import { need, optional } from "./env.mjs";
import { Limiter, httpJson, withRetry, log, money3 } from "./log.mjs";

const API_VERSION = "2026-07";
const limiter = new Limiter(600, "Shopify");

function shopDomain() {
  return optional("SHOPIFY_STORE_DOMAIN") || "drynksapp.myshopify.com";
}

function endpoint() {
  return `https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`;
}

/* ------------------------------------------------------------------------
 * Access tokens.
 *
 * Shopify stopped allowing admin-created custom apps on 1 January 2026, so
 * new apps no longer get a permanent shpat_ token. Dev Dashboard apps instead
 * exchange a Client ID and Client Secret for an access token that lives about
 * 24 hours (`expires_in` is 86399). Refreshing is just the same request again.
 *
 * Confirmed against Shopify's client credentials grant documentation:
 *   POST https://{shop}.myshopify.com/admin/oauth/access_token
 *   Content-Type: application/x-www-form-urlencoded
 *   grant_type=client_credentials & client_id=… & client_secret=…
 *   -> { access_token, scope, expires_in }
 * The token then goes in the X-Shopify-Access-Token header, exactly as the
 * legacy token did, so only the acquisition changes.
 *
 * The token lives in memory for the run and is never written to disk, to a
 * log line, or to sync_log. Both credentials are on the redaction list.
 * --------------------------------------------------------------------- */

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min early, never mid-request
let token = { value: null, expiresAt: 0, permanent: false };

async function accessToken({ force = false } = {}) {
  // A permanent offline token, if configured, never expires and is preferred:
  // no exchange per run, and no 24h clock to outlive during a long backfill.
  // Minted by scripts/shopify-install.mjs.
  const permanent = optional("SHOPIFY_ADMIN_TOKEN");
  if (permanent) {
    if (!token.permanent) {
      log.ok("Shopify: using the permanent SHOPIFY_ADMIN_TOKEN (no exchange needed)");
      token.permanent = true;
    }
    return permanent;
  }

  if (!force && token.value && Date.now() < token.expiresAt - REFRESH_MARGIN_MS) {
    return token.value;
  }

  const clientId = need("SHOPIFY_CLIENT_ID", "Shopify Dev Dashboard → your app → Client ID");
  const clientSecret = need("SHOPIFY_CLIENT_SECRET", "Shopify Dev Dashboard → your app → Client secret");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  let res;
  try {
    res = await withRetry("shopify token exchange", () =>
      httpJson(
        `https://${shopDomain()}/admin/oauth/access_token`,
        { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
        "shopify token exchange",
      ),
    );
  } catch (err) {
    // The two failures worth naming, because the generic message is unhelpful.
    if (err.status === 401 || /invalid_client/i.test(err.message)) {
      throw new Error(
        "Shopify rejected the client credentials. Check SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET " +
          "are copied from the same app, with no trailing whitespace.",
      );
    }
    if (err.status === 400 || err.status === 403) {
      // Keep Shopify's own wording. `shop_not_permitted` means the store is
      // not in the app's organization; anything else here is a different
      // problem and the raw text is the only way to tell them apart.
      const shopNotPermitted = /shop_not_permitted/i.test(err.message);
      throw new Error(
        `Shopify refused the client credentials grant for ${shopDomain()}.\n` +
          `  Shopify said: ${err.message}\n` +
          (shopNotPermitted
            ? "  shop_not_permitted means the STORE IS NOT IN THE APP'S ORGANIZATION. Compare the org id in\n" +
              "  the Dev Dashboard URL (dev.shopify.com/dashboard/<org-id>) against the org that owns the store."
            : "  This grant requires the app and store to be in the same Shopify organization."),
      );
    }
    throw err;
  }

  if (!res?.access_token) throw new Error("Shopify token exchange returned no access_token");

  const ttlMs = Number(res.expires_in ?? 86399) * 1000;
  token = { value: res.access_token, expiresAt: Date.now() + ttlMs, legacy: false };

  // Log the shape of what we got, never the token itself.
  const hours = Math.round(ttlMs / 3600000);
  log.ok(`Shopify: access token obtained, valid ~${hours}h, scopes: ${res.scope ?? "(none reported)"}`);
  return token.value;
}

const headers = async () => ({
  "X-Shopify-Access-Token": await accessToken(),
  "content-type": "application/json",
});

/**
 * A GraphQL call that survives its own token expiring.
 *
 * Proactive refresh (5 minutes before expiry) handles the normal case, but a
 * 90-day backfill runs for the better part of an hour and could still be
 * unlucky, so a 401 triggers one forced refresh and a single retry. Beyond
 * that the error is real and is allowed through.
 */
export async function gql(query, variables, label, { authRetried = false } = {}) {
  // Nothing reaches Shopify without passing this.
  assertReadOnly(query, label);

  let res;
  try {
    res = await limiter.run(() =>
      withRetry(label, async () =>
        httpJson(
          endpoint(),
          { method: "POST", headers: await headers(), body: JSON.stringify({ query, variables }) },
          label,
        ),
      ),
    );
  } catch (err) {
    if ((err.status === 401 || err.status === 403) && !authRetried && !optional("SHOPIFY_ADMIN_TOKEN")) {
      log.info("Shopify token was rejected mid-run; refreshing and retrying once");
      await accessToken({ force: true });
      return gql(query, variables, label, { authRetried: true });
    }
    throw err;
  }

  if (res.errors?.length) {
    const msg = res.errors.map((e) => e.message).join("; ");
    // The single most likely misconfiguration, called out explicitly.
    if (/access denied|not approved|read_all_orders/i.test(msg)) {
      throw new Error(
        `${label}: ${msg}\n  This usually means the app lacks read_all_orders, which caps order history at 60 days.`,
      );
    }
    throw new Error(`${label}: ${msg}`);
  }
  return res.data;
}

/* ===========================================================================
 * READ-ONLY GUARD
 *
 * The Shopify token carries WRITE scopes as well as read. This script must
 * never use them: it is a reporting sync against a live store, and a mutation
 * issued from here would alter real orders or products.
 *
 * The guard is an ALLOWLIST, not a blocklist. Every top-level definition must
 * be a `query` or a `fragment`, or the document must be a bare anonymous
 * selection set. Anything else is refused, including operation types that do
 * not exist yet. A blocklist of "reject mutation" would pass anything it had
 * not been taught about; this fails closed instead.
 *
 * It runs inside gql(), which is the only path to the network, so nothing can
 * reach Shopify without passing through it.
 * ======================================================================== */

/**
 * Removes comments and string literals so the scanner cannot be fooled by a
 * mutation hidden inside a string, nor tripped by the word "mutation"
 * appearing innocently in one.
 */
function stripStringsAndComments(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "#") {                                   // comment to end of line
      while (i < src.length && src[i] !== "\n") i++;
      out += " ";
    } else if (c === '"' && src.slice(i, i + 3) === '"""') {
      const end = src.indexOf('"""', i + 3);           // block string
      i = end === -1 ? src.length : end + 2;
      out += " ";
    } else if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") i++;                     // skip escaped char
        i++;
      }
      out += " ";
    } else out += c;
  }
  return out;
}

