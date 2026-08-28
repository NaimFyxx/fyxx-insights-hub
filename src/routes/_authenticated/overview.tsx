import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDateRange } from "@/context/date-range-context";
import { fetchAttributed, fetchCampaigns, fetchDailySales, fetchFlows, fetchPush, fetchSnapshots } from "@/lib/queries";
import { previousRange } from "@/lib/ranges";
import { deltaPct, jod, num, pct } from "@/lib/format";
import { PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { describeChannels } from "@/lib/channels";
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
  const { range, refreshKey, channels } = useDateRange();
  const prev = previousRange(range);

  const q = useQuery({
    queryKey: ["overview", range.from, range.to, refreshKey],
    queryFn: async () => {
      const [sales, prevSales, attributed, prevAttributed, campaigns, prevCampaigns, flows, prevFlows, push, prevPush, snaps, prevSnaps] =
        await Promise.all([
          fetchDailySales(range),
          fetchDailySales(prev),
          fetchAttributed(range),
          fetchAttributed(prev),
          fetchCampaigns(range),
          fetchCampaigns(prev),
          fetchFlows(range),
          fetchFlows(prev),
          fetchPush(range),
          fetchPush(prev),
          fetchSnapshots(range),
          fetchSnapshots(prev),
        ]);
      return { sales, prevSales, attributed, prevAttributed, campaigns, prevCampaigns, flows, prevFlows, push, prevPush, snaps, prevSnaps };
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

  // MESSAGES SENT, not people. Uniqueness does not aggregate: a profile mailed
  // on ten days counts ten times here. True unique reach needs Klaviyo's
  // `unique` measurement queried per range — see scripts/README.md.
  const sent = (c: typeof d.campaigns, f: typeof d.flows, p: typeof d.push) =>
    sum(c.map((x) => x.sent)) + sum(f.map((x) => x.recipients)) + sum(p.map((x) => x.sent));

  const sentNow = sent(d.campaigns, d.flows, d.push);
  const sentPrev = sent(d.prevCampaigns, d.prevFlows, d.prevPush);

  // Attributed revenue now comes from its own table, not the dead column.
  const klaviyoNow = sum(d.attributed.map((x) => Number(x.revenue_jod)));
  const klaviyoPrev = sum(d.prevAttributed.map((x) => Number(x.revenue_jod)));

  // One row per channel per day, so sum the SELECTED channels only.
  const inSelection = (r: { sub_channel: string }) => channels.includes(r.sub_channel as never);
  const selSales = d.sales.filter(inSelection);
  const selPrevSales = d.prevSales.filter(inSelection);
  const onlineNow = sum(selSales.map((x) => Number(x.total_online_revenue_jod)));
  const onlinePrev = sum(selPrevSales.map((x) => Number(x.total_online_revenue_jod)));

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

  // Collapse the per-channel rows to one point per day before charting,
  // otherwise each day appears once per channel.
  const attributedByDate = new Map(d.attributed.map((a) => [a.date, Number(a.revenue_jod)]));
  const totalByDate = new Map<string, number>();
  for (const s of selSales) {
    totalByDate.set(s.date, (totalByDate.get(s.date) ?? 0) + Number(s.total_online_revenue_jod));
  }
  const linePoints = [...totalByDate.keys()].sort().map((date) => ({
    date,
    klaviyo: attributedByDate.get(date) ?? 0,
    total: totalByDate.get(date) ?? 0,
  }));

  const sentByChannel = [
    { label: "Email campaigns", value: sum(d.campaigns.map((x) => x.sent)) },
    { label: "Push", value: sum(d.push.map((x) => x.sent)) },
    { label: "Flows", value: sum(d.flows.map((x) => x.recipients)) },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Overview" subtitle="Selected range compared with the previous period." />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Messages sent"
          value={num(sentNow)}
          delta={deltaPct(sentNow, sentPrev)}
          note="Sends, not people. One person mailed daily counts once per send."
        />
        <StatTile
          label="Klaviyo revenue"
          value={jod(klaviyoNow)}
          delta={deltaPct(klaviyoNow, klaviyoPrev)}
          note="Attributed by order date, all sales channels."
        />
        <StatTile
          label="Klaviyo-attributed share"
          value={pct(shareNow)}
          delta={deltaPct(shareNow, sharePrev)}
          note={`${jod(klaviyoNow)} attributed by Klaviyo across ALL channels, against ${jod(onlineNow)} from ${describeChannels(channels)}. Attribution cannot be split by channel, so the numerator is fixed while the denominator follows your filters.`}
        />
        <StatTile label="Loyalty members" value={num(members)} delta={deltaPct(members, membersPrev)} />
      </div>

      <Panel title={`Daily revenue — Klaviyo attributed vs ${describeChannels(channels)}`}>
        {linePoints.length ? <RevenueLineChart data={linePoints} /> : <EmptyState>No data in range.</EmptyState>}
      </Panel>

      <Panel title="Messages sent by channel">
        <SimpleBarChart data={sentByChannel} />
      </Panel>
    </div>
  );
}
