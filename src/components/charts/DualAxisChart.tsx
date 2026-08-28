import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceArea,
} from "recharts";
import { CHART_BLACK, CHART_PINK, CHART_GRID, tooltipStyle } from "./chart-theme";

export type DualPoint = { bucket: string; app: number; web: number };

/**
 * Two series on separate axes.
 *
 * DUAL AXIS ON PURPOSE. The app is ~24x the website by revenue, so a shared
 * axis flattens the website into the baseline. Indexing both to 100 would fix
 * the shape but destroy the scale — a reader could conclude the two channels
 * matter equally. Dual axis keeps both shapes legible while the axis labels
 * carry the scale, and the legend states the absolute totals so the gap is
 * a number rather than an inference from the picture.
 *
 * The known hazard is that crossing lines on dual axes look meaningful when
 * they are not. Each axis is coloured to match its series to blunt that.
 */
export function DualAxisChart({
  data, appLabel, webLabel, appTotal, webTotal, unit = "", band, height = 320,
}: {
  data: DualPoint[];
  appLabel: string;
  webLabel: string;
  appTotal?: string;
  webTotal?: string;
  unit?: string;
  band?: { from: string; to: string; label: string } | null;
  height?: number;
}) {
  const appColor = CHART_BLACK;
  const webColor = CHART_PINK;
  // Rounding to whole thousands produced duplicate labels ("3k, 3k, 2k"),
  // which defeats the point of having two axes. One decimal below 10k keeps
  // adjacent ticks distinguishable; above that the values are far enough apart.
  const fmt = (v: number) => {
    if (Math.abs(v) >= 10000) return `${Math.round(v / 1000)}k`;
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(Math.round(v));
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#666666" }} minTickGap={24} />
          <YAxis yAxisId="app" orientation="left" tickFormatter={fmt} tickCount={5}
                 tick={{ fontSize: 11, fill: appColor }} width={56} />
          <YAxis yAxisId="web" orientation="right" tickFormatter={fmt} tickCount={5}
                 tick={{ fontSize: 11, fill: webColor }} width={56} />
          {band ? (
            <ReferenceArea
              yAxisId="app" x1={band.from} x2={band.to}
              fill={CHART_PINK} fillOpacity={0.22}
              label={{ value: band.label, position: "insideTop", fontSize: 10, fill: "#666666" }}
            />
          ) : null}
          <Tooltip
            {...tooltipStyle}
            formatter={(v: number, name: string) => [`${Math.round(v).toLocaleString("en-JO")}${unit}`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="app" type="monotone" dataKey="app" name={appLabel}
                stroke={appColor} strokeWidth={2} dot={false} />
          <Line yAxisId="web" type="monotone" dataKey="web" name={webLabel}
                stroke={webColor} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {appTotal || webTotal ? (
        // The scale gap stated numerically, so the dual axis cannot mislead.
        <p className="mt-2 text-xs text-muted-foreground">
          <span style={{ color: appColor }}>■</span> {appLabel} {appTotal}
          {"   "}
          <span style={{ color: webColor }}>■</span> {webLabel} {webTotal}
          {"  — note the two axes use different scales."}
        </p>
      ) : null}
    </div>
  );
}
