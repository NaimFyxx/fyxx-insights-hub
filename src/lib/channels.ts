/**
 * Sales channels, in our vocabulary.
 *
 * Three systems name these differently and none errors on the wrong name —
 * see scripts/README.md. This file is the single definition the frontend uses.
 */
export const SUB_CHANNELS = ["Website", "Mobile App", "Draft Orders", "POS"] as const;
export type SubChannel = (typeof SUB_CHANNELS)[number];

/**
 * First load shows ONLINE SALES ONLY.
 *
 * This hides roughly two thirds of revenue: Draft Orders alone is 39.3% and POS
 * a further 28.8%. That is a deliberate choice, which is exactly why the
 * caption naming the included channels is mandatory on first load and not only
 * after the user changes something. A revenue figure must never be ambiguous
 * about what it covers.
 */
export const DEFAULT_CHANNELS: SubChannel[] = ["Website", "Mobile App"];

/** "Website and Mobile App" — for captions. Always rendered, never omitted. */
export function describeChannels(selected: readonly SubChannel[]): string {
  const ordered = SUB_CHANNELS.filter((c) => selected.includes(c));
  if (ordered.length === 0) return "no channels";
  if (ordered.length === SUB_CHANNELS.length) return "all channels";
  const last = ordered[ordered.length - 1] as string;
  if (ordered.length === 1) return last;
  return `${ordered.slice(0, -1).join(", ")} and ${last}`;
}

/** True when the selection spans the date POS changed meaning. */
export const POS_DEFINITION_CHANGED = "2026-02-27";
export function posDefinitionWarning(
  selected: readonly SubChannel[],
  from: string,
  to: string,
): string | null {
  if (!selected.includes("POS")) return null;
  if (!(from < POS_DEFINITION_CHANGED && to >= POS_DEFINITION_CHANGED)) return null;
  return (
    "POS changed meaning on 27 Feb 2026: before that date it covers every retail order, " +
    "after it covers only orders with an identified customer, because the Odoo connector " +
    "syncs no others. The two periods are not comparable."
  );
}
