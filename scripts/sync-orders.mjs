#!/usr/bin/env node
/**
 * Every Shopify order, one row each, into shopify_orders.
 *
 *   node scripts/sync-orders.mjs [--from 2019-01-01] [--to YYYY-MM-DD] [--write]
 *
 * Why this exists: the channel toggles filter by ORDER channel — where an
 * order came from. The question that matters is ACQUISITION channel — where
 * the customer first came from. A customer the app acquired who now phones
 * orders in shows as Draft Orders revenue: marketing acquired them, the
 * dashboard credits the sales team. Answering that needs order-level rows
 * joined to shopify_customers.first_order_channel, and nothing stored them.
 * customer-history.mjs already derives per-order channel and throws it away.
 *
 * Three deliberate choices:
 *
 *   Cancelled orders are STORED with cancelled_at, not skipped. Netting at
 *   read time lets a cancellation correct an old figure; skipping them freezes
 *   whatever happened to be true on sweep day.
 *
 *   Orders with NO customer are stored too. They are ~10.7% of orders and can
 *   never carry an acquisition channel. Keeping them makes the coverage
 *   ceiling visible instead of quietly reporting a subset as the whole.
 *
 *   An order hitting no SOURCE_MAP entry is counted and shouted about. A sweep
 *   that silently bucketed orders into Unknown would look like a clean run and
 *   produce a wrong channel split — which is exactly how the +831.8% Mobile App
 *   figure happened.
 *
 * Read-only against Shopify: gql() asserts no mutation before every call.
 */
import { loadEnv } from "./lib/env.mjs";
import { log } from "./lib/log.mjs";
import { gql, classifySource } from "./lib/shopify.mjs";
import { upsert } from "./lib/db.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FROM = argOf("--from", "2019-01-01");
const TO = argOf("--to", new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" }));
const WRITE = args.includes("--write");
const BATCH = 2000;

const ammanDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
const n0 = (v) => Math.round(v).toLocaleString("en-US");

const Q = `query($q:String!,$cursor:String){ orders(first:250, after:$cursor, query:$q, sortKey:CREATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{ id createdAt cancelledAt sourceName customer{id}
         currentTotalPriceSet{shopMoney{amount}} } } }`;

let cursor = null, pages = 0, scanned = 0, written = 0;
let cancelled = 0, noCustomer = 0, unknownChannel = 0;
const unknownSources = new Map();
let batch = [];

const flush = async (force = false) => {
  if (!batch.length || (!force && batch.length < BATCH)) return;
  if (WRITE) written += await upsert("shopify_orders", batch, "order_id", { dryRun: false });
  batch = [];
};

do {
  const d = await gql(
    Q,
    { q: `created_at:>='${FROM}T00:00:00+03:00' created_at:<='${TO}T23:59:59+03:00'`, cursor },
    `orders page ${pages + 1}`,
  );
  for (const o of d.orders.nodes ?? []) {
    scanned++;
    const cust = o.customer?.id ? String(o.customer.id).split("/").pop() : null;
    if (!cust) noCustomer++;
    if (o.cancelledAt) cancelled++;
    const cls = classifySource(o.sourceName);
    if (cls.sub_channel === "Unknown") {
      unknownChannel++;
      const k = o.sourceName ?? "(null)";
      unknownSources.set(k, (unknownSources.get(k) ?? 0) + 1);
    }
    batch.push({
      order_id: String(o.id).split("/").pop(),
      shopify_customer_id: cust,
      ordered_at: o.createdAt,
      ordered_on: ammanDay(o.createdAt),
      source_name: o.sourceName ?? null,
      sub_channel: cls.sub_channel,
      revenue_jod: Math.round(Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0) * 1000) / 1000,
      cancelled_at: o.cancelledAt ?? null,
    });
  }
  await flush();
  cursor = d.orders.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
  pages++;
  if (pages % 25 === 0) log.info(`  ${pages} pages, ${n0(scanned)} orders, ${n0(written)} written`);
} while (cursor && pages < 8000);
await flush(true);

log.ok(`${n0(scanned)} orders scanned over ${pages} pages`);
log.info(`  ${n0(cancelled)} cancelled (stored, netted at read time)`);
log.info(`  ${n0(noCustomer)} with no customer (never assignable to an acquisition channel)`);

if (unknownChannel > 0) {
  log.warn(`${n0(unknownChannel)} orders hit no SOURCE_MAP entry and were stored as Unknown:`);
  for (const [k, v] of [...unknownSources].sort((a, b) => b[1] - a[1])) {
    log.warn(`    ${k}: ${n0(v)}`);
  }
  log.warn(`Resolve the app id before trusting any channel figure from this run.`);
}

if (WRITE) log.ok(`wrote ${n0(written)} order row(s)`);
else log.info("read-only; pass --write to store");
