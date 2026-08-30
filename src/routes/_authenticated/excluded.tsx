import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { QueryFailed, PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { Table, Th, Td } from "@/components/fyxx/data-table";
import { useDateRange } from "@/context/date-range-context";
import { buildExclusionView, MISTAGGED_EXEMPTIONS, POSSIBLE_MISTAGS } from "@/lib/excluded";
import { jod, num, pct } from "@/lib/format";
import { ammanToday } from "@/lib/ranges";

export const Route = createFileRoute("/_authenticated/excluded")({
  head: () => ({
    meta: [
      { title: "What is excluded — Fyxx Marketing" },
      { name: "description", content: "Internal accounts left out of every revenue figure." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ExcludedPage,
});

function ExcludedPage() {
  const { range, refreshKey } = useDateRange();
  const today = ammanToday();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["excluded", range.from, range.to, refreshKey],
    queryFn: () => buildExclusionView(range),
  });

  // "Historic" means nothing in the last 180 days. B2B and venue orders moved
  // to Odoo and stopped syncing to Shopify in February 2026, so most of this
  // list is closed history rather than an ongoing deduction.
  const cutoff = useMemo(() => {
    const d = new Date(Date.parse(today));
    d.setUTCDate(d.getUTCDate() - 180);
    return d.toISOString().slice(0, 10);
  }, [today]);

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="What is excluded" />
        <QueryFailed error={error} />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="What is excluded" />
        <EmptyState>Loading…</EmptyState>
      </div>
    );
  }

  const live = data.rows.filter((r) => r.lastOrder && r.lastOrder >= cutoff);

  return (
    <div className="space-y-8">
      <PageHeader
        title="What is excluded"
        subtitle="Internal accounts left out of every revenue figure on this dashboard. This page answers “what isn’t in that number”."
      />

      <section>
        <p className="label-xs mb-3 text-muted-foreground">
          Selected range — excluded against included
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Excluded in this range"
            value={jod(data.range.excluded)}
            note={`${num(data.range.excludedOrders)} orders from internal accounts`}
          />
          <StatTile
            label="Included — what the dashboard shows"
            value={jod(data.range.included)}
            note={`${num(data.range.includedOrders)} orders`}
          />
          <StatTile
            label="Excluded share"
            value={data.range.pct === null ? "—" : pct(data.range.pct)}
            note={`of ${jod(data.range.total)} gross for this range`}
          />
        </div>
      </section>

      {/* The all-time gap is the thing most likely to be forgotten, so it is
          stated as a standing figure rather than left to be recomputed. */}
      <Panel title="All time, both ways">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div>
            <p className="label-xs text-muted-foreground">Gross, as Shopify counts it</p>
            <p className="display-num text-2xl">{jod(9_832_449 + data.lifetime.excluded)}</p>
          </div>
          <div>
            <p className="label-xs text-muted-foreground">Excluded</p>
            <p className="display-num text-2xl">{jod(data.lifetime.excluded)}</p>
          </div>
          <div>
            <p className="label-xs text-muted-foreground">What the dashboard shows</p>
            <p className="display-num text-2xl">{jod(9_832_449)}</p>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-xs text-muted-foreground">
          Every revenue figure on this dashboard is roughly 6% below Shopify&rsquo;s own total, and
          that difference is this list. If a figure here is ever compared against Shopify admin,
          this is the gap to expect — it is not an error.
        </p>
      </Panel>

      <Panel title="By category">
        <Table>
          <thead>
            <tr>
              <Th>Category</Th>
              <Th align="right">Accounts</Th>
              <Th align="right">In this range</Th>
              <Th align="right">Lifetime</Th>
              <Th align="right">Last order</Th>
            </tr>
          </thead>
          <tbody>
            {data.byCategory.map((c) => (
              <tr key={c.category}>
                <Td>{c.category}</Td>
                <Td align="right">{num(c.accounts)}</Td>
                <Td align="right">{c.rangeRevenue > 0 ? jod(c.rangeRevenue) : "—"}</Td>
                <Td align="right">{jod(c.lifetimeRevenue)}</Td>
                <Td align="right">
                  {c.lastOrder ?? "—"}
                  {c.lastOrder && c.lastOrder < cutoff ? (
                    <span className="ml-2 text-xs text-muted-foreground">historic</span>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <div className="border-l-2 border-foreground bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
        <b>Most of this is closed history, not an ongoing deduction.</b> B2B and venue orders moved
        to Odoo and no longer sync to Shopify, which is why the table and terrace accounts stop in
        February 2026. {live.length ? (
          <>
            Only <b>{num(live.length)}</b> of {num(data.rows.length)} accounts have ordered in the
            last 180 days, and those are named staff.
          </>
        ) : (
          <>No excluded account has ordered in the last 180 days.</>
        )}{" "}
        A series that stops in February is that migration, not a broken sync.
      </div>

      <Panel title="Not excluded, despite the tag">
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          These carry <code>CUSTOMER_INTERNAL</code> but are third-party delivery — real sales to
          real customers, and counted as ordinary revenue. The tag is a mistake being fixed in
          Shopify; once it is, they will drop out of this note on their own.
        </p>
        <ul className="text-sm">
          {MISTAGGED_EXEMPTIONS.map((m) => (
            <li key={m.id} className="text-muted-foreground">
              <span className="text-foreground">{m.name}</span> — {m.id}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Worth a second look">
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          Every account that is clearly staff carries <code>CUSTOMER TYPE_Employee</code> or{" "}
          <code>INTERNAL_EMPLOYEE</code>. <code>CUSTOMER_INTERNAL</code> on its own is otherwise
          used for venue tables, write-offs and events — never for a person. These two are the only
          exceptions. They remain <b>excluded</b>; this is a flag, not a change.
        </p>
        <Table>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th>Id</Th>
              <Th align="right">Lifetime revenue</Th>
              <Th align="right">Last order</Th>
            </tr>
          </thead>
          <tbody>
            {POSSIBLE_MISTAGS.map((m) => (
              <tr key={m.id}>
                <Td>{m.name}</Td>
                <Td>{m.id}</Td>
                <Td align="right">{jod(m.revenue)}</Td>
                <Td align="right">{m.lastOrder}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel title={`Every excluded account (${num(data.rows.length)})`}>
        <Table>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th>Category</Th>
              <Th>Tagged</Th>
              <Th align="right">Orders</Th>
              <Th align="right">Lifetime revenue</Th>
              <Th align="right">In this range</Th>
              <Th align="right">Last order</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const historic = !r.lastOrder || r.lastOrder < cutoff;
              return (
                <tr key={r.shopify_customer_id}>
                  <Td>{r.name}</Td>
                  <Td>{r.category}</Td>
                  <Td>
                    <span className="text-xs text-muted-foreground">{r.classified_by}</span>
                  </Td>
                  <Td align="right">{num(r.lifetimeOrders)}</Td>
                  <Td align="right">{jod(r.lifetimeRevenue)}</Td>
                  <Td align="right">{r.rangeRevenue > 0 ? jod(r.rangeRevenue) : "—"}</Td>
                  <Td align="right">
                    {r.lastOrder ?? "never ordered"}
                    {historic && r.lastOrder ? (
                      <span className="ml-2 text-xs text-muted-foreground">historic</span>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