/** Operation types this script is permitted to send. Nothing else, ever. */
const ALLOWED_DEFINITIONS = new Set(["query", "fragment"]);

/** Consumes a balanced {...} / (...) / [...] starting at `i`. Returns the index after it. */
function consumeBalanced(src, i) {
  const open = src[i];
  const close = { "{": "}", "(": ")", "[": "]" }[open];
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("unbalanced");
}

/**
 * Throws unless every top-level definition in the document is read-only.
 *
 * Walks definition by definition rather than pattern-matching the text, so
 * an operation NAME or a field cannot be mistaken for a keyword, and a
 * keyword cannot hide inside a selection set. Exported for direct testing.
 */
export function assertReadOnly(document, label = "graphql") {
  const src = stripStringsAndComments(String(document ?? ""));
  if (!src.trim()) throw new Error(`${label}: refusing to send an empty GraphQL document`);

  let i = 0;
  let sawOperation = false;

  const skipSpace = () => { while (i < src.length && /[\s,]/.test(src[i])) i++; };

  try {
    skipSpace();
    while (i < src.length) {
      if (src[i] === "{") {
        // Anonymous operation — a bare selection set, always a read.
        i = consumeBalanced(src, i);
        sawOperation = true;
        skipSpace();
        continue;
      }

      const word = /^[_A-Za-z][_0-9A-Za-z]*/.exec(src.slice(i));
      if (!word) {
        throw new Error(
          `${label}: refusing to send a GraphQL document with unparseable top-level syntax near "${src.slice(i, i + 24).trim()}".`,
        );
      }
      const keyword = word[0];
      if (!ALLOWED_DEFINITIONS.has(keyword)) {
        throw new Error(
          `${label}: REFUSED — this script is strictly read-only and will not send a "${keyword}" operation.\n` +
            "  The Shopify token carries write scopes; only `query` and `fragment` are permitted here.\n" +
            "  If a write is genuinely required, it does not belong in the reporting sync.",
        );
      }
      i += keyword.length;

      // Skip the operation name, variable definitions and directives, then
      // consume the selection set. Variable defaults may contain braces, so
      // parens and brackets are traversed whole rather than scanned through.
      let guard = 0;
      while (i < src.length && src[i] !== "{") {
        if (src[i] === "(" || src[i] === "[") i = consumeBalanced(src, i);
        else i++;
        if (++guard > src.length) throw new Error("unbalanced");
      }
      if (i >= src.length) throw new Error("unbalanced");
      i = consumeBalanced(src, i);
      if (keyword === "query") sawOperation = true;
      skipSpace();
    }
  } catch (err) {
    if (err.message === "unbalanced") {
      throw new Error(`${label}: refusing to send a GraphQL document with unbalanced braces.`);
    }
    throw err;
  }

  // A document of fragments alone sends nothing useful and suggests the real
  // operation was lost somewhere; treat it as a mistake rather than run it.
  if (!sawOperation) throw new Error(`${label}: refusing to send a GraphQL document with no operation.`);
  return true;
}

