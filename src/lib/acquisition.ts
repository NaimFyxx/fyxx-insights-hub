import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/queries";
import type { DateRange } from "@/lib/ranges";

/**
 * Acquisition channel: where the CUSTOMER first came from.
 *
 * Distinct from the order channel that the global toggles filter on, which is
 * where each individual order came from. The two diverge and the gap is the
 * point: a customer the app acquired who now phones their orders in shows as
 * Draft Orders revenue, so marketing acquired them and the sales team gets
 * credited.
 *
 * Reads a VIEW, so cancellations net at read time rather than being frozen
 * into a stored total.
 */
export type AcqRow = {
  month: string;
  acquisition_channel: string;
  order_channel: string;
  is_first_order: boolean;
  orders: number;
  revenue_jod: number;
};

/** Channels that represent a customer marketing brought in. */
export const ONLINE_ACQUIRED = ["Website", "Mobile App"] as const;

/**
 * Rows that carry no acquisition channel and never can.
 *
 * Kept visible rather than filtered away. These are orders with nobody
 * attached — mostly POS, where the Odoo connector syncs orders without an
 * identified customer. Any acquisition-based figure is therefore a FLOOR, not
 * a total, and every panel says so.
 */
export const UNATTRIBUTABLE = [
  "No customer on order",
  "Customer not on file",
  "Customer, no acquisition channel",
];

export const isUnattributable = (c: string) => UNATTRIBUTABLE.includes(c);
export const isOnlineAcquired = (c: string) => (ONLINE_ACQUIRED as readonly string[]).includes(c);

/**
 * Measured 30 August 2026 across the full order history, from order-level data
 * rather than estimated from aggregates. An earlier estimate of the ORDER
 * share was wrong (10.7% against a true 16.4%); the revenue share was right.
 */
export const ACQUISITION_COVERAGE = {
  measuredOn: "2026-08-30",
  pctRevenueAssignable: 84.4,
  pctOrdersNoCustomer: 16.4,
  pctRevenueNoCustomer: 9.5,
} as const;

/**
 * Coverage is computed FROM THE RANGE ON SCREEN, not printed as a constant.
 *
 * It varies a great deal by period — 83.7% in 2024 against 99.8% in 2020 —
 * because it depends on how many orders carried a customer at the time. A
 * fixed 84.4% shown above a month where the real figure is 99.8% would itself
 * be a misleading number, which is the exact failure this note exists to
 * prevent. The all-time figure stays available as context.
 */
export function coverageNote(h: ReturnType<typeof headline>): string {
  const covered = h.unattributablePct === null ? null : 100 - h.unattributablePct;
  const head =
    covered === null
      ? "Acquisition figures cannot be assigned to a channel for part of this revenue."
      : `Acquisition figures cover ${covered.toFixed(1)}% of revenue in this range.`;
  return (
    `${head} The rest is orders with no customer attached, mostly POS, which can never carry ` +
    `an acquisition channel. Every figure here is a FLOOR, not a total. ` +
    `Across the full history since 2019 the figure is ${ACQUISITION_COVERAGE.pctRevenueAssignable}%, ` +
    `and coverage varies by period — it was 83.7% in 2024 and 99.8% in 2020.`
  );
}

/**
 * Postgres cannot prove a view's columns are non-null, so the generated types
 * widen every one of them. Fetch the nullable shape and narrow here, the same
 * way fetchAttributed does, rather than lying to the type system upstream.
 *
 * The month filter starts at the FIRST of the selected range's month, because
 * the view buckets monthly: a range beginning mid-month would otherwise drop
 * that month entirely rather than including it.
 */
type AcqRowRaw = {
  month: string | null;
  acquisition_channel: string | null;
  order_channel: string | null;
  is_first_order: boolean | null;
  orders: number | null;
  revenue_jod: number | null;
};

