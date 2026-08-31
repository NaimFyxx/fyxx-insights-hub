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
} from "recharts";
import { CHART_BLACK, CHART_PINK, CHART_PINK_SOFT, CHART_GRID, axisProps, tooltipStyle } from "./chart-theme";

/**
 * A tier count is `null` for a night that was never recorded.
 *
 * Nullable on purpose, not defensively. LoyaltyLion keeps no history, so a
 * missed snapshot can never be backfilled — the type has to be able to say
 * "not measured", because a zero would claim the programme emptied and an
 * absent row would let the line draw straight through the gap.
 */
export type TierPoint = {
  date: string;
  Blue: number | null;
  Silver: number | null;
  Gold: number | null;
  Platinum: number | null;
};

const SERIES: { key: keyof Omit<TierPoint, "date">; color: string; dash?: string }[] = [
  { key: "Blue", color: CHART_BLACK },
  { key: "Silver", color: CHART_BLACK, dash: "4 3" },
  { key: "Gold", color: CHART_PINK },
  { key: "Platinum", color: CHART_PINK_SOFT },
];

export function TierLineChart({ data }: { data: TierPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="date"
          {...axisProps}
          tickFormatter={(v: string) => format(parseISO(v), "d MMM")}
          minTickGap={24}
        />
        <YAxis {...axisProps} width={56} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => format(parseISO(String(v)), "d MMM yyyy")} />
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: "Inter, sans-serif" }} />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="linear"
            // A missing night must show as a BREAK. Recharts defaults this to
            // false, but it is load-bearing here — flipping it would silently
            // draw a straight line across a measurement nobody took.
            connectNulls={false}
            dataKey={s.key}
            stroke={s.color}
            strokeDasharray={s.dash}
            strokeWidth={1.5}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
