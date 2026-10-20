import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "@/lib/ranges";

export type DailySales = {
  date: string;
  total_online_revenue_jod: number;
  orders: number;
  source_name: string;
  sub_channel: string;
  channel: string;
  /** Five largest individual order totals for this date and source. */
  top_order_values: number[];
};

export type AttributedDay = {
  date: string;
  revenue_jod: number;
};

export type Campaign = {
  /**
   * NULL means not fetched yet, NOT zero unsubscribes. The columns were added
   * on 2 September 2026 and older rows carry null until they are re-synced;
   * rendering a null as 0% would claim a campaign cost no subscribers.
   */
  unsubscribes: number | null;
  unsubscribe_rate: number | null;
  spam_complaints: number | null;
  id: string;
  name: string;
  sent_on: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  orders: number;
  revenue_jod: number;
  /** Klaviyo's own rates, computed off DELIVERED. Stored as fractions. */
  open_rate: number;
  click_rate: number;
  conversion_rate: number;
};

export type FlowRow = {
  id: string;
  flow_name: string;
  date: string;
  recipients: number;
  delivered: number;
  opened: number;
  clicked: number;
  conversions: number;
  revenue_jod: number;
  open_rate: number;
  click_rate: number;
  conversion_rate: number;
};

export type PushRow = {
  id: string;
  source_name: string;
  source_type: string;
  sent_on: string;
  sent: number;
  delivered: number;
  opened: number;
  open_rate: number;
  conversions: number;
  revenue_jod: number;
};

/**
 * A flow's performance over a WHOLE calendar month, from one Klaviyo call.
 *
 * Separate from FlowRow because opens cannot be summed out of daily rows:
 * Klaviyo's opens_unique counts unique people inside the window asked for, so
 * a person who opens on three days is one person in a monthly report and three
 * in the sum of three daily ones. September 2026, review-request-judgeme: the
 * daily rows sum to 1,298 opens against Klaviyo's 761 for the month.
 *
 * Everything else agrees exactly, delivered included, so the daily table is
 * still right about everything it is asked for by day.
 */
export type FlowMonthlyRow = {
  month: string;
  flow_id: string;
  flow_message_id: string;
  /** "email" or "push". The report tables split on this. */
  send_channel: string;
  flow_name: string;
  recipients: number;
  delivered: number;
  /** Unique people who opened during the month. Never add across months. */
  opened: number;
  clicked: number;
  conversions: number;
  revenue_jod: number;
};

export type Snapshot = {
  snapshot_date: string;
  points_source: string;
  blue_members: number;
  silver_members: number;
  gold_members: number;
  platinum_members: number;
  /**
   * ONE DAY's redeeming members over ALL members ever, as a percentage already
   * rather than a 0-1 fraction. 0.15 means 0.15 per cent, not 15.
   *
   * SUPERSEDED for reporting by loyalty_redemption_monthly. Both halves of
   * this answer the wrong question: the base counts members who never bought
   * or stopped years ago, and a single day catches almost nobody, so it reads
   * near zero and barely moves. 20 October 2026: 18 of 12,081, 0.15 per cent,
   * against 6.37 per cent on the monthly basis for September.
   *
   * Kept because it is what the nightly snapshot records and the Sync health
   * seed probe tests against it. Anywhere it is shown it must be labelled as
   * the one-day figure so the two cannot be confused.
   */
  redemption_rate: number;
  points_outstanding: number;
  birthday_rewards_issued: number;
};

export type Activation = {
  id: string;
  title: string;
  date: string;
  status: string;
  notes: string | null;
};

const unwrap = <T>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
};

/**
 * PostgREST caps a response at 1000 rows regardless of the limit requested,
 * and does not tell you it did. `.limit(5000)` on a 2,364-row table silently
 * returned 1000 and the dashboard showed 58% of the data as though it were
 * all of it.
 *
 * This pages by RANGE until a short page arrives, so the caller gets every row
 * or an error — never a quiet subset. Advance by what the server returned, not
 * by what was asked for.
 */
const PAGE = 1000;
export async function fetchAllRows<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await build(from, from + PAGE - 1);
    if (res.error) throw new Error(res.error.message);
    const rows = res.data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    if (out.length > 200_000) throw new Error("pagination did not terminate");
  }
  return out;
}

/**
 * One row per (date, sub_channel), so callers must aggregate rather than
 * assuming one row per day.
 *
 * Reads the DERIVED view, which EXCLUDES internal accounts.
 *
 * Naim's decision, 30 August 2026, after seeing the 635,901 JOD broken down by
 * account: exclude all of them — venue tables, By The Glass, terraces,
 * write-offs, events and named staff. Nothing about them is
 * customer-attributable and their sales have no use in this dashboard.
 *
 * Two accounts are EXEMPT and count as ordinary revenue: Talabat and Careem
 * are tagged CUSTOMER_INTERNAL but are third-party delivery, real sales to
 * real customers. See the excluded_accounts view for the full definition.
 *
 * Three consequences, all intended:
 *   - all-time revenue is 9,832,449 rather than 10,460,454
 *   - the figure is never stale; the stored table lags the nightly sync
 *   - cancellations net at READ time, so a cancellation corrects old figures
 *
 * The exclusion is VISIBLE, not just applied: /excluded lists every account,
 * and every revenue figure carries a line linking to it. An exclusion nobody
 * can see is indistinguishable from a wrong number.
 */
type DailySalesRaw = {
  [K in keyof DailySales]: DailySales[K] | null;
};