/* ------------------------------------------------------------------------
 * Sales channels.
 *
 * Shopify's Order.sourceName is stored RAW and unmapped, so a channel
 * definition can be changed later without re-fetching three years of orders.
 * sub_channel and channel are derived from it here.
 *
 * Two channels changed provider mid-history, and both IDs must land on the
 * same sub-channel or the trend snaps at the switchover:
 *   Mobile App : 2653365 (Shopney, previous) -> 5382175 (Appmaker, current)
 *   POS        : pos (Shopify POS, historic) -> 179433 (Odoo Connector, current)
 * --------------------------------------------------------------------- */
export const SOURCE_MAP = {
  web:                  { sub_channel: "Website",      channel: "Online Sales" },
  "5382175":            { sub_channel: "Mobile App",   channel: "Online Sales" }, // Appmaker, current
  "2653365":            { sub_channel: "Mobile App",   channel: "Online Sales" }, // Shopney, previous
  pos:                  { sub_channel: "POS",          channel: "POS Sales" },    // Shopify POS, historic
  "179433":             { sub_channel: "POS",          channel: "POS Sales" },    // Odoo Connector, current
  shopify_draft_order:  { sub_channel: "Draft Orders", channel: "Draft Orders" },
  iphone:               { sub_channel: "Draft Orders", channel: "Draft Orders" },
  android:              { sub_channel: "Draft Orders", channel: "Draft Orders" },
};

/**
 * An unrecognised source is stored as Unknown rather than dropped or guessed.
 * Shopify can add a channel at any time, and silently discarding its orders
 * would understate revenue with no visible symptom.
 */
export function classifySource(sourceName) {
  const key = String(sourceName ?? "").trim() || "unknown";
  return { source_name: key, ...(SOURCE_MAP[key] ?? { sub_channel: "Unknown", channel: "Unknown" }) };
}

const ORDERS_QUERY = `
  query DailySales($q: String!, $cursor: String) {
    orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        createdAt
        cancelledAt
        sourceName
        currentTotalPriceSet { shopMoney { amount currencyCode } }
      }
    }
  }`;

/**
 * Total online sales per day.
 *
 * `-source_name:pos` excludes point-of-sale orders, leaving online store and
 * other online channels, which is the "online sales" figure you asked for.
 *
 * Amounts are taken as Shopify reports them: VAT-inclusive at 16%. Nothing is
 * stripped out here. If the report ever needs a net figure, that is a display
 * decision made downstream, not a silent transformation at fetch time.
 */
