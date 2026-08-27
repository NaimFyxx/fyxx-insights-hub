export const CHART_BLACK = "#000000";
export const CHART_PINK = "#f0b09e";
export const CHART_PINK_SOFT = "#F5D5CF";
export const CHART_GRID = "#e5e5e5";

export const axisProps = {
  stroke: CHART_BLACK,
  tick: { fontSize: 11, fill: "#666666", fontFamily: "Inter, sans-serif" },
  tickLine: false,
  axisLine: { stroke: CHART_GRID },
} as const;

export const tooltipStyle = {
  contentStyle: {
    border: "1px solid #e5e5e5",
    borderRadius: 4,
    boxShadow: "none",
    fontSize: 12,
    fontFamily: "Inter, sans-serif",
  },
  cursor: { fill: CHART_PINK_SOFT, stroke: CHART_GRID },
} as const;