export const fetchDailySales = async (r: DateRange): Promise<DailySales[]> => {
  const rows = await fetchAllRows<DailySalesRaw>((from, to) =>
    supabase
      .from("shopify_daily_sales_net")
      .select(
        "date,total_online_revenue_jod,orders,source_name,sub_channel,channel,top_order_values",
      )
      .gte("date", r.from)
      .lte("date", r.to)
      .order("date")
      .range(from, to),
  );
  // Postgres cannot prove a view's columns are non-null, so the generated types
  // widen all of them. Narrow here rather than asserting upstream.
  return rows
    .filter((x) => x.date !== null && x.sub_channel !== null)
    .map((x) => ({
      date: x.date as string,
      total_online_revenue_jod: Number(x.total_online_revenue_jod ?? 0),
      orders: Number(x.orders ?? 0),
      source_name: x.source_name ?? "",
      sub_channel: x.sub_channel as string,
      channel: x.channel ?? "",
      top_order_values: x.top_order_values ?? [],
    }));
};

/**
 * Klaviyo-attributed revenue, ORDER-date basis, whole account.
 * Deliberately not on shopify_daily_sales: it cannot be split by channel.
 */
/**
 * Reads the NETTED view, not the stored daily table. Klaviyo never retracts a
 * Placed Order event when an order is cancelled, so a stored daily total only
 * drifts upward. The view subtracts whatever is cancelled at the moment it is
 * read, so an order cancelled today corrects a figure from three weeks ago.
 */
export const fetchAttributed = async (r: DateRange): Promise<AttributedDay[]> => {
  const rows = await fetchAllRows<{ date: string | null; revenue_jod: number | null }>((from, to) =>
    supabase
      .from("klaviyo_attributed_daily_net")
      .select("date,revenue_jod")
      .gte("date", r.from)
      .lte("date", r.to)
      .order("date")
      .range(from, to),
  );
  // The view groups by date, so neither column can be null in practice. The
  // generated types widen them because Postgres cannot prove that for a view.
  return rows
    .filter((x) => x.date !== null)
    .map((x) => ({ date: x.date as string, revenue_jod: Number(x.revenue_jod ?? 0) }));
};

export const fetchCampaigns = async (r: DateRange) =>
  unwrap<Campaign[]>(
    await supabase
      .from("klaviyo_campaigns")
      .select("*")
      .gte("sent_on", r.from)
      .lte("sent_on", r.to)
      .order("sent_on"),
  );

export const fetchFlows = (r: DateRange) =>
  fetchAllRows<FlowRow>((from, to) =>
    supabase
      .from("klaviyo_flows")
      .select("*")
      .gte("date", r.from)
      .lte("date", r.to)
      .order("date")
      .range(from, to),
  );

export const fetchPush = (r: DateRange) =>
  fetchAllRows<PushRow>((from, to) =>
    supabase
      .from("klaviyo_push")
      .select("*")
      .gte("sent_on", r.from)
      .lte("sent_on", r.to)
      .order("sent_on")
      .range(from, to),
  );

/**
 * Flow figures for the calendar month a range starts in.
 *
 * The monthly report always picks a whole month, so this is exact for it. A
 * caller with an arbitrary range must not use this: see flowOpensAvailable.
 */
export const fetchFlowMonthly = (month: string) =>
  fetchAllRows<FlowMonthlyRow>((from, to) =>
    supabase
      .from("klaviyo_flow_monthly")
      .select(
        "month,flow_id,flow_message_id,send_channel,flow_name,recipients,delivered,opened,clicked,conversions,revenue_jod",
      )
      .eq("month", month)
      .range(from, to),
  );

/**
 * Redemption on a base of members who still buy, for one calendar month.
 *
 * `redeemers` counts every member who claimed a reward that month, including
 * members who have stopped buying, so it is NOT contained in `activeMembers`:
 * September 2026 has 172 redeemers of whom 161 are in the base. `redeemersInBase`
 * is the contained figure, carried so the gap is visible rather than guessed.
 *
 * The base reconciles with LoyaltyLion: their trailing_12m_customers for
 * September 2026 gives 662 redeeming plus 2,041 non-redeeming members, so
 * 2,703, against 2,701 here.
 */
export type RedemptionMonth = {
  month: string;
  redeemers: number;
  activeMembers: number;
  redeemersInBase: number;
};

export const fetchRedemptionMonth = async (month: string): Promise<RedemptionMonth | null> => {
  const { data, error } = await supabase
    .from("loyalty_redemption_monthly")
    .select("month,redeemers,active_members,redeemers_in_base")
    .eq("month", month)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.month === null) return null;
  return {
    month: data.month,
    redeemers: Number(data.redeemers ?? 0),
    activeMembers: Number(data.active_members ?? 0),
    redeemersInBase: Number(data.redeemers_in_base ?? 0),
  };
};

export const fetchSnapshots = async (r: DateRange) =>
  unwrap<Snapshot[]>(
    await supabase
      .from("ll_snapshots")
      .select("*")
      .gte("snapshot_date", r.from)
      .lte("snapshot_date", r.to)
      .order("snapshot_date"),
  );

export const fetchActivations = async () =>
  unwrap<Activation[]>(
    await supabase.from("activations").select("*").order("date", { ascending: true }),
  );

export const fetchLastSync = async () => {
  const { data, error } = await supabase
    .from("sync_log")
    .select("synced_at,source,status")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};
