/**
 * Pure aggregation for the monthly report: no network, no Supabase client, no
 * React. Split out of report.ts for one reason, which is that a plain node
 * test can then import it the way timeseries.ts is imported.
 *
 * Anything added here must stay dependency-free. The moment this file imports
 * the Supabase client, scripts/test/report-rollups.test.mjs can no longer load
 * it, and these checks go quiet instead of failing.
 */
import type { FlowMonthlyRow, FlowRow, PushRow } from "@/lib/queries";
import type { DateRange } from "@/lib/ranges";

export type FlowAgg = {
  name: string;
  recipients: number;
  delivered: number;
  opened: number;
  /** Conversion EVENTS, meaning orders. Not the Conv. rate numerator. */
  conversions: number;
  /**
   * Distinct customers who ordered, from Klaviyo's conversion_uniques.
   *
   * This is what Conv. rate divides by delivered, because it is the numerator
   * Klaviyo's own conversion_rate uses. Dividing `conversions` instead counts
   * a customer who ordered twice as two: review-request-judgeme, September
   * 2026, read 98 / 2,762 = 3.5 per cent against Klaviyo's 54 / 2,762 = 2.0.
   */
  uniqueBuyers: number;
  revenue: number;
};

/**
 * Top 8 flows by revenue, then ONE rolled-up row for every other flow with
 * sends in the period, then a total. Names exactly as Klaviyo returns them,
 * never reformatted, because a renamed flow must be recognisable.
 */
export function rollUpFlows(rows: FlowRow[]): {
  top: FlowAgg[];
  otherCount: number;
  other: FlowAgg | null;
  total: FlowAgg;
} {
  const byName = new Map<string, FlowAgg>();
  for (const r of rows) {
    const cur = byName.get(r.flow_name) ?? {
      name: r.flow_name,
      recipients: 0,
      delivered: 0,
      opened: 0,
      conversions: 0,
      uniqueBuyers: 0,
      revenue: 0,
    };
    cur.recipients += r.recipients;
    cur.delivered += r.delivered;
    cur.opened += r.opened;
    cur.conversions += r.conversions;
    // Summing buyers across a flow's messages slightly overcounts anyone who
    // bought from two of them. Klaviyo offers nothing finer: its flow values
    // report rejects a request grouped by flow_id alone with "Group by
    // flow_message_id is required", so this sum is the only flow-level figure
    // that exists.
    cur.uniqueBuyers += (r as { unique_buyers?: number }).unique_buyers ?? 0;
    cur.revenue += Number(r.revenue_jod);
    byName.set(r.flow_name, cur);
  }
  // Only flows that actually sent. Over 50 flows exist and most never send;
  // a zero row for each would fill the page with nothing.
  const live = [...byName.values()].filter((f) => f.recipients > 0);
  live.sort((a, b) => b.revenue - a.revenue);

  const top = live.slice(0, 8);
  const rest = live.slice(8);
  const fold = (name: string, xs: FlowAgg[]): FlowAgg =>
    xs.reduce(
      (a, f) => ({
        name,
        recipients: a.recipients + f.recipients,
        delivered: a.delivered + f.delivered,
        opened: a.opened + f.opened,
        conversions: a.conversions + f.conversions,
        uniqueBuyers: a.uniqueBuyers + f.uniqueBuyers,
        revenue: a.revenue + f.revenue,
      }),
      { name, recipients: 0, delivered: 0, opened: 0, conversions: 0, uniqueBuyers: 0, revenue: 0 },
    );

  return {
    top,
    otherCount: rest.length,
    other: rest.length ? fold(`All other flows with sends (${rest.length})`, rest) : null,
    total: fold("All flows", live),
  };
}

export type PushAgg = { name: string; sent: number; delivered: number; opened: number };

