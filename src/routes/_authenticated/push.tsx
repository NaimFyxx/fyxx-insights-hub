import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useDateRange } from "@/context/date-range-context";
import { fetchPush } from "@/lib/queries";
import { jod, num, pct, rate } from "@/lib/format";
import { OpensCaveat, QueryFailed, PageHeader, Panel, EmptyState } from "@/components/fyxx/primitives";
import { Table, Th, Td, TotalsRow } from "@/components/fyxx/data-table";

export const Route = createFileRoute("/_authenticated/push")({
  head: () => ({
    meta: [
      { title: "Push — Fyxx Marketing" },
      { name: "description", content: "Push notification reach grouped by source flow or campaign." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Push — Fyxx Marketing" },
      {
        property: "og:description",
        content: "Push notification reach grouped by source flow or campaign.",
      },
    ],
  }),
  component: PushPage,
});

function PushPage() {
  const { range, refreshKey } = useDateRange();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["push", range.from, range.to, refreshKey],
    queryFn: () => fetchPush(range),
  });

  const rows = useMemo(() => {
    const map = new Map<string, { name: string; type: string; sent: number; delivered: number; opened: number; conversions: number; revenue: number }>();
    for (const r of data ?? []) {
      const key = `${r.source_type}::${r.source_name}`;
      const cur = map.get(key) ?? { name: r.source_name, type: r.source_type, sent: 0, delivered: 0, opened: 0, conversions: 0, revenue: 0 };
      cur.sent += r.sent;
      cur.delivered += r.delivered;
      cur.opened += r.opened;
      cur.conversions += r.conversions;
      cur.revenue += Number(r.revenue_jod);
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.sent - a.sent);
  }, [data]);

  const t = rows.reduce(
    (a, r) => ({
      sent: a.sent + r.sent,
      delivered: a.delivered + r.delivered,
      opened: a.opened + r.opened,
      conversions: a.conversions + r.conversions,
      revenue: a.revenue + r.revenue,
    }),
    { sent: 0, delivered: 0, opened: 0, conversions: 0, revenue: 0 },
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Push"
        subtitle="Grouped by the flow or campaign that sent the notification. Klaviyo cannot split by Shopify sales channel, so no channel filter applies here."
      />
      {isError ? <QueryFailed error={error} /> : null}
      <OpensCaveat />
      <p className="text-xs text-muted-foreground">
        Push opens are a different measurement from email opens and are not affected by Apple
        Mail. But Klaviyo emits no push CLICK event of any kind, so for push there is nothing to
        fall back to — opens and conversions are the whole picture.
      </p>
      <Panel title="Push notifications">
        {isLoading ? (
          <EmptyState>Loading…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>No push sends in range.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Source</Th>
                <Th>Type</Th>
                <Th align="right">Sent</Th>
                <Th align="right">Opened</Th>
                <Th align="right">Open rate</Th>
                <Th align="right">Orders</Th>
                <Th align="right">Revenue JOD</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.type}-${r.name}`}>
                  <Td>{r.name}</Td>
                  <Td>{r.type}</Td>
                  <Td align="right">{num(r.sent)}</Td>
                  <Td align="right">{num(r.opened)}</Td>
                  <Td align="right">{pct(rate(r.opened, r.delivered))}</Td>
                  <Td align="right">{num(r.conversions)}</Td>
                  <Td align="right">{jod(r.revenue)}</Td>
                </tr>
              ))}
              <TotalsRow>
                <Td>Total</Td>
                <Td>—</Td>
                <Td align="right">{num(t.sent)}</Td>
                <Td align="right">{num(t.opened)}</Td>
                <Td align="right">{pct(rate(t.opened, t.delivered))}</Td>
                <Td align="right">{num(t.conversions)}</Td>
                <Td align="right">{jod(t.revenue)}</Td>
              </TotalsRow>
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
