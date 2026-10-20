import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDateRange } from "@/context/date-range-context";
import { fetchFlows, fetchFlowMonthly } from "@/lib/queries";
import { wholeMonthOf } from "@/lib/report";
import { jod, num, pct, rate } from "@/lib/format";
import { OpensCaveat, QueryFailed, PageHeader, Panel, EmptyState } from "@/components/fyxx/primitives";
import { Table, Th, Td, TotalsRow } from "@/components/fyxx/data-table";

export const Route = createFileRoute("/_authenticated/flows")({
  head: () => ({
    meta: [
      { title: "Flows — Fyxx Marketing" },
      { name: "description", content: "Live Klaviyo flows with sends in the selected range." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Flows — Fyxx Marketing" },
      { property: "og:description", content: "Live Klaviyo flows with sends in the selected range." },
    ],
  }),
  component: FlowsPage,
});

type Agg = {
  flow_name: string;
  recipients: number;
  /** Klaviyo computes its rates off delivered, so totals must too. */
  delivered: number;
  /**
   * NULL when the selected range is not a whole calendar month, because then
   * no true figure exists: see the note on `month` below. Rendering a null as
   * a number here would print the inflated daily sum.
   */
  opened: number | null;
  /**
   * Distinct customers who ordered, the numerator Klaviyo's conversion_rate
   * uses. NULL on a range that is not a whole month, for the same reason as
   * `opened`: uniqueness is defined over the window asked about, so daily
   * figures cannot be added. `conversions` below counts ORDERS and is
   * additive, which is why it stays a number.
   */
  uniqueBuyers: number | null;
  clicked: number;
  conversions: number;
  revenue: number;
};

type SortKey = "flow_name" | "recipients" | "open_rate" | "click_rate" | "conversion_rate" | "revenue";

function FlowsPage() {
  const { range, refreshKey } = useDateRange();
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [asc, setAsc] = useState(false);

  /**
   * Opens are only true for a window Klaviyo was asked about.
   *
   * Klaviyo's opens_unique counts unique PEOPLE inside the window, so summing
   * the daily rows counts anyone who opened on more than one day more than
   * once: September 2026 sums to 1,298 for review-request-judgeme against
   * Klaviyo's 761 for the month, and the gap widens with the range. The only
   * window we hold a true figure for is the calendar month, so on any other
   * range the open rate is withheld rather than overstated.
   */
  const month = wholeMonthOf(range);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["flows", range.from, range.to, refreshKey],
    queryFn: async () => {
      const [daily, monthly] = await Promise.all([
        fetchFlows(range),
        month ? fetchFlowMonthly(month) : Promise.resolve([]),
      ]);
      return { daily, monthly };
    },
  });

  const rows = useMemo(() => {
    const map = new Map<string, Agg>();
    for (const r of data?.daily ?? []) {
      const cur = map.get(r.flow_name) ?? {
        flow_name: r.flow_name,
        recipients: 0,
        delivered: 0,
        opened: 0,
        uniqueBuyers: 0,
        clicked: 0,
        conversions: 0,
        revenue: 0,
      };
      cur.recipients += r.recipients;
      cur.delivered += r.delivered;
      cur.clicked += r.clicked;
      cur.conversions += r.conversions;
      cur.revenue += Number(r.revenue_jod);
      map.set(r.flow_name, cur);
    }
    // Opens come from the monthly report, never from the daily rows. Email
    // only, matching what this table shows: flow push lives on the Push page.
    const opensByFlow = new Map<string, number>();
    const buyersByFlow = new Map<string, number>();
    for (const m of data?.monthly ?? []) {
      if (m.send_channel !== "email") continue;
      opensByFlow.set(m.flow_name, (opensByFlow.get(m.flow_name) ?? 0) + m.opened);
      buyersByFlow.set(m.flow_name, (buyersByFlow.get(m.flow_name) ?? 0) + (m.unique_buyers ?? 0));
    }
    for (const f of map.values()) {
      f.opened = month ? (opensByFlow.get(f.flow_name) ?? 0) : null;
      f.uniqueBuyers = month ? (buyersByFlow.get(f.flow_name) ?? 0) : null;
    }

    const list = [...map.values()].filter((f) => f.recipients > 0);
    const value = (f: Agg) => {
      switch (sortKey) {
        case "flow_name":
          return f.flow_name;
        case "recipients":
          return f.recipients;
        case "open_rate":
          return f.opened === null ? -1 : rate(f.opened, f.delivered);
        case "click_rate":
          return rate(f.clicked, f.delivered);
        case "conversion_rate":
          return f.uniqueBuyers === null ? -1 : rate(f.uniqueBuyers, f.delivered);
        default:
          return f.revenue;
      }
    };
    return list.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return asc ? cmp : -cmp;
    });
  }, [data, month, sortKey, asc]);

  const t = rows.reduce(
    (acc, r) => ({
      recipients: acc.recipients + r.recipients,
      delivered: acc.delivered + r.delivered,
      opened: r.opened === null ? acc.opened : acc.opened + r.opened,
      clicked: acc.clicked + r.clicked,
      conversions: acc.conversions + r.conversions,
      uniqueBuyers: r.uniqueBuyers === null ? acc.uniqueBuyers : acc.uniqueBuyers + r.uniqueBuyers,
      revenue: acc.revenue + r.revenue,
    }),
    { recipients: 0, delivered: 0, opened: 0, uniqueBuyers: 0, clicked: 0, conversions: 0, revenue: 0 },
  );

  const header = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <Th
      align={align}
      active={sortKey === key}
      onClick={() => {
        if (sortKey === key) setAsc(!asc);
        else {
          setSortKey(key);
          setAsc(false);
        }
      }}
    >
      {label}
      {sortKey === key ? (asc ? " ↑" : " ↓") : ""}
    </Th>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Flows"
        subtitle="Aggregated per flow across the selected range. Klaviyo cannot split by Shopify sales channel, so no channel filter applies here."
      />
      {isError ? <QueryFailed error={error} /> : null}
      {month ? null : (
        <p className="border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
          <span className="text-foreground">Open rate is not shown for this range.</span> Klaviyo
          counts unique people who opened inside the window it is asked about, so a figure for one
          day cannot be added to the next: anyone who opens on two days would be counted twice.
          September 2026 summed that way gives 1,298 opens for review-request-judgeme against
          Klaviyo&rsquo;s 761 for the month. A true figure is held for whole calendar months only,
          so <b>set the range to one month</b> to see it. Conversion rate is withheld for the
          same reason: it divides distinct BUYERS by delivered, and a buyer who orders in two
          months is one buyer in each. Recipients, clicks, orders and revenue are all additive
          and correct for any range.
        </p>
      )}
      <OpensCaveat />
      <Panel title="Live flows">
        {isError ? (
          <EmptyState>Not loaded — see the error above.</EmptyState>
        ) : isLoading ? (
          <EmptyState>Loading…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>No flow sends in range.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                {header("flow_name", "Flow", "left")}
                {header("recipients", "Recipients")}
                {header("open_rate", "Open rate")}
                {header("click_rate", "Click rate")}
                {header("conversion_rate", "Conversion rate")}
                {header("revenue", "Revenue JOD")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.flow_name}>
                  <Td>{r.flow_name}</Td>
                  <Td align="right">{num(r.recipients)}</Td>
                  <Td align="right">
                    {r.opened === null ? "n/a" : pct(rate(r.opened, r.delivered))}
                  </Td>
                  <Td align="right">{pct(rate(r.clicked, r.delivered))}</Td>
                  <Td align="right">
                    {r.uniqueBuyers === null ? "n/a" : pct(rate(r.uniqueBuyers, r.delivered), 2)}
                  </Td>
                  <Td align="right">{jod(r.revenue)}</Td>
                </tr>
              ))}
              <TotalsRow>
                <Td>Total</Td>
                <Td align="right">{num(t.recipients)}</Td>
                <Td align="right">{month ? pct(rate(t.opened, t.delivered)) : "n/a"}</Td>
                <Td align="right">{pct(rate(t.clicked, t.delivered))}</Td>
                <Td align="right">
                  {month ? pct(rate(t.uniqueBuyers, t.delivered), 2) : "n/a"}
                </Td>
                <Td align="right">{jod(t.revenue)}</Td>
              </TotalsRow>
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
