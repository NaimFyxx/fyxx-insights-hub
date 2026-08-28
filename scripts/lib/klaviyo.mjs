import { createHash } from "node:crypto";
import { need } from "./env.mjs";
import { Limiter, httpJson, withRetry, log, money3, int, rate4 } from "./log.mjs";

const BASE = "https://a.klaviyo.com/api";
const REVISION = "2026-07-15";
const TZ_OFFSET = "+03:00";
const AMMAN_TZ = "Asia/Amman";

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

/**
 * Klaviyo refuses a values-report timeframe longer than one year
 * ("Passed in timeframe is greater than 1 year"). Any range wider than that
 * has to be split, so a multi-year backfill is chunked rather than failing.
 * 360 days leaves margin against boundary arithmetic.
 */
export const MAX_TIMEFRAME_DAYS = 360;

export function chunkRange(from, to, maxDays = MAX_TIMEFRAME_DAYS) {
  const chunks = [];
  let start = from;
  while (start <= to) {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + maxDays - 1);
    const end = d.toISOString().slice(0, 10);
    chunks.push({ from: start, to: end < to ? end : to });
    if (end >= to) break;
    const next = new Date(`${end}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    start = next.toISOString().slice(0, 10);
  }
  return chunks;
}

/** Day boundaries in Amman time, so a "day" means what it means in the shop. */
const dayStart = (d) => `${d}T00:00:00${TZ_OFFSET}`;
const dayEnd = (d) => `${d}T23:59:59${TZ_OFFSET}`;

/** ------------------------------------------------------------------------
 * The Placed Order metric. Every conversion figure in this file is measured
 * against it, per your instruction.
 * --------------------------------------------------------------------- */
export async function findMetricIdByName(name) {
  let url = "/metrics";
  let pages = 0;
  while (url && pages < 10) {
    const res = await get(url, "metrics");
    const hit = (res.data ?? []).find((m) => m.attributes?.name === name);
    if (hit) return hit.id;
    const next = res.links?.next;
    url = next ? next.replace(BASE, "") : null;
    pages++;
  }
  throw new Error(`Klaviyo metric "${name}" not found`);
}

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
  // Klaviyo reads a naive `datetime` filter as UTC but buckets results in the
  // requested `timezone`. Sending naive Amman midnights therefore starts the
  // window at 03:00 Amman — losing the first three hours of the opening day —
  // and adds a spurious partial bucket at the end. Verified against the live
  // API: naive bounds returned 4 buckets for a 3-day range, UTC instants
  // returned exactly 3. So convert Amman midnight to its UTC instant here.
  const ammanMidnightUtc = (day, addDays = 0) => {
    const d = new Date(`${day}T00:00:00${TZ_OFFSET}`);
    d.setUTCDate(d.getUTCDate() + addDays);
    return d.toISOString().slice(0, 19);
  };

  const body = {
    data: {
      type: "metric-aggregate",
      attributes: {
        metric_id: conversionMetricId,
        measurements: ["sum_value", "count"],
        interval: "day",
        timezone: AMMAN_TZ,
        by: ["$attributed_channel"],
        filter: [
          `greater-or-equal(datetime,${ammanMidnightUtc(from)})`,
          `less-than(datetime,${ammanMidnightUtc(to, 1)})`,
        ],
      },
    },
  };

  const res = await generalLimiter.run(() =>
    withRetry("metric aggregates", () =>
      httpJson(`${BASE}/metric-aggregates`, { method: "POST", headers: headers(), body: JSON.stringify(body) }, "metric aggregates"),
    ),
  );

  // Buckets come back as the UTC instant of each Amman midnight, so
  // "2026-08-23T21:00:00+00:00" IS Amman's 24th. Taking the first ten
  // characters would file that day's revenue under the 23rd and, since the
  // 23rd is outside the requested range, drop it entirely. Convert properly.
  const dates = (res.data?.attributes?.dates ?? []).map(toAmmanDate);
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

/* ------------------------------------------------------------------------
 * UNIQUE REACH
 *
 * Klaviyo cannot answer "how many distinct people did we reach" for a range:
 * metric_id takes one metric so email and push cannot be combined, and there
 * is no filter to isolate flow traffic as a single group. Counts also cannot
 * be summed across days, because the same people recur.
 *
 * SETS can be unioned though, so we store the daily set of profile identifiers
 * and let Postgres do the union for whatever range is asked for. That makes any
 * range — including a report export for an arbitrary month — a database query
 * rather than a 20-minute crawl.
 *
 * Identifiers are hashed before they are stored. We never keep a raw Klaviyo
 * profile id or an email; the hash is only ever compared with other hashes.
 * --------------------------------------------------------------------- */

/** Metrics that count as "reached". Resolved by name, never hardcoded ids. */
export const REACH_METRICS = { email: "Received Email", push: "Received Push" };

export async function resolveReachMetricIds() {
  const found = {};
  let url = "/metrics";
  let pages = 0;
  while (url && pages < 10) {
    const res = await get(url, "metrics");
    for (const m of res.data ?? []) {
      for (const [channel, name] of Object.entries(REACH_METRICS)) {
        if (m.attributes?.name === name) found[channel] = m.id;
      }
    }
    const next = res.links?.next;
    url = next ? next.replace(BASE, "") : null;
    pages++;
  }
  const missing = Object.keys(REACH_METRICS).filter((c) => !found[c]);
  if (missing.length) {
    throw new Error(`Klaviyo metric(s) not found: ${missing.map((c) => REACH_METRICS[c]).join(", ")}`);
  }
  return found;
}

/**
 * 48-bit hash of a profile id. Non-reversible, and small enough to stay inside
 * JavaScript's safe integer range so it survives JSON without precision loss.
 * Collision odds at this scale are negligible: ~50k ids in a 2^48 space is
 * about one chance in 200,000 of a single collision.
 */
export function hashProfileId(id) {
  const d = createHash("sha256").update(String(id)).digest();
  return d.readUIntBE(0, 6);
}

/**
 * One day of reach, split into the four buckets the dashboard needs:
 * email/campaign, email/flow, push/campaign, push/flow.
 *
 * `$flow` present on the event means it came from a flow; absent means a
 * campaign. Verified against the aggregate endpoint, which splits the same way.
 */
export async function fetchDailyReach(day, metricIds) {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const dayEnd = next.toISOString().slice(0, 10);

  const buckets = new Map();
  const key = (channel, source) => `${channel}|${source}`;
  for (const channel of Object.keys(metricIds)) {
    for (const source of ["campaign", "flow"]) {
      buckets.set(key(channel, source), { hashes: new Set(), events: 0 });
    }
  }

  for (const [channel, metricId] of Object.entries(metricIds)) {
    const filter = `and(equals(metric_id,"${metricId}"),greater-or-equal(datetime,${day}T00:00:00),less-than(datetime,${dayEnd}T00:00:00))`;
    let path = `/events?filter=${encodeURIComponent(filter)}&page%5Bsize%5D=200`;
    let pages = 0;
    while (path && pages < 2000) {
      const res = await get(path, `reach ${channel} ${day}`);
      for (const e of res.data ?? []) {
        const profileId = e.relationships?.profile?.data?.id;
        const source = e.attributes?.event_properties?.$flow ? "flow" : "campaign";
        const b = buckets.get(key(channel, source));
        b.events++;
        if (profileId) b.hashes.add(hashProfileId(profileId));
      }
      const nextLink = res.links?.next;
      path = nextLink ? nextLink.replace(BASE, "") : null;
      pages++;
    }
  }

  return [...buckets.entries()]
    .map(([k, v]) => {
      const [channel, source] = k.split("|");
      return {
        date: day,
        channel,
        source,
        profile_hashes: [...v.hashes],
        profile_count: v.hashes.size,
        event_count: v.events,
      };
    })
    // A day with no sends on a channel writes nothing rather than an empty row.
    .filter((r) => r.event_count > 0);
}

/* ------------------------------------------------------------------------
 * MARKETING-INFLUENCED ORDERS
 *
 * Our own model, not Klaviyo's attribution: did this customer click a Klaviyo
 * email shortly before ordering? Klaviyo's own attribution cannot be split by
 * channel; this can, because the order carries one. The two must never be
 * reconciled — see the table comment.
 * --------------------------------------------------------------------- */

/** Days of click history to look back before the order window. */
export const INFLUENCE_LOOKBACK_DAYS = 7;

/** Shopify sourceName -> our sub_channel, for the Klaviyo side of the join. */
function subChannelFromKlaviyoSource(src) {
  const s = String(src ?? "");
  if (s === "web") return "Website";
  if (/appmaker|shopney|mobile app/i.test(s)) return "Mobile App";
  if (/odoo|point of sale|^pos$/i.test(s)) return "POS";
  if (/draft|iphone|android/i.test(s)) return "Draft Orders";
  return "Unknown";
}

async function pullEvents(metricId, fromIso, toIso, take, label) {
  const filter = `and(equals(metric_id,"${metricId}"),greater-or-equal(datetime,${fromIso}),less-than(datetime,${toIso}))`;
  let path = `/events?filter=${encodeURIComponent(filter)}&page%5Bsize%5D=200`;
  const out = [];
  let pages = 0;
  while (path && pages < 4000) {
    const res = await get(path, label);
    for (const e of res.data ?? []) out.push(take(e));
    const next = res.links?.next;
    path = next ? next.replace(BASE, "") : null;
    pages++;
  }
  return out;
}

export async function fetchOrderInfluence({ from, to, conversionMetricId }) {
  const clickMetric = await findMetricIdByName("Clicked Email");

  // Clicks are pulled with a lookback so an order early in the range can still
  // see a click that happened before it.
  const lookbackFrom = new Date(`${from}T00:00:00Z`);
  lookbackFrom.setUTCDate(lookbackFrom.getUTCDate() - INFLUENCE_LOOKBACK_DAYS);
  const endExclusive = new Date(`${to}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endIso = `${endExclusive.toISOString().slice(0, 10)}T00:00:00`;

  const clicks = await pullEvents(
    clickMetric, `${lookbackFrom.toISOString().slice(0, 10)}T00:00:00`, endIso,
    (e) => ({ profile: e.relationships?.profile?.data?.id, t: Date.parse(e.attributes?.datetime) }),
    "influence clicks",
  );
  const orders = await pullEvents(
    conversionMetricId, `${from}T00:00:00`, endIso,
    (e) => ({
      orderId: String(e.attributes?.event_properties?.$event_id ?? ""),
      profile: e.relationships?.profile?.data?.id,
      t: Date.parse(e.attributes?.datetime),
      value: Number(e.attributes?.event_properties?.$value ?? 0),
      src: e.attributes?.event_properties?.["Source Name"],
    }),
    "influence orders",
  );

  const byProfile = new Map();
  for (const c of clicks) {
    if (!c.profile || !Number.isFinite(c.t)) continue;
    const arr = byProfile.get(c.profile) ?? [];
    arr.push(c.t);
    byProfile.set(c.profile, arr);
  }
  for (const arr of byProfile.values()) arr.sort((a, b) => a - b);

  const rows = [];
  for (const o of orders) {
    if (!o.orderId || !Number.isFinite(o.t)) continue;
    // Most recent click at or before the order. Clicks AFTER the order are
    // ignored: they cannot have caused it.
    let last = null;
    for (const t of byProfile.get(o.profile) ?? []) {
      if (t <= o.t) last = t;
      else break;
    }
    rows.push({
      order_id: o.orderId,
      ordered_at: new Date(o.t).toISOString(),
      date: toAmmanDate(o.t),
      sub_channel: subChannelFromKlaviyoSource(o.src),
      revenue_jod: money3(o.value),
      hours_since_click: last === null ? null : Number(((o.t - last) / 3600000).toFixed(2)),
    });
  }
  log.ok(`influence: ${orders.length} orders, ${clicks.length} clicks, ${rows.filter((r) => r.hours_since_click !== null).length} with a prior click`);
  return rows;
}

/** The Amman calendar date an instant falls on. */
export const toAmmanDate = (iso) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: AMMAN_TZ });

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
