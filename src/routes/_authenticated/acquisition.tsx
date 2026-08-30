import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { QueryFailed, PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { Table, Th, Td } from "@/components/fyxx/data-table";
import { useDateRange } from "@/context/date-range-context";
import {
  fetchAcquisition,
  headline,
  byMonth,
  byMonthOrderChannel,
  channels,
  migration,
  isUnattributable,
  coverageNote,
  trend,
  trendSummary,
  BASIS_BREAK_MONTH,
  BASIS_BREAK_NOTE,
  ACQUISITION_COVERAGE,
} from "@/lib/acquisition";
import { SUB_CHANNELS } from "@/lib/channels";
import { jod, num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/acquisition")({
  head: () => ({
    meta: [
      { title: "Acquisition channel — Fyxx Marketing" },
      { name: "description", content: "Revenue by the channel that acquired the customer." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AcquisitionPage,
});

function AcquisitionPage() {
  const { range, refreshKey } = useDateRange();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["acquisition", range.from, range.to, refreshKey],
    queryFn: () => fetchAcquisition(range),
  });

  // LOCAL to this page, deliberately. The global toggles filter by ORDER
  // channel; this filters by ACQUISITION channel. Sharing one control for both
  // would produce two different totals for the same range from what looks like
  // the same switch, which is indistinguishable from a bug.
  const [selected, setSelected] = useState<string[]>([]);

  const rows = data ?? [];
  const present = useMemo(() => channels(rows), [rows]);
  const active = selected.length ? selected : present.map((p) => p.name);
  const filtered = useMemo(
    () => rows.filter((r) => active.includes(r.acquisition_channel)),
    [rows, active],
  );

  const h = useMemo(() => headline(rows), [rows]);
  const mig = useMemo(() => migration(rows), [rows]);
  const acqSeries = useMemo(
    () => byMonth(filtered, active.filter((a) => !isUnattributable(a))),
    [filtered, active],
  );
  const ordSeries = useMemo(() => byMonthOrderChannel(rows, SUB_CHANNELS), [rows]);
  const tr = useMemo(() => trend(rows), [rows]);
  const trSum = useMemo(() => trendSummary(tr), [tr]);

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Acquisition channel" />
        <QueryFailed error={error} />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Acquisition channel" />
        <EmptyState>Loading…</EmptyState>
      </div>
    );
  }

  const toggle = (name: string) =>
    setSelected((cur) => {
      const base = cur.length ? cur : present.map((p) => p.name);
      const next = base.includes(name) ? base.filter((x) => x !== name) : [...base, name];
      return next.length ? next : base;
    });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Acquisition channel"
        subtitle="Where the CUSTOMER first came from, not where each order came from. Monthly buckets, netted of cancellations."
      />

      {/* Stated wherever an acquisition figure appears, not once at the bottom. */}
      <p className="border-l-2 border-foreground bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
        ⚠️ {coverageNote(h)}
      </p>

      <section>
        <p className="label-xs mb-3 text-muted-foreground">
          The headline — revenue from customers marketing acquired, wherever they now buy
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="From customers acquired online"
            value={h.pct === null ? "—" : pct(h.pct)}
            note={`${jod(h.onlineAcquiredRevenue)} of ${jod(h.totalRevenue)} — Website and Mobile App acquisitions`}
          />
          <StatTile
            label="Same figure, unattributable removed"
            value={h.pctOfAttributable === null ? "—" : pct(h.pctOfAttributable)}
            note="Share of only the revenue that CAN carry an acquisition channel"
          />
          <StatTile
            label="Cannot be attributed to anyone"
            value={h.unattributablePct === null ? "—" : pct(h.unattributablePct)}
            note={`${jod(h.unattributableRevenue)} — orders with no customer attached`}
          />
        </div>
        <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
          This answers <b>&ldquo;how much of the business comes from customers marketing brought
          in&rdquo;</b>. It is NOT &ldquo;revenue marketing caused&rdquo;: someone acquired at POS
          in 2020 who has bought online ever since counts entirely as POS. The first claim is
          defensible and the second is not, so use the first wording.
        </p>
      </section>

      {/* ---- the filter, visually distinct from the global order-channel bar ---- */}
      <div className="border border-dashed border-foreground/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="label-xs text-foreground">Acquisition channel filter</span>
          <div className="flex flex-wrap items-center gap-1">
            {present.map((c) => {
              const on = active.includes(c.name);
              return (
                <button
                  key={c.name}
                  onClick={() => toggle(c.name)}
                  aria-pressed={on}
                  className={cn(
                    "label-xs rounded-sm border px-3 py-1",
                    on
                      ? "border-foreground bg-secondary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                    c.unattributable && "italic",
                  )}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          This is <b>not</b> the channel filter on the Overview. That one asks where an order came
          from; this asks where the customer came from. The same range will give different totals
          through each, and that is correct rather than a fault.
        </p>
      </div>

      <Panel title="The trend — share of revenue from online-acquired customers">
        {tr.length < 2 ? (
          <EmptyState>
            One month is a number, not a trend. Widen the date range to see the series.
          </EmptyState>
        ) : (
          <>
            {/* The basis break is stated ABOVE the table, not under it. A reader
                who takes the raw column across April 2026 reaches a wrong
                conclusion, and a caption below would arrive too late. */}
            <p className="mb-4 border-l-2 border-foreground bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
              ⚠️ <b>The basis changes in {BASIS_BREAK_MONTH}.</b> {BASIS_BREAK_NOTE}
            </p>

            {trSum.changePoints !== null ? (
              <div className="mb-4 grid grid-cols-1 gap-6 md:grid-cols-3">
                <StatTile
                  label={`Before ${BASIS_BREAK_MONTH}, like-for-like`}
                  value={pct(trSum.before!)}
                  note={`average across ${trSum.monthsBefore} months`}
                />
                <StatTile
                  label={`Since ${BASIS_BREAK_MONTH}, like-for-like`}
                  value={pct(trSum.after!)}
                  note={`average across ${trSum.monthsAfter} months`}
                />
                <StatTile
                  label="Change"
                  value={`${trSum.changePoints >= 0 ? "+" : ""}${trSum.changePoints.toFixed(1)} pts`}
                  note="On the comparable basis, so the measurement change is excluded"
                />
              </div>
            ) : null}

            <Table>
              <thead>
                <tr>
                  <Th>Month</Th>
                  <Th align="right">Share of ALL revenue</Th>
                  <Th align="right">Like-for-like share</Th>
                  <Th align="right">Coverage</Th>
                  <Th align="right">Revenue</Th>
                </tr>
              </thead>
              <tbody>
                {tr.map((p, i) => {
                  const isBreak = p.month === BASIS_BREAK_MONTH && i > 0;
                  return (
                    <tr key={p.month} className={isBreak ? "border-t-2 border-foreground" : ""}>
                      <Td>
                        {p.month}
                        {isBreak ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ← basis changes here
                          </span>
                        ) : null}
                      </Td>
                      <Td align="right">
                        <span className="text-muted-foreground">
                          {p.rawShare === null ? "—" : pct(p.rawShare)}
                        </span>
                      </Td>
                      <Td align="right">
                        <b>{p.comparableShare === null ? "—" : pct(p.comparableShare)}</b>
                      </Td>
                      <Td align="right">{p.coverage === null ? "—" : pct(p.coverage)}</Td>
                      <Td align="right">{jod(p.revenue)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
              The <b>like-for-like</b> column is the one to read across time: it excludes revenue
              that can never carry an acquisition channel from both halves of the fraction, so it
              means the same thing in every month. The share-of-all-revenue column is the honest
              figure for any SINGLE month and is what the headline tile shows, but it is not
              comparable across {BASIS_BREAK_MONTH}.
            </p>
          </>
        )}
      </Panel>

      <Panel title="Revenue by ACQUISITION channel, by month">
        {acqSeries.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                {active.filter((a) => !isUnattributable(a)).map((a) => (
                  <Th key={a} align="right">{a}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {acqSeries.map((p) => (
                <tr key={String(p["month"])}>
                  <Td>{String(p["month"])}</Td>
                  {active.filter((a) => !isUnattributable(a)).map((a) => (
                    <Td key={a} align="right">{jod(Number(p[a] ?? 0))}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState>No data in range.</EmptyState>
        )}
      </Panel>

      <Panel title="Revenue by ORDER channel, by month — the existing view, for comparison">
        <p className="mb-3 text-xs text-muted-foreground">
          Same months, same revenue, cut the other way. Where a row differs sharply from the table
          above, that difference IS the migration.
        </p>
        {ordSeries.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                {SUB_CHANNELS.map((c) => (
                  <Th key={c} align="right">{c}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordSeries.map((p) => (
                <tr key={String(p["month"])}>
                  <Td>{String(p["month"])}</Td>
                  {SUB_CHANNELS.map((c) => (
                    <Td key={c} align="right">{jod(Number(p[c] ?? 0))}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState>No data in range.</EmptyState>
        )}
      </Panel>

      <Panel title="The migration — where online-acquired customers place their LATER orders">
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          Each customer&rsquo;s own first order is excluded, so this is subsequent behaviour rather
          than a restatement of how they were acquired.
        </p>

        {mig.map((m) => (
          <div key={m.acquiredVia} className="mb-6">
            <p className="label-xs mb-2 text-muted-foreground">
              Acquired via {m.acquiredVia} — {num(m.laterOrders)} later orders,{" "}
              {jod(m.laterRevenue)}
            </p>

            {/* The gap is the finding, so both measures sit side by side and
                neither can be read without the other. */}
            <div className="mb-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="border border-border px-4 py-3">
                <p className="label-xs text-muted-foreground">Of later ORDERS, placed offline</p>
                <p className="display-num text-2xl">
                  {m.pctOrdersOffline === null ? "—" : pct(m.pctOrdersOffline)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {num(m.offlineOrders)} of {num(m.laterOrders)}
                </p>
              </div>
              <div className="border border-foreground px-4 py-3">
                <p className="label-xs text-muted-foreground">Of later REVENUE, placed offline</p>
                <p className="display-num text-2xl">
                  {m.pctRevenueOffline === null ? "—" : pct(m.pctRevenueOffline)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {jod(m.offlineRevenue)} of {jod(m.laterRevenue)}
                </p>
              </div>
            </div>
            {m.pctOrdersOffline !== null && m.pctRevenueOffline !== null ? (
              <p className="mb-3 border-l-2 border-foreground bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
                The revenue share is{" "}
                <b>{(m.pctRevenueOffline / m.pctOrdersOffline).toFixed(1)}×</b> the order share.
                Offline baskets from these customers are materially bigger, so counting orders
                alone understates the effect by roughly half.
              </p>
            ) : null}

            <Table>
              <thead>
                <tr>
                  <Th>Later orders placed through</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">% of orders</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">% of revenue</Th>
                </tr>
              </thead>
              <tbody>
                {m.byOrderChannel.map((c) => (
                  <tr key={c.orderChannel}>
                    <Td>{c.orderChannel}</Td>
                    <Td align="right">{num(c.orders)}</Td>
                    <Td align="right">{c.pctOrders === null ? "—" : pct(c.pctOrders)}</Td>
                    <Td align="right">{jod(c.revenue)}</Td>
                    <Td align="right">{c.pctRevenue === null ? "—" : pct(c.pctRevenue)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ))}
      </Panel>

      <Panel title="Every acquisition channel in range">
        <Table>
          <thead>
            <tr>
              <Th>Acquired via</Th>
              <Th align="right">Orders</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">Share of revenue</Th>
            </tr>
          </thead>
          <tbody>
            {present.map((c) => (
              <tr key={c.name}>
                <Td>
                  {c.name}
                  {c.unattributable ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      cannot carry an acquisition channel
                    </span>
                  ) : null}
                </Td>
                <Td align="right">{num(c.orders)}</Td>
                <Td align="right">{jod(c.revenue)}</Td>
                <Td align="right">
                  {h.totalRevenue > 0 ? pct((c.revenue / h.totalRevenue) * 100) : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Coverage measured {ACQUISITION_COVERAGE.measuredOn} across the full order history. House
          and staff accounts are excluded entirely, as everywhere else on this dashboard.
        </p>
      </Panel>
    </div>
  );
}
