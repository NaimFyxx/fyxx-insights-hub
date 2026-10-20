import { supabase } from "@/integrations/supabase/client";
import {
  fetchCampaigns,
  fetchFlows,
  fetchPush,
  fetchDailySales,
  fetchAttributed,
  fetchSnapshots,
  fetchActivations,
  fetchFlowMonthly,
  type Campaign,
  type FlowRow,
  type PushRow,
  type Activation,
} from "@/lib/queries";
import { POS_DEFINITION_CHANGED } from "@/lib/channels";
import { settledOnly, rangeIncludesToday, type DateRange } from "@/lib/ranges";
import { fetchCoverage, coverageGap } from "@/lib/coverage";
import {
  pushByTypeForMonth,
  rollUpCampaigns,
  rollUpFlows,
  rollUpFlowsMonthly,
  rollUpPushByType,
  wholeMonthOf,
} from "@/lib/rollups";

// Re-exported so report.ts stays the one import the report page needs.
export {
  pushByTypeForMonth,
  rollUpCampaigns,
  rollUpFlows,
  rollUpFlowsMonthly,
  rollUpPushByType,
  wholeMonthOf,
} from "@/lib/rollups";
export type { CampaignAgg, FlowAgg, PushAgg } from "@/lib/rollups";

/**
 * A section that cannot be rendered honestly is marked unavailable with the
 * reason, and the report prints the reason instead of the figures.
 *
 * The rule, from the audit: a blank section with an explanation is fine; a
 * zero that looks like a real measurement is not. Zeid sees no filters, cannot
 * click anything, and has no way to tell an unmeasured zero from a real one.
 */
export type Availability = { available: true } | { available: false; reason: string };

const ok: Availability = { available: true };

/**
 * Attributed revenue was withheld from the report while our figure and
 * Klaviyo's disagreed by roughly a factor of two. That is resolved: Klaviyo
 * never retracts a Placed Order event when an order is cancelled, so the old
 * metric-aggregate kept counting cancelled orders at full value. Attribution
 * is now stored per order and netted against current cancellations at read
 * time, and the daily figure is bounded by that day's total sales.
 *
 * August 2026 moved from 37,615 JOD to 28,260, and 5 August from an impossible
 * 8,530 against 5,220 of sales to 1,618.
 *
 * Kept as a switch rather than deleted: if the bound is ever breached again,
 * flipping this back withholds the figure instead of publishing a wrong one.
 */
export const ATTRIBUTION_UNRECONCILED = false;
const no = (reason: string): Availability => ({ available: false, reason });

