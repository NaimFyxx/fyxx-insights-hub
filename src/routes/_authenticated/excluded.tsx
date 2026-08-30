import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { QueryFailed, PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { Table, Th, Td } from "@/components/fyxx/data-table";
import { useDateRange } from "@/context/date-range-context";
import { buildExclusionView, MISTAGGED_EXEMPTIONS, INTERNAL_IN_MARKETING } from "@/lib/excluded";
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
            <p className="display-num text-2xl">
              {jod(data.allTime.included + data.allTime.excluded)}
            </p>
          </div>
          <div>
            <p className="label-xs text-muted-foreground">Excluded</p>
            <p className="display-num text-2xl">{jod(data.allTime.excluded)}</p>
          </div>
          <div>
            <p className="label-xs text-muted-foreground">What the dashboard shows</p>
            <p className="display-num text-2xl">{jod(data.allTime.included)}</p>
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
              <span className="text-foreground">{m.name}</span> — {m.id} — {m.why}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Internal accounts sitting in marketing lists">
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          Excluding these accounts from revenue does not remove them from Klaviyo or
          LoyaltyLion. Measured on {INTERNAL_IN_MARKETING.measuredOn}, the inflation is real
          but small — no figure moves by more than about one part in six hundred, so nothing
          here is adjusted for. Cleaning them at source fixes it permanently.
        </p>
        <div className="mb-4 grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Email subscribers that are internal"
            value={num(INTERNAL_IN_MARKETING.emailSubscribed)}
            note={`of ${num(INTERNAL_IN_MARKETING.emailSubscribedOutOf)} — ${pct(
              (INTERNAL_IN_MARKETING.emailSubscribed / INTERNAL_IN_MARKETING.emailSubscribedOutOf) * 100,
            )}. No SMS subscribers are internal.`}
          />
          <StatTile
            label="Loyalty members that are internal"
            value={num(INTERNAL_IN_MARKETING.loyaltyEnrolled)}
            note={`of ${num(INTERNAL_IN_MARKETING.loyaltyEnrolledOutOf)} — ${pct(
              (INTERNAL_IN_MARKETING.loyaltyEnrolled / INTERNAL_IN_MARKETING.loyaltyEnrolledOutOf) * 100,
            )}`}
          />
          <StatTile
            label="Points held by internal accounts"
            value={num(INTERNAL_IN_MARKETING.points)}
            note={`of ${num(INTERNAL_IN_MARKETING.pointsOutOf)} outstanding — ${pct(
              (INTERNAL_IN_MARKETING.points / INTERNAL_IN_MARKETING.pointsOutOf) * 100,
            )} of the liability`}
          />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th>Id</Th>
              <Th>Klaviyo email</Th>
              <Th>Tier</Th>
              <Th align="right">Points</Th>
            </tr>
          </thead>
          <tbody>
            {INTERNAL_IN_MARKETING.accounts.map((a) => (
              <tr key={a.id}>
                <Td>{a.name}</Td>
                <Td>{a.id}</Td>
                <Td>
                  {a.email === "SUBSCRIBED" ? (
                    <b>SUBSCRIBED</b>
                  ) : (
                    <span className="text-muted-foreground">{a.email ?? "no email"}</span>
                  )}
                </Td>
                <Td>{a.tier ?? "—"}</Td>
                <Td align="right">{num(a.points)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
          Four of these are <b>venue tables</b> — Communal Table, Table 3, Table 8 and Terrace 1
          are enrolled in a loyalty programme. They hold no points, so nothing is distorted, but
          it shows enrolment is not gated against non-people.{" "}
          <b>Yousef Mazahreh alone holds 4,096 points</b>, a third of the internal total, and is
          the same staff account at the centre of the worst identity conflict.
        </p>
      </Panel>

      <Panel title="How the two ambiguous accounts were resolved">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Two person-named accounts carried <code>CUSTOMER_INTERNAL</code> without an employee
          tag, which is the pattern used for venue tables and write-offs rather than for people.
          Both were flagged rather than decided. Naim confirmed on 30 August 2026 that{" "}
          <b>Hashim El akabi (11,614 JOD) is a real customer</b> — now exempt and counted as
          ordinary revenue — and that <b>Ahmad Ayman (11,636 JOD) is not</b>, so he remains
          excluded. The tag pattern flagged the right pair; it could not tell them apart.
        </p>
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
