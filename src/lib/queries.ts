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

export type Snapshot = {
  snapshot_date: string;
  points_source: string;
  blue_members: number;
  silver_members: number;
  gold_members: number;
  platinum_members: number;
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
 * Reads the STORED table, which INCLUDES house and staff accounts.
 *
 * `shopify_daily_sales_net` exists and would exclude them, would never be
 * stale, and would net cancellations at read time. It was briefly wired up
 * here and has been reverted, because switching it changes what "revenue"
 * means — all-time 10,461,794 → 9,825,893 JOD, −635,901 across 73 accounts —
 * and that is a business decision about whether venue tables and "By The
 * Glass" are sales or internal transfers. It is Naim's to make, not one to
 * arrive at as a side effect of fixing a page inconsistency.
 *
 * The known cost of staying here: the Overview total and the acquisition
 * denominator differ by the house-account share of the period (1,161.900 JOD
 * for August 2026). That gap is STATED on the acquisition page and in the
 * report rather than hidden — see DENOMINATOR_NOTE in src/lib/acquisition.ts.
 */
type DailySalesRaw = {
  [K in keyof DailySales]: DailySales[K] | null;
};

export const fetchDailySales = async (r: DateRange): Promise<DailySales[]> => {
  const rows = await fetchAllRows<DailySalesRaw>((from, to) =>
    supabase
      .from("shopify_daily_sales")
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
