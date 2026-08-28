import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import { useDateRange } from "@/context/date-range-context";
import { fetchSyncLog, summarise, fetchBackfillProgress, type SourceHealth } from "@/lib/health";
import { PageHeader, Panel, EmptyState } from "@/components/fyxx/primitives";
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
  stale: "Stale",
  failing: "FAILING",
  paused: "Paused — daily quota",
  never: "Never run",
};

function StateBadge({ state }: { state: SourceHealth["state"] }) {
  const cls =
    state === "ok" ? "text-foreground"
    : state === "stale" || state === "paused" ? "text-muted-foreground"
    : "text-destructive font-medium";
  return <span className={cls}>{STATE_LABEL[state]}</span>;
}

function HealthPage() {
  const { refreshKey } = useDateRange();

  const { data, isLoading } = useQuery({
    queryKey: ["health", refreshKey],
    queryFn: async () => {
      const rows = await fetchSyncLog();
      const [flows, reach] = await Promise.all([
        fetchBackfillProgress("klaviyo_flows", BACKFILL_FROM),
        fetchBackfillProgress("klaviyo_reach", BACKFILL_FROM),
      ]);
      return { health: summarise(rows), rows, flows, reach };
    },
    refetchInterval: 60_000,
  });

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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sync health"
        subtitle="Four things run unattended. This is whether they are working."
      />

      {problems.length ? (
        <p className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs">
          {problems.length} source{problems.length === 1 ? "" : "s"} needing attention:{" "}
          {problems.map((p) => p.label).join(", ")}
        </p>
      ) : (
        <p className="border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
          All sources ran successfully and recently.
        </p>
      )}

      {paused.length ? (
        <p className="border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
          {paused.map((p) => p.label).join(", ")} stopped on Klaviyo&apos;s daily quota. That is
          expected during a backfill — work already done is saved and the next nightly run continues.
          Nothing to fix.
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
                <Td><StateBadge state={h.state} /></Td>
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
              <Th>When</Th><Th>Source</Th><Th>Status</Th><Th>Range</Th>
              <Th align="right">Rows</Th><Th>Message</Th>
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
                <Td>{r.range_start ? `${r.range_start}${r.range_end && r.range_end !== r.range_start ? ` … ${r.range_end}` : ""}` : "—"}</Td>
                <Td align="right">{num(r.rows_written)}</Td>
                <Td><span className="text-xs text-muted-foreground">{r.message?.slice(0, 60) ?? "—"}</span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
