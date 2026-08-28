import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDateRange } from "@/context/date-range-context";
import { fetchSnapshots } from "@/lib/queries";
import { previousRange } from "@/lib/ranges";
import { deltaPct, jod, num, pct, pointsToJod } from "@/lib/format";
import { PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { TierLineChart } from "@/components/charts/TierLineChart";

export const Route = createFileRoute("/_authenticated/loyalty")({
  head: () => ({
    meta: [
      { title: "Loyalty — Fyxx Marketing" },
      { name: "description", content: "LoyaltyLion tier membership, redemption and points outstanding." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Loyalty — Fyxx Marketing" },
      {
        property: "og:description",
        content: "LoyaltyLion tier membership, redemption and points outstanding.",
      },
    ],
  }),
  component: LoyaltyPage,
});

/**
 * Missing data said plainly. A zero here would read as "the programme has no
 * members", which is a different and much worse claim than "we did not measure
 * this on these days".
 */
function NoData({ what }: { what: string }) {
  return (
    <div>
      <p className="display-num text-3xl text-muted-foreground">—</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {what} is only recorded from 27 Aug 2026, when nightly snapshots began. LoyaltyLion cannot
        report it historically, so earlier days have no value rather than a value of zero.
      </p>
    </div>
  );
}

function LoyaltyPage() {
  const { range, refreshKey } = useDateRange();
  const prev = previousRange(range);

  const { data, isLoading } = useQuery({
    queryKey: ["loyalty", range.from, range.to, refreshKey],
    queryFn: async () => {
      const [current, previous] = await Promise.all([fetchSnapshots(range), fetchSnapshots(prev)]);
      return { current, previous };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loyalty" />
        <EmptyState>Loading…</EmptyState>
      </div>
    );
  }

  // Tier counts, redemptions and birthday rewards exist only for days we
  // scanned LoyaltyLion. The imported year of points history carries none of
  // them, and showing 0 would read as "no members" rather than "not measured".
  const scanned = data.current.filter((r) => r.blue_members > 0);
  const hasScanData = scanned.length > 0;
  // For tier counts use the latest SCANNED day, not the latest day of any
  // kind — otherwise an imported points-only day (all tiers 0) wins and the
  // page reports an empty loyalty programme.
  const last = scanned.at(-1) ?? data.current.at(-1);
  const prevLast = data.previous.filter((r) => r.blue_members > 0).at(-1) ?? data.previous.at(-1);

  if (!last) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loyalty" />
        <EmptyState>No loyalty snapshots in range.</EmptyState>
      </div>
    );
  }

  const tiers = hasScanData ? [
    { label: "Blue", value: last.blue_members, prev: prevLast?.blue_members ?? 0 },
    { label: "Silver", value: last.silver_members, prev: prevLast?.silver_members ?? 0 },
    { label: "Gold", value: last.gold_members, prev: prevLast?.gold_members ?? 0 },
    { label: "Platinum", value: last.platinum_members, prev: prevLast?.platinum_members ?? 0 },
  ] : [];

  const birthdayRewards = data.current.reduce((a, s) => a + s.birthday_rewards_issued, 0);

  const chart = data.current.map((s) => ({
    date: s.snapshot_date,
    Blue: s.blue_members,
    Silver: s.silver_members,
    Gold: s.gold_members,
    Platinum: s.platinum_members,
  }));

  return (
    <div className="space-y-8">
      <PageHeader title="Loyalty" subtitle="Latest daily snapshot in the selected range." />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {hasScanData ? (
          tiers.map((t) => (
            <StatTile
              key={t.label}
              label={`${t.label} tier`}
              value={num(t.value)}
              delta={deltaPct(t.value, t.prev)}
            />
          ))
        ) : (
          <div className="col-span-full">
            <NoData what="Tier membership" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Panel title="Redemption rate">
          {/* Computed from one nightly sync window, not the selected range —
              so it is only meaningful on days we actually scanned. */}
          {hasScanData ? (
            <>
              <p className="display-num text-3xl">{pct(Number(last.redemption_rate))}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Redeeming members as a share of all members, measured on {last.snapshot_date}.
              </p>
            </>
          ) : (
            <NoData what="Redemption rate" />
          )}
        </Panel>
        <Panel title="Points outstanding">
          <p className="display-num text-3xl">{num(Number(last.points_outstanding))}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {jod(pointsToJod(Number(last.points_outstanding)))} at 100 points = 1 JOD.{" "}
            {last.points_source === "ll_export"
              ? "LoyaltyLion's own end-of-day figure."
              : "Summed from customer balances; LoyaltyLion's own close may differ by ~2%."}
          </p>
        </Panel>
        <Panel title="Birthday rewards issued">
          {hasScanData ? (
            <>
              <p className="display-num text-3xl">{num(birthdayRewards)}</p>
              <p className="mt-2 text-xs text-muted-foreground">Total across the selected range</p>
            </>
          ) : (
            <NoData what="Birthday rewards" />
          )}
        </Panel>
      </div>

      <Panel title="Members per tier over time">
        <TierLineChart data={chart} />
      </Panel>
    </div>
  );
}
