import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/queries";

/**
 * The customer population.
 *
 * Two rules are baked in here rather than left to the caller:
 *
 *   House accounts are excluded by TAG, never by order volume. Venue tables,
 *   "By The Glass", "Free of Charge Goods FOC" and staff carry
 *   CUSTOMER_INTERNAL or "CUSTOMER TYPE_Employee". Filtering by volume instead
 *   would drop a genuine customer with 708 orders and 79,840 JOD who carries
 *   no such tag. What is excluded is reported, not hidden.
 *
 *   Value figures use revenue_jod, computed from orders, NOT amount_spent_jod.
 *   Of 808 customers tested, amountSpent matched the non-cancelled sum 572
 *   times, the all-orders sum 175 times and neither 61 times. It is fine for
 *   ranking and wrong for arithmetic.
 */
export type CustomerRow = {
  loyalty_enrolled: boolean | null;
  shopify_customer_id: string;
  orders_lifetime: number;
  revenue_jod: number | null;
  first_order_date: string | null;
  second_order_date: string | null;
  last_order_date: string | null;
  first_order_channel: string | null;
  has_email: boolean;
  has_phone: boolean;
  email_consent: string | null;
  sms_consent: string | null;
  is_house_account: boolean;
};

export const fetchCustomers = () =>
  fetchAllRows<CustomerRow>((from, to) =>
    supabase
      .from("shopify_customers")
      .select(
        "shopify_customer_id,orders_lifetime,revenue_jod,first_order_date,second_order_date,last_order_date,first_order_channel,has_email,has_phone,email_consent,sms_consent,is_house_account,loyalty_enrolled",
      )
      .order("shopify_customer_id")
      .range(from, to),
  );

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

export type CustomerPicture = ReturnType<typeof summarise>;

