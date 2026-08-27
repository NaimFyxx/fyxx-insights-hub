import { need, optional } from "./env.mjs";
import { Limiter, httpJson, withRetry, log, money3 } from "./log.mjs";

const API_VERSION = "2026-07";
const limiter = new Limiter(600, "Shopify");

function endpoint() {
  const domain = optional("SHOPIFY_STORE_DOMAIN") || "drynksapp.myshopify.com";
  return `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
}

const headers = () => ({
  "X-Shopify-Access-Token": need(
    "SHOPIFY_ADMIN_TOKEN",
    "Shopify → Settings → Apps and sales channels → Develop apps → Admin API access token",
  ),
  "content-type": "application/json",
});

async function gql(query, variables, label) {
  const res = await limiter.run(() =>
    withRetry(label, () =>
      httpJson(endpoint(), { method: "POST", headers: headers(), body: JSON.stringify({ query, variables }) }, label),
    ),
  );
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
  return days.map((date) => {
    const s = byDay.get(date) ?? { revenue: 0, orders: 0 };
    return {
      date,
      total_online_revenue_jod: money3(s.revenue),
      // Event-date basis, so it lines up with the order dates above.
      klaviyo_attributed_revenue_jod: money3(attributedByDay?.get(date) ?? 0),
      orders: s.orders,
    };
  });
}
