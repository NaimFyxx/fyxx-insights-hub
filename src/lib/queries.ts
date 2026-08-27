import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "@/lib/ranges";

export type DailySales = {
  date: string;
  total_online_revenue_jod: number;
  klaviyo_attributed_revenue_jod: number;
  orders: number;
  people_reached: number;
};

export type Campaign = {
  id: string;
  name: string;
  sent_on: string;
  sent: number;
  opened: number;
  clicked: number;
  orders: number;
  revenue_jod: number;
};

export type FlowRow = {
  id: string;
  flow_name: string;
  date: string;
  recipients: number;
  opened: number;
  conversions: number;
  revenue_jod: number;
};

export type PushRow = {
  id: string;
  source_name: string;
  source_type: string;
  sent_on: string;
  sent: number;
  opened: number;
};

export type Snapshot = {
  snapshot_date: string;
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

export const fetchDailySales = async (r: DateRange) =>
  unwrap<DailySales[]>(
    await supabase
      .from("shopify_daily_sales")
      .select("date,total_online_revenue_jod,klaviyo_attributed_revenue_jod,orders,people_reached")
      .gte("date", r.from)
      .lte("date", r.to)
      .order("date"),
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
