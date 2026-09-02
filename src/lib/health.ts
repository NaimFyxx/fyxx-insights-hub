import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/queries";
import { tierSeriesWithGaps } from "@/lib/timeseries";

/** The unattended jobs, and how far behind each is allowed to be. */
export const SOURCES = [
  { key: "klaviyo_campaigns", label: "Klaviyo campaigns", staleAfterHours: 36 },
  { key: "klaviyo_flows", label: "Klaviyo flows", staleAfterHours: 36 },
  { key: "shopify_daily_sales", label: "Shopify sales", staleAfterHours: 36 },
  { key: "ll_snapshots", label: "Loyalty snapshot", staleAfterHours: 36 },
  { key: "klaviyo_reach", label: "Unique reach", staleAfterHours: 36 },
  { key: "klaviyo_order_influence", label: "Order influence", staleAfterHours: 24 * 8 },
  { key: "shopify_margin_monthly", label: "Margin", staleAfterHours: 24 * 8 },
  { key: "database_backup", label: "Database backup", staleAfterHours: 24 * 9 },
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
    const coveredThrough =
      mine
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

    return {
      key: s.key,
      label: s.label,
      lastRun,
      lastSuccess,
      coveredThrough,
      hoursSinceSuccess: hours,
      state,
    };
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

/**
 * Lovable's seed migration (20260827105917) inserted placeholder rows into
 * eight tables. Its seed block is commented out now, but that edit changes the
 * file's checksum, and it is not known whether Lovable's tooling re-applies
 * migrations by checksum rather than by version. If it ever re-seeds, the rows
 * look entirely real: invented campaign names, an invented monthly narrative,
 * fabricated sync_log successes.
 *
 * Each probe below matches values ONLY the seed block writes, so a hit means
 * seeded data is present, not merely that a table looks unusual.
 */
/**
 * The filter surface these probes need. PostgREST's builder generic is keyed to
 * each table, so a single array of probes across eight tables cannot share its
 * exact type; this narrows to the three operators actually used instead of
 * reaching for `any`.
 */
type SeedFilter = {
  eq(column: string, value: string | number): SeedFilter;
  gt(column: string, value: string | number): SeedFilter;
  in(column: string, values: string[]): SeedFilter;
};

export const SEED_PROBES = [
  {
    table: "shopify_daily_sales" as const,
    label: "Shopify sales",
    // The seed writes the pre-migration shape; the sync never sets people_reached.
    apply: (q: SeedFilter) => q.eq("source_name", "unknown").gt("people_reached", 0),
  },
  {
    table: "ll_snapshots" as const,
    label: "Loyalty snapshots",
    // Seeded redemption_rate is ~21; a real one is a 0-1 fraction.
    apply: (q: SeedFilter) => q.gt("redemption_rate", 1),
  },
  {
    table: "klaviyo_campaigns" as const,
    label: "Klaviyo campaigns",
    apply: (q: SeedFilter) =>
      q.in("name", ["July Champagne Week", "August Grand Cru Preview", "Cigar Lounge Reopening"]),
  },
  {
    table: "klaviyo_flows" as const,
    label: "Klaviyo flows",
    apply: (q: SeedFilter) =>
      q.in("flow_name", ["Browse Abandonment", "Winback 90 Days", "Loyalty Tier Upgrade"]),
  },
  {
    table: "klaviyo_push" as const,
    label: "Klaviyo push",
    apply: (q: SeedFilter) => q.in("source_name", ["Weekly Drop Alert", "Flash Restock Alert"]),
  },
  {
    table: "activations" as const,
    label: "Activations",
    apply: (q: SeedFilter) =>
      q.in("title", ["Islay whisky masterclass", "Grand Cru preview dinner"]),
  },
  {
    table: "reports" as const,
    label: "Reports",
    // The highest-risk one: seeded NARRATIVE text, which the report renders as prose.
    apply: (q: SeedFilter) => q.eq("start_date", "2026-07-01").eq("end_date", "2026-07-31"),
  },
  {
    table: "sync_log" as const,
    label: "Sync log",
    apply: (q: SeedFilter) => q.in("source", ["klaviyo", "shopify", "loyaltylion"]),
  },
];

export type SeedResidue = { label: string; table: string; rows: number };

/** Counts only — HEAD requests, so this is cheap enough to run on every load. */
export async function fetchSeedResidue(): Promise<SeedResidue[]> {
  const hits = await Promise.all(
    SEED_PROBES.map(async (p) => {
      // The filter methods return the same builder object at runtime, so
      // narrowing to SeedFilter and back is safe; only the static type differs.
      const base = supabase.from(p.table).select("*", { count: "exact", head: true });
      const filtered = p.apply(base as unknown as SeedFilter) as unknown as typeof base;
      const { count, error } = await filtered;
      if (error) return null;
      const rows = count ?? 0;
      return rows > 0
        ? ({ label: p.label, table: p.table as string, rows } satisfies SeedResidue)
        : null;
    }),
  );
  return hits.filter((h): h is SeedResidue => h !== null);
}

/**
 * Nights where the LoyaltyLion tier snapshot was never taken.
 *
 * THIS IS THE ONLY IRRECOVERABLE LOSS IN THE SYSTEM. Every other source can be
 * re-fetched for a past date. LoyaltyLion has no history endpoint for tier
 * counts or points outstanding — the API answers only "what is true now" — so
 * a night that is not recorded is gone permanently. Nothing can backfill it.
 *
 * It nearly happened silently on 31 August 2026: a false alarm in the filter
 * guard failed the whole run, and the snapshot would have been lost had the
 * failure email not been read. A generic "sync failed" does not convey that
 * one of the failures destroys data and the others merely delay it.
 *
 * A day counts as scanned only if it carries tier counts. The imported year of
 * points history has none, so a points-only row is not a snapshot.
 */
export type SnapshotGap = { date: string };

export async function fetchSnapshotGaps(): Promise<{
  gaps: SnapshotGap[];
  firstScan: string | null;
  lastScan: string | null;
  scanned: number;
}> {
  const rows = await fetchAllRows<{ snapshot_date: string | null; blue_members: number | null }>(
    (from, to) =>
      supabase
        .from("ll_snapshots")
        .select("snapshot_date,blue_members")
        .order("snapshot_date")
        .range(from, to),
  );
  const scanned = rows
    .filter((r) => r.snapshot_date && Number(r.blue_members ?? 0) > 0)
    .map((r) => r.snapshot_date as string)
    .sort();
  if (scanned.length === 0) return { gaps: [], firstScan: null, lastScan: null, scanned: 0 };

  // Reuses the SAME day-walk the chart uses, rather than keeping a second copy
  // of it here. Two implementations of "which nights are missing" can disagree,
  // and the one on this page is the alarm for the only irrecoverable loss in
  // the system — it must not be the untested copy. tierSeriesWithGaps has nine
  // checks against it, including two deliberate regressions.
  const series = tierSeriesWithGaps(
    rows
      .filter((r) => r.snapshot_date && Number(r.blue_members ?? 0) > 0)
      .map((r) => ({
        snapshot_date: r.snapshot_date as string,
        blue_members: Number(r.blue_members),
        silver_members: 0,
        gold_members: 0,
        platinum_members: 0,
      })),
  );
  const gaps: SnapshotGap[] = series
    .filter((p) => p.Blue === null)
    .map((p) => ({ date: p.date }));
  return {
    gaps,
    firstScan: scanned[0]!,
    lastScan: scanned[scanned.length - 1]!,
    scanned: scanned.length,
  };
}
