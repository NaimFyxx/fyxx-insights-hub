import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import { useDateRange } from "@/context/date-range-context";
import {
  fetchSyncLog,
  summarise,
  fetchBackfillProgress,
  fetchSeedResidue,
  fetchSnapshotGaps,
  type SourceHealth,
} from "@/lib/health";
import { QueryFailed, PageHeader, Panel, EmptyState } from "@/components/fyxx/primitives";
import { Table, Th, Td } from "@/components/fyxx/data-table";
import { num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/health")({
  head: () => ({
    meta: [
      { title: "Sync health — Fyxx Marketing" },
      { name: "description", content: "What is synced, what is outstanding, what is broken." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HealthPage,
});

const BACKFILL_FROM = "2025-01-01";

const STATE_LABEL: Record<SourceHealth["state"], string> = {
  ok: "OK",
  stale: "Stale — job",
  // Distinct from "stale" on purpose. The job is succeeding; the DATA is old.
  // The two need different fixes, and collapsing them is what let reach report
  // healthy while its figures were a week behind.
  behind: "Behind — data",
  failing: "FAILING",
  paused: "Paused — daily quota",
  never: "Never run",
};

function StateBadge({ state }: { state: SourceHealth["state"] }) {
  const cls =
    state === "ok"
      ? "text-foreground"
      : state === "stale" || state === "behind" || state === "paused"
        ? "text-muted-foreground"
        : "text-destructive font-medium";
  return <span className={cls}>{STATE_LABEL[state]}</span>;
}

function HealthPage() {
  const { refreshKey } = useDateRange();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["health", refreshKey],
    queryFn: async () => {
      const rows = await fetchSyncLog();
      const [flows, reach, seed, snapshots] = await Promise.all([
        fetchBackfillProgress("klaviyo_flows", BACKFILL_FROM),
        fetchBackfillProgress("klaviyo_reach", BACKFILL_FROM),
        fetchSeedResidue(),
        fetchSnapshotGaps(),
      ]);
      return { health: summarise(rows), rows, flows, reach, seed, snapshots };
    },
    refetchInterval: 60_000,
  });

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sync health" />
        <QueryFailed error={error} />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sync health" />
        <EmptyState>Loading…</EmptyState>
      </div>
    );
  }

  // "paused" is expected behaviour during a backfill, not something to chase.
  const problems = data.health.filter((h) => h.state !== "ok" && h.state !== "paused");
  const paused = data.health.filter((h) => h.state === "paused");
  const gaps = data.snapshots.gaps;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sync health"
        subtitle="Four things run unattended. This is whether they are working."
      />

      {/* ABOVE everything else, and never auto-dismissed. Every other failure
          on this page delays data; this one destroyed it. LoyaltyLion has no
          history endpoint for tier counts, so a night not recorded is gone —
          no backfill exists, which is why there is no "retry" here. */}
      {gaps.length > 0 ? (
        <section className="border-2 border-destructive bg-destructive/5 px-5 py-4">
          <p className="label-xs text-destructive">
            Permanently missing loyalty snapshot{gaps.length === 1 ? "" : "s"}
          </p>
          <p className="mt-2 text-2xl">
            <span className="display-num">{num(gaps.length)}</span>{" "}
            <span className="text-sm text-muted-foreground">
              night{gaps.length === 1 ? "" : "s"} never recorded
            </span>
          </p>
          <ul className="mt-3 text-sm">
            {gaps.map((g) => (
              <li key={g.date} className="text-foreground">
                {g.date}
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
            Tier counts and points outstanding are only knowable on the day they are read —
            LoyaltyLion answers &ldquo;what is true now&rdquo; and keeps no history. These nights
            <b> cannot be backfilled</b> and this notice will not clear. Treat those dates as
            absent rather than zero; any comparison spanning them is comparing across a hole.
          </p>
        </section>
      ) : (
        <section className="border border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            <span className="text-foreground">No missing loyalty snapshots.</span>{" "}
            {data.snapshots.scanned} night{data.snapshots.scanned === 1 ? "" : "s"} recorded
            without a gap, {data.snapshots.firstScan} to {data.snapshots.lastScan}. This is the
            only figure in the system that cannot be re-fetched after the fact, so it is checked
            explicitly rather than inferred from whether the sync passed.
          </p>
        </section>
      )}

      {problems.length ? (
        <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs">
          <p className="font-semibold">
            {problems.length} source{problems.length === 1 ? "" : "s"} needing attention
          </p>
          <ul className="mt-2 space-y-1">
            {problems.map((p) => (
              <li key={p.key}>
                <span className="text-foreground">{p.label}</span>
                {p.why ? <span className="text-muted-foreground"> — {p.why}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
          All sources ran recently <b>and their data reaches today</b>. Both are checked: a job
          can succeed every night while its data stays weeks behind, which is not health.
        </p>
      )}

      {/* Placeholder data reads as real, so this is louder than a stale source.
          The reports probe matters most: that row is invented NARRATIVE text,
          and the report route renders it as the operator's own prose. */}
      {data.seed.length ? (
        <div className="border border-destructive bg-destructive/10 px-4 py-3 text-xs">
          <p className="font-semibold">
            Placeholder seed data is present in {data.seed.length} table
            {data.seed.length === 1 ? "" : "s"}.
          </p>
          <p className="mt-1">{data.seed.map((s) => `${s.label} (${num(s.rows)})`).join(", ")}</p>
          <p className="mt-1 text-muted-foreground">
            Lovable&apos;s seed migration has re-applied. These rows are invented and will be read
            as real. Remove them before trusting any figure, and re-check that the seed block in
            supabase/migrations/20260827105917 is still commented out.
          </p>
        </div>
      ) : null}

      {paused.length ? (
        <p className="border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
          {paused.map((p) => p.label).join(", ")} stopped on Klaviyo&apos;s daily quota. That is
          expected during a backfill — work already done is saved and the next nightly run
          continues. Nothing to fix.
        </p>
      ) : null}

      <Panel title="Sources">
        <Table>
          <thead>
            <tr>
              <Th>Source</Th>
              <Th>State</Th>
              <Th>Data through</Th>
              <Th>Last success</Th>
              <Th align="right">Rows</Th>
              <Th>Last message</Th>
            </tr>
          </thead>
          <tbody>
            {data.health.map((h) => (
              <tr key={h.key}>
                <Td>{h.label}</Td>
                <Td>
                  <StateBadge state={h.state} />
                </Td>
                {/* "Data through" is the furthest date covered, which is not
                    the same as when the job last ran — a job can run nightly
                    and still be months behind on a backfill. */}
                <Td>{h.coveredThrough ? format(parseISO(h.coveredThrough), "d MMM yyyy") : "—"}</Td>
                <Td>
                  {h.lastSuccess
                    ? `${formatDistanceToNow(parseISO(h.lastSuccess.synced_at))} ago`
                    : "never"}
                </Td>
                <Td align="right">{h.lastSuccess ? num(h.lastSuccess.rows_written) : "—"}</Td>
                <Td>
                  <span className="text-xs text-muted-foreground">
                    {h.lastRun?.message?.slice(0, 70) ?? "—"}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel title="Backfill progress">
        {[
          { label: "Klaviyo flows", p: data.flows },
          { label: "Unique reach", p: data.reach },
        ].map(({ label, p }) => (
          <div key={label} className="mb-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm">{label}</span>
              <span className="text-xs text-muted-foreground">
                {num(p.done)} of {num(p.total)} days · {num(p.outstanding)} outstanding
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full bg-secondary">
              <div
                className="h-1.5 bg-foreground"
                style={{ width: `${Math.min(100, (100 * p.done) / Math.max(1, p.total))}%` }}
              />
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Both continue automatically each night while the BACKFILL_FROM repository variable is set.
          Nothing to trigger by hand.
        </p>
      </Panel>

      <Panel title="Recent runs">
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th>Range</Th>
              <Th align="right">Rows</Th>
              <Th>Message</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.slice(0, 25).map((r, i) => (
              <tr key={`${r.source}-${r.synced_at}-${i}`}>
                <Td>{format(parseISO(r.synced_at), "d MMM HH:mm")}</Td>
                <Td>{r.source}</Td>
                <Td>
                  <span className={r.status === "success" ? "" : "text-destructive font-medium"}>
                    {r.status}
                  </span>
                </Td>
                <Td>
                  {r.range_start
                    ? `${r.range_start}${r.range_end && r.range_end !== r.range_start ? ` … ${r.range_end}` : ""}`
                    : "—"}
                </Td>
                <Td align="right">{num(r.rows_written)}</Td>
                <Td>
                  <span className="text-xs text-muted-foreground">
                    {r.message?.slice(0, 60) ?? "—"}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
