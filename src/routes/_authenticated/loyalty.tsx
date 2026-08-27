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

  const last = data.current.at(-1);
  const prevLast = data.previous.at(-1);

  if (!last) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loyalty" />
        <EmptyState>No loyalty snapshots in range.</EmptyState>
      </div>
    );
  }

  const tiers = [
    { label: "Blue", value: last.blue_members, prev: prevLast?.blue_members ?? 0 },
    { label: "Silver", value: last.silver_members, prev: prevLast?.silver_members ?? 0 },
    { label: "Gold", value: last.gold_members, prev: prevLast?.gold_members ?? 0 },
    { label: "Platinum", value: last.platinum_members, prev: prevLast?.platinum_members ?? 0 },
  ];

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
        {tiers.map((t) => (
          <StatTile
            key={t.label}
            label={`${t.label} tier`}
            value={num(t.value)}
            delta={deltaPct(t.value, t.prev)}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Panel title="Redemption rate">
          <p className="display-num text-3xl">{pct(Number(last.redemption_rate))}</p>
        </Panel>
        <Panel title="Points outstanding">
          <p className="display-num text-3xl">{num(Number(last.points_outstanding))}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {jod(pointsToJod(Number(last.points_outstanding)))} at 100 points = 1 JOD
          </p>
        </Panel>
        <Panel title="Birthday rewards issued">
          <p className="display-num text-3xl">{num(birthdayRewards)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Total across the selected range</p>
        </Panel>
      </div>

      <Panel title="Members per tier over time">
        <TierLineChart data={chart} />
      </Panel>
    </div>
  );
}
