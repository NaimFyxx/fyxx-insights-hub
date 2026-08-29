import { supabase } from "@/integrations/supabase/client";
import {
  fetchCampaigns,
  fetchFlows,
  fetchPush,
  fetchDailySales,
  fetchAttributed,
  fetchSnapshots,
  fetchActivations,
  type Campaign,
  type FlowRow,
  type PushRow,
  type Activation,
} from "@/lib/queries";
import { POS_DEFINITION_CHANGED } from "@/lib/channels";
import { settledOnly, rangeIncludesToday, type DateRange } from "@/lib/ranges";

/**
 * A section that cannot be rendered honestly is marked unavailable with the
 * reason, and the report prints the reason instead of the figures.
 *
 * The rule, from the audit: a blank section with an explanation is fine; a
 * zero that looks like a real measurement is not. Zeid sees no filters, cannot
 * click anything, and has no way to tell an unmeasured zero from a real one.
 */
export type Availability = { available: true } | { available: false; reason: string };

const ok: Availability = { available: true };

/**
 * Attributed revenue was withheld from the report while our figure and
 * Klaviyo's disagreed by roughly a factor of two. That is resolved: Klaviyo
 * never retracts a Placed Order event when an order is cancelled, so the old
 * metric-aggregate kept counting cancelled orders at full value. Attribution
 * is now stored per order and netted against current cancellations at read
 * time, and the daily figure is bounded by that day's total sales.
 *
 * August 2026 moved from 37,615 JOD to 28,260, and 5 August from an impossible
 * 8,530 against 5,220 of sales to 1,618.
 *
 * Kept as a switch rather than deleted: if the bound is ever breached again,
 * flipping this back withholds the figure instead of publishing a wrong one.
 */
export const ATTRIBUTION_UNRECONCILED = false;
const no = (reason: string): Availability => ({ available: false, reason });

