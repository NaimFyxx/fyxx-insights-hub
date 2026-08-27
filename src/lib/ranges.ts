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

/** The seeded dataset covers June–August 2026. */
export const DATA_TODAY = parseISO("2026-08-31");

export function presetRange(key: PresetKey, today: Date = DATA_TODAY): DateRange {
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