export const fetchAcquisition = async (r: DateRange): Promise<AcqRow[]> => {
  const rows = await fetchAllRows<AcqRowRaw>((from, to) =>
    supabase
      .from("revenue_by_acquisition")
      .select("month,acquisition_channel,order_channel,is_first_order,orders,revenue_jod")
      .gte("month", `${r.from.slice(0, 7)}-01`)
      .lte("month", r.to)
      .order("month")
      .range(from, to),
  );
  return rows
    .filter((x) => x.month !== null && x.acquisition_channel !== null && x.order_channel !== null)
    .map((x) => ({
      month: x.month as string,
      acquisition_channel: x.acquisition_channel as string,
      order_channel: x.order_channel as string,
      is_first_order: x.is_first_order === true,
      orders: Number(x.orders ?? 0),
      revenue_jod: Number(x.revenue_jod ?? 0),
    }));
};

const sumRev = (rows: AcqRow[]) => rows.reduce((a, x) => a + Number(x.revenue_jod ?? 0), 0);
const sumOrders = (rows: AcqRow[]) => rows.reduce((a, x) => a + Number(x.orders ?? 0), 0);

/**
 * THE headline: revenue from customers marketing acquired, wherever they now
 * buy, against all revenue.
 *
 * Note what this is NOT. It is not "revenue marketing caused". A customer
 * acquired at POS in 2020 who has bought online ever since counts entirely as
 * POS. It answers "how much of the business comes from customers marketing
 * brought in", which is a different and more defensible claim.
 */
export function headline(rows: AcqRow[]) {
  const total = sumRev(rows);
  const online = sumRev(rows.filter((r) => isOnlineAcquired(r.acquisition_channel)));
  const unattributable = sumRev(rows.filter((r) => isUnattributable(r.acquisition_channel)));
  return {
    onlineAcquiredRevenue: online,
    totalRevenue: total,
    pct: total > 0 ? (online / total) * 100 : null,
    unattributableRevenue: unattributable,
    unattributablePct: total > 0 ? (unattributable / total) * 100 : null,
    /** The same figure with unattributable revenue removed from the denominator. */
    pctOfAttributable:
      total - unattributable > 0 ? (online / (total - unattributable)) * 100 : null,
  };
}

/** Revenue per month, split by ACQUISITION channel. */
export function byMonth(rows: AcqRow[], selected: readonly string[]) {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  return months.map((month) => {
    const inMonth = rows.filter((r) => r.month === month);
    const point: Record<string, string | number> = { month: month.slice(0, 7) };
    for (const ch of selected) {
      point[ch] = sumRev(inMonth.filter((r) => r.acquisition_channel === ch));
    }
    return point;
  });
}

/** Revenue per month by ORDER channel — the existing view, for comparison. */
export function byMonthOrderChannel(rows: AcqRow[], selected: readonly string[]) {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  return months.map((month) => {
    const inMonth = rows.filter((r) => r.month === month);
    const point: Record<string, string | number> = { month: month.slice(0, 7) };
    for (const ch of selected) {
      point[ch] = sumRev(inMonth.filter((r) => r.order_channel === ch));
    }
    return point;
  });
}

