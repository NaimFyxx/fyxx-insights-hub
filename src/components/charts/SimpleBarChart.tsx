import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { CHART_BLACK, CHART_PINK, CHART_GRID, axisProps, tooltipStyle } from "./chart-theme";

export type BarPoint = { label: string; value: number };

export function SimpleBarChart({
  data,
  height = 280,
  valueSuffix = "",
  angledLabels = false,
}: {
  data: BarPoint[];
  height?: number;
  valueSuffix?: string;
  angledLabels?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, bottom: angledLabels ? 70 : 0, left: -8 }}
      >
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="label"
          {...axisProps}
          interval={0}
          angle={angledLabels ? -35 : 0}
          textAnchor={angledLabels ? "end" : "middle"}
          height={angledLabels ? 80 : 30}
          tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 26)}…` : v)}
        />
        <YAxis {...axisProps} width={56} />
        <Tooltip
          {...tooltipStyle}
          formatter={(v: number) => [`${Math.round(v).toLocaleString()}${valueSuffix}`, "Value"]}
        />
        <Bar dataKey="value" fill={CHART_PINK} stroke={CHART_BLACK} strokeWidth={1} />
      </BarChart>
    </ResponsiveContainer>
  );
}
