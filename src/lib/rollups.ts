/**
 * Pure aggregation for the monthly report: no network, no Supabase client, no
 * React. Split out of report.ts for one reason, which is that a plain node
 * test can then import it the way timeseries.ts is imported.
 *
 * Anything added here must stay dependency-free. The moment this file imports
 * the Supabase client, scripts/test/report-rollups.test.mjs can no longer load
 * it, and these checks go quiet instead of failing.
 */
import type { FlowRow, PushRow } from "@/lib/queries";

export type FlowAgg = {
  name: string;
  recipients: number;
  delivered: number;
  opened: number;
  conversions: number;
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
      revenue: 0,
    };
    cur.recipients += r.recipients;
    cur.delivered += r.delivered;
    cur.opened += r.opened;
    cur.conversions += r.conversions;
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
        revenue: a.revenue + f.revenue,
      }),
      { name, recipients: 0, delivered: 0, opened: 0, conversions: 0, revenue: 0 },
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
