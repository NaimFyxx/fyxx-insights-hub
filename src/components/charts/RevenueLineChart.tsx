import { format, parseISO } from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Area,
  ComposedChart,
} from "recharts";
import { CHART_BLACK, CHART_PINK, CHART_GRID, axisProps, tooltipStyle } from "./chart-theme";

export type RevenuePoint = {
  date: string;
  klaviyo: number;
  total: number;
};

/**
 * `totalLabel` names what the second series actually covers. It used to be
 * hardcoded to "Total online" while the series followed the channel toggles,
 * so selecting POS or Draft Orders produced a line labelled online that wasn't.
 */
export function RevenueLineChart({
  data,
  totalLabel = "Total",
}: {
  data: RevenuePoint[];
  totalLabel?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="date"
          {...axisProps}
          tickFormatter={(v: string) => format(parseISO(v), "d MMM")}
          minTickGap={24}
        />
        <YAxis {...axisProps} width={56} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={(v) => format(parseISO(String(v)), "d MMM yyyy")}
          formatter={(v: number, n) => [`${Math.round(v).toLocaleString()} JOD`, n]}
        />
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: "Inter, sans-serif" }} />
        <Area
          type="linear"
          dataKey="klaviyo"
          name="Klaviyo attributed"
          stroke={CHART_PINK}
          fill={CHART_PINK}
          fillOpacity={0.5}
          strokeWidth={1.5}
          dot={false}
        />
        <Line
          type="linear"
          dataKey="total"
          name={totalLabel}
          stroke={CHART_BLACK}
          strokeWidth={1.5}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
