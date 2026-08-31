import type { DailySales } from "@/lib/queries";

export type Granularity = "daily" | "weekly" | "monthly";

/**
 * The Shopney → Appmaker changeover. Shopney's last order was 2025-08-06 and
 * Appmaker's first was 2025-08-04, so the two overlapped for three days rather
 * than cutting over cleanly — hence a band, not a line.
 *
 * A step in the Mobile App series here is a PLATFORM change, not a performance
 * one, and any year-on-year comparison spanning it compares Appmaker against
 * Shopney. The warning belongs everywhere the comparison appears, not only on
 * the chart.
 */
export const MOBILE_SWITCHOVER = { from: "2025-08-04", to: "2025-08-06" } as const;

export function spansSwitchover(from: string, to: string): boolean {
  return from <= MOBILE_SWITCHOVER.to && to >= MOBILE_SWITCHOVER.from;
}

export const SWITCHOVER_WARNING =
  "This range spans the Mobile App platform change (Shopney → Appmaker, 4–6 Aug 2025). " +
  "A step in the app line is a platform change, not a performance change.";

/** Monday-anchored week start, so weeks are stable across a 605-day range. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function bucketOf(iso: string, g: Granularity): string {
  if (g === "daily") return iso;
  if (g === "weekly") return weekStart(iso);
  return `${iso.slice(0, 7)}-01`;
}

export type ChannelPoint = {
  bucket: string;
  revenue: number;
  orders: number;
  aov: number;
};

export type SeriesPoint = {
  bucket: string;
  app: ChannelPoint;
  web: ChannelPoint;
  /** Website's share of the two channels combined, as a percentage. */
  webShare: number | null;
};

const empty = (bucket: string): ChannelPoint => ({ bucket, revenue: 0, orders: 0, aov: 0 });

/**
 * Aggregates per-channel daily rows into buckets, for Mobile App and Website
 * only. Buckets with no data in either channel are omitted rather than drawn
 * as zero, so a gap reads as "no data" instead of "no sales".
 */
export function buildSeries(rows: DailySales[], g: Granularity): SeriesPoint[] {
  const byBucket = new Map<string, { app: ChannelPoint; web: ChannelPoint }>();

  for (const r of rows) {
    if (r.sub_channel !== "Mobile App" && r.sub_channel !== "Website") continue;
    const b = bucketOf(r.date, g);
    if (!byBucket.has(b)) byBucket.set(b, { app: empty(b), web: empty(b) });
    const slot = byBucket.get(b)!;
    const target = r.sub_channel === "Mobile App" ? slot.app : slot.web;
    target.revenue += Number(r.total_online_revenue_jod);
    target.orders += Number(r.orders);
  }

  return [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => {
      v.app.aov = v.app.orders > 0 ? v.app.revenue / v.app.orders : 0;
      v.web.aov = v.web.orders > 0 ? v.web.revenue / v.web.orders : 0;
      const both = v.app.revenue + v.web.revenue;
      return {
        bucket,
        app: v.app,
        web: v.web,
        // Null rather than 0 when there is nothing to take a share of — a
        // zero share and an unknown share are different claims.
        webShare: both > 0 ? (v.web.revenue / both) * 100 : null,
      };
    });
}

/**
 * How noisy a channel's buckets are, from order counts alone.
 *
 * At roughly six orders a day the Website's weekly totals swing on randomness.
 * Relative standard error for a count is about 1/sqrt(n), so this states the
 * expected swing numerically rather than leaving the reader to guess which
 * wiggles mean anything.
 */
