export const jod = (value: number) =>
  `${value.toLocaleString("en-JO", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} JOD`;

export const jod2 = (value: number) =>
  `${value.toLocaleString("en-JO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} JOD`;

export const num = (value: number) => value.toLocaleString("en-JO");

export const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

export const rate = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

export const deltaPct = (current: number, previous: number) => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
};

export const POINTS_PER_JOD = 100;
export const pointsToJod = (points: number) => points / POINTS_PER_JOD;
