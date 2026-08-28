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
async function gql(query, variables, label, { authRetried = false } = {}) {
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

const ORDERS_QUERY = `
  query DailySales($q: String!, $cursor: String) {
    orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        createdAt
        cancelledAt
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
  const q = `created_at:>='${from}T00:00:00+03:00' created_at:<='${to}T23:59:59+03:00' -source_name:pos`;
  const byDay = new Map();
  let cursor = null;
  let pages = 0;
  let scanned = 0;
  let cancelled = 0;
  const currencies = new Set();

  do {
    const data = await gql(ORDERS_QUERY, { q, cursor }, `shopify orders page ${pages + 1}`);
    const conn = data.orders;
    for (const o of conn.nodes ?? []) {
      scanned++;
      if (o.cancelledAt) {
        cancelled++;
        continue;
      }
      const money = o.currentTotalPriceSet?.shopMoney;
      if (money?.currencyCode) currencies.add(money.currencyCode);
      // Bucket by Amman calendar day, matching the query window.
      const day = new Date(o.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
      const cur = byDay.get(day) ?? { revenue: 0, orders: 0 };
      cur.revenue += Number(money?.amount ?? 0);
      cur.orders += 1;
      byDay.set(day, cur);
    }
    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    pages++;
  } while (cursor && pages < 200);

  if (currencies.size > 1) {
    log.warn(`orders span multiple currencies (${[...currencies].join(", ")}); amounts were NOT converted`);
  } else if (currencies.size === 1 && !currencies.has("JOD")) {
    log.warn(
      `shop currency is ${[...currencies][0]}, not JOD. Values are stored as reported, with no conversion applied.`,
    );
  }
  log.ok(`shopify: ${scanned} orders scanned, ${cancelled} cancelled and excluded, ${byDay.size} days with sales`);
  return byDay;
}

export function toSalesRows(byDay, attributedByDay, days) {
  // When Klaviyo did not run (e.g. `--only shopify`), we have NO attributed
  // figure — which is not the same as an attributed figure of zero. Writing a
  // zero would silently destroy real revenue already stored for these days.
  // Omitting the column entirely leaves the existing value untouched, because
  // the upsert only updates columns present in the payload.
  const haveAttribution = attributedByDay instanceof Map;
  return days.map((date) => {
    const s = byDay.get(date) ?? { revenue: 0, orders: 0 };
    const row = {
      date,
      total_online_revenue_jod: money3(s.revenue),
      orders: s.orders,
    };
    if (haveAttribution) {
      // Event-date basis, so it lines up with the order dates above.
      row.klaviyo_attributed_revenue_jod = money3(attributedByDay.get(date) ?? 0);
    }
    return row;
  });
}
