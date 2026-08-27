import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDateRange } from "@/context/date-range-context";
import { fetchCampaigns, fetchDailySales, fetchFlows, fetchPush, fetchSnapshots } from "@/lib/queries";
import { previousRange } from "@/lib/ranges";
import { deltaPct, jod, num, pct } from "@/lib/format";
import { PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { RevenueLineChart } from "@/components/charts/RevenueLineChart";
import { SimpleBarChart } from "@/components/charts/SimpleBarChart";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — Fyxx Marketing" },
      { name: "description", content: "Reach, attributed revenue and loyalty at a glance." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Overview — Fyxx Marketing" },
      { property: "og:description", content: "Reach, attributed revenue and loyalty at a glance." },
    ],
  }),
  component: OverviewPage,
});

const sum = (rows: number[]) => rows.reduce((a, b) => a + b, 0);

function OverviewPage() {
  const { range, refreshKey } = useDateRange();
  const prev = previousRange(range);

  const q = useQuery({
    queryKey: ["overview", range.from, range.to, refreshKey],
    queryFn: async () => {
      const [sales, prevSales, campaigns, prevCampaigns, flows, prevFlows, push, prevPush, snaps, prevSnaps] =
        await Promise.all([
          fetchDailySales(range),
          fetchDailySales(prev),
          fetchCampaigns(range),
          fetchCampaigns(prev),
          fetchFlows(range),
          fetchFlows(prev),
          fetchPush(range),
          fetchPush(prev),
          fetchSnapshots(range),
          fetchSnapshots(prev),
        ]);
      return { sales, prevSales, campaigns, prevCampaigns, flows, prevFlows, push, prevPush, snaps, prevSnaps };
    },
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" />
        <EmptyState>Loading…</EmptyState>
      </div>
    );
  }

  const d = q.data;

  const reach = (c: typeof d.campaigns, f: typeof d.flows, p: typeof d.push) =>
    sum(c.map((x) => x.sent)) + sum(f.map((x) => x.recipients)) + sum(p.map((x) => x.sent));

  const reachNow = reach(d.campaigns, d.flows, d.push);
  const reachPrev = reach(d.prevCampaigns, d.prevFlows, d.prevPush);

  const klaviyoNow = sum(d.sales.map((x) => Number(x.klaviyo_attributed_revenue_jod)));
  const klaviyoPrev = sum(d.prevSales.map((x) => Number(x.klaviyo_attributed_revenue_jod)));

  const onlineNow = sum(d.sales.map((x) => Number(x.total_online_revenue_jod)));
  const onlinePrev = sum(d.prevSales.map((x) => Number(x.total_online_revenue_jod)));

  const shareNow = onlineNow > 0 ? (klaviyoNow / onlineNow) * 100 : 0;
  const sharePrev = onlinePrev > 0 ? (klaviyoPrev / onlinePrev) * 100 : 0;

  const last = d.snaps.at(-1);
  const prevLast = d.prevSnaps.at(-1);
  const members = last
    ? last.blue_members + last.silver_members + last.gold_members + last.platinum_members
    : 0;
  const membersPrev = prevLast
    ? prevLast.blue_members + prevLast.silver_members + prevLast.gold_members + prevLast.platinum_members
    : 0;

  const linePoints = d.sales.map((s) => ({
    date: s.date,
    klaviyo: Number(s.klaviyo_attributed_revenue_jod),
    total: Number(s.total_online_revenue_jod),
  }));

  const reachByChannel = [
    { label: "Email campaigns", value: sum(d.campaigns.map((x) => x.sent)) },
    { label: "Push", value: sum(d.push.map((x) => x.sent)) },
    { label: "Flows", value: sum(d.flows.map((x) => x.recipients)) },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Overview" subtitle="Selected range compared with the previous period." />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatTile label="People reached" value={num(reachNow)} delta={deltaPct(reachNow, reachPrev)} />
        <StatTile
          label="Klaviyo revenue"
          value={jod(klaviyoNow)}
          delta={deltaPct(klaviyoNow, klaviyoPrev)}
        />
        <StatTile
          label="Share of online revenue"
          value={pct(shareNow)}
          delta={deltaPct(shareNow, sharePrev)}
        />
        <StatTile label="Loyalty members" value={num(members)} delta={deltaPct(members, membersPrev)} />
      </div>

      <Panel title="Daily revenue — Klaviyo attributed vs total online">
        {linePoints.length ? <RevenueLineChart data={linePoints} /> : <EmptyState>No data in range.</EmptyState>}
      </Panel>

      <Panel title="Reach by channel">
        <SimpleBarChart data={reachByChannel} />
      </Panel>
    </div>
  );
}
