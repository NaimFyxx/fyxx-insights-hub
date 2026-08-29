import { supabase } from "@/integrations/supabase/client";

/** The unattended jobs, and how far behind each is allowed to be. */
export const SOURCES = [
  { key: "klaviyo_campaigns",       label: "Klaviyo campaigns",   staleAfterHours: 36 },
  { key: "klaviyo_flows",           label: "Klaviyo flows",       staleAfterHours: 36 },
  { key: "shopify_daily_sales",     label: "Shopify sales",       staleAfterHours: 36 },
  { key: "ll_snapshots",            label: "Loyalty snapshot",    staleAfterHours: 36 },
  { key: "klaviyo_reach",           label: "Unique reach",        staleAfterHours: 36 },
  { key: "klaviyo_order_influence", label: "Order influence",     staleAfterHours: 24 * 8 },
  { key: "shopify_margin_monthly",  label: "Margin",              staleAfterHours: 24 * 8 },
  { key: "database_backup",         label: "Database backup",     staleAfterHours: 24 * 9 },
] as const;

export type SyncRow = {
  source: string;
  status: string;
  synced_at: string;
  range_start: string | null;
  range_end: string | null;
  rows_written: number;
  message: string | null;
};

export type SourceHealth = {
  key: string;
  label: string;
  lastRun: SyncRow | null;
  lastSuccess: SyncRow | null;
  /** Latest date actually covered, which is not the same as when it last ran. */
  coveredThrough: string | null;
  hoursSinceSuccess: number | null;
  state: "ok" | "stale" | "failing" | "paused" | "never";
};

/** Recent sync_log, enough to see the last success even after failures. */
export async function fetchSyncLog(): Promise<SyncRow[]> {
  // 1000 is PostgREST's hard page cap, so this is the most one call can give.
  // Recent runs are all this view needs; it is not trying to be exhaustive.
  const { data, error } = await supabase
    .from("sync_log")
    .select("source,status,synced_at,range_start,range_end,rows_written,message")
    .order("synced_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as SyncRow[];
}

export function summarise(rows: SyncRow[], now = new Date()): SourceHealth[] {
  return SOURCES.map((s) => {
    const mine = rows.filter((r) => r.source === s.key);
    const lastRun = mine[0] ?? null;
    const lastSuccess = mine.find((r) => r.status === "success") ?? null;
    const hours = lastSuccess
      ? (now.getTime() - new Date(lastSuccess.synced_at).getTime()) / 3600000
      : null;

    // The furthest date any successful run covered — the question people
    // actually mean by "is it up to date", which is not "did it run".
    const coveredThrough = mine
      .filter((r) => r.status === "success" && r.range_end)
      .map((r) => r.range_end as string)
      .sort()
      .at(-1) ?? null;

    let state: SourceHealth["state"] = "ok";
    if (!lastSuccess) state = "never";
    // A daily-quota stop is a normal pause, not a fault: work already done is
    // saved and the next scheduled run continues. Showing it as FAILING would
    // send someone debugging a job that is behaving correctly.
    else if (lastRun && lastRun.status === "quota_exhausted") state = "paused";
    else if (lastRun && lastRun.status !== "success") state = "failing";
    else if (hours !== null && hours > s.staleAfterHours) state = "stale";

    return { key: s.key, label: s.label, lastRun, lastSuccess, coveredThrough, hoursSinceSuccess: hours, state };
  });
}

/** Backfill progress for the two sources that run a day at a time. */
export async function fetchBackfillProgress(source: string, from: string) {
  // Must page: PostgREST caps at 1000 per request whatever limit is asked for,
  // and a 605-day backfill has more successful days than that — the progress
  // bar would stall at 1000 and read as stuck.
  const days = new Set<string>();
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from("sync_log")
      .select("range_start")
      .eq("source", source)
      .eq("status", "success")
      .gte("range_start", from)
      .range(start, start + 999);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) if (r.range_start) days.add(r.range_start as string);
    if (rows.length < 1000) break;
  }
  const total = Math.floor((Date.now() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1;
  return { done: days.size, total, outstanding: Math.max(0, total - days.size) };
}
