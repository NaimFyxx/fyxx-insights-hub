export const jod = (value: number) =>
  `${value.toLocaleString("en-JO", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} JOD`;

export const jod2 = (value: number) =>
  `${value.toLocaleString("en-JO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} JOD`;

export const num = (value: number) => value.toLocaleString("en-JO");

export const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

export const rate = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

/**
 * Percentage change, or null when there is nothing to compare against.
 *
 * Previously this returned a literal 100 whenever the prior period was zero,
 * so an empty comparison window showed "+100.0%" on every tile — a number that
 * looked like a result and was pure artefact. Absence of a baseline is not a
 * 100% rise, so it returns null and the caller shows "no comparison".
 */
export const deltaPct = (current: number, previous: number): number | null => {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
};

export const POINTS_PER_JOD = 100;
export const pointsToJod = (points: number) => points / POINTS_PER_JOD;
