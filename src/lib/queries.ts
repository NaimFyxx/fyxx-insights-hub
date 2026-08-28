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

const unwrap = <T,>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
};

/**
 * One row per (date, source_name) since the channel split, so callers must
 * aggregate rather than assuming one row per day.
 */
export const fetchDailySales = async (r: DateRange) =>
  unwrap<DailySales[]>(
    await supabase
      .from("shopify_daily_sales")
      .select("date,total_online_revenue_jod,orders,source_name,sub_channel,channel,top_order_values")
      .gte("date", r.from)
      .lte("date", r.to)
      .order("date")
      .limit(5000),
  );

/**
 * Klaviyo-attributed revenue, ORDER-date basis, whole account.
 * Deliberately not on shopify_daily_sales: it cannot be split by channel.
 */
export const fetchAttributed = async (r: DateRange) =>
  unwrap<AttributedDay[]>(
    await supabase
      .from("klaviyo_attributed_daily")
      .select("date,revenue_jod")
      .gte("date", r.from)
      .lte("date", r.to)
      .order("date")
      .limit(2000),
  );

export const fetchCampaigns = async (r: DateRange) =>
  unwrap<Campaign[]>(
    await supabase
      .from("klaviyo_campaigns")
      .select("*")
      .gte("sent_on", r.from)
      .lte("sent_on", r.to)
      .order("sent_on"),
  );

export const fetchFlows = async (r: DateRange) =>
  unwrap<FlowRow[]>(
    await supabase
      .from("klaviyo_flows")
      .select("*")
      .gte("date", r.from)
      .lte("date", r.to)
      .order("date")
      .limit(2000),
  );

export const fetchPush = async (r: DateRange) =>
  unwrap<PushRow[]>(
    await supabase
      .from("klaviyo_push")
      .select("*")
      .gte("sent_on", r.from)
      .lte("sent_on", r.to)
      .order("sent_on")
      .limit(2000),
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
