import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDateRange } from "@/context/date-range-context";
import { fetchDailySales } from "@/lib/queries";
import { jod, num, pct, deltaPct } from "@/lib/format";
import {
  buildSeries, noiseNote, sameRangeLastYear, spansSwitchover,
  MOBILE_SWITCHOVER, SWITCHOVER_WARNING, type Granularity,
} from "@/lib/timeseries";
import { PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { DualAxisChart } from "@/components/charts/DualAxisChart";
import { SimpleBarChart } from "@/components/charts/SimpleBarChart";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/online")({
  head: () => ({
    meta: [
      { title: "Online channels — Fyxx Marketing" },
      { name: "description", content: "Mobile App against Website over time." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OnlineChannelsPage,
});

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

function OnlineChannelsPage() {
  const { range, refreshKey } = useDateRange();
  // Local controls, not the global toggles: this view is definitionally
  // App vs Website, and the global toggles could set it to POS and leave it
  // empty. Date range stays shared, because that genuinely is global.
  const [granularity, setGranularity] = useState<Granularity>("weekly");

  const lastYear = sameRangeLastYear(range.from, range.to);

  const { data, isLoading } = useQuery({
    queryKey: ["online", range.from, range.to, refreshKey],
    queryFn: async () => {
      const [now, prior] = await Promise.all([fetchDailySales(range), fetchDailySales(lastYear)]);
      return { now, prior };
    },
  });

  const series = useMemo(() => buildSeries(data?.now ?? [], granularity), [data, granularity]);
  const priorSeries = useMemo(() => buildSeries(data?.prior ?? [], granularity), [data, granularity]);

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Online channels" />
        <EmptyState>Loading…</EmptyState>
      </div>
    );
  }

  const total = (pts: typeof series, ch: "app" | "web") =>
    pts.reduce((a, p) => ({ revenue: a.revenue + p[ch].revenue, orders: a.orders + p[ch].orders }),
      { revenue: 0, orders: 0 });

  const appNow = total(series, "app");
  const webNow = total(series, "web");
  const appPrior = total(priorSeries, "app");
  const webPrior = total(priorSeries, "web");
  const aov = (t: { revenue: number; orders: number }) => (t.orders > 0 ? t.revenue / t.orders : 0);

  const revenueData = series.map((p) => ({ bucket: p.bucket, app: p.app.revenue, web: p.web.revenue }));
  const ordersData = series.map((p) => ({ bucket: p.bucket, app: p.app.orders, web: p.web.orders }));
  const shareData = series
    .filter((p) => p.webShare !== null)
    .map((p) => ({ label: p.bucket, value: Number(p.webShare) }));

  const webNoise = noiseNote(series, "web", granularity);
  const appNoise = noiseNote(series, "app", granularity);

  // The comparison window sits a year back, so it can span the switchover even
  // when the selected range does not. Both are checked.
  const switchoverInRange = spansSwitchover(range.from, range.to);
  const switchoverInComparison = spansSwitchover(lastYear.from, lastYear.to);

  const band = switchoverInRange
    ? { from: MOBILE_SWITCHOVER.from, to: MOBILE_SWITCHOVER.to, label: "Shopney → Appmaker" }
    : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Online channels"
        subtitle="Mobile App against Website. This view uses its own channel scope, not the global toggles."
      />

      {switchoverInRange || switchoverInComparison ? (
        <p className="border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
          ⚠️ {SWITCHOVER_WARNING}
          {switchoverInComparison && !switchoverInRange
            ? " The year-earlier comparison window spans it, so the year-on-year app figure compares Appmaker against Shopney."
            : ""}
        </p>
      ) : null}

      <div className="flex items-center gap-1">
        {GRANULARITIES.map((g) => (
          <button
            key={g.key}
            onClick={() => setGranularity(g.key)}
            className={cn(
              "label-xs rounded-sm border px-3 py-1.5",
              granularity === g.key
                ? "border-foreground bg-secondary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Mobile App revenue" value={jod(appNow.revenue)}
          delta={deltaPct(appNow.revenue, appPrior.revenue)} note="vs the same range a year earlier" />
        <StatTile label="Website revenue" value={jod(webNow.revenue)}
          delta={deltaPct(webNow.revenue, webPrior.revenue)} note="vs the same range a year earlier" />
        <StatTile label="Mobile App AOV" value={jod(aov(appNow))}
          delta={deltaPct(aov(appNow), aov(appPrior))} note={`${num(appNow.orders)} orders`} />
        <StatTile label="Website AOV" value={jod(aov(webNow))}
          delta={deltaPct(aov(webNow), aov(webPrior))} note={`${num(webNow.orders)} orders`} />
      </div>

      <Panel title="Revenue over time">
        {revenueData.length ? (
          <DualAxisChart
            data={revenueData} appLabel="Mobile App" webLabel="Website"
            appTotal={jod(appNow.revenue)} webTotal={jod(webNow.revenue)}
            unit=" JOD" band={band}
          />
        ) : <EmptyState>No data in range.</EmptyState>}
      </Panel>

      <Panel title="Website share of online revenue">
        {shareData.length ? (
          <>
            <SimpleBarChart data={shareData} valueSuffix="%" height={260} angledLabels />
            <p className="mt-2 text-xs text-muted-foreground">
              Website as a percentage of Website plus Mobile App. A rising line means the website is
              taking share, which two absolute lines cannot show.
            </p>
          </>
        ) : <EmptyState>No data in range.</EmptyState>}
      </Panel>

      <Panel title="Orders over time">
        {ordersData.length ? (
          <DualAxisChart
            data={ordersData} appLabel="Mobile App" webLabel="Website"
            appTotal={`${num(appNow.orders)} orders`} webTotal={`${num(webNow.orders)} orders`}
            band={band}
          />
        ) : <EmptyState>No data in range.</EmptyState>}
      </Panel>

      {webNoise || appNoise ? (
        <p className="text-xs text-muted-foreground">
          {webNoise ? `⚠️ ${webNoise}` : null}
          {webNoise && appNoise ? " " : null}
          {appNoise ? `⚠️ ${appNoise}` : null}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Margin is near identical between these two channels — {pct(24.2)} for the app and {pct(24.1)} for
        the website across the full period — so they differ in scale, not efficiency.
      </p>
    </div>
  );
}
