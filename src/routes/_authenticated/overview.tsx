import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDateRange } from "@/context/date-range-context";
import { fetchAttributed, fetchCampaigns, fetchDailySales, fetchFlows, fetchPush, fetchSnapshots } from "@/lib/queries";
import { previousRange } from "@/lib/ranges";
import { deltaPct, jod, num, pct } from "@/lib/format";
import { PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { describeChannels } from "@/lib/channels";
import { ChannelBar } from "@/components/layout/ChannelBar";
import { ConcentrationNotice } from "@/components/fyxx/ConcentrationNotice";
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
  // Selected-channel revenue — this is what the toggles drive.
  const onlineNow = sum(selSales.map((x) => Number(x.total_online_revenue_jod)));
  const onlinePrev = sum(selPrevSales.map((x) => Number(x.total_online_revenue_jod)));
  const ordersNow = sum(selSales.map((x) => Number(x.orders)));
  const ordersPrev = sum(selPrevSales.map((x) => Number(x.orders)));

  // The share is ALWAYS against every channel, never the filtered subset.
  //
  // Attributed revenue is whole-account and cannot be split by channel, so
  // dividing it by a subset is not a share of anything: Website alone produced
  // 358% and 392%. Capping at 100% would invent a ceiling and hide the
  // problem; reframing as a ratio answers a question nobody asks. Pairing a
  // whole-account numerator with a whole-account denominator is the only form
  // that means what its label says — and it is why this tile sits with the
  // other Klaviyo figures the toggles do not affect.
  const allNow = sum(d.sales.map((x) => Number(x.total_online_revenue_jod)));
  const allPrev = sum(d.prevSales.map((x) => Number(x.total_online_revenue_jod)));
  const shareNow = allNow > 0 ? (klaviyoNow / allNow) * 100 : null;
  const sharePrev = allPrev > 0 ? (klaviyoPrev / allPrev) * 100 : null;

  // Tier counts exist only on days we scanned LoyaltyLion — 3 of 369, because
  // the imported year of points history carries none. Taking the latest
  // snapshot of ANY kind means an imported day wins and the tile reads 0
  // members, which claims the programme is empty rather than unmeasured.
  const tiered = (rows: typeof d.snaps) => rows.filter((r) => r.blue_members > 0);
  const last = tiered(d.snaps).at(-1) ?? null;
  const prevLast = tiered(d.prevSnaps).at(-1) ?? null;
  const members = last
    ? last.blue_members + last.silver_members + last.gold_members + last.platinum_members
    : null;
  const membersPrev = prevLast
    ? prevLast.blue_members + prevLast.silver_members + prevLast.gold_members + prevLast.platinum_members
    : null;

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

      <ChannelBar />

      <section>
        <p className="label-xs mb-3 text-muted-foreground">
          Klaviyo — whole account, not affected by the channel toggles
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Messages sent"
            value={num(sentNow)}
            delta={deltaPct(sentNow, sentPrev)}
            note="Sends, not unique people"
          />
          <StatTile
            label="Klaviyo revenue"
            value={jod(klaviyoNow)}
            delta={deltaPct(klaviyoNow, klaviyoPrev)}
            note="Order-date basis, all channels"
          />
          <StatTile
            label="Klaviyo share of all revenue"
            value={shareNow === null ? "—" : pct(shareNow)}
            delta={shareNow !== null && sharePrev !== null ? deltaPct(shareNow, sharePrev) : undefined}
            note={`${jod(klaviyoNow)} of ${jod(allNow)} across every channel`}
          />
        </div>
      </section>

      <section>
        <p className="label-xs mb-3 text-muted-foreground">
          Shopify — follows the channel toggles: {describeChannels(channels)}
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Revenue"
            value={jod(onlineNow)}
            delta={deltaPct(onlineNow, onlinePrev)}
            note={describeChannels(channels)}
          />
          <StatTile
            label="Orders"
            value={num(ordersNow)}
            delta={deltaPct(ordersNow, ordersPrev)}
            note={describeChannels(channels)}
          />
          <StatTile
            label="Average order value"
            value={ordersNow > 0 ? jod(onlineNow / ordersNow) : "—"}
            delta={
              ordersNow > 0 && ordersPrev > 0
                ? deltaPct(onlineNow / ordersNow, onlinePrev / ordersPrev)
                : undefined
            }
            note={describeChannels(channels)}
          />
        </div>
      </section>

      <section>
        <p className="label-xs mb-3 text-muted-foreground">LoyaltyLion</p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Loyalty members"
            value={members === null ? "—" : num(members)}
            delta={members !== null && membersPrev !== null ? deltaPct(members, membersPrev) : undefined}
            note={
              members === null
                ? "Not measured in this range — tier snapshots start 27 Aug 2026"
                : `As at ${last!.snapshot_date}`
            }
          />
        </div>
      </section>

      {channels.includes("POS") ? (
        <p className="border-l-2 border-foreground bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
          ⚠️ POS revenue above is complete, but Klaviyo can only see about 35% of POS orders — the
          Odoo connector syncs only those with an identified customer. Don&apos;t compare the Klaviyo
          figures against POS revenue.
        </p>
      ) : null}

      <ConcentrationNotice rows={selSales} channels={channels} />

      <Panel title={`Daily revenue — Klaviyo attributed vs ${describeChannels(channels)}`}>
        {linePoints.length ? <RevenueLineChart data={linePoints} /> : <EmptyState>No data in range.</EmptyState>}
      </Panel>

      <Panel title="Messages sent by channel">
        <SimpleBarChart data={sentByChannel} />
      </Panel>
    </div>
  );
}
