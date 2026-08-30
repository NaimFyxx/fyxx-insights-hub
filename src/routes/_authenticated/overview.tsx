import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDateRange } from "@/context/date-range-context";
import {
  fetchAcquisition,
  headline,
  coverageNote,
  trend,
  trendSummary,
  BASIS_BREAK_MONTH,
} from "@/lib/acquisition";
import {
  fetchAttributed,
  fetchCampaigns,
  fetchDailySales,
  fetchFlows,
  fetchPush,
  fetchSnapshots,
} from "@/lib/queries";
import { previousRange, settledOnly, rangeIncludesToday } from "@/lib/ranges";
import { deltaPct, jod, num, pct } from "@/lib/format";
import { QueryFailed, PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { attributionLimitNote, SUB_CHANNELS, describeChannels } from "@/lib/channels";
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

  // Acquisition sits in its OWN query. It is monthly-bucketed and the trend
  // needs a trailing year regardless of the selected range, so folding it into
  // the main query would either refetch a year on every range change or tie
  // the trend to a range it does not use.
  const acq = useQuery({
    queryKey: ["overview-acquisition", range.from, range.to, refreshKey],
    queryFn: () => fetchAcquisition(range),
  });
  const acqTrend = useQuery({
    queryKey: ["overview-acquisition-trend", refreshKey],
    queryFn: () =>
      fetchAcquisition({ from: `${Number(range.to.slice(0, 4)) - 1}-${range.to.slice(5, 7)}-01`, to: range.to }),
  });

  const q = useQuery({
    queryKey: ["overview", range.from, range.to, refreshKey],
    queryFn: async () => {
      const [
        sales,
        prevSales,
        attributed,
        prevAttributed,
        campaigns,
        prevCampaigns,
        flows,
        prevFlows,
        push,
        prevPush,
        snaps,
        prevSnaps,
      ] = await Promise.all([
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
      return {
        sales,
        prevSales,
        attributed,
        prevAttributed,
        campaigns,
        prevCampaigns,
        flows,
        prevFlows,
        push,
        prevPush,
        snaps,
        prevSnaps,
      };
    },
  });

  if (q.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" />
        <QueryFailed error={q.error} />
      </div>
    );
  }

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
  // The RATIO excludes the day still in progress. Klaviyo and Shopify are
  // synced hours apart, so on the current day one source is further ahead than
  // the other and the share is distorted in whichever direction synced later.
  // The absolute tiles above still include today; only this quotient cannot.
  const klaviyoSettled = sum(settledOnly(d.attributed).map((x) => Number(x.revenue_jod)));
  const allSettled = sum(settledOnly(d.sales).map((x) => Number(x.total_online_revenue_jod)));
  const shareNow = allSettled > 0 ? (klaviyoSettled / allSettled) * 100 : null;
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
    ? prevLast.blue_members +
      prevLast.silver_members +
      prevLast.gold_members +
      prevLast.platinum_members
    : null;

  // Collapse the per-channel rows to one point per day before charting,
  // otherwise each day appears once per channel.
  const attributedByDate = new Map(d.attributed.map((a) => [a.date, Number(a.revenue_jod)]));
  const totalByDate = new Map<string, number>();
  for (const s of selSales) {
    totalByDate.set(s.date, (totalByDate.get(s.date) ?? 0) + Number(s.total_online_revenue_jod));
  }
  // Union of both series, not just the selected channels. Taking the axis from
  // sales alone silently dropped any day with Klaviyo revenue but no sales in
  // the current selection, removing that day's Klaviyo point with it — the
  // channel filter reaching a series it does not apply to.
  const axis = [...new Set([...totalByDate.keys(), ...attributedByDate.keys()])].sort();
  const linePoints = axis.map((date) => ({
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

      {/* The headline for the whole dashboard, so it sits above everything and
          before the channel-split figures. Detail lives on /acquisition. */}
      {acq.data ? (() => {
        const h = headline(acq.data);
        const t = acqTrend.data ? trend(acqTrend.data) : [];
        const s = t.length > 1 ? trendSummary(t) : null;
        return (
          <section className="border border-foreground px-5 py-4">
            <p className="label-xs mb-3 text-foreground">
              Revenue from customers marketing brought in — wherever they now buy
            </p>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <StatTile
                label="Share of revenue in range"
                value={h.pct === null ? "—" : pct(h.pct)}
                note={`${jod(h.onlineAcquiredRevenue)} of ${jod(h.totalRevenue)} — acquired via Website or Mobile App`}
              />
              <StatTile
                label={s ? `Like-for-like, before ${BASIS_BREAK_MONTH}` : "Like-for-like"}
                value={s && s.before !== null ? pct(s.before) : "—"}
                note={s ? `average across ${s.monthsBefore} months` : "widen the range for a trend"}
              />
              <StatTile
                label={s ? `Like-for-like, since ${BASIS_BREAK_MONTH}` : "Coverage in range"}
                value={
                  s && s.after !== null
                    ? pct(s.after)
                    : h.unattributablePct === null
                      ? "—"
                      : pct(100 - h.unattributablePct)
                }
                note={
                  s && s.changePoints !== null
                    ? `${s.changePoints >= 0 ? "+" : ""}${s.changePoints.toFixed(1)} pts, measurement change excluded`
                    : "share of revenue that can carry an acquisition channel"
                }
              />
            </div>
            <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
              This is <b>revenue from customers marketing brought in</b>, not revenue marketing
              caused — a customer acquired at POS in 2020 who has bought online ever since counts
              entirely as POS. {coverageNote(h)}{" "}
              <Link to="/acquisition" className="underline">
                Full detail, including the migration to phone and in-store ordering
              </Link>
              .
            </p>
          </section>
        );
      })() : null}

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
            delta={
              shareNow !== null && sharePrev !== null ? deltaPct(shareNow, sharePrev) : undefined
            }
            note={
              rangeIncludesToday(range)
                ? `${jod(klaviyoSettled)} of ${jod(allSettled)} across every channel, to yesterday`
                : `${jod(klaviyoSettled)} of ${jod(allSettled)} across every channel`
            }
          />
        </div>
        {/* The share tile divides by every channel, so it inherits the channels
            that cannot be credited to anyone. Stated here rather than in the
            tile note, which is too short to carry it. */}
        <p className="mt-3 text-xs text-muted-foreground">{attributionLimitNote(SUB_CHANNELS)}</p>
      </section>

      <section>
        <p className="label-xs mb-3 text-muted-foreground">
          Shopify — follows the channel toggles: {describeChannels(channels)}
        </p>
        {attributionLimitNote(channels) ? (
          <p className="mb-3 text-xs text-muted-foreground">{attributionLimitNote(channels)}</p>
        ) : null}
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
            delta={
              members !== null && membersPrev !== null ? deltaPct(members, membersPrev) : undefined
            }
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
          Odoo connector syncs only those with an identified customer. Don&apos;t compare the
          Klaviyo figures against POS revenue.
        </p>
      ) : null}

      <ConcentrationNotice rows={selSales} channels={channels} />

      <Panel title={`Daily revenue — Klaviyo attributed vs ${describeChannels(channels)}`}>
        {linePoints.length ? (
          <RevenueLineChart data={linePoints} totalLabel={describeChannels(channels)} />
        ) : (
          <EmptyState>No data in range.</EmptyState>
        )}
      </Panel>

      <Panel title="Messages sent by channel">
        <SimpleBarChart data={sentByChannel} />
      </Panel>
    </div>
  );
}