/** Every acquisition channel present, with its totals. */
export function channels(rows: AcqRow[]) {
  const names = [...new Set(rows.map((r) => r.acquisition_channel))];
  return names
    .map((name) => {
      const mine = rows.filter((r) => r.acquisition_channel === name);
      return { name, orders: sumOrders(mine), revenue: sumRev(mine), unattributable: isUnattributable(name) };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * The migration: where do online-acquired customers place their LATER orders?
 *
 * Excludes each customer's first order, so this is genuinely subsequent
 * behaviour and not a restatement of the acquisition channel.
 *
 * Orders AND revenue are both returned, deliberately. About a fifth of later
 * orders go offline but over a third of later revenue does — offline baskets
 * from these customers are materially bigger, so showing either figure alone
 * understates or overstates the effect by roughly half.
 */
export function migration(rows: AcqRow[]) {
  const later = rows.filter((r) => !r.is_first_order);
  return ONLINE_ACQUIRED.map((acq) => {
    const mine = later.filter((r) => r.acquisition_channel === acq);
    const offline = mine.filter((r) => !isOnlineAcquired(r.order_channel));
    const o = sumOrders(mine);
    const rev = sumRev(mine);
    return {
      acquiredVia: acq,
      laterOrders: o,
      laterRevenue: rev,
      offlineOrders: sumOrders(offline),
      offlineRevenue: sumRev(offline),
      pctOrdersOffline: o > 0 ? (sumOrders(offline) / o) * 100 : null,
      pctRevenueOffline: rev > 0 ? (sumRev(offline) / rev) * 100 : null,
      byOrderChannel: [...new Set(mine.map((r) => r.order_channel))]
        .map((oc) => {
          const c = mine.filter((r) => r.order_channel === oc);
          return {
            orderChannel: oc,
            orders: sumOrders(c),
            revenue: sumRev(c),
            pctOrders: o > 0 ? (sumOrders(c) / o) * 100 : null,
            pctRevenue: rev > 0 ? (sumRev(c) / rev) * 100 : null,
          };
        })
        .sort((a, b) => b.revenue - a.revenue),
    };
  }).filter((m) => m.laterOrders > 0);
}

/**
 * The month the measurement basis changed, NOT a change in the business.
 *
 * The Odoo connector began requiring a customer on every POS order after
 * 27 February 2026. POS orders carrying no customer ran 42-50% through late
 * 2025, spiked to 87.3% in March 2026, and have been ~0% since April. So
 * unattributable revenue left the denominator almost entirely.
 *
 * That inflates the RAW share across this boundary: December 2025 reads 44.1%
 * and August 2026 reads 61.0%, but roughly a third of that 17-point gap is the
 * denominator changing rather than more revenue coming from online-acquired
 * customers. On a like-for-like basis it is 49.6% to 61.1%.
 */
export const BASIS_BREAK_MONTH = "2026-04";
export const BASIS_BREAK_NOTE =
  "The Odoo connector began requiring a customer on every POS order after 27 February 2026, " +
  "so unattributable revenue almost vanished from the denominator. Compare the like-for-like " +
  "column across this line, never the raw one.";

/**
 * Share of revenue from online-acquired customers, per month, on BOTH bases.
 *
 * `comparableShare` excludes unattributable revenue from the denominator, so it
 * means the same thing either side of the basis break. `rawShare` is the share
 * of ALL revenue and is the honest figure for any single month, but it cannot
 * be compared across the break. Both are returned because showing either alone
 * would mislead: raw alone invents a jump, comparable alone hides the floor.
 */
export function trend(rows: AcqRow[]) {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  return months.map((month) => {
    const inMonth = rows.filter((r) => r.month === month);
    const total = sumRev(inMonth);
    const online = sumRev(inMonth.filter((r) => isOnlineAcquired(r.acquisition_channel)));
    const attributable = sumRev(inMonth.filter((r) => !isUnattributable(r.acquisition_channel)));
    return {
      month: month.slice(0, 7),
      revenue: total,
      onlineRevenue: online,
      rawShare: total > 0 ? (online / total) * 100 : null,
      comparableShare: attributable > 0 ? (online / attributable) * 100 : null,
      coverage: total > 0 ? (attributable / total) * 100 : null,
      afterBreak: month.slice(0, 7) >= BASIS_BREAK_MONTH,
    };
  });
}

/** Mean of the comparable series either side of the break, for a fair summary. */
export function trendSummary(t: ReturnType<typeof trend>) {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const before = avg(t.filter((p) => !p.afterBreak && p.comparableShare !== null).map((p) => p.comparableShare!));
  const after = avg(t.filter((p) => p.afterBreak && p.comparableShare !== null).map((p) => p.comparableShare!));
  return {
    before,
    after,
    changePoints: before !== null && after !== null ? after - before : null,
    monthsBefore: t.filter((p) => !p.afterBreak).length,
    monthsAfter: t.filter((p) => p.afterBreak).length,
  };
}