export function summarise(all: CustomerRow[], today: string, activeWindowDays = 90) {
  const house = all.filter((c) => c.is_house_account);
  const real = all.filter((c) => !c.is_house_account);
  const buyers = real.filter((c) => c.first_order_date !== null);
  const rev = (c: CustomerRow) => Number(c.revenue_jod ?? 0);
  const totalRevenue = buyers.reduce((a, c) => a + rev(c), 0);

  const cutoff = (n: number) => {
    const d = new Date(Date.parse(today));
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const activeCut = cutoff(activeWindowDays);
  const lapsingCut = cutoff(activeWindowDays * 2);

  const bucket = (c: CustomerRow) => {
    if (!c.last_order_date) return "never" as const;
    if (c.last_order_date >= activeCut) return "active" as const;
    if (c.last_order_date >= lapsingCut) return "lapsing" as const;
    return "lapsed" as const;
  };

  // A single order only means "never returned" once it has HAD time to repeat.
  const mature = buyers.filter((c) => c.first_order_date && days(c.first_order_date, today) >= 90);
  const oneAndDone = mature.filter((c) => c.orders_lifetime === 1);

  const sorted = [...buyers].sort((a, b) => rev(b) - rev(a));
  const shareOfTop = (pct: number) => {
    const n = Math.max(1, Math.round(sorted.length * (pct / 100)));
    return totalRevenue > 0
      ? (sorted.slice(0, n).reduce((a, c) => a + rev(c), 0) / totalRevenue) * 100
      : 0;
  };
  const values = buyers.map(rev).sort((a, b) => a - b);
  const quantile = (q: number) =>
    values.length ? (values[Math.floor((values.length - 1) * q)] ?? 0) : 0;

  const sub = (c: CustomerRow) =>
    c.email_consent === "SUBSCRIBED" || c.sms_consent === "SUBSCRIBED";
  const unreachable = buyers.filter((c) => !sub(c));

  return {
    houseExcluded: {
      count: house.length,
      orders: house.reduce((a, c) => a + c.orders_lifetime, 0),
    },
    totalCustomers: real.length,
    buyers: buyers.length,
    neverOrdered: real.length - buyers.length,

    lifecycle: {
      active: buyers.filter((c) => bucket(c) === "active").length,
      lapsing: buyers.filter((c) => bucket(c) === "lapsing").length,
      lapsed: buyers.filter((c) => bucket(c) === "lapsed").length,
    },

    oneAndDone: {
      count: oneAndDone.length,
      of: mature.length,
      pct: mature.length ? (oneAndDone.length / mature.length) * 100 : 0,
    },

    concentration: {
      top1: shareOfTop(1),
      top5: shareOfTop(5),
      top10: shareOfTop(10),
      mean: buyers.length ? totalRevenue / buyers.length : 0,
      median: quantile(0.5),
      p90: quantile(0.9),
      p10: quantile(0.1),
      totalRevenue,
    },

    reach: {
      unreachable: unreachable.length,
      unreachablePct: buyers.length ? (unreachable.length / buyers.length) * 100 : 0,
      unreachableRevenue: unreachable.reduce((a, c) => a + rev(c), 0),
      unreachableRevenuePct: totalRevenue
        ? (unreachable.reduce((a, c) => a + rev(c), 0) / totalRevenue) * 100
        : 0,
      neverOptedIn: unreachable.filter((c) => c.has_email && c.email_consent === "NOT_SUBSCRIBED")
        .length,
      optedOut: unreachable.filter((c) => c.email_consent === "UNSUBSCRIBED").length,
      smsOnly: buyers.filter((c) => c.has_phone && !sub(c)).length,
      smsOnlyRevenue: buyers.filter((c) => c.has_phone && !sub(c)).reduce((a, c) => a + rev(c), 0),
    },
  };
}

/** Repeat rate by acquisition year, comparable because it is age-limited. */
export function cohorts(all: CustomerRow[], today: string, windowDays = 90) {
  const buyers = all.filter((c) => !c.is_house_account && c.first_order_date);
  const byYear = new Map<string, CustomerRow[]>();
  for (const c of buyers) {
    const y = c.first_order_date!.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(c);
  }
  return [...byYear.entries()].sort().map(([year, rows]) => {
    // Only customers who have HAD the window to repeat in. Without this the
    // rate falls every year purely because newer cohorts have had less time,
    // which reads as collapse and is not.
    const eligible = rows.filter((c) => days(c.first_order_date!, today) >= windowDays);
    const repeated = eligible.filter(
      (c) => c.second_order_date && days(c.first_order_date!, c.second_order_date) <= windowDays,
    );
    return {
      year,
      acquired: rows.length,
      eligible: eligible.length,
      repeatPct: eligible.length ? (repeated.length / eligible.length) * 100 : null,
    };
  });
}

const CHANNELS = ["Mobile App", "Website", "Draft Orders", "POS"] as const;

/** Lifetime value and retention by the channel a customer was ACQUIRED through. */
export function byAcquisitionChannel(all: CustomerRow[], today: string, windowDays = 90) {
  const eligible = all.filter(
    (c) =>
      !c.is_house_account &&
      c.first_order_date &&
      c.first_order_channel &&
      days(c.first_order_date, today) >= windowDays,
  );
  return CHANNELS.map((ch) => {
    const rows = eligible.filter((c) => c.first_order_channel === ch);
    const repeated = rows.filter(
      (c) => c.second_order_date && days(c.first_order_date!, c.second_order_date) <= windowDays,
    );
    const values = rows.map((c) => Number(c.revenue_jod ?? 0)).sort((a, b) => a - b);
    return {
      channel: ch,
      customers: rows.length,
      repeatPct: rows.length ? (repeated.length / rows.length) * 100 : null,
      avgOrders: rows.length ? rows.reduce((a, c) => a + c.orders_lifetime, 0) / rows.length : 0,
      medianRevenue: values.length ? (values[Math.floor((values.length - 1) / 2)] ?? 0) : 0,
    };
  }).filter((r) => r.customers > 0);
}

/**
 * Splits the repeat-rate change into "who we acquired" and "how well each
 * channel held them".
 *
 * `predicted` holds every channel at its own all-time rate and varies only the
 * MIX. Where actual runs below predicted, channels are retaining worse than
 * their own history — which is the harder finding, and the one the app story
 * tends to bury.
 *
 * Indicative, not exact: the all-time rate for the app is dominated by its
 * early years, so this flatters the mix explanation in later cohorts.
 */
export function mixVersusDecay(all: CustomerRow[], today: string, windowDays = 90) {
  const base = new Map(
    byAcquisitionChannel(all, today, windowDays).map((r) => [
      r.channel as string,
      r.repeatPct ?? 0,
    ]),
  );
  const eligible = all.filter(
    (c) =>
      !c.is_house_account &&
      c.first_order_date &&
      c.first_order_channel &&
      days(c.first_order_date, today) >= windowDays,
  );
  const byYear = new Map<string, CustomerRow[]>();
  for (const c of eligible) {
    const y = c.first_order_date!.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(c);
  }
  return [...byYear.entries()].sort().map(([year, rows]) => {
    const repeated = rows.filter(
      (c) => c.second_order_date && days(c.first_order_date!, c.second_order_date) <= windowDays,
    );
    const actual = (repeated.length / rows.length) * 100;
    const predicted =
      rows.reduce((a, c) => a + (base.get(c.first_order_channel!) ?? 0), 0) / rows.length;
    const appShare =
      (rows.filter((c) => c.first_order_channel === "Mobile App").length / rows.length) * 100;
    return { year, customers: rows.length, actual, predicted, gap: actual - predicted, appShare };
  });
}

/** Per-channel repeat rate by cohort — shows WHERE the decay is concentrated. */
export function channelDecay(all: CustomerRow[], today: string, windowDays = 90) {
  const eligible = all.filter(
    (c) =>
      !c.is_house_account &&
      c.first_order_date &&
      c.first_order_channel &&
      days(c.first_order_date, today) >= windowDays,
  );
  const years = [...new Set(eligible.map((c) => c.first_order_date!.slice(0, 4)))].sort();
  return CHANNELS.map((ch) => {
    const rows = eligible.filter((c) => c.first_order_channel === ch);
    const perYear = years.map((y) => {
      const g = rows.filter((c) => c.first_order_date!.startsWith(y));
      // Below this a single customer moves the rate by more than a point.
      if (g.length < 40) return { year: y, pct: null, n: g.length };
      const r = g.filter(
        (c) => c.second_order_date && days(c.first_order_date!, c.second_order_date) <= windowDays,
      );
      return { year: y, pct: (r.length / g.length) * 100, n: g.length };
    });
    const measured = perYear.filter((p) => p.pct !== null);
    const firstM = measured[0];
    const lastM = measured[measured.length - 1];
    return {
      channel: ch,
      perYear,
      change: firstM && lastM && firstM !== lastM ? lastM.pct! - firstM.pct! : null,
      from: firstM?.year ?? null,
      to: lastM?.year ?? null,
    };
  });
}

/**
 * New customers captured per 100 POS orders, monthly.
 *
 * A staff-behaviour metric, not a data one. It collapsed in the second half of
 * 2023 — 12.0 per 100 orders in 2023 H1, 5.2 in H2, 3.2 by 2024 — and has sat
 * between 3.0 and 4.0 ever since. Capture tracks basket size: 83.5% of orders
 * over 250 JOD carry a customer against 24.7% of orders under 10.
 *
 * Stops at the POS definition change. From 27 February 2026 only orders with an
 * identified customer sync at all, so the denominator becomes "identified POS
 * orders" and the ratio stops meaning what it meant before. Showing the later
 * months on the same axis would imply a recovery that is an artefact.
 */
export const POS_CAPTURE_COMPARABLE_UNTIL = "2026-02-27";

export type CaptureMonth = {
  month: string;
  posOrders: number;
  newCustomers: number;
  per100: number;
};

export function posCapture(
  sales: { date: string; sub_channel: string; orders: number }[],
  customers: CustomerRow[],
): CaptureMonth[] {
  const orders = new Map<string, number>();
  for (const s of sales) {
    if (s.sub_channel !== "POS" || s.date >= POS_CAPTURE_COMPARABLE_UNTIL) continue;
    const m = s.date.slice(0, 7);
    orders.set(m, (orders.get(m) ?? 0) + s.orders);
  }
  const acquired = new Map<string, number>();
  for (const c of customers) {
    if (c.is_house_account || c.first_order_channel !== "POS" || !c.first_order_date) continue;
    if (c.first_order_date >= POS_CAPTURE_COMPARABLE_UNTIL) continue;
    const m = c.first_order_date.slice(0, 7);
    acquired.set(m, (acquired.get(m) ?? 0) + 1);
  }
  return [...orders.entries()]
    .sort()
    .filter(([, n]) => n >= 100) // below this a handful of orders swings the rate
    .map(([month, posOrders]) => {
      const newCustomers = acquired.get(month) ?? 0;
      return { month, posOrders, newCustomers, per100: (newCustomers / posOrders) * 100 };
    });
}

/**
 * How often the shop has a busy day, and what that costs in identification.
 *
 * A separate factor from the July 2023 drop, and actionable without knowing
 * what caused it: when the shop is busy, capture falls. If busy days become
 * more common, capture erodes on its own without anyone changing behaviour.
 *
 * Frequency is computed live from order counts. The identification RATES are
 * fixed measurements from a sweep on 29 August 2026, because per-order customer
 * presence is not stored — only the daily aggregate is.
 */
export const BUSY_DAY_ORDERS = 60;
export const BUSY_DAY_IDENTIFICATION = {
  measuredOn: "2026-08-29",
  normalDaysRange: "35 to 79%",
  busyDaysRange: "24 to 40%",
};

export function busyDays(sales: { date: string; sub_channel: string; orders: number }[]) {
  const perDay = new Map<string, number>();
  for (const s of sales) {
    if (s.sub_channel !== "POS") continue;
    perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.orders);
  }
  const byQuarter = new Map<
    string,
    { days: number; busy: number; busyOrders: number; orders: number }
  >();
  for (const [date, n] of perDay) {
    const q = `${date.slice(0, 4)} Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
    const v = byQuarter.get(q) ?? { days: 0, busy: 0, busyOrders: 0, orders: 0 };
    v.days++;
    v.orders += n;
    if (n >= BUSY_DAY_ORDERS) {
      v.busy++;
      v.busyOrders += n;
    }
    byQuarter.set(q, v);
  }
  return [...byQuarter.entries()].sort().map(([quarter, v]) => ({
    quarter,
    ...v,
    busyShareOfOrders: v.orders ? (v.busyOrders / v.orders) * 100 : 0,
  }));
}

/**
 * Retention by loyalty enrolment, within acquisition channel.
 *
 * The largest single difference measured anywhere in this project — and
 * CORRELATIONAL. Loyal customers are more likely to enrol, so this shows where
 * to look, not what to conclude. Never phrase it as enrolment causing
 * retention.
 */
export function byEnrolment(all: CustomerRow[], today: string, windowDays = 90) {
  const eligible = all.filter(
    (c) =>
      !c.is_house_account &&
      c.first_order_date &&
      c.first_order_channel &&
      days(c.first_order_date, today) >= windowDays,
  );
  const rate = (rows: CustomerRow[]) =>
    rows.length
      ? (rows.filter(
          (c) =>
            c.second_order_date && days(c.first_order_date!, c.second_order_date) <= windowDays,
        ).length /
          rows.length) *
        100
      : null;
  return CHANNELS.map((ch) => {
    const rows = eligible.filter((c) => c.first_order_channel === ch);
    const yes = rows.filter((c) => c.loyalty_enrolled === true);
    const no = rows.filter((c) => c.loyalty_enrolled !== true);
    return {
      channel: ch,
      enrolled: yes.length,
      enrolledRate: rate(yes),
      notEnrolled: no.length,
      notEnrolledRate: rate(no),
      enrolledOrders: yes.length ? yes.reduce((a, c) => a + c.orders_lifetime, 0) / yes.length : 0,
      notEnrolledOrders: no.length ? no.reduce((a, c) => a + c.orders_lifetime, 0) / no.length : 0,
    };
  }).filter((r) => r.enrolled + r.notEnrolled > 0);
}

/**
 * The within-customer enrolment test, as measured on 29 August 2026.
 *
 * Held as constants rather than computed live because it needs each customer's
 * full order history relative to their enrolment date, which is a 163,000-order
 * sweep and is not stored. Re-run scripts/diagnose/enrolment-effect.mjs and
 * update these; the panel prints the date so a stale figure is visible.
 *
 * Kept next to the cross-sectional numbers deliberately. On its own the
 * cross-sectional gap reads as an argument for pushing enrolment, and it is
 * not one.
 */
export const ENROLMENT_WITHIN_CUSTOMER = {
  measuredOn: "2026-08-29",
  windowDays: 180,
  clean: { customers: 4115, before: 1.92, after: 1.42, changePct: -25.9 },
  biased: { customers: 416, before: 5.27, after: 6.4, changePct: 21.4 },

  /**
   * Three windows, one sweep. The direction holds at every width, and the two
   * rows move in opposite ways as the window grows — which is itself evidence
   * that the split is doing its job.
   *
   * The biased subset decays from +25.6% to +3.3% as the window widens, because
   * the single purchase its "after" window opens on matters less across a
   * longer span. The clean result stays between -23.7% and -32.5%. If the
   * effect were real rather than selection, widening the window would not
   * dissolve the positive result and leave the negative one standing.
   */
  windows: [
    { days: 90, cleanN: 4792, cleanChange: -32.5, biasedN: 497, biasedChange: 25.6 },
    { days: 180, cleanN: 4115, cleanChange: -25.9, biasedN: 416, biasedChange: 21.4 },
    { days: 365, cleanN: 2875, cleanChange: -23.7, biasedN: 194, biasedChange: 3.3 },
  ],
};

/**
 * The lapsed segment: bought once, and not since the cutoff.
 *
 * Kept distinct from "never bought" deliberately. Before six years of history
 * were loaded, the only available figure was "no order since 2025-01-01",
 * which put someone who spent 3,000 JOD in 2023 in the same bucket as someone
 * who has never ordered at all. Those are opposite marketing problems.
 *
 * CONSENT IS THE POINT OF THIS PANEL. The value of the segment is not its size
 * but the part of it that can be emailed today with no opt-in step, so the
 * subscribed subset is computed first and everything else is broken down
 * WITHIN it. A band containing people who cannot be contacted would be a
 * target list that quietly does not exist.
 */
export const LAPSED_SINCE = "2025-01-01";

const VALUE_BANDS = [
  { label: "1,000+", min: 1000 },
  { label: "500 – 999", min: 500 },
  { label: "100 – 499", min: 100 },
  { label: "Under 100", min: 0 },
] as const;

export function lapsed(all: CustomerRow[], since: string = LAPSED_SINCE) {
  const rev = (c: CustomerRow) => Number(c.revenue_jod ?? 0);
  const sum = (rows: CustomerRow[]) => rows.reduce((a, c) => a + rev(c), 0);

  const all_ = all.filter(
    (c) => !c.is_house_account && c.first_order_date !== null && c.last_order_date !== null,
  );
  const rows = all_.filter((c) => c.last_order_date! < since);

  // SUBSCRIBED only. "has an email address" is not consent, and NOT_SUBSCRIBED
  // is not the same as UNSUBSCRIBED — neither can be mailed, but only one of
  // them has ever been asked. Both are reported so the gap is visible.
  const contactable = rows.filter((c) => c.email_consent === "SUBSCRIBED");
  const unsubscribed = rows.filter((c) => c.email_consent === "UNSUBSCRIBED");
  const neverAsked = rows.filter(
    (c) => c.has_email && c.email_consent !== "SUBSCRIBED" && c.email_consent !== "UNSUBSCRIBED",
  );

  const band = (c: CustomerRow) => VALUE_BANDS.find((b) => rev(c) >= b.min)!.label;
  const byValue = VALUE_BANDS.map((b) => {
    const inBand = contactable.filter((c) => band(c) === b.label);
    return {
      band: b.label,
      customers: inBand.length,
      revenue: sum(inBand),
      avgOrders: inBand.length
        ? inBand.reduce((a, c) => a + c.orders_lifetime, 0) / inBand.length
        : 0,
    };
  }).filter((b) => b.customers > 0);

  const years = [...new Set(contactable.map((c) => c.last_order_date!.slice(0, 4)))].sort();
  const byYear = years.map((y) => {
    const inYear = contactable.filter((c) => c.last_order_date!.startsWith(y));
    return {
      year: y,
      customers: inYear.length,
      revenue: sum(inYear),
      avgOrders: inYear.length
        ? inYear.reduce((a, c) => a + c.orders_lifetime, 0) / inYear.length
        : 0,
    };
  });

  // Where to start: high value AND most recently lapsed. Recency matters
  // because the further back the last order, the more likely the address is
  // dead and the person has simply moved on.
  const mostRecentYear = years.at(-1) ?? null;
  const priority = contactable.filter(
    (c) => rev(c) >= 1000 && mostRecentYear !== null && c.last_order_date!.startsWith(mostRecentYear),
  );

  return {
    since,
    total: { customers: rows.length, revenue: sum(rows) },
    contactable: { customers: contactable.length, revenue: sum(contactable) },
    unsubscribed: { customers: unsubscribed.length, revenue: sum(unsubscribed) },
    neverAsked: { customers: neverAsked.length, revenue: sum(neverAsked) },
    noEmail: rows.filter((c) => !c.has_email).length,
    byValue,
    byYear,
    mostRecentYear,
    priority: { customers: priority.length, revenue: sum(priority) },
  };
}
