import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDateRange } from "@/context/date-range-context";
import { fetchSnapshots } from "@/lib/queries";
import { previousRange } from "@/lib/ranges";
import { deltaPct, jod, num, pct, pointsToJod } from "@/lib/format";
import { QueryFailed, PageHeader, Panel, StatTile, EmptyState } from "@/components/fyxx/primitives";
import { TierLineChart } from "@/components/charts/TierLineChart";
import { tierSeriesWithGaps } from "@/lib/timeseries";

export const Route = createFileRoute("/_authenticated/loyalty")({
  head: () => ({
    meta: [
      { title: "Loyalty — Fyxx Marketing" },
      {
        name: "description",
        content: "LoyaltyLion tier membership, redemption and points outstanding.",
      },
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
        {what}: no data before 27 Aug 2026 — snapshots started then and LoyaltyLion can&apos;t
        backfill it. Not zero, unmeasured.
      </p>
    </div>
  );
}

function LoyaltyPage() {
  const { range, refreshKey } = useDateRange();
  const prev = previousRange(range);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["loyalty", range.from, range.to, refreshKey],
    queryFn: async () => {
      const [current, previous] = await Promise.all([fetchSnapshots(range), fetchSnapshots(prev)]);
      return { current, previous };
    },
  });

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loyalty" />
        <QueryFailed error={error} />
      </div>
    );
  }

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

  // `?? 0` here would treat "no earlier measurement" as "zero members last
  // period", turning every tier delta into a fabricated +100%-style jump.
  // null means no comparison, which is what the tile renders.
  const hadPrevScan = prevLast != null && prevLast.blue_members > 0;
  const tiers = hasScanData
    ? [
        {
          label: "Blue",
          value: last.blue_members,
          prev: hadPrevScan ? prevLast!.blue_members : null,
        },
        {
          label: "Silver",
          value: last.silver_members,
          prev: hadPrevScan ? prevLast!.silver_members : null,
        },
        {
          label: "Gold",
          value: last.gold_members,
          prev: hadPrevScan ? prevLast!.gold_members : null,
        },
        {
          label: "Platinum",
          value: last.platinum_members,
          prev: hadPrevScan ? prevLast!.platinum_members : null,
        },
      ]
    : [];

  const birthdayRewards = data.current.reduce((a, s) => a + s.birthday_rewards_issued, 0);
  const birthdayMeasured = data.current.some((x) => x.birthday_rewards_issued > 0);

  // Liability trend across the selected range. Only snapshots that actually
  // carry a balance count — a zero row is an unmeasured day, not a day the
  // programme owed nothing.
  const withPoints = data.current.filter((x) => Number(x.points_outstanding) > 0);
  const firstWithPoints = withPoints[0];
  const lastWithPoints = withPoints[withPoints.length - 1];
  const liabilityFrom =
    withPoints.length > 1 && firstWithPoints
      ? pointsToJod(Number(firstWithPoints.points_outstanding))
      : null;
  const liabilityNow = lastWithPoints ? pointsToJod(Number(lastWithPoints.points_outstanding)) : 0;
  const liabilityDelta = liabilityFrom === null ? 0 : liabilityNow - liabilityFrom;
  const liabilityPct = liabilityFrom ? (liabilityDelta / liabilityFrom) * 100 : null;

  // Only days we actually scanned. Plotting the points-only imported days
  // draws their zero tier counts as real values — a year-long flat line at
  // zero followed by a vertical spike, which reads as explosive growth rather
  // than as the day measurement began.
  //
  // MISSING NIGHTS BECOME NULLS, NOT ABSENT ROWS. A date that is simply left
  // out of the array is not "no data" to a line chart — the line joins the two
  // neighbours and draws straight through it, asserting a measurement that was
  // never taken. LoyaltyLion keeps no history, so a missed night can never be
  // filled; the line must break there and stay broken. Emitting an explicit
  // null for every unscanned day in the span is what makes that happen.
  const chart = tierSeriesWithGaps(scanned);
  const chartGaps = chart.filter((p) => p.Blue === null).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Loyalty"
        subtitle="Points from LoyaltyLion\u2019s own accounting; tiers and redemptions from nightly scans."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {hasScanData ? (
          tiers.map((t) => (
            <StatTile
              key={t.label}
              label={`${t.label} tier`}
              value={num(t.value)}
              delta={t.prev === null ? undefined : deltaPct(t.value, t.prev)}
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
        <Panel title="Points liability">
          {/* The JOD figure leads, because that is what the balance IS: money
              owed. The points count is the unit it is denominated in. The
              growth matters more than the level — it has roughly tracked from
              53,000 to 88,000 JOD across the imported year. */}
          <p className="display-num text-3xl">
            {jod(pointsToJod(Number(last.points_outstanding)))}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {num(Number(last.points_outstanding))} points at 100 points = 1 JOD
          </p>
          {liabilityFrom !== null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {liabilityDelta >= 0 ? "Up" : "Down"} {jod(Math.abs(liabilityDelta))} from{" "}
              {jod(liabilityFrom)} at the start of this range
              {liabilityPct !== null
                ? ` (${liabilityPct >= 0 ? "+" : ""}${liabilityPct.toFixed(1)}%)`
                : ""}
              .
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            {last.points_source === "ll_export"
              ? "LoyaltyLion's own end-of-day figure."
              : "Summed from customer balances. Reconciled against LoyaltyLion's own export on 29 Aug 2026 to +0.00% — 8,620,578 against their 8,620,816. Both count approved points only; pending is a separate 1.59%."}
          </p>
        </Panel>
        <Panel title="Birthday rewards issued">
          {/* Gated on whether the field was ever populated, NOT on whether tier
              scan data exists. birthday_rewards_issued is zero on every snapshot
              because the nightly sync does not collect it, so keying off
              hasScanData rendered a hard 0 labelled as a range total. */}
          {birthdayMeasured ? (
            <>
              <p className="display-num text-3xl">{num(birthdayRewards)}</p>
              <p className="mt-2 text-xs text-muted-foreground">Total across the selected range</p>
            </>
          ) : (
            <>
              <p className="display-num text-3xl text-muted-foreground">—</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Not collected. The nightly sync does not pull birthday rewards, so this is
                unmeasured rather than zero.
              </p>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Members per tier over time">
        {chart.length > 1 ? (
          <>
            <TierLineChart data={chart} />
            <p className="mt-2 text-xs text-muted-foreground">
              {chart.length - chartGaps} measured day
              {chart.length - chartGaps === 1 ? "" : "s"}
              {chartGaps > 0 ? (
                <>
                  {" "}
                  and <b>{chartGaps} night{chartGaps === 1 ? "" : "s"} never recorded</b>, drawn as
                  a break rather than a line — LoyaltyLion keeps no history, so those days cannot
                  be filled in
                </>
              ) : null}
              . Tier snapshots began 27
              Aug 2026; LoyaltyLion cannot report tiers historically.
            </p>
          </>
        ) : (
          <EmptyState>
            Not enough measured days to draw a trend — tier snapshots began 27 Aug 2026 and there
            {chart.length === 1 ? " is 1 day" : " are none"} in this range.
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}