/** Every day in the range, for coverage checks. */
function daysIn(r: DateRange): string[] {
  const out: string[] = [];
  const end = new Date(`${r.to}T12:00:00Z`);
  for (let d = new Date(`${r.from}T12:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export type ReachSection = {
  availability: Availability;
  emailCampaigns: number;
  push: number;
  flows: number;
  totalUnique: number;
  totalSends: number;
  daysCovered: number;
  daysInRange: number;
};

/**
 * Unique reach. The cross-channel total is a genuine distinct count, so it is
 * SMALLER than the three channel figures added together — anyone reached on
 * both email and push is one person, counted once. That is expected, and the
 * report says so rather than leaving it to look like an error.
 */
async function buildReach(r: DateRange): Promise<ReachSection> {
  const days = daysIn(r);

  // klaviyo_reach_daily holds per-person records and is service-role only, so
  // the frontend must never read it. Coverage comes from sync_log, and the
  // counts come from the SECURITY DEFINER function, which returns integers and
  // never the underlying sets.
  const { data: logged } = await supabase
    .from("sync_log")
    .select("range_start")
    .eq("source", "klaviyo_reach")
    .eq("status", "success")
    .gte("range_start", r.from)
    .lte("range_start", r.to)
    .range(0, 999);
  const daysCovered = new Set((logged ?? []).map((x) => x.range_start as string)).size;

  const { data, error } = await supabase.rpc("klaviyo_reach_counts", {
    p_from: r.from,
    p_to: r.to,
  });
  const row = Array.isArray(data) ? data[0] : data;

  const empty = { emailCampaigns: 0, push: 0, flows: 0, totalUnique: 0, totalSends: 0 };
  if (error || !row) {
    return {
      availability: no("Unique reach could not be read."),
      ...empty,
      daysCovered,
      daysInRange: days.length,
    };
  }
  if (daysCovered === 0) {
    return {
      availability: no(
        `Unique reach has not been collected for this period. The backfill runs nightly and has not yet reached ${r.from}.`,
      ),
      ...empty,
      daysCovered,
      daysInRange: days.length,
    };
  }
  if (daysCovered < days.length) {
    return {
      availability: no(
        `Unique reach covers only ${daysCovered} of ${days.length} days in this period, so a total would understate it. The backfill is still running.`,
      ),
      emailCampaigns: row.email_campaigns ?? 0,
      push: row.push_all ?? 0,
      flows: row.flows_all ?? 0,
      totalUnique: row.total_unique ?? 0,
      totalSends: row.total_sends ?? 0,
      daysCovered,
      daysInRange: days.length,
    };
  }
  return {
    availability: ok,
    emailCampaigns: row.email_campaigns ?? 0,
    push: row.push_all ?? 0,
    flows: row.flows_all ?? 0,
    totalUnique: row.total_unique ?? 0,
    totalSends: row.total_sends ?? 0,
    daysCovered,
    daysInRange: days.length,
  };
}

export type FlowAgg = {
  name: string;
  recipients: number;
  delivered: number;
  opened: number;
  conversions: number;
  revenue: number;
};

/**
 * Top 8 flows by revenue, then ONE rolled-up row for every other flow with
 * sends in the period, then a total. Names exactly as Klaviyo returns them —
 * never reformatted, because a renamed flow must be recognisable.
 */
export function rollUpFlows(rows: FlowRow[]): {
  top: FlowAgg[];
  otherCount: number;
  other: FlowAgg | null;
  total: FlowAgg;
} {
  const byName = new Map<string, FlowAgg>();
  for (const r of rows) {
    const cur = byName.get(r.flow_name) ?? {
      name: r.flow_name,
      recipients: 0,
      delivered: 0,
      opened: 0,
      conversions: 0,
      revenue: 0,
    };
    cur.recipients += r.recipients;
    cur.delivered += r.delivered;
    cur.opened += r.opened;
    cur.conversions += r.conversions;
    cur.revenue += Number(r.revenue_jod);
    byName.set(r.flow_name, cur);
  }
  // Only flows that actually sent. Over 50 flows exist and most never send;
  // a zero row for each would fill the page with nothing.
  const live = [...byName.values()].filter((f) => f.recipients > 0);
  live.sort((a, b) => b.revenue - a.revenue);

  const top = live.slice(0, 8);
  const rest = live.slice(8);
  const fold = (name: string, xs: FlowAgg[]): FlowAgg =>
    xs.reduce(
      (a, f) => ({
        name,
        recipients: a.recipients + f.recipients,
        delivered: a.delivered + f.delivered,
        opened: a.opened + f.opened,
        conversions: a.conversions + f.conversions,
        revenue: a.revenue + f.revenue,
      }),
      { name, recipients: 0, delivered: 0, opened: 0, conversions: 0, revenue: 0 },
    );

  return {
    top,
    otherCount: rest.length,
    other: rest.length ? fold(`All other live flows with sends (${rest.length})`, rest) : null,
    total: fold("All live flows", live),
  };
}

export type Narrative = {
  id: string | null;
  monthHighlight: string;
  nextMonthBullets: string[];
};

/** The written parts of the report. Stored per range in `reports`. */
export async function fetchNarrative(r: DateRange): Promise<Narrative> {
  const { data } = await supabase
    .from("reports")
    .select("id, month_highlight, next_month_bullets")
    .eq("start_date", r.from)
    .eq("end_date", r.to)
    .maybeSingle();
  return {
    id: data?.id ?? null,
    monthHighlight: data?.month_highlight ?? "",
    nextMonthBullets: data?.next_month_bullets ?? [],
  };
}

export async function saveNarrative(r: DateRange, n: Omit<Narrative, "id">) {
  const { error } = await supabase.from("reports").upsert(
    {
      start_date: r.from,
      end_date: r.to,
      month_highlight: n.monthHighlight,
      next_month_bullets: n.nextMonthBullets,
    },
    { onConflict: "start_date,end_date" },
  );
  if (error) throw error;
}

export type PushAgg = { name: string; sent: number; delivered: number; opened: number };

/**
 * 34 distinct push sources send in a typical month, which would run to a
 * 35-row table in a half-width column. Same shape as the flows table: the
 * biggest senders by name, then one honest rollup, then a total.
 */
export function rollUpPush(
  rows: PushRow[],
  topN = 6,
): {
  top: PushAgg[];
  other: PushAgg | null;
  total: PushAgg;
} {
  const byName = new Map<string, PushAgg>();
  for (const r of rows) {
    const cur = byName.get(r.source_name) ?? {
      name: r.source_name,
      sent: 0,
      delivered: 0,
      opened: 0,
    };
    cur.sent += r.sent;
    cur.delivered += r.delivered;
    cur.opened += r.opened;
    byName.set(r.source_name, cur);
  }
  const live = [...byName.values()].filter((p) => p.sent > 0).sort((a, b) => b.sent - a.sent);
  const fold = (name: string, xs: PushAgg[]): PushAgg =>
    xs.reduce(
      (a, p) => ({
        name,
        sent: a.sent + p.sent,
        delivered: a.delivered + p.delivered,
        opened: a.opened + p.opened,
      }),
      { name, sent: 0, delivered: 0, opened: 0 },
    );
  const rest = live.slice(topN);
  return {
    top: live.slice(0, topN),
    other: rest.length ? fold(`All other push sends (${rest.length})`, rest) : null,
    total: fold("Total", live),
  };
}

export type ReportData = {
  range: DateRange;
  narrative: Narrative;
  reach: ReachSection;
  campaigns: { availability: Availability; rows: Campaign[] };
  flows: { availability: Availability; rollup: ReturnType<typeof rollUpFlows> };
  push: { availability: Availability; rollup: ReturnType<typeof rollUpPush> };
  loyalty: {
    availability: Availability;
    latest: Awaited<ReturnType<typeof fetchSnapshots>>[number] | null;
    prior: Awaited<ReturnType<typeof fetchSnapshots>>[number] | null;
    birthdayRewards: number;
    birthdayAvailability: Availability;
    pointsRow: Awaited<ReturnType<typeof fetchSnapshots>>[number] | null;
    pointsAvailability: Availability;
  };
  activations: Activation[];
  revenue: {
    availability: Availability;
    klaviyoAttributed: number;
    allChannels: number;
    sharePct: number | null;
    /** True when the range runs into the day still in progress. */
    shareIsPartial: boolean;
  };
  notices: string[];
};

export async function buildReport(range: DateRange): Promise<ReportData> {
  const [reach, campaigns, flows, push, sales, attributed, snaps, activations, narrative] =
    await Promise.all([
      buildReach(range),
      fetchCampaigns(range),
      fetchFlows(range),
      fetchPush(range),
      fetchDailySales(range),
      fetchAttributed(range),
      fetchSnapshots(range),
      fetchActivations(),
      fetchNarrative(range),
    ]);

  const days = daysIn(range);

  // Flow reports are backfilled a day at a time; an incomplete range would
  // understate every flow figure without looking wrong.
  const flowDays = new Set(flows.map((f) => f.date));
  const flowsAvailability: Availability =
    flowDays.size === 0
      ? no(
          `Flow data has not been collected for this period. The backfill runs nightly and has not yet reached ${range.from}.`,
        )
      : flowDays.size < days.length
        ? no(
            `Flow data covers only ${flowDays.size} of ${days.length} days, so these figures would understate the period. The backfill is still running.`,
          )
        : ok;

  // Tier counts exist only for days LoyaltyLion was scanned.
  const scanned = snaps.filter((s) => s.blue_members > 0);
  const latest = scanned.at(-1) ?? null;

  // Compare against the last measurement BEFORE this period, so the delta means
  // "since the previous month" rather than "since a snapshot two days ago".
  const { data: priorRows } = await supabase
    .from("ll_snapshots")
    .select("*")
    .lt("snapshot_date", range.from)
    .gt("blue_members", 0)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  const priorOutside = priorRows?.[0] ?? null;
  const loyaltyAvailability: Availability = latest
    ? ok
    : no(
        "Tier membership was not measured in this period. Nightly snapshots began on 27 August 2026 and LoyaltyLion cannot report tiers historically.",
      );

  // Points outstanding is recorded on every snapshot, including the imported
  // LoyaltyLion export days, so it has much better coverage than tier counts
  // and carries its own date rather than borrowing the tier snapshot's.
  const pointsRow = snaps.filter((s) => Number(s.points_outstanding) > 0).at(-1) ?? null;
  const pointsAvailability: Availability = pointsRow
    ? ok
    : no("Points outstanding was not recorded for this period.");

  // birthday_rewards_issued has never been populated: it is zero on all 369
  // snapshots because the sync does not collect it. Printing "0" would state a
  // measurement that was never taken, so the report says it is not collected.
  const birthdayMeasured = snaps.some((s) => s.birthday_rewards_issued > 0);
  const birthdayAvailability: Availability = birthdayMeasured
    ? ok
    : no("Birthday rewards are not yet collected by the nightly sync.");

  const klaviyoAttributed = attributed.reduce((a, x) => a + Number(x.revenue_jod), 0);
  const allChannels = sales.reduce((a, x) => a + Number(x.total_online_revenue_jod), 0);

  // The SHARE divides two sources synced hours apart, so the day still in
  // progress is excluded from both sides of it. The absolute figures above
  // keep the whole range. A month-end export is unaffected; only an export run
  // mid-month, which is exactly when someone is checking a figure early.
  const klaviyoSettled = settledOnly(attributed).reduce((a, x) => a + Number(x.revenue_jod), 0);
  const salesSettled = settledOnly(sales).reduce(
    (a, x) => a + Number(x.total_online_revenue_jod),
    0,
  );
  const shareIsPartial = rangeIncludesToday(range);

  const notices: string[] = [];
  if (range.from < POS_DEFINITION_CHANGED && range.to >= POS_DEFINITION_CHANGED) {
    notices.push(
      "This period spans 27 February 2026, when POS changed meaning: before that date it covers every retail order, after it covers only orders with an identified customer. POS figures either side are not comparable.",
    );
  }

  return {
    range,
    narrative,
    reach,
    campaigns: {
      availability: campaigns.length ? ok : no("No campaigns were sent in this period."),
      rows: campaigns,
    },
    flows: { availability: flowsAvailability, rollup: rollUpFlows(flows) },
    push: {
      availability: push.length ? ok : no("No push notifications were sent in this period."),
      rollup: rollUpPush(push),
    },
    loyalty: {
      availability: loyaltyAvailability,
      latest,
      prior: priorOutside ?? (scanned.length > 1 ? (scanned[0] ?? null) : null),
      birthdayRewards: snaps.reduce((a, s) => a + s.birthday_rewards_issued, 0),
      birthdayAvailability,
      pointsRow,
      pointsAvailability,
    },
    activations: activations.filter((a) => a.date >= range.from && a.date <= range.to),
    revenue: {
      availability: ATTRIBUTION_UNRECONCILED
        ? no(
            "Revenue attributed to Klaviyo is withheld this month. Our own figure and Klaviyo's disagree by roughly a factor of two, and the cause is still being traced. It will be reported once the two agree.",
          )
        : ok,
      klaviyoAttributed,
      allChannels,
      sharePct: salesSettled > 0 ? (klaviyoSettled / salesSettled) * 100 : null,
      shareIsPartial,
    },
    notices,
  };
}
