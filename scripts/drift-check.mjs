#!/usr/bin/env node
/**
 * Measure how far stored order data has drifted from Shopify.
 *
 *   node scripts/drift-check.mjs --snapshot [--from D] [--to D] [--out FILE]
 *   node scripts/drift-check.mjs --compare  --baseline FILE
 *   node scripts/drift-check.mjs --compare  --from D --to D      (live vs stored)
 *
 * Why this exists: an order cancelled after it was swept stays live in our
 * tables forever. The nightly sync only fetches orders CREATED in its window,
 * so a cancellation three days later is never seen. We have been working from
 * an estimate of how big that drift is; this measures it.
 *
 * It is also the test harness for the updated_at repair. The repair is correct
 * exactly when a --compare run after it reports no gaps.
 *
 * Read-only against Shopify. Writes nothing to the database ever — this
 * measures, it does not fix.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "./lib/env.mjs";
import { log } from "./lib/log.mjs";
import { gql, classifySource } from "./lib/shopify.mjs";
import { selectAll } from "./lib/db.mjs";

loadEnv();
const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
const fortnightAgo = new Date(Date.parse(today) - 14 * 86_400_000).toISOString().slice(0, 10);
const FROM = argOf("--from", fortnightAgo);
const TO = argOf("--to", today);

const n0 = (v) => Math.round(v).toLocaleString("en-US");
const jod = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
const ammanDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

/** What our database currently believes about a date range. */
async function readStored(from, to) {
  const rows = await selectAll(
    "shopify_orders",
    `select=order_id,ordered_on,revenue_jod,cancelled_at,sub_channel&ordered_on=gte.${from}&ordered_on=lte.${to}`,
  );
  const byId = new Map(rows.map((r) => [String(r.order_id), r]));
  return { rows, byId };
}

/** What Shopify says right now about the same range. */
async function readLive(from, to) {
  const Q = `query($q:String!,$cursor:String){ orders(first:250, after:$cursor, query:$q, sortKey:CREATED_AT){
    pageInfo{hasNextPage endCursor}
    nodes{ id createdAt cancelledAt sourceName
           currentTotalPriceSet{shopMoney{amount}} } } }`;
  const out = new Map();
  let cursor = null, pages = 0;
  do {
    const d = await gql(
      Q,
      { q: `created_at:>='${from}T00:00:00+03:00' created_at:<='${to}T23:59:59+03:00'`, cursor },
      `drift page ${pages + 1}`,
    );
    for (const o of d.orders.nodes ?? []) {
      out.set(String(o.id).split("/").pop(), {
        order_id: String(o.id).split("/").pop(),
        ordered_on: ammanDay(o.createdAt),
        revenue_jod: Math.round(Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0) * 1000) / 1000,
        cancelled_at: o.cancelledAt ?? null,
        sub_channel: classifySource(o.sourceName).sub_channel,
      });
    }
    cursor = d.orders.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
    pages++;
  } while (cursor && pages < 4000);
  return out;
}

const liveTotal = (rows) =>
  [...rows].reduce((a, r) => a + (r.cancelled_at ? 0 : Number(r.revenue_jod ?? 0)), 0);
const liveCount = (rows) => [...rows].filter((r) => !r.cancelled_at).length;