export function noiseNote(points: SeriesPoint[], channel: "app" | "web", g: Granularity): string | null {
  const counts = points.map((p) => p[channel].orders).filter((n) => n > 0);
  if (counts.length < 2) return null;
  const median = [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0;
  if (median <= 0) return null;
  const rsePct = (1 / Math.sqrt(median)) * 100;
  // Below ~10% the wiggle is small enough not to mislead.
  if (rsePct < 10) return null;
  const period = g === "daily" ? "day" : g === "weekly" ? "week" : "month";
  const label = channel === "web" ? "Website" : "Mobile App";
  return (
    `${label} averages about ${Math.round(median)} orders a ${period}, so expect swings of ` +
    `roughly ±${Math.round(rsePct)}% from randomness alone. Treat a single ${period} as weak evidence.`
  );
}

/**
 * Flags buckets where a handful of orders carried the revenue.
 *
 * Verified against a real case: Website revenue for the week of 3 Aug 2026 was
 * 3,292 JOD against a ~1,600 norm, and order count was NORMAL at 49. Two orders
 * on 8 August (533.58 and 470 JOD) were 30% of the week. Nothing in a revenue
 * line distinguishes that from demand.
 *
 * Six bulk orders in one week — case quantities to a venue — look identical to
 * broad growth in a revenue line. This compares the largest few order totals
 * in a bucket against the bucket's revenue, so a spike can be labelled with
 * the number of orders behind it instead of being read as a trend.
 */
export type Concentration = { topN: number; share: number; note: string } | null;

export function concentrationOf(
  rows: DailySales[],
  bucketKey: string,
  channelName: string,
  g: Granularity,
): Concentration {
  const inBucket = rows.filter(
    (r) => r.sub_channel === channelName && bucketOf(r.date, g) === bucketKey,
  );
  const revenue = inBucket.reduce((a, r) => a + Number(r.total_online_revenue_jod), 0);
  if (revenue <= 0) return null;

  const tops = inBucket
    .flatMap((r) => (r.top_order_values ?? []).map(Number))
    .sort((a, b) => b - a);
  if (!tops.length) return null;

  // How many of the largest orders it takes to reach a third of the bucket.
  let acc = 0;
  let n = 0;
  for (const v of tops) {
    if (acc >= revenue / 3) break;
    acc += v;
    n++;
  }
  const share = (acc / revenue) * 100;
  // Only worth saying when a genuinely small number of orders dominates.
  if (n > 6 || share < 30) return null;
  const period = g === "daily" ? "day" : g === "weekly" ? "week" : "month";
  return {
    topN: n,
    share,
    note: `${n} order${n === 1 ? "" : "s"} account for ${Math.round(share)}% of ${channelName} revenue this ${period} — a spike here is those orders, not broader demand.`,
  };
}

/** The same calendar range a year earlier, for year-on-year comparison. */
export function sameRangeLastYear(from: string, to: string): { from: string; to: string } {
  const shift = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(from), to: shift(to) };
}

/** The largest concentration in any bucket of a range, for a summary notice. */
export function worstConcentration(
  rows: DailySales[],
  channelName: string,
  g: Granularity,
): { bucket: string; c: NonNullable<Concentration> } | null {
  const buckets = [...new Set(rows.filter((r) => r.sub_channel === channelName).map((r) => bucketOf(r.date, g)))];
  let worst: { bucket: string; c: NonNullable<Concentration> } | null = null;
  for (const b of buckets) {
    const c = concentrationOf(rows, b, channelName, g);
    if (c && (!worst || c.share > worst.c.share)) worst = { bucket: b, c };
  }
  return worst;
}

/**
 * One point per calendar day, with `null` where no snapshot was taken.
 *
 * A date left OUT of a chart's data array is not "no data" to a line chart:
 * the line joins its neighbours and draws straight across, asserting a
 * measurement nobody made. LoyaltyLion keeps no history, so a missed night can
 * never be backfilled — the break has to be permanent and visible.
 *
 * Only rows carrying tier counts count as measured. The imported year of
 * points history has none, and treating those as zero would draw the
 * programme emptying and refilling.
 */
export type TierSnapshotRow = {
  snapshot_date: string;
  blue_members: number;
  silver_members: number;
  gold_members: number;
  platinum_members: number;
};

export type TierSeriesPoint = {
  date: string;
  Blue: number | null;
  Silver: number | null;
  Gold: number | null;
  Platinum: number | null;
};

export function tierSeriesWithGaps(scanned: TierSnapshotRow[]): TierSeriesPoint[] {
  if (!scanned.length) return [];
  const rows = [...scanned].sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));
  const have = new Map(rows.map((s) => [s.snapshot_date, s]));
  const first = rows[0]!.snapshot_date;
  const last = rows[rows.length - 1]!.snapshot_date;
  const out: TierSeriesPoint[] = [];
  for (const d = new Date(`${first}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > last) break;
    const s = have.get(iso);
    out.push({
      date: iso,
      Blue: s ? s.blue_members : null,
      Silver: s ? s.silver_members : null,
      Gold: s ? s.gold_members : null,
      Platinum: s ? s.platinum_members : null,
    });
  }
  return out;
}
