#!/usr/bin/env node
/**
 * Independently re-fetch a date range from Shopify and diff it against what is
 * stored in shopify_daily_sales. Read-only, writes nothing.
 *
 *   node scripts/diagnose/verify-shopify.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * This deliberately uses its OWN GraphQL document rather than calling
 * fetchDailySales, so a bug in the production query is visible as a difference
 * instead of being reproduced identically on both sides. What it shares with
 * production is only the parts that must match to make the comparison fair:
 * the Amman day boundary, the exclusion of cancelled orders, and
 * currentTotalPriceSet as the money field.
 *
 * Shopify's order search silently ignores a source_name filter, so sourceName
 * is read per order across a full paginated sweep and bucketed here. Filtering
 * server-side would return everything and look like it had filtered.
 */
import { loadEnv, need } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { gql, classifySource } from "../lib/shopify.mjs";
import { money3 } from "../lib/log.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FROM = argOf("--from", "2026-08-01");
const TO = argOf("--to", "2026-08-31");

const n0 = (v) => Math.round(v).toLocaleString("en-US");
const j3 = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const ammanDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

// Deliberately not the production document: extra fields, different shape.
const VERIFY_QUERY = `
  query VerifyOrders($q: String!, $cursor: String) {
    orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        cancelledAt
        test
        sourceName
        app { id name }
        channelInformation { channelDefinition { handle channelName } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        totalTaxSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        refunds { id totalRefundedSet { shopMoney { amount } } }
      }
    }
  }`;

async function sweep() {
  const q = `created_at:>='${FROM}T00:00:00+03:00' created_at:<='${TO}T23:59:59+03:00'`;
  const byKey = new Map();          // `${day}|${source_name}` -> { revenue, orders }
  const bySource = new Map();       // source_name -> { revenue, orders, apps:Set, channels:Set }
  const nullSourceSamples = [];
  let cursor = null, pages = 0, scanned = 0, cancelled = 0, tests = 0;
  const currencies = new Set();
  // Kept separately so a difference against an external export can be
  // attributed to a cause instead of guessed at.
  const tally = { cancelledRevenue: 0, refunded: 0, refundedOrders: 0, editDelta: 0, byDayAll: new Map(),
                  shipping: 0, tax: 0, discounts: 0, cancelledBySource: new Map() };

  do {
    const data = await gql(VERIFY_QUERY, { q, cursor }, `verify orders page ${pages + 1}`);
    const conn = data.orders;
    for (const o of conn.nodes ?? []) {
      scanned++;
      const dayAll = ammanDay(o.createdAt);
      const origAll = Number(o.totalPriceSet?.shopMoney?.amount ?? 0);
      const dAll = tally.byDayAll.get(dayAll) ?? { orders: 0, revenue: 0, cancelledOrders: 0, cancelledRevenue: 0 };
      dAll.orders += 1; dAll.revenue += origAll;
      if (o.cancelledAt) { dAll.cancelledOrders += 1; dAll.cancelledRevenue += origAll; }
      tally.byDayAll.set(dayAll, dAll);

      if (o.cancelledAt) {
        cancelled++;
        tally.cancelledRevenue += origAll;
        const ck = classifySource(o.sourceName).source_name;
        const cv = tally.cancelledBySource.get(ck) ?? { orders: 0, original: 0, current: 0 };
        cv.orders += 1; cv.original += origAll;
        cv.current += Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0);
        tally.cancelledBySource.set(ck, cv);
        continue;
      }
      const refundAmt = (o.refunds ?? []).reduce((a, r) => a + Number(r.totalRefundedSet?.shopMoney?.amount ?? 0), 0);
      if (refundAmt > 0) { tally.refunded += refundAmt; tally.refundedOrders += 1; }
      tally.editDelta += origAll - Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0);
      tally.shipping += Number(o.totalShippingPriceSet?.shopMoney?.amount ?? 0);
      tally.tax += Number(o.totalTaxSet?.shopMoney?.amount ?? 0);
      tally.discounts += Number(o.totalDiscountsSet?.shopMoney?.amount ?? 0);
      if (o.test) tests++;

      const money = o.currentTotalPriceSet?.shopMoney;
      if (money?.currencyCode) currencies.add(money.currencyCode);
      const amt = Number(money?.amount ?? 0);
      const cls = classifySource(o.sourceName);
      const day = ammanDay(o.createdAt);

      const k = `${day}|${cls.source_name}`;
      const cur = byKey.get(k) ?? { revenue: 0, orders: 0, sub_channel: cls.sub_channel };
      cur.revenue += amt; cur.orders += 1;
      byKey.set(k, cur);

      const s = bySource.get(cls.source_name) ??
        { revenue: 0, orders: 0, sub_channel: cls.sub_channel, apps: new Set(), channels: new Set() };
      s.revenue += amt; s.orders += 1;
      if (o.app?.name) s.apps.add(`${o.app.name} (${String(o.app.id).split("/").pop()})`);
      const ch = o.channelInformation?.channelDefinition;
      if (ch?.channelName) s.channels.add(`${ch.channelName} [${ch.handle}]`);
      bySource.set(cls.source_name, s);

      if ((o.sourceName ?? "") === "" && nullSourceSamples.length < 12) {
        nullSourceSamples.push({
          name: o.name, day, amt,
          app: o.app?.name ?? null,
          appId: o.app?.id ? String(o.app.id).split("/").pop() : null,
          channel: ch?.channelName ?? null,
        });
      }
    }
    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    pages++;
    if (pages % 10 === 0) log.info(`  ${pages} pages, ${scanned} orders scanned`);
  } while (cursor && pages < 4000);

  return { byKey, bySource, nullSourceSamples, scanned, cancelled, tests, currencies, pages, tally };
}