/**
 * Push grouped by TYPE rather than by individual message, per Zeid's approved
 * template: two rows, Campaigns and Flows, then a total.
 *
 * WHY BY TYPE
 * The per-message version ran to 34 rows in a half-width column, and the
 * detail was never the point. The question the template asks is how much push
 * went out as a deliberate campaign against how much fired automatically, and
 * two rows answer it.
 *
 * `source_type` comes from Klaviyo and is already either Campaign or Flow, so
 * nothing is being inferred here. Anything else Klaviyo may send is kept under
 * its own name rather than folded into one of the two, so an unexpected type
 * shows up instead of being quietly absorbed.
 *
 * September 2026: Campaigns 30,540 sent across 4 messages, Flows 8,658.
 */
const PUSH_TYPE_ORDER = ["Campaign", "Flow"];

export function rollUpPushByType(rows: PushRow[]): { types: PushAgg[]; total: PushAgg } {
  const byType = new Map<string, PushAgg>();
  for (const r of rows) {
    // Klaviyo's own wording, pluralised for a column heading that reads as one.
    const label =
      r.source_type === "Campaign"
        ? "Campaigns"
        : r.source_type === "Flow"
          ? "Flows"
          : r.source_type || "Unclassified";
    const cur = byType.get(label) ?? { name: label, sent: 0, delivered: 0, opened: 0 };
    cur.sent += r.sent;
    cur.delivered += r.delivered;
    cur.opened += r.opened;
    byType.set(label, cur);
  }
  const rank = (n: string) => {
    const i = PUSH_TYPE_ORDER.indexOf(n.replace(/s$/, ""));
    return i === -1 ? PUSH_TYPE_ORDER.length : i;
  };
  const types = [...byType.values()]
    .filter((t) => t.sent > 0)
    .sort((a, b) => rank(a.name) - rank(b.name) || b.sent - a.sent);
  const total = types.reduce(
    (a, t) => ({
      name: "Total",
      sent: a.sent + t.sent,
      delivered: a.delivered + t.delivered,
      opened: a.opened + t.opened,
    }),
    { name: "Total", sent: 0, delivered: 0, opened: 0 },
  );
  return { types, total };
}

export type CampaignAgg = {
  name: string;
  /** Null on the rolled-up and total rows, which span several dates. */
  sentOn: string | null;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  orders: number;
  revenue: number;
};

/**
 * Top 6 campaigns by revenue, then one rolled-up row, then a total.
 *
 * WHY THE TABLE IS CAPPED AT ALL
 * The report is meant to be one A4 page and the stylesheet lets height grow
 * rather than clip, so an uncapped table does not truncate, it pushes the
 * footer onto a second sheet. Campaign counts run from 2 to 11 a month
 * (December 2025 sent 11 with names up to 70 characters, most wrapping to two
 * lines), so an uncapped table decides the page count by accident.
 *
 * Capping bounds the page by construction instead. It is the same shape the
 * flows table already uses, the folded row is counted and labelled rather than
 * dropped, and the total still covers every campaign, so nothing disappears:
 * the detail for every send lives on the Campaigns page of the dashboard.
 *
 * Six rather than eight because campaign rows are nearly half again as tall as
 * flow rows once a long name wraps.
 */
export function rollUpCampaigns<
  T extends {
    name: string;
    sent_on: string;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    orders: number;
    revenue_jod: number;
  },
>(rows: T[], topN = 6): { top: CampaignAgg[]; other: CampaignAgg | null; total: CampaignAgg } {
  const as = (r: T): CampaignAgg => ({
    name: r.name,
    sentOn: r.sent_on,
    sent: r.sent,
    delivered: r.delivered,
    opened: r.opened,
    clicked: r.clicked,
    orders: r.orders,
    revenue: Number(r.revenue_jod),
  });
  // Revenue first, and sends as the tie-break so a month where nothing is
  // attributed still orders by something meaningful rather than by chance.
  const live = rows.map(as).sort((a, b) => b.revenue - a.revenue || b.sent - a.sent);
  const fold = (name: string, xs: CampaignAgg[]): CampaignAgg =>
    xs.reduce(
      (a, c) => ({
        name,
        sentOn: null,
        sent: a.sent + c.sent,
        delivered: a.delivered + c.delivered,
        opened: a.opened + c.opened,
        clicked: a.clicked + c.clicked,
        orders: a.orders + c.orders,
        revenue: a.revenue + c.revenue,
      }),
      { name, sentOn: null, sent: 0, delivered: 0, opened: 0, clicked: 0, orders: 0, revenue: 0 },
    );
  const rest = live.slice(topN);
  return {
    top: live.slice(0, topN),
    other: rest.length ? fold(`All other campaigns (${rest.length})`, rest) : null,
    total: fold("All campaigns", live),
  };
}

