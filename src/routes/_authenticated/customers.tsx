import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { Table, Th, Td } from "@/components/fyxx/data-table";
import { Input } from "@/components/ui/input";
import { fetchCustomers, summarise, cohorts } from "@/lib/customers";
import { ammanToday } from "@/lib/ranges";
import { jod, num, pct } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Fyxx Marketing" },
      { name: "description", content: "Customer population, retention and reachability." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CustomersPage,
});

function CustomersPage() {
  const [windowDays, setWindowDays] = useState(90);
  const today = ammanToday();

  const q = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const s = useMemo(
    () => (q.data ? summarise(q.data, today, windowDays) : null),
    [q.data, today, windowDays],
  );
  const co = useMemo(() => (q.data ? cohorts(q.data, today, 90) : []), [q.data, today]);

  if (q.isLoading || !s) {
    return (
      <div className="space-y-6">
        <PageHeader title="Customers" />
        <EmptyState>Loading…</EmptyState>
      </div>
    );
  }

  // The stabilisation is the CURRENT state; the decline is history. Both are
  // shown, because a trend line alone reads as "still falling".
  const withRate = co.filter((c) => c.repeatPct !== null);
  const recent = withRate.slice(-3);
  const flat =
    recent.length === 3 &&
    Math.max(...recent.map((c) => c.repeatPct!)) - Math.min(...recent.map((c) => c.repeatPct!)) < 3;
  const peak = withRate.reduce((a, c) => (c.repeatPct! > a.repeatPct! ? c : a), withRate[0]!);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Customers"
        subtitle={`${num(s.totalCustomers)} customers, ${num(s.buyers)} of whom have ordered. ${num(s.houseExcluded.count)} house and staff accounts excluded, holding ${num(s.houseExcluded.orders)} lifetime orders.`}
      />

      {/* The three that matter, before any chart. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <StatTile
          label="Bought once, never returned"
          value={pct(s.oneAndDone.pct)}
          note={`${num(s.oneAndDone.count)} of ${num(s.oneAndDone.of)} buyers whose first order was over 90 days ago`}
        />
        <StatTile
          label="Revenue from the top 1%"
          value={pct(s.concentration.top1)}
          note={`median customer ${jod(s.concentration.median)}, mean ${jod(s.concentration.mean)}`}
        />
        <StatTile
          label="Revenue we cannot reach"
          value={pct(s.reach.unreachableRevenuePct)}
          note={`${num(s.reach.unreachable)} buyers on neither email nor SMS, ${jod(s.reach.unreachableRevenue)}`}
        />
      </div>

      <Panel title="Repeat rate by acquisition year">
        {/* Age-limited so cohorts are comparable. The raw "ever repeated"
            version runs 86.5% to 39.4% and reads as collapse; almost all of
            that is older cohorts simply having had more years. */}
        <div className="mb-4 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="label-xs text-muted-foreground">Then</p>
            <p className="display-num text-2xl">
              {peak?.repeatPct != null ? pct(peak.repeatPct) : "—"}{" "}
              <span className="text-sm text-muted-foreground">in {peak?.year}</span>
            </p>
          </div>
          <div>
            <p className="label-xs text-muted-foreground">Now</p>
            <p className="display-num text-2xl">
              {recent.at(-1)?.repeatPct != null ? pct(recent.at(-1)!.repeatPct!) : "—"}{" "}
              <span className="text-sm text-muted-foreground">
                {flat ? `flat across ${recent.map((c) => c.year).join(", ")}` : "latest cohort"}
              </span>
            </p>
          </div>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Acquired in</Th>
              <Th align="right">Customers</Th>
              <Th align="right">Had 90 days</Th>
              <Th align="right">Repeated within 90 days</Th>
            </tr>
          </thead>
          <tbody>
            {co.map((c) => (
              <tr key={c.year}>
                <Td>{c.year}</Td>
                <Td align="right">{num(c.acquired)}</Td>
                <Td align="right">{num(c.eligible)}</Td>
                <Td align="right">{c.repeatPct === null ? "—" : pct(c.repeatPct)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Only customers whose first order was at least 90 days ago are counted, so every year is
          measured over the same window. A cohort with fewer than 90 days of history shows a dash
          rather than a partial rate.
          {flat
            ? " The fall ran to " +
              peak?.year +
              " and has since stabilised: the last three cohorts sit within three points of each other."
            : ""}
        </p>
      </Panel>

      <Panel title="Where customers are in their life cycle">
        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-muted-foreground">Active means ordered within</span>
          <Input
            type="number"
            min={7}
            max={730}
            value={windowDays}
            onChange={(e) => setWindowDays(Math.max(7, Number(e.target.value) || 90))}
            className="w-28"
          />
        </label>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Active"
            value={num(s.lifecycle.active)}
            note={`ordered in the last ${windowDays} days`}
          />
          <StatTile
            label="Lapsing"
            value={num(s.lifecycle.lapsing)}
            note={`last ordered ${windowDays} to ${windowDays * 2} days ago`}
          />
          <StatTile
            label="Lapsed"
            value={num(s.lifecycle.lapsed)}
            note={`nothing for over ${windowDays * 2} days`}
          />
        </div>
      </Panel>

      <Panel title="How concentrated the revenue is">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <StatTile label="Top 1%" value={pct(s.concentration.top1)} />
          <StatTile label="Top 5%" value={pct(s.concentration.top5)} />
          <StatTile label="Top 10%" value={pct(s.concentration.top10)} />
          <StatTile label="All buyers" value={jod(s.concentration.totalRevenue)} />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          <StatTile label="Median customer" value={jod(s.concentration.median)} />
          <StatTile label="Top decile starts at" value={jod(s.concentration.p90)} />
          <StatTile label="Bottom decile ends at" value={jod(s.concentration.p10)} />
          <StatTile
            label="Mean"
            value={jod(s.concentration.mean)}
            note="shown for comparison only"
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The mean is {(s.concentration.mean / Math.max(1, s.concentration.median)).toFixed(1)}× the
          median, so it describes almost nobody. Read the median and the deciles; the mean is here
          only to show how far the top pulls it.
        </p>
      </Panel>

      <Panel title="The ceiling on everything marketing can do">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Buyers we cannot reach"
            value={num(s.reach.unreachable)}
            note={`${pct(s.reach.unreachablePct)} of buyers, ${jod(s.reach.unreachableRevenue)}`}
          />
          <StatTile
            label="Never opted in"
            value={num(s.reach.neverOptedIn)}
            note="have an email address, never asked"
          />
          <StatTile label="Opted out" value={num(s.reach.optedOut)} note="must not be contacted" />
        </div>
        <p className="mt-4 text-sm">
          <b>{num(s.reach.smsOnly)} buyers hold a phone number and are subscribed to nothing</b>,
          worth {jod(s.reach.smsOnlyRevenue)}. SMS is the only route that exists to them.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Never-opted-in and opted-out are counted separately on purpose. Only the first group can
          be asked; contacting the second would be contacting people who chose to leave.
        </p>
      </Panel>
    </div>
  );
}
