import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useDateRange } from "@/context/date-range-context";
import { fetchCampaigns } from "@/lib/queries";
import { jod, num, pct, rate } from "@/lib/format";
import { UNSUBSCRIBE_WATCH_RATE } from "@/lib/engagement";
import { OpensCaveat, QueryFailed, PageHeader, Panel, EmptyState } from "@/components/fyxx/primitives";
import { Table, Th, Td, TotalsRow } from "@/components/fyxx/data-table";
import { SimpleBarChart } from "@/components/charts/SimpleBarChart";

export const Route = createFileRoute("/_authenticated/campaigns")({
  head: () => ({
    meta: [
      { title: "Email campaigns — Fyxx Marketing" },
      { name: "description", content: "Klaviyo email campaign performance for the selected range." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Email campaigns — Fyxx Marketing" },
      {
        property: "og:description",
        content: "Klaviyo email campaign performance for the selected range.",
      },
    ],
  }),
  component: CampaignsPage,
});

function CampaignsPage() {
  const { range, refreshKey } = useDateRange();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["campaigns", range.from, range.to, refreshKey],
    queryFn: () => fetchCampaigns(range),
  });

  const rows = data ?? [];
  const t = rows.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      delivered: acc.delivered + r.delivered,
      opened: acc.opened + r.opened,
      clicked: acc.clicked + r.clicked,
      orders: acc.orders + r.orders,
      revenue: acc.revenue + Number(r.revenue_jod),
    }),
    { sent: 0, delivered: 0, opened: 0, clicked: 0, orders: 0, revenue: 0 },
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Email campaigns"
        subtitle="One row per campaign sent in the selected range. Klaviyo cannot split by Shopify sales channel, so no channel filter applies here."
      />
      {isError ? <QueryFailed error={error} /> : null}
      <OpensCaveat />
      <p className="text-xs text-muted-foreground">
        <b>Unsubscribe rate is the cost column</b>, and the one engagement figure Apple Mail
        cannot distort — no mail client unsubscribes on someone&rsquo;s behalf. Read it beside
        revenue, never on its own: a campaign that earns well while burning list is not a success.
        A dash means the figure has not been fetched for that campaign yet, which is not the same
        as nobody unsubscribing.
      </p>

      <Panel title="Revenue per campaign">
        {isError ? (
          <EmptyState>Not loaded — see the error above.</EmptyState>
        ) : isLoading ? (
          <EmptyState>Loading…</EmptyState>
        ) : rows.length ? (
          <SimpleBarChart
            data={rows.map((r) => ({ label: r.name, value: Number(r.revenue_jod) }))}
            valueSuffix=" JOD"
            angledLabels
            height={340}
          />
        ) : (
          <EmptyState>No campaigns in range.</EmptyState>
        )}
      </Panel>

      <Panel title="Campaign detail">
        {isError ? (
          <EmptyState>Not loaded — see the error above.</EmptyState>
        ) : isLoading ? (
          <EmptyState>Loading…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>No campaigns in range.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Sent on</Th>
                <Th align="right">Sent</Th>
                <Th align="right">Opened</Th>
                <Th align="right">Open rate</Th>
                <Th align="right">Clicked</Th>
                <Th align="right">Click rate</Th>
                <Th align="right">Orders</Th>
                <Th align="right">Revenue JOD</Th>
                <Th align="right">Unsub. rate</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{r.name}</Td>
                  <Td>{format(parseISO(r.sent_on), "d MMM yyyy")}</Td>
                  <Td align="right">{num(r.sent)}</Td>
                  <Td align="right">{num(r.opened)}</Td>
                  <Td align="right">{pct(Number(r.open_rate) * 100)}</Td>
                  <Td align="right">{num(r.clicked)}</Td>
                  <Td align="right">{pct(Number(r.click_rate) * 100)}</Td>
                  <Td align="right">{num(r.orders)}</Td>
                  <Td align="right">{jod(Number(r.revenue_jod))}</Td>
                  {/* null means NOT YET FETCHED, and must not render as 0% —
                      a zero here would claim a campaign cost no subscribers. */}
                  <Td align="right">
                    {r.unsubscribe_rate === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={
                          Number(r.unsubscribe_rate) >= UNSUBSCRIBE_WATCH_RATE
                            ? "text-destructive"
                            : ""
                        }
                      >
                        {pct(Number(r.unsubscribe_rate) * 100)}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
              <TotalsRow>
                <Td>Total</Td>
                <Td>—</Td>
                <Td align="right">{num(t.sent)}</Td>
                <Td align="right">{num(t.opened)}</Td>
                <Td align="right">{pct(rate(t.opened, t.delivered))}</Td>
                <Td align="right">{num(t.clicked)}</Td>
                <Td align="right">{pct(rate(t.clicked, t.delivered))}</Td>
                <Td align="right">{num(t.orders)}</Td>
                <Td align="right">{jod(t.revenue)}</Td>
              </TotalsRow>
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
