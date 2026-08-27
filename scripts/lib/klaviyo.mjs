import { need } from "./env.mjs";
import { Limiter, httpJson, withRetry, log, money3, int, rate4 } from "./log.mjs";

const BASE = "https://a.klaviyo.com/api";
const REVISION = "2026-07-15";
const TZ_OFFSET = "+03:00"; // Asia/Amman. Jordan dropped DST in 2022, so this is fixed.

/**
 * Klaviyo's values-report endpoints allow 2 requests/minute steady. 31s of
 * spacing keeps us just inside that. Everything else is far more generous.
 */
const reportLimiter = new Limiter(31_000, "Klaviyo values reports");
const generalLimiter = new Limiter(400, "Klaviyo general");

const headers = () => ({
  Authorization: `Klaviyo-API-Key ${need("KLAVIYO_API_KEY", "Klaviyo → Settings → Account → API keys → Create Private API Key")}`,
  revision: REVISION,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
});

const get = (path, label) =>
  generalLimiter.run(() => withRetry(label, () => httpJson(`${BASE}${path}`, { headers: headers() }, label)));

const postReport = (path, body, label) =>
  reportLimiter.run(() =>
    withRetry(label, () =>
      httpJson(`${BASE}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) }, label),
    ),
  );

/* ------------------------------------------------------------------------
 * Channel vocabularies. Klaviyo uses TWO DIFFERENT NAMES for push depending
 * on which endpoint you are talking to, and mixing them up produces a 400
 * that names the wrong culprit. Confirmed against the current docs:
 *
 *   /api/campaigns          messages.channel   email | sms | mobile_push
 *   values reports          send_channel       email | sms | push-notification | whatsapp
 *
 * These constants exist so the difference is stated once, in the open, rather
 * than being an easily-copied literal in three places.
 * --------------------------------------------------------------------- */

/** Values accepted by the campaigns LIST endpoint's messages.channel filter. */
export const LIST_CHANNEL = { email: "email", push: "mobile_push" };

/** Values returned/accepted by the VALUES REPORT endpoints' send_channel. */
export const REPORT_CHANNEL = { email: "email", push: "push-notification" };

/**
 * Both spellings mean push. Groupings come from the report endpoints and
 * metadata from the list endpoint, so anything routing on channel has to
 * accept either without caring which endpoint it came from.
 */
const PUSH_ALIASES = new Set([LIST_CHANNEL.push, REPORT_CHANNEL.push]);
export const isPush = (channel) => PUSH_ALIASES.has(channel);

/** Day boundaries in Amman time, so a "day" means what it means in the shop. */
const dayStart = (d) => `${d}T00:00:00${TZ_OFFSET}`;
const dayEnd = (d) => `${d}T23:59:59${TZ_OFFSET}`;

/** ------------------------------------------------------------------------
 * The Placed Order metric. Every conversion figure in this file is measured
 * against it, per your instruction.
 * --------------------------------------------------------------------- */
export async function findPlacedOrderMetricId() {
  let url = `/metrics?filter=${encodeURIComponent('equals(integration.name,"Shopify")')}`;
  let res;
  try {
    res = await get(url, "metrics (Shopify)");
  } catch {
    log.warn("integration filter rejected, falling back to a full metric scan");
    res = await get("/metrics", "metrics (all)");
  }
  let match = (res.data ?? []).find((m) => m.attributes?.name === "Placed Order");
  if (!match) {
    const all = await get("/metrics", "metrics (all)");
    match = (all.data ?? []).find((m) => m.attributes?.name === "Placed Order");
  }
  if (!match) {
    throw new Error(
      'No metric named "Placed Order" found. Check the Klaviyo key has metrics:read and that the Shopify integration is connected.',
    );
  }
  log.ok(`Placed Order metric resolved (id ${match.id})`);
  return match.id;
}

/** ------------------------------------------------------------------------
 * Campaign names and send dates. The values report returns ids only —
 * campaign_name is not an available grouping — so we look names up here and
 * store them EXACTLY as the API returns them, never reformatted.
 * --------------------------------------------------------------------- */
export async function fetchCampaignMeta(from, to) {
  const meta = new Map();
  for (const channel of [LIST_CHANNEL.email, LIST_CHANNEL.push]) {
    // Campaigns must be filtered by channel; the endpoint requires it.
    // A 45-day lookback catches campaigns scheduled well before they sent.
    const since = new Date(new Date(`${from}T00:00:00Z`).getTime() - 45 * 864e5)
      .toISOString()
      .slice(0, 19) + "Z";
    const filter = `and(equals(messages.channel,"${channel}"),greater-or-equal(created_at,${since}))`;
    let path = `/campaigns?filter=${encodeURIComponent(filter)}&sort=-created_at`;
    let pages = 0;
    while (path && pages < 25) {
      const res = await get(path, `campaigns (${channel})`);
      for (const c of res.data ?? []) {
        const sendTime = c.attributes?.send_time ?? c.attributes?.scheduled_at ?? null;
        meta.set(c.id, {
          name: c.attributes?.name ?? "(unnamed campaign)", // verbatim from the API
          sentOn: sendTime ? sendTime.slice(0, 10) : null,
          channel,
        });
      }
      const next = res.links?.next;
      path = next ? next.replace(BASE, "") : null;
      pages++;
    }
  }
  log.ok(`campaign metadata: ${meta.size} campaigns known`);
  return meta;
}

const STATS = [
  "recipients", "delivered", "opens_unique", "open_rate",
  "clicks_unique", "click_rate", "conversions", "conversion_rate", "conversion_value",
];

/** ------------------------------------------------------------------------
 * CAMPAIGN VALUES — send-date basis.
 * One call covers the whole range, because each campaign has a single send
 * date. Grouping by send_channel returns email and push as separate rows, so
 * push is never silently folded into the email numbers.
 * --------------------------------------------------------------------- */
export async function fetchCampaignValues({ from, to, conversionMetricId }) {
  const body = {
    data: {
      type: "campaign-values-report",
      attributes: {
        statistics: STATS,
        timeframe: { start: dayStart(from), end: dayEnd(to) },
        conversion_metric_id: conversionMetricId,
        group_by: ["campaign_id", "campaign_message_id", "send_channel"],
      },
    },
  };
  const res = await postReport("/campaign-values-reports", body, "campaign values report");
  return (res.data?.attributes?.results ?? []).map((r) => ({
    campaignId: r.groupings?.campaign_id,
    messageId: r.groupings?.campaign_message_id,
    channel: r.groupings?.send_channel,
    s: r.statistics ?? {},
  }));
}

/** ------------------------------------------------------------------------
 * FLOW VALUES — send-date basis, one call per day.
 * Flows send continuously, so a single call across a range cannot be split
 * back into days. One call per day is the only way to get a figure that can
 * be sliced by an arbitrary date range in the dashboard. At 2 calls/minute
 * this is the slow part of any backfill.
 * --------------------------------------------------------------------- */
export async function fetchFlowValuesForDay({ day, conversionMetricId }) {
  const body = {
    data: {
      type: "flow-values-report",
      attributes: {
        statistics: STATS,
        timeframe: { start: dayStart(day), end: dayEnd(day) },
        conversion_metric_id: conversionMetricId,
        group_by: ["flow_id", "flow_message_id", "flow_name", "send_channel"],
      },
    },
  };
  const res = await postReport("/flow-values-reports", body, `flow values report ${day}`);
  return (res.data?.attributes?.results ?? []).map((r) => ({
    flowId: r.groupings?.flow_id,
    messageId: r.groupings?.flow_message_id,
    flowName: r.groupings?.flow_name ?? "(unnamed flow)", // verbatim
    channel: r.groupings?.send_channel,
    s: r.statistics ?? {},
  }));
}

/** ------------------------------------------------------------------------
 * ATTRIBUTED REVENUE — event-date basis. A different question, deliberately.
 *
 * The reports above answer "how did this send perform", dated by SEND date.
 * This answers "how much of the day's revenue did Klaviyo drive", dated by
 * ORDER date, so it lines up with Shopify's daily totals. Mixing the two in
 * one figure is the thing we agreed never to do.
 * --------------------------------------------------------------------- */
export async function fetchAttributedRevenueByDay({ from, to, conversionMetricId }) {
  const endExclusive = new Date(`${to}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const body = {
    data: {
      type: "metric-aggregate",
      attributes: {
        metric_id: conversionMetricId,
        measurements: ["sum_value", "count"],
        interval: "day",
        timezone: "Asia/Amman",
        by: ["$attributed_channel"],
        filter: [
          `greater-or-equal(datetime,${from}T00:00:00)`,
          `less-than(datetime,${endExclusive.toISOString().slice(0, 10)}T00:00:00)`,
        ],
      },
    },
  };
  const res = await generalLimiter.run(() =>
    withRetry("metric aggregates", () =>
      httpJson(`${BASE}/metric-aggregates`, { method: "POST", headers: headers(), body: JSON.stringify(body) }, "metric aggregates"),
    ),
  );
  const dates = (res.data?.attributes?.dates ?? []).map((d) => d.slice(0, 10));
  const byDay = new Map(dates.map((d) => [d, 0]));
  for (const row of res.data?.attributes?.data ?? []) {
    // An empty dimension means the order was not attributed to any Klaviyo
    // message. Those are real sales but not Klaviyo's, so they are excluded.
    const channel = (row.dimensions ?? [])[0];
    if (!channel || channel === "" || channel === "$none") continue;
    const values = row.measurements?.sum_value ?? [];
    dates.forEach((d, i) => byDay.set(d, (byDay.get(d) ?? 0) + Number(values[i] ?? 0)));
  }
  return byDay;
}

/** ------------------------------------------------------------------------
 * Shaping report rows into table rows.
 * --------------------------------------------------------------------- */
export function toCampaignRows(results, meta) {
  const email = [];
  const push = [];
  for (const r of results) {
    if (!r.campaignId) continue;
    const m = meta.get(r.campaignId);
    const sentOn = m?.sentOn;
    if (!sentOn) continue; // never sent, or outside the window
    const s = r.s;
    if (isPush(r.channel)) {
      push.push({
        source_name: m.name,
        source_type: "Campaign",
        source_id: r.campaignId,
        message_id: r.messageId,
        sent_on: sentOn,
        sent: int(s.recipients),
        delivered: int(s.delivered),
        opened: int(s.opens_unique),
        open_rate: rate4(s.open_rate),
        conversions: int(s.conversions),
        revenue_jod: money3(s.conversion_value),
        // No clicks column by design: push click tracking is broken account-wide.
      });
    } else {
      email.push({
        campaign_id: r.campaignId,
        campaign_message_id: r.messageId,
        send_channel: r.channel ?? "email",
        name: m.name,
        sent_on: sentOn,
        sent: int(s.recipients),
        delivered: int(s.delivered),
        opened: int(s.opens_unique),
        open_rate: rate4(s.open_rate),
        clicked: int(s.clicks_unique),
        click_rate: rate4(s.click_rate),
        orders: int(s.conversions),
        conversion_rate: rate4(s.conversion_rate),
        revenue_jod: money3(s.conversion_value),
      });
    }
  }
  return { email, push };
}

export function toFlowRows(results, day) {
  const flows = [];
  const push = [];
  for (const r of results) {
    if (!r.flowId) continue;
    const s = r.s;
    // Over 50 flows exist and most are utility flows that never send. Storing
    // a zero row for each of them every day would bloat the table and put
    // permanent 0% rows in the report. Only flows that actually sent land here.
    if (int(s.recipients) === 0) continue;
    if (isPush(r.channel)) {
      push.push({
        source_name: r.flowName,
        source_type: "Flow",
        source_id: r.flowId,
        message_id: r.messageId,
        sent_on: day,
        sent: int(s.recipients),
        delivered: int(s.delivered),
        opened: int(s.opens_unique),
        open_rate: rate4(s.open_rate),
        conversions: int(s.conversions),
        revenue_jod: money3(s.conversion_value),
      });
    } else {
      flows.push({
        flow_id: r.flowId,
        flow_message_id: r.messageId,
        send_channel: r.channel ?? "email",
        flow_name: r.flowName,
        date: day,
        recipients: int(s.recipients),
        delivered: int(s.delivered),
        opened: int(s.opens_unique),
        open_rate: rate4(s.open_rate),
        clicked: int(s.clicks_unique),
        click_rate: rate4(s.click_rate),
        conversions: int(s.conversions),
        conversion_rate: rate4(s.conversion_rate),
        revenue_jod: money3(s.conversion_value),
      });
    }
  }
  return { flows, push };
}
