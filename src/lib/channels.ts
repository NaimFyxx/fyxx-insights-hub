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

/**
 * Orders that cannot be credited to a person.
 *
 * The Odoo integration requires a customer on every order, so staff attach a
 * placeholder ("Shopify Draft (No Customer)") when there is no real one. Those
 * orders are counted in revenue but can never be attributed to any marketing
 * activity, because there is nobody to attribute them to.
 *
 * Measured 29 August 2026 over 2025-01-01 to 2026-08-29 by
 * scripts/diagnose/placeholder.mjs. Re-run it rather than re-estimating: the
 * draft figure in particular came out far below what was expected.
 */
export const UNATTRIBUTABLE = {
  /** Placeholder or no customer, as a share of draft orders, monthly since the changeover. */
  draftPctRecent: "2 to 6",
  /** Post-changeover POS orders carrying no customer at all. */
  posNoCustomerPct: 28,
} as const;

/**
 * One sentence for anywhere a channel figure sits next to something
 * attribution-related. POS is the larger gap by far, which is the opposite of
 * what was assumed before it was measured.
 */
export function attributionLimitNote(selected: readonly SubChannel[]): string | null {
  const draft = selected.includes("Draft Orders");
  const pos = selected.includes("POS");
  if (!draft && !pos) return null;
  const parts: string[] = [];
  if (draft) {
    parts.push(
      `${UNATTRIBUTABLE.draftPctRecent}% of draft orders in recent months carry a placeholder customer or none at all`,
    );
  }
  if (pos) {
    parts.push(
      `${UNATTRIBUTABLE.posNoCustomerPct}% of POS orders since 27 February 2026 have no customer attached`,
    );
  }
  return `${parts.join(", and ")}. Those orders count towards revenue but cannot be credited to any campaign or flow.`;
}
