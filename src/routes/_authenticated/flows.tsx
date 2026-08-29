import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDateRange } from "@/context/date-range-context";
import { fetchFlows } from "@/lib/queries";
import { jod, num, pct, rate } from "@/lib/format";
import { QueryFailed, PageHeader, Panel, EmptyState } from "@/components/fyxx/primitives";
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
  opened: number;
  clicked: number;
  conversions: number;
  revenue: number;
};

type SortKey = "flow_name" | "recipients" | "open_rate" | "click_rate" | "conversion_rate" | "revenue";

function FlowsPage() {
  const { range, refreshKey } = useDateRange();
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [asc, setAsc] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["flows", range.from, range.to, refreshKey],
    queryFn: () => fetchFlows(range),
  });

  const rows = useMemo(() => {
    const map = new Map<string, Agg>();
    for (const r of data ?? []) {
      const cur = map.get(r.flow_name) ?? {
        flow_name: r.flow_name,
        recipients: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        conversions: 0,
        revenue: 0,
      };
      cur.recipients += r.recipients;
      cur.delivered += r.delivered;
      cur.opened += r.opened;
      cur.clicked += r.clicked;
      cur.conversions += r.conversions;
      cur.revenue += Number(r.revenue_jod);
      map.set(r.flow_name, cur);
    }
    const list = [...map.values()].filter((f) => f.recipients > 0);
    const value = (f: Agg) => {
      switch (sortKey) {
        case "flow_name":
          return f.flow_name;
        case "recipients":
          return f.recipients;
        case "open_rate":
          return rate(f.opened, f.delivered);
        case "click_rate":
          return rate(f.clicked, f.delivered);
        case "conversion_rate":
          return rate(f.conversions, f.delivered);
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
  }, [data, sortKey, asc]);

  const t = rows.reduce(
    (acc, r) => ({
      recipients: acc.recipients + r.recipients,
      delivered: acc.delivered + r.delivered,
      opened: acc.opened + r.opened,
      clicked: acc.clicked + r.clicked,
      conversions: acc.conversions + r.conversions,
      revenue: acc.revenue + r.revenue,
    }),
    { recipients: 0, delivered: 0, opened: 0, clicked: 0, conversions: 0, revenue: 0 },
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
      <Panel title="Live flows">
        {isLoading ? (
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
                  <Td align="right">{pct(rate(r.opened, r.delivered))}</Td>
                  <Td align="right">{pct(rate(r.clicked, r.delivered))}</Td>
                  <Td align="right">{pct(rate(r.conversions, r.delivered), 2)}</Td>
                  <Td align="right">{jod(r.revenue)}</Td>
                </tr>
              ))}
              <TotalsRow>
                <Td>Total</Td>
                <Td align="right">{num(t.recipients)}</Td>
                <Td align="right">{pct(rate(t.opened, t.delivered))}</Td>
                <Td align="right">{pct(rate(t.clicked, t.delivered))}</Td>
                <Td align="right">{pct(rate(t.conversions, t.delivered), 2)}</Td>
                <Td align="right">{jod(t.revenue)}</Td>
              </TotalsRow>
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
