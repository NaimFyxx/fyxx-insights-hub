import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  differenceInCalendarDays,
  addDays,
  subDays,
  parseISO,
} from "date-fns";

export type PresetKey = "this_month" | "last_month" | "last_3_months" | "custom";

export type DateRange = { from: string; to: string };

export const iso = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * The Amman calendar date right now.
 *
 * Sources are synced at different times of day: Shopify might be written at
 * 07:04 while Klaviyo is pulled that evening. Any figure that DIVIDES one
 * source by another is distorted for the day still in progress, in whichever
 * direction was synced later.
 */
export const ammanToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

/** The same instant as a Date, for the date-fns calendar helpers. */
export const ammanNow = () => parseISO(ammanToday());

/**
 * Presets read the REAL clock, deliberately.
 *
 * This previously defaulted to `DATA_TODAY`, hardcoded to 2026-08-31 by the
 * Lovable seed with the comment "the seeded dataset covers June-August 2026".
 * It was harmless only while the real date happened to match it. From
 * 1 September 2026 "This month" would have meant August and "Last month" July,
 * silently and permanently, and the report page would have refused to open
 * September at all. Nothing would have looked broken.
 *
 * `today` stays a parameter so the behaviour can be tested at any date.
 */
export function presetRange(key: PresetKey, today: Date = ammanNow()): DateRange {
  switch (key) {
    case "last_month": {
      const m = subMonths(today, 1);
      return { from: iso(startOfMonth(m)), to: iso(endOfMonth(m)) };
    }
    case "last_3_months":
      return { from: iso(startOfMonth(subMonths(today, 2))), to: iso(endOfMonth(today)) };
    case "this_month":
    default:
      return { from: iso(startOfMonth(today)), to: iso(endOfMonth(today)) };
  }
}

export function previousRange(range: DateRange): DateRange {
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  const days = differenceInCalendarDays(to, from) + 1;
  const prevTo = subDays(from, 1);
  const prevFrom = subDays(prevTo, days - 1);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

export function rangeLabel(range: DateRange) {
  return `${format(parseISO(range.from), "d MMM yyyy")} — ${format(parseISO(range.to), "d MMM yyyy")}`;
}

export function eachDay(range: DateRange) {
  const out: string[] = [];
  let d = parseISO(range.from);
  const to = parseISO(range.to);
  while (d <= to) {
    out.push(iso(d));
    d = addDays(d, 1);
  }
  return out;
}

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_3_months", label: "Last 3 months" },
  { key: "custom", label: "Custom" },
];

/**
 * Drop the day still in progress from a cross-source ratio.
 *
 * Absolute figures should still include today — the operator wants to see the
 * day's takings. It is only the RATIO of two independently synced sources that
 * cannot be trusted until both have finished the day, so this is applied to
 * numerator and denominator together and captioned where it is used.
 */
export function settledOnly<T extends { date: string }>(rows: T[]): T[] {
  const today = ammanToday();
  return rows.filter((r) => r.date < today);
}

/** True when the range runs into the day still in progress. */
export const rangeIncludesToday = (r: DateRange) => r.to >= ammanToday();