if (has("--snapshot")) {
  const { rows } = await readStored(FROM, TO);
  const byDay = new Map();
  for (const r of rows) {
    const d = byDay.get(r.ordered_on) ?? { day: r.ordered_on, orders: [], };
    d.orders.push({ order_id: String(r.order_id), revenue_jod: Number(r.revenue_jod), cancelled: !!r.cancelled_at });
    byDay.set(r.ordered_on, d);
  }
  const days = [...byDay.values()]
    .map((d) => ({
      day: d.day,
      stored_orders: d.orders.length,
      live_orders: d.orders.filter((o) => !o.cancelled).length,
      cancelled: d.orders.filter((o) => o.cancelled).length,
      live_revenue: Math.round(d.orders.filter((o) => !o.cancelled).reduce((a, o) => a + o.revenue_jod, 0) * 1000) / 1000,
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const snapshot = {
    // Passed in rather than stamped from the clock, so a re-run is comparable.
    taken_for: { from: FROM, to: TO },
    note: "Stored state BEFORE any external change. Compare with --compare --baseline.",
    totals: {
      stored_orders: rows.length,
      live_orders: days.reduce((a, d) => a + d.live_orders, 0),
      live_revenue: Math.round(days.reduce((a, d) => a + d.live_revenue, 0) * 1000) / 1000,
    },
    days,
    // Every order id, so a cancellation can be identified individually rather
    // than inferred from a daily total moving.
    order_ids: rows.map((r) => ({
      id: String(r.order_id),
      rev: Number(r.revenue_jod),
      cancelled: !!r.cancelled_at,
    })),
  };
  const out = argOf("--out", `drift-baseline-${FROM}_${TO}.json`);
  writeFileSync(out, JSON.stringify(snapshot, null, 2));
  log.ok(`snapshot ${FROM} to ${TO}: ${n0(snapshot.totals.live_orders)} live orders, ${jod(snapshot.totals.live_revenue)} JOD`);
  log.ok(`wrote ${out}`);
} else if (has("--compare")) {
  const baselinePath = argOf("--baseline", null);
  const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
  const from = baseline?.taken_for?.from ?? FROM;
  const to = baseline?.taken_for?.to ?? TO;

  log.info(`comparing ${from} to ${to} — stored against Shopify right now`);
  const [{ byId: stored }, live] = await Promise.all([readStored(from, to), readLive(from, to)]);

  const newlyCancelled = [];
  const revenueChanged = [];
  const missingLocally = [];
  for (const [id, l] of live) {
    const s = stored.get(id);
    if (!s) { missingLocally.push(l); continue; }
    const wasCancelled = !!s.cancelled_at;
    const isCancelled = !!l.cancelled_at;
    if (!wasCancelled && isCancelled) {
      newlyCancelled.push({ id, day: l.ordered_on, stored_revenue: Number(s.revenue_jod), channel: l.sub_channel });
    } else if (Math.abs(Number(s.revenue_jod) - l.revenue_jod) > 0.0005) {
      revenueChanged.push({ id, day: l.ordered_on, was: Number(s.revenue_jod), now: l.revenue_jod });
    }
  }
  const goneFromShopify = [...stored.keys()].filter((id) => !live.has(id));

  const storedLive = liveTotal(stored.values());
  const shopifyLive = liveTotal(live.values());
  const gap = shopifyLive - storedLive;

  console.log("\n=== DRIFT ===\n");
  console.log(`  Dashboard shows      ${jod(storedLive).padStart(14)} JOD over ${n0(liveCount(stored.values()))} orders`);
  console.log(`  Shopify says         ${jod(shopifyLive).padStart(14)} JOD over ${n0(liveCount(live.values()))} orders`);
  console.log(`  Gap                  ${jod(gap).padStart(14)} JOD` +
    (storedLive > 0 ? `  (${((gap / storedLive) * 100).toFixed(2)}%)` : ""));

  console.log(`\n  Newly cancelled since we stored them: ${n0(newlyCancelled.length)}`);
  if (newlyCancelled.length) {
    const byDay = new Map();
    for (const c of newlyCancelled) {
      const d = byDay.get(c.day) ?? { n: 0, rev: 0 };
      d.n++; d.rev += c.stored_revenue;
      byDay.set(c.day, d);
    }
    for (const [day, d] of [...byDay].sort()) {
      const age = Math.round((Date.parse(to) - Date.parse(day)) / 86_400_000);
      console.log(`    ${day}  ${String(d.n).padStart(3)} orders  ${jod(d.rev).padStart(12)} JOD` +
        `   (${age} day${age === 1 ? "" : "s"} after the order)`);
    }
    const over3 = newlyCancelled.filter(
      (c) => (Date.parse(to) - Date.parse(c.day)) / 86_400_000 > 3,
    );
    console.log(`\n    ${n0(over3.length)} of these are more than 3 days old — the nightly sync`);
    console.log(`    re-fetches by CREATED date, so it would never have seen them.`);
  }
  if (revenueChanged.length) {
    console.log(`\n  Revenue changed without cancellation: ${n0(revenueChanged.length)} (refunds or edits)`);
    for (const r of revenueChanged.slice(0, 10)) {
      console.log(`    ${r.day}  order ${r.id}  ${jod(r.was)} -> ${jod(r.now)}`);
    }
    if (revenueChanged.length > 10) console.log(`    ... and ${revenueChanged.length - 10} more`);
  }
  if (missingLocally.length) console.log(`\n  In Shopify but NOT stored: ${n0(missingLocally.length)}`);
  if (goneFromShopify.length) console.log(`  Stored but NOT in Shopify: ${n0(goneFromShopify.length)}`);

  if (baseline) {
    const drop = baseline.totals.live_revenue - shopifyLive;
    console.log(`\n  Against the baseline taken before the change:`);
    console.log(`    then ${jod(baseline.totals.live_revenue)} JOD over ${n0(baseline.totals.live_orders)} orders`);
    console.log(`    now  ${jod(shopifyLive)} JOD over ${n0(liveCount(live.values()))} orders`);
    console.log(`    moved ${jod(-drop)} JOD`);
  }
  console.log("");
  if (!newlyCancelled.length && !revenueChanged.length && !missingLocally.length) {
    log.ok("no drift: stored data matches Shopify for this range");
  } else {
    log.warn("stored data does not match Shopify — the updated_at repair would close this");
  }
} else {
  console.log("pass --snapshot or --compare; see the header of this file");
}
