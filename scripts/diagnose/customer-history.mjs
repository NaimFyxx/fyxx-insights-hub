#!/usr/bin/env node
/**
 * Per-customer order history across the FULL Shopify record, back to 2019.
 * Read-only by default; --write fills first_order_date, last_order_date and
 * revenue_jod on shopify_customers.
 *
 *   node scripts/diagnose/customer-history.mjs [--from 2019-01-01] [--write]
 *
 * Why this exists: every "first order" figure computed from 2025 onward is
 * wrong. A customer who first bought in 2020 and returned in 2025 was being
 * counted as new, which inflates acquisition and deflates retention. The
 * one-and-never-returned figure of 42.7% was computed without knowing five
 * years of buyers existed before the window.
 *
 * revenue_jod is computed from ORDERS, excluding cancelled ones, because
 * amountSpent is unreliable: of 808 customers tested it matched the
 * non-cancelled sum 572 times, the all-orders sum 175 times, and neither 61.
 */
import { loadEnv, need } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { gql, classifySource } from "../lib/shopify.mjs";
import { upsert } from "../lib/db.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FROM = argOf("--from", "2019-01-01");
const TO = argOf("--to", "2026-08-29");
const WRITE = args.includes("--write");

const n0 = (v) => Math.round(v).toLocaleString("en-US");
const pc = (a, b) => (b > 0 ? ((100 * a) / b).toFixed(1) + "%" : "-");
const ammanDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

const Q = `query($q:String!,$cursor:String){ orders(first:250, after:$cursor, query:$q, sortKey:CREATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{ createdAt cancelledAt sourceName customer{id}
         currentTotalPriceSet{shopMoney{amount}} } } }`;

const byCustomer = new Map();
let cursor = null, pages = 0, scanned = 0, cancelled = 0, noCustomer = 0;
do {
  const d = await gql(Q, { q: `created_at:>='${FROM}T00:00:00+03:00' created_at:<='${TO}T23:59:59+03:00'`, cursor },
    `customer history page ${pages + 1}`);
  for (const o of d.orders.nodes ?? []) {
    scanned++;
    if (o.cancelledAt) { cancelled++; continue; }
    const cust = o.customer?.id ? String(o.customer.id).split("/").pop() : null;
    if (!cust) { noCustomer++; continue; }
    const day = ammanDay(o.createdAt);
    const v = byCustomer.get(cust) ?? { first: day, last: day, orders: 0, revenue: 0, firstChannel: null };
    if (day < v.first) { v.first = day; v.firstChannel = classifySource(o.sourceName).sub_channel; }
    if (!v.firstChannel) v.firstChannel = classifySource(o.sourceName).sub_channel;
    if (day > v.last) v.last = day;
    v.orders++; v.revenue += Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0);
    byCustomer.set(cust, v);
  }
  cursor = d.orders.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
  pages++;
  if (pages % 50 === 0) log.info(`  ${pages} pages, ${scanned} orders, ${byCustomer.size} customers`);
} while (cursor && pages < 8000);

log.ok(`${scanned} orders scanned, ${cancelled} cancelled, ${noCustomer} with no customer`);
log.ok(`${byCustomer.size} customers with at least one order`);

const firstYears = new Map();
for (const v of byCustomer.values()) {
  const y = v.first.slice(0, 4);
  firstYears.set(y, (firstYears.get(y) ?? 0) + 1);
}
console.log("\n=== FIRST ORDER YEAR — what the 2025-onward window could not see ===\n");
let before2025 = 0;
for (const y of [...firstYears.keys()].sort()) {
  const n = firstYears.get(y);
  if (y < "2025") before2025 += n;
  console.log(`  ${y}  ${n0(n).padStart(7)} customers${y < "2025" ? "   <-- invisible before this sweep" : ""}`);
}
console.log(`\n  ${n0(before2025)} of ${n0(byCustomer.size)} buyers (${pc(before2025, byCustomer.size)}) first bought BEFORE 2025.`);

if (WRITE) {
  const rows = [...byCustomer].map(([id, v]) => ({
    shopify_customer_id: id,
    first_order_date: v.first,
    last_order_date: v.last,
    revenue_jod: Math.round(v.revenue * 1000) / 1000,
  }));
  const w = await upsert("shopify_customers", rows, "shopify_customer_id", { dryRun: false });
  log.ok(`wrote ${w} customer row(s) with first/last order and computed revenue`);
} else {
  log.info("read-only; pass --write to fill first_order_date, last_order_date and revenue_jod");
}
