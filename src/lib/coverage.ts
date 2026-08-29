import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "@/lib/ranges";

/**
 * What each source actually covers.
 *
 * Thirteen distinct coverage windows exist and none of them is the start of the
 * business — Shopify orders reach back to 2019, LoyaltyLion activities to 2023,
 * Klaviyo attribution to January 2025, Klaviyo campaigns to June 2025,
 * LoyaltyLion rewards to August 2025. A range that starts before a source's
 * first row will read as a genuine zero for that source unless something says
 * otherwise, and "Klaviyo drove 0% of revenue in 2024" is false: Klaviyo was
 * not the platform then.
 *
 * Read from the `data_coverage` view rather than declared here, so it is
 * derived from the rows themselves and cannot drift as sources are backfilled.
 */
export type Coverage = {
  source: string;
  kind: "live" | "imported" | "snapshot";
  rows: number;
  from: string | null;
  to: string | null;
};

export async function fetchCoverage(): Promise<Coverage[]> {
  const { data, error } = await supabase
    .from("data_coverage")
    .select("source,kind,rows,covers_from,covers_to");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r) => r.source)
    .map((r) => ({
      source: r.source as string,
      kind: (r.kind ?? "live") as Coverage["kind"],
      rows: Number(r.rows ?? 0),
      from: r.covers_from,
      to: r.covers_to,
    }));
}

/**
 * The reason a source cannot answer for this range, or null if it can.
 *
 * Returns prose rather than a boolean because the caller has to PRINT it — the
 * whole point is that the reader sees an absence stated, not a zero rendered.
 */
export function coverageGap(
  cov: Coverage[],
  source: string,
  range: DateRange,
  label = source,
): string | null {
  const c = cov.find((x) => x.source === source);
  if (!c || !c.rows || !c.from) {
    return `${label} has no data at all, so this period cannot be reported.`;
  }
  const startsLate = range.from < c.from;

  if (startsLate && range.to < c.from) {
    return `${label} does not cover this period at all — its data begins on ${c.from}. This is an absence, not a zero.`;
  }
  if (startsLate) {
    return `${label} only covers this period from ${c.from}. Anything before that is missing, not zero.`;
  }

  // The END of a range is deliberately NOT treated as a gap for live sources.
  //
  // `covers_to` is the last row a source HAS, which for an event-shaped source
  // like campaigns is the last time one was sent — not the last time it was
  // collected. Flagging that produced "Campaign reporting has not been
  // collected since 2026-08-26" when the truth was simply that no campaign had
  // been sent for three days. Two earlier attempts here were wrong in the same
  // direction: judging the end against the RANGE withheld a correct August
  // figure because the month had not finished yet.
  //
  // Sync staleness is a different question, already answered properly by
  // sync_log on the health page. This function answers only "does the source
  // reach back far enough", which is where zeros get mistaken for measurements.
  //
  // An import is the exception: it stops dead at its export date, and every
  // later day genuinely holds nothing.
  if (c.kind === "imported" && c.to !== null && range.to > c.to) {
    return `${label} was imported and stops on ${c.to}. Later dates are not collected at all.`;
  }
  return null;
}