async function stored() {
  const url = need("SUPABASE_URL", "").replace(/\/+$/, "");
  const key = need("SUPABASE_SERVICE_ROLE_KEY", "");
  const rows = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${url}/rest/v1/shopify_daily_sales?select=date,source_name,sub_channel,orders,total_online_revenue_jod` +
      `&date=gte.${FROM}&date=lte.${TO}&limit=1000&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    // PostgREST caps a page at 1000 whatever we ask for; advance by what came back.
    if (page.length === 0) break;
    offset += page.length;
    if (page.length < 1000) break;
  }
  return rows;
}

const { byKey, bySource, nullSourceSamples, scanned, cancelled, tests, currencies, pages, tally } = await sweep();
const rows = await stored();

log.ok(`Shopify: ${pages} pages, ${scanned} orders scanned, ${cancelled} cancelled excluded, ${tests} test orders`);
if (currencies.size > 1) log.warn(`multiple currencies: ${[...currencies].join(", ")} — NOT converted`);

console.log("\n=== RE-FETCHED, by source_name ===");
let apiRev = 0, apiOrd = 0;
for (const [src, s] of [...bySource].sort((a, b) => b[1].revenue - a[1].revenue)) {
  apiRev += s.revenue; apiOrd += s.orders;
  console.log(`  ${src.padEnd(22)} ${j3(s.revenue).padStart(14)}  ${String(s.orders).padStart(6)}  ${s.sub_channel}`);
  if (s.apps.size) console.log(`      apps: ${[...s.apps].join(", ")}`);
  if (s.channels.size) console.log(`      channels: ${[...s.channels].join(", ")}`);
}
console.log(`  ${"TOTAL".padEnd(22)} ${j3(apiRev).padStart(14)}  ${String(apiOrd).padStart(6)}`);

if (nullSourceSamples.length) {
  console.log(`\n=== ORDERS WITH NO sourceName (first ${nullSourceSamples.length}) ===`);
  for (const s of nullSourceSamples) {
    console.log(`  ${s.name.padEnd(12)} ${s.day}  ${j3(s.amt).padStart(11)}  app=${s.app ?? "-"}${s.appId ? ` (${s.appId})` : ""}  channel=${s.channel ?? "-"}`);
  }
}

// --- diff per (date, source_name) ---
const storedKeys = new Map();
let dbRev = 0, dbOrd = 0;
for (const r of rows) {
  storedKeys.set(`${r.date}|${r.source_name}`, r);
  dbRev += Number(r.total_online_revenue_jod);
  dbOrd += r.orders;
}