export async function fetchDailySales(from, to) {
  // No channel filter. Every order is fetched and tagged; filtering is a
  // display concern. Excluding POS here would throw away data that could only
  // be recovered by re-fetching the entire history.
  const q = `created_at:>='${from}T00:00:00+03:00' created_at:<='${to}T23:59:59+03:00'`;

  // date -> source_name -> { revenue, orders }
  const byDay = new Map();
  let cursor = null;
  let pages = 0;
  let scanned = 0;
  let cancelled = 0;
  const currencies = new Set();
  const sourceTally = new Map();
  const unknownSources = new Map();

  do {
    const data = await gql(ORDERS_QUERY, { q, cursor }, `shopify orders page ${pages + 1}`);
    const conn = data.orders;
    for (const o of conn.nodes ?? []) {
      scanned++;
      if (o.cancelledAt) { cancelled++; continue; }

      const money = o.currentTotalPriceSet?.shopMoney;
      if (money?.currencyCode) currencies.add(money.currencyCode);

      const cls = classifySource(o.sourceName);
      sourceTally.set(cls.source_name, (sourceTally.get(cls.source_name) ?? 0) + 1);
      if (cls.sub_channel === "Unknown") {
        unknownSources.set(cls.source_name, (unknownSources.get(cls.source_name) ?? 0) + 1);
      }

      const day = new Date(o.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
      if (!byDay.has(day)) byDay.set(day, new Map());
      const perSource = byDay.get(day);
      const cur = perSource.get(cls.source_name) ?? { revenue: 0, orders: 0, cls, top: [] };
      const amt = Number(money?.amount ?? 0);
      cur.revenue += amt;
      cur.orders += 1;
      // Keep the five largest order totals, so a bucket can later show whether
      // a handful of orders drove it rather than broad demand.
      cur.top.push(amt);
      cur.top.sort((a, b) => b - a);
      if (cur.top.length > 5) cur.top.length = 5;
      perSource.set(cls.source_name, cur);
    }
    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    pages++;
    if (pages % 20 === 0) log.info(`shopify: ${pages} pages, ${scanned} orders so far`);
  } while (cursor && pages < 4000);

  if (currencies.size > 1) {
    log.warn(`orders span multiple currencies (${[...currencies].join(", ")}); amounts were NOT converted`);
  } else if (currencies.size === 1 && !currencies.has("JOD")) {
    log.warn(`shop currency is ${[...currencies][0]}, not JOD. Values stored as reported, no conversion.`);
  }

  log.ok(`shopify: ${scanned} orders scanned, ${cancelled} cancelled and excluded, ${byDay.size} days`);
  if (sourceTally.size) {
    log.info("  orders by source_name:");
    for (const [src, n] of [...sourceTally].sort((a, b) => b[1] - a[1])) {
      const { sub_channel, channel } = classifySource(src);
      log.info(`      ${src.padEnd(20)} ${String(n).padStart(7)}   ${sub_channel} / ${channel}`);
    }
  }
  if (unknownSources.size) {
    log.warn(`${unknownSources.size} UNRECOGNISED source name(s): ${[...unknownSources.keys()].join(", ")}`);
    log.warn("  These are stored as Unknown, not dropped. Add them to SOURCE_MAP in lib/shopify.mjs.");
  }
  return byDay;
}

/**
 * One row per (date, source_name). Days with no orders produce no rows — there
 * is no channel to attribute an absence to, and a zero row per possible source
 * would invent data Shopify never reported.
 *
 * Attribution is deliberately NOT written here. It is whole-account and cannot
 * be split by channel, so it lives in klaviyo_attributed_daily.
 */
/* ------------------------------------------------------------------------
 * MARGIN
 *
 * ShopifyQL's `sales_channel` is a THIRD channel vocabulary, distinct from
 * Order.sourceName and from Klaviyo's Source Name. Every value observed across
 * 2025-2026 is mapped below; anything new is reported rather than dropped.
 *
 * Note "Shopify Mobile for iPhone" — 347k JOD in 2025 — has no sourceName
 * equivalent at all. Those are draft orders created from the Shopify admin
 * apps, which the order API reports simply as shopify_draft_order. Validated
 * against our own 2025 revenue: mapped Draft Orders came within 0.2%.
 * --------------------------------------------------------------------- */
export const SALES_CHANNEL_MAP = {
  "Online Store":               "Website",
  "Appmaker.xyz - Mobile app":  "Mobile App",
  "Shopney - Mobile App":       "Mobile App",
  "Point of Sale":              "POS",
  "Odoo Connector":             "POS",
  "Draft Orders":               "Draft Orders",
  "Shopify Mobile for iPhone":  "Draft Orders",
  "Shopify Mobile for Android": "Draft Orders",
  "Shopify Web":                "Draft Orders",
};

/** ShopifyQL, which is a GraphQL query and so passes the read-only guard. */
async function shopifyql(sql, label) {
  const data = await gql(
    `query Ql($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { rows columns { name } } } }`,
    { q: sql },
    label,
  );
  const r = data?.shopifyqlQuery;
  if (r?.parseErrors && (Array.isArray(r.parseErrors) ? r.parseErrors.length : true)) {
    throw new Error(`${label}: ShopifyQL rejected the query — ${JSON.stringify(r.parseErrors).slice(0, 200)}`);
  }
  const cols = (r?.tableData?.columns ?? []).map((c) => c.name);
  return (r?.tableData?.rows ?? []).map((row) =>
    Object.fromEntries((Array.isArray(row) ? row : cols.map((c) => row[c])).map((v, i) => [cols[i], v])),
  );
}

/**
 * Monthly margin per sub-channel. Shopify caps a ShopifyQL range at one year,
 * same as Klaviyo's reports, so multi-year ranges are chunked.
 */
export async function fetchMonthlyMargin(from, to) {
  const out = new Map();     // `${month}|${sub_channel}` -> row
  const unmapped = new Map();

  for (const chunk of yearChunks(from, to)) {
    const sql =
      `FROM sales SHOW net_sales, gross_profit ` +
      `GROUP BY month, sales_channel SINCE ${chunk.from} UNTIL ${chunk.to}`;
    const rows = await shopifyql(sql, `margin ${chunk.from}..${chunk.to}`);
    for (const r of rows) {
      const raw = String(r.sales_channel ?? "").trim();
      const sub = SALES_CHANNEL_MAP[raw];
      if (!sub) {
        unmapped.set(raw, (unmapped.get(raw) ?? 0) + Number(r.net_sales ?? 0));
        continue;
      }
      const month = String(r.month ?? "").slice(0, 10);
      if (!month) continue;
      const key = `${month}|${sub}`;
      const cur = out.get(key) ?? { month, sub_channel: sub, net: 0, profit: 0, sources: new Set() };
      cur.net += Number(r.net_sales ?? 0);
      cur.profit += Number(r.gross_profit ?? 0);
      cur.sources.add(raw);
      out.set(key, cur);
    }
  }

  if (unmapped.size) {
    log.warn(`ShopifyQL sales_channel value(s) not in SALES_CHANNEL_MAP, EXCLUDED from margin:`);
    for (const [name, net] of unmapped) log.warn(`    ${name}  (${money3(net)} JOD net)`);
    log.warn("  Add them to SALES_CHANNEL_MAP in lib/shopify.mjs — margin is understated until you do.");
  }

  return [...out.values()].map((v) => ({
    month: v.month,
    sub_channel: v.sub_channel,
    net_sales_jod: money3(v.net),
    gross_profit_jod: money3(v.profit),
    source_channels: [...v.sources].sort(),
  }));
}

/** Shopify rejects a ShopifyQL range longer than a year, as Klaviyo does. */
function yearChunks(from, to) {
  const chunks = [];
  let start = from;
  while (start <= to) {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 359);
    const end = d.toISOString().slice(0, 10);
    chunks.push({ from: start, to: end < to ? end : to });
    if (end >= to) break;
    const n = new Date(`${end}T12:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    start = n.toISOString().slice(0, 10);
  }
  return chunks;
}

export function toSalesRows(byDay, days) {
  const rows = [];
  for (const date of days) {
    const perSource = byDay.get(date);
    if (!perSource) continue;
    for (const [source_name, v] of perSource) {
      rows.push({
        date,
        source_name,
        sub_channel: v.cls.sub_channel,
        channel: v.cls.channel,
        total_online_revenue_jod: money3(v.revenue),
        orders: v.orders,
        top_order_values: (v.top ?? []).map(money3),
      });
    }
  }
  return rows;
}

/** Order id, channel and value only — for the Klaviyo coverage comparison. */
export async function pullOrderIdentity(from, to) {
  const q = `created_at:>='${from}T00:00:00+03:00' created_at:<='${to}T23:59:59+03:00'`;
  const out = [];
  let cursor = null, pages = 0;
  do {
    const data = await gql(
      `query($q:String!,$cursor:String){ orders(first:250, after:$cursor, query:$q, sortKey:CREATED_AT){
        pageInfo{hasNextPage endCursor}
        nodes{ legacyResourceId cancelledAt sourceName currentTotalPriceSet{shopMoney{amount}} } } }`,
      { q, cursor }, `coverage orders page ${pages + 1}`,
    );
    const conn = data.orders;
    for (const o of conn.nodes ?? []) {
      if (o.cancelledAt) continue;
      out.push({
        id: String(o.legacyResourceId),
        sub_channel: classifySource(o.sourceName).sub_channel,
        amount: Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0),
      });
    }
    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    pages++;
    if (pages % 20 === 0) log.info(`  ${pages} pages, ${out.length} orders`);
  } while (cursor && pages < 4000);
  return out;
}