/**
 * The push table on the report: Campaigns, Flows, and a total.
 *
 * The two rows come from DIFFERENT sources on purpose, because only one of
 * them can be trusted per day.
 *
 *   Campaigns  klaviyo_push, written by a single call covering the whole
 *              range. A campaign has one send date, so its opens_unique is
 *              counted once and is correct. Checked against Klaviyo for all
 *              seven August 2026 campaigns: delivered and opens match exactly.
 *
 *   Flows      klaviyo_flow_monthly, because flow push is fetched one day at a
 *              time and opens_unique is not additive across days. September
 *              2026 flow push read 308 opens from the daily rows against
 *              Klaviyo's 274 for the month.
 *
 * Sends and deliveries ARE additive and agree between the two sources, so
 * either would do for those; opens decide which source each row uses.
 */
export function pushByTypeForMonth(
  campaignPush: PushRow[],
  flowMonthly: FlowMonthlyRow[],
): { types: PushAgg[]; total: PushAgg } {
  const campaigns = campaignPush
    .filter((p) => p.source_type === "Campaign")
    .reduce(
      (a, p) => ({
        name: "Campaigns",
        sent: a.sent + p.sent,
        delivered: a.delivered + p.delivered,
        opened: a.opened + p.opened,
      }),
      { name: "Campaigns", sent: 0, delivered: 0, opened: 0 },
    );
  const flows = flowMonthly
    .filter((f) => f.send_channel === "push")
    .reduce(
      (a, f) => ({
        name: "Flows",
        sent: a.sent + f.recipients,
        delivered: a.delivered + f.delivered,
        opened: a.opened + f.opened,
      }),
      { name: "Flows", sent: 0, delivered: 0, opened: 0 },
    );
  const types = [campaigns, flows].filter((t) => t.sent > 0);
  const total = types.reduce(
    (a, t) => ({
      name: "Total",
      sent: a.sent + t.sent,
      delivered: a.delivered + t.delivered,
      opened: a.opened + t.opened,
    }),
    { name: "Total", sent: 0, delivered: 0, opened: 0 },
  );
  return { types, total };
}

/**
 * The flows table on the report, built from whole-month figures.
 *
 * Takes the same shape as rollUpFlows and exists so the caller does not have
 * to reshape monthly rows into daily ones. Email only: push sent by a flow is
 * counted in the push table, and folding it in here would double count it.
 */
export function rollUpFlowsMonthly(rows: FlowMonthlyRow[]) {
  return rollUpFlows(
    rows
      .filter((r) => r.send_channel === "email")
      .map((r) => ({
        id: r.flow_message_id,
        flow_name: r.flow_name,
        date: r.month,
        recipients: r.recipients,
        delivered: r.delivered,
        opened: r.opened,
        clicked: r.clicked,
        conversions: r.conversions,
        unique_buyers: r.unique_buyers ?? 0,
        revenue_jod: r.revenue_jod,
        open_rate: 0,
        click_rate: 0,
        conversion_rate: 0,
      })),
  );
}

/**
 * The calendar month a range covers exactly, or null if it covers anything
 * else. Returns the first of that month, which is how klaviyo_flow_monthly is
 * keyed.
 *
 * Flow opens are only knowable for a window Klaviyo was asked about, and the
 * only such window we store is the calendar month. A page showing an arbitrary
 * range therefore cannot show a true open rate, and must say so rather than
 * print the sum of the daily figures, which overstates by up to about 70 per
 * cent and gets worse the longer the range.
 */
export function wholeMonthOf(r: DateRange): string | null {
  const start = new Date(`${r.from}T12:00:00Z`);
  if (start.getUTCDate() !== 1) return null;
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 12))
    .toISOString()
    .slice(0, 10);
  return r.to === lastDay ? r.from : null;
}