const missing = [], extra = [], differing = [];
for (const [k, v] of byKey) {
  const r = storedKeys.get(k);
  if (!r) { missing.push({ k, v }); continue; }
  const dRev = money3(v.revenue) - Number(r.total_online_revenue_jod);
  const dOrd = v.orders - r.orders;
  if (Math.abs(dRev) > 0.0005 || dOrd !== 0) differing.push({ k, v, r, dRev, dOrd });
}
for (const [k, r] of storedKeys) if (!byKey.has(k)) extra.push({ k, r });

console.log("\n=== STORED vs RE-FETCHED ===");
console.log(`  re-fetched : ${j3(apiRev).padStart(14)}  ${String(apiOrd).padStart(6)} orders   ${byKey.size} (day,source) cells`);
console.log(`  stored     : ${j3(dbRev).padStart(14)}  ${String(dbOrd).padStart(6)} orders   ${storedKeys.size} (day,source) cells`);
console.log(`  difference : ${j3(apiRev - dbRev).padStart(14)}  ${String(apiOrd - dbOrd).padStart(6)} orders`);

const show = (title, list, fmt) => {
  if (!list.length) return;
  console.log(`\n  ${title} (${list.length}):`);
  for (const x of list.slice(0, 40)) console.log(`    ${fmt(x)}`);
  if (list.length > 40) console.log(`    ... and ${list.length - 40} more`);
};
show("IN SHOPIFY BUT NOT STORED", missing, ({ k, v }) => `${k.padEnd(40)} ${j3(v.revenue).padStart(12)}  ${v.orders} orders`);
show("STORED BUT NOT IN SHOPIFY", extra, ({ k, r }) => `${k.padEnd(40)} ${j3(Number(r.total_online_revenue_jod)).padStart(12)}  ${r.orders} orders`);
show("DIFFERENT VALUES", differing, ({ k, v, r, dRev, dOrd }) =>
  `${k.padEnd(40)} api ${j3(v.revenue).padStart(12)}/${v.orders}  db ${j3(Number(r.total_online_revenue_jod)).padStart(12)}/${r.orders}  Δ ${j3(dRev)}/${dOrd}`);

console.log("\n=== WHAT SEPARATES OUR BASIS FROM A GROSS EXPORT ===");
console.log(`  orders in range, including cancelled : ${String(scanned).padStart(6)}`);
console.log(`  cancelled, excluded by us            : ${String(cancelled).padStart(6)}   ${j3(tally.cancelledRevenue).padStart(12)} JOD at original price`);
console.log(`  non-cancelled, what we store         : ${String(scanned - cancelled).padStart(6)}   ${j3(apiRev).padStart(12)} JOD at current price`);
console.log(`  orders carrying a refund             : ${String(tally.refundedOrders).padStart(6)}   ${j3(tally.refunded).padStart(12)} JOD refunded`);
console.log(`  original minus current on kept orders: ${" ".repeat(6)}   ${j3(tally.editDelta).padStart(12)} JOD (refunds and edits)`);
console.log(`  shipping inside our figure           : ${" ".repeat(6)}   ${j3(tally.shipping).padStart(12)} JOD`);
console.log(`  tax inside our figure                : ${" ".repeat(6)}   ${j3(tally.tax).padStart(12)} JOD`);
console.log(`  discounts already deducted           : ${" ".repeat(6)}   ${j3(tally.discounts).padStart(12)} JOD`);

console.log("\n=== CANCELLED ORDERS BY SOURCE (we exclude these; a gross export may count them) ===");
for (const [src, v] of [...tally.cancelledBySource].sort((a, b) => b[1].orders - a[1].orders)) {
  console.log(`  ${src.padEnd(22)} ${String(v.orders).padStart(5)} orders   original ${j3(v.original).padStart(12)}   current ${j3(v.current).padStart(12)}`);
}

console.log("\n=== LAST DAYS, ALL ORDERS AT ORIGINAL PRICE ===");
for (const d of [...tally.byDayAll.keys()].sort().slice(-4)) {
  const v = tally.byDayAll.get(d);
  console.log(`  ${d}  ${String(v.orders).padStart(5)} orders  ${j3(v.revenue).padStart(12)}   cancelled ${v.cancelledOrders} / ${j3(v.cancelledRevenue)}`);
}

if (!missing.length && !extra.length && !differing.length) {
  log.ok("Every (date, source_name) cell matches to the stored 3 decimals.");
}