/** Every day in the range, for coverage checks. */
function daysIn(r: DateRange): string[] {
  const out: string[] = [];
  const end = new Date(`${r.to}T12:00:00Z`);
  for (let d = new Date(`${r.from}T12:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export type ReachSection = {
  availability: Availability;
  emailCampaigns: number;
  push: number;
  flows: number;
  totalUnique: number;
  totalSends: number;
  daysCovered: number;
  daysInRange: number;
};

/**
 * Unique reach. The cross-channel total is a genuine distinct count, so it is
 * SMALLER than the three channel figures added together, because anyone
 * reached on both email and push is one person, counted once. That is said
 * report says so rather than leaving it to look like an error.
 */
async function buildReach(r: DateRange): Promise<ReachSection> {
  const days = daysIn(r);

  // klaviyo_reach_daily holds per-person records and is service-role only, so
  // the frontend must never read it. Coverage comes from sync_log, and the
  // counts come from the SECURITY DEFINER function, which returns integers and
  // never the underlying sets.
  const { data: logged } = await supabase
    .from("sync_log")
    .select("range_start")
    .eq("source", "klaviyo_reach")
    .eq("status", "success")
    .gte("range_start", r.from)
    .lte("range_start", r.to)
    .range(0, 999);
  const daysCovered = new Set((logged ?? []).map((x) => x.range_start as string)).size;

  const { data, error } = await supabase.rpc("klaviyo_reach_counts", {
    p_from: r.from,
    p_to: r.to,
  });
  const row = Array.isArray(data) ? data[0] : data;

  const empty = { emailCampaigns: 0, push: 0, flows: 0, totalUnique: 0, totalSends: 0 };
  if (error || !row) {
    return {
      availability: no("Unique reach could not be read."),
      ...empty,
      daysCovered,
      daysInRange: days.length,
    };
  }
  if (daysCovered === 0) {
    return {
      availability: no(
        `Unique reach has not been collected for this period. The backfill runs nightly and has not yet reached ${r.from}.`,
      ),
      ...empty,
      daysCovered,
      daysInRange: days.length,
    };
  }
  if (daysCovered < days.length) {
    return {
      availability: no(
        `Unique reach covers only ${daysCovered} of ${days.length} days in this period, so a total would understate it. The backfill is still running.`,
      ),
      emailCampaigns: row.email_campaigns ?? 0,
      push: row.push_all ?? 0,
      flows: row.flows_all ?? 0,
      totalUnique: row.total_unique ?? 0,
      totalSends: row.total_sends ?? 0,
      daysCovered,
      daysInRange: days.length,
    };
  }
  return {
    availability: ok,
    emailCampaigns: row.email_campaigns ?? 0,
    push: row.push_all ?? 0,
    flows: row.flows_all ?? 0,
    totalUnique: row.total_unique ?? 0,
    totalSends: row.total_sends ?? 0,
    daysCovered,
    daysInRange: days.length,
  };
}

export type Narrative = {
  id: string | null;
  monthHighlight: string;
  nextMonthBullets: string[];
};

/** The written parts of the report. Stored per range in `reports`. */
export async function fetchNarrative(r: DateRange): Promise<Narrative> {
  const { data } = await supabase
    .from("reports")
    .select("id, month_highlight, next_month_bullets")
    .eq("start_date", r.from)
    .eq("end_date", r.to)
    .maybeSingle();
  return {
    id: data?.id ?? null,
    monthHighlight: data?.month_highlight ?? "",
    nextMonthBullets: data?.next_month_bullets ?? [],
  };
}

export async function saveNarrative(r: DateRange, n: Omit<Narrative, "id">) {
  const { error } = await supabase.from("reports").upsert(
    {
      start_date: r.from,
      end_date: r.to,
      month_highlight: n.monthHighlight,
      next_month_bullets: n.nextMonthBullets,
    },
    { onConflict: "start_date,end_date" },
  );
  if (error) throw error;
}

export type ReportData = {
  range: DateRange;
  narrative: Narrative;
  reach: ReachSection;
  campaigns: {
    availability: Availability;
    rows: Campaign[];
    /** The printed table: top 6 by revenue, one rolled-up row, then a total. */
    rollup: ReturnType<typeof rollUpCampaigns<Campaign>>;
    /** Sends below MIN_CAMPAIGN_RECIPIENTS, excluded from rows but named. */
    excludedTests: Campaign[];
  };
  flows: { availability: Availability; rollup: ReturnType<typeof rollUpFlows> };
  push: { availability: Availability; rollup: ReturnType<typeof rollUpPushByType> };
  loyalty: {
    availability: Availability;
    latest: Awaited<ReturnType<typeof fetchSnapshots>>[number] | null;
    prior: Awaited<ReturnType<typeof fetchSnapshots>>[number] | null;
    birthdayRewards: number;
    birthdayAvailability: Availability;
    pointsRow: Awaited<ReturnType<typeof fetchSnapshots>>[number] | null;
    pointsAvailability: Availability;
  };
  activations: Activation[];
  revenue: {
    availability: Availability;
    klaviyoAttributed: number;
    allChannels: number;
    /** Mobile App + Website only. The denominator for the share tile. */
    onlineChannels: number;
    sharePct: number | null;
    /** True when the range runs into the day still in progress. */
    shareIsPartial: boolean;
  };
  /**
   * Messages sent, summed from the SAME rows the three tables below total.
   *
   * The reach strip used to show unique people per channel beside tables
   * counting messages, and the two could not be made to agree because they
   * were never the same quantity: 6,252 people against 39,198 push messages
   * reads as a contradiction on a page with no way to ask.
   *
   * So the tile now shows both, and the message figure is computed here from
   * the table rows rather than from the reach table, which makes it agree with
   * the tables by construction rather than by coincidence.
   */
  sends: { campaigns: number; flows: number; push: number; total: number };
  notices: string[];
};

/**
 * A send below this is a test, not a campaign.
 *
 * "Careem & Talabat 50% OFF Final" went to 3 recipients and sat among eight
 * real campaigns showing 100% open and 33% click. Rates from a handful of
 * recipients are noise with the authority of a percentage, and next to genuine
 * campaigns they read as the best-performing send of the month.
 *
 * Excluded sends are COUNTED and named rather than silently dropped, because a
 * campaign vanishing without explanation is its own kind of wrong.
 */
export const MIN_CAMPAIGN_RECIPIENTS = 50;

export function splitTestSends(rows: Campaign[]) {
  return {
    real: rows.filter((c) => c.sent >= MIN_CAMPAIGN_RECIPIENTS),
    tests: rows.filter((c) => c.sent < MIN_CAMPAIGN_RECIPIENTS),
  };
}

export async function buildReport(range: DateRange): Promise<ReportData> {
  const [
    coverage,
    reach,
    campaigns,
    flows,
    push,
    sales,
    attributed,
    snaps,
    activations,
    narrative,
  ] = await Promise.all([
    fetchCoverage(),
    buildReach(range),
    fetchCampaigns(range),
    fetchFlows(range),
    fetchPush(range),
    fetchDailySales(range),
    fetchAttributed(range),
    fetchSnapshots(range),
    fetchActivations(),
    fetchNarrative(range),
  ]);

  // Flow OPENS come from the whole-month report, not from the daily rows.
  // Klaviyo's opens_unique counts unique people inside the window asked for,
  // so it cannot be summed across days: September 2026 review-request-judgeme
  // reads 1,298 from the daily rows against Klaviyo's 761 for the month.
  // Everything else agrees exactly, delivered included.
  const flowMonthly = await fetchFlowMonthly(range.from);

  const days = daysIn(range);

  // Flow reports are backfilled a day at a time; an incomplete range would
  // understate every flow figure without looking wrong.
  const flowDays = new Set(flows.map((f) => f.date));
  const flowsAvailability: Availability =
    flowMonthly.length === 0
      ? no(
          "Flow figures for this month have not been collected yet. They come from a single monthly report, which runs nightly.",
        )
      : flowDays.size === 0
      ? no(
          `Flow data has not been collected for this period. The backfill runs nightly and has not yet reached ${range.from}.`,
        )
      : flowDays.size < days.length
        ? no(
            `Flow data covers only ${flowDays.size} of ${days.length} days, so these figures would understate the period. The backfill is still running.`,
          )
        : ok;

  // Tier counts exist only for days LoyaltyLion was scanned.
  const scanned = snaps.filter((s) => s.blue_members > 0);
  const latest = scanned.at(-1) ?? null;

  // Compare against the last measurement BEFORE this period, so the delta means
  // "since the previous month" rather than "since a snapshot two days ago".
  const { data: priorRows } = await supabase
    .from("ll_snapshots")
    .select("*")
    .lt("snapshot_date", range.from)
    .gt("blue_members", 0)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  const priorOutside = priorRows?.[0] ?? null;
  const loyaltyAvailability: Availability = latest
    ? ok
    : no(
        "Tier membership was not measured in this period. Nightly snapshots began on 27 August 2026 and LoyaltyLion cannot report tiers historically.",
      );

  // Points outstanding is recorded on every snapshot, including the imported
  // LoyaltyLion export days, so it has much better coverage than tier counts
  // and carries its own date rather than borrowing the tier snapshot's.
  const pointsRow = snaps.filter((s) => Number(s.points_outstanding) > 0).at(-1) ?? null;
  const pointsAvailability: Availability = pointsRow
    ? ok
    : no("Points outstanding was not recorded for this period.");

  // Birthday rewards ARE collected now. The old zero came from counting only
  // `approved` activities while LoyaltyLion issues them `pending`. Measured
  // over the full history, 1,753 of 1,831 do approve, so pending is transient.
  // A day still showing zero is a day the sync had not yet been fixed, which is
  // a real absence rather than a real zero.
  const birthdayMeasured = snaps.some((s) => s.birthday_rewards_issued > 0);
  const birthdayAvailability: Availability = birthdayMeasured
    ? ok
    : no(
        "Birthday rewards were not collected for this period. Collection was fixed on 29 August 2026; earlier snapshots hold no figure.",
      );

  const klaviyoAttributed = attributed.reduce((a, x) => a + Number(x.revenue_jod), 0);
  const allChannels = sales.reduce((a, x) => a + Number(x.total_online_revenue_jod), 0);
  const onlineChannels = sales
    .filter((x) => (ONLINE_SUB_CHANNELS as readonly string[]).includes(x.sub_channel))
    .reduce((a, x) => a + Number(x.total_online_revenue_jod), 0);

  // The SHARE divides two sources synced hours apart, so the day still in
  // progress is excluded from both sides of it. The absolute figures above
  // keep the whole range. A month-end export is unaffected; only an export run
  // mid-month, which is exactly when someone is checking a figure early.
  const klaviyoSettled = settledOnly(attributed).reduce((a, x) => a + Number(x.revenue_jod), 0);
  // The share is now against ONLINE sales only, per Zeid's approved template.
  // Draft orders and POS are roughly 60 per cent of turnover and Klaviyo
  // cannot influence a sale rung up at the till, so including them understated
  // the figure: September 2026 reads 10.1 per cent against all sales and
  // 24.5 per cent against online.
  const onlineSettled = settledOnly(sales)
    .filter((x) => (ONLINE_SUB_CHANNELS as readonly string[]).includes(x.sub_channel))
    .reduce((a, x) => a + Number(x.total_online_revenue_jod), 0);
  const shareIsPartial = rangeIncludesToday(range);

  // Summed from the same rows the tables total, so the strip above cannot
  // disagree with the tables below. Flow "sends" are recipients, which is what
  // Klaviyo reports for a flow message and what the flows table shows.
  // Taken from the SAME rows each table totals, so the strip cannot disagree
  // with the tables. Flows and flow push read the monthly figures because the
  // tables below do; campaign push stays on its own correct per-send rows.
  const campaignSends = splitTestSends(campaigns).real.reduce((a, c) => a + c.sent, 0);
  const flowSends = flowMonthly
    .filter((f) => f.send_channel === "email")
    .reduce((a, f) => a + f.recipients, 0);
  const pushSends =
    push.filter((p) => p.source_type === "Campaign").reduce((a, p) => a + p.sent, 0) +
    flowMonthly.filter((f) => f.send_channel === "push").reduce((a, f) => a + f.recipients, 0);

  const notices: string[] = [];
  if (range.from < POS_DEFINITION_CHANGED && range.to >= POS_DEFINITION_CHANGED) {
    notices.push(
      "This period spans 27 February 2026, when POS changed meaning: before that date it covers every retail order, after it covers only orders with an identified customer. POS figures either side are not comparable.",
    );
  }

  return {
    range,
    narrative,
    reach,
    campaigns: {
      availability:
        (coverageGap(coverage, "klaviyo_campaigns", range, "Campaign reporting") ??
        (splitTestSends(campaigns).real.length ? null : "No campaigns were sent in this period."))
          ? no(
              coverageGap(coverage, "klaviyo_campaigns", range, "Campaign reporting") ??
                "No campaigns were sent in this period.",
            )
          : ok,
      rows: splitTestSends(campaigns).real,
      rollup: rollUpCampaigns(splitTestSends(campaigns).real),
      excludedTests: splitTestSends(campaigns).tests,
    },
    flows: { availability: flowsAvailability, rollup: rollUpFlowsMonthly(flowMonthly) },
    push: {
      availability: push.length ? ok : no("No push notifications were sent in this period."),
      rollup: pushByTypeForMonth(push, flowMonthly),
    },
    loyalty: {
      availability: loyaltyAvailability,
      latest,
      prior: priorOutside ?? (scanned.length > 1 ? (scanned[0] ?? null) : null),
      birthdayRewards: snaps.reduce((a, s) => a + s.birthday_rewards_issued, 0),
      birthdayAvailability,
      pointsRow,
      pointsAvailability,
    },
    activations: activations.filter((a) => a.date >= range.from && a.date <= range.to),
    revenue: {
      // Coverage first. A range that predates Klaviyo attribution would
      // otherwise render 0.0% as though Klaviyo drove nothing, when in fact
      // Klaviyo was not the sending platform then. Derived from data_coverage,
      // so it stays correct as sources are backfilled.
      availability:
        coverageGap(coverage, "klaviyo_attributed_orders", range, "Klaviyo attribution") !== null
          ? no(coverageGap(coverage, "klaviyo_attributed_orders", range, "Klaviyo attribution")!)
          : ATTRIBUTION_UNRECONCILED
            ? no(
                "Revenue attributed to Klaviyo is withheld this month. Our own figure and Klaviyo's disagree by roughly a factor of two, and the cause is still being traced. It will be reported once the two agree.",
              )
            : ok,
      klaviyoAttributed,
      allChannels,
      onlineChannels,
      sharePct: onlineSettled > 0 ? (klaviyoSettled / onlineSettled) * 100 : null,
      shareIsPartial,
    },
    sends: {
      campaigns: campaignSends,
      flows: flowSends,
      push: pushSends,
      total: campaignSends + flowSends + pushSends,
    },
    notices,
  };
}

/**
 * Jordanian VAT is 16 per cent and Zeid reads money with it taken out.
 *
 * STORED DATA IS NEVER CHANGED. Shopify reports gross, the database keeps
 * gross, and every figure on the dashboard stays gross. Only the monthly
 * report divides, and only at the point of display, so the two can always be
 * reconciled against each other and against Shopify admin.
 *
 * The report footer states the divisor, because a money figure that silently
 * differs from the same figure on the Overview is the kind of discrepancy that
 * costs an afternoon.
 */
export const VAT_RATE = 0.16;
export const VAT_DIVISOR = 1 + VAT_RATE;
export const exVat = (gross: number) => gross / VAT_DIVISOR;
export const VAT_FOOTER_NOTE = "All figures ex VAT (\u00f7 1.16).";

/**
 * Online revenue: Mobile App plus Website only.
 *
 * Zeid's approved template asks for "Share of online revenue", not share of
 * all sales. Dividing Klaviyo attributed revenue by EVERY channel understates
 * it badly, because draft orders and POS are roughly 60 per cent of turnover
 * and Klaviyo cannot influence a sale rung up at the till. September 2026:
 * 10.1 per cent against all sales, 24.5 per cent against online.
 */
export const ONLINE_SUB_CHANNELS = ["Mobile App", "Website"] as const;
