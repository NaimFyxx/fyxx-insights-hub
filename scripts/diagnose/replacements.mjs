#!/usr/bin/env node
/**
 * Cancel-and-re-place detection. Read-only, writes nothing.
 *
 *   node scripts/diagnose/replacements.mjs [--from 2025-01-01] [--to 2026-08-31]
 *
 * Since the Odoo changeover, an app or website order that needs editing is
 * cancelled and re-placed the same day. If the replacement is created as a
 * draft order, revenue leaves the originating channel and lands in Draft
 * Orders. That is reclassification, not a real channel shift, and every
 * per-channel trend on the dashboard would be partly measuring it.
 *
 * Method: for each cancelled Website or Mobile App order, look for a
 * non-cancelled order from the SAME customer on the SAME Amman day, and grade
 * the match by how close its value is to the cancelled one.
 *
 * Two cautions this script takes seriously:
 *  - Cancelled orders carry a current price of 0.000, so ORIGINAL totals
 *    (totalPriceSet) are used on both sides of every comparison.
 *  - A regular customer ordering twice in a day is not a replacement. Match
 *    quality is reported in bands and the ambiguous ones are counted, never
 *    folded into a single clean number. A pre-changeover baseline is measured
 *    so the practice can be told apart from ordinary repeat buying.
 *
 * Customer ids are used for matching only and never printed.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnv } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { gql, classifySource } from "../lib/shopify.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FROM = argOf("--from", "2025-01-01");
const TO = argOf("--to", "2026-08-31");
const CHANGEOVER = "2026-02";

const j3 = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const n0 = (v) => Math.round(v).toLocaleString("en-US");
const pctOf = (a, b) => (b > 0 ? (100 * a) / b : 0);
const ammanDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

// Channels an order can be moved OUT of by this practice, named by SUB-CHANNEL
// rather than by source id. Mobile App has two source ids (Appmaker now,
// Shopney until August 2025) and naming one of them silently drops the other.
const ORIGIN_SUBS = new Set(["Website", "Mobile App"]);

const ORDERS_QUERY = `
  query ReplacementScan($q: String!, $cursor: String) {
    orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        createdAt
        cancelledAt
        sourceName
        customer { id }
        totalPriceSet { shopMoney { amount } }
      }
    }
  }`;

async function sweep() {
  const q = `created_at:>='${FROM}T00:00:00+03:00' created_at:<='${TO}T23:59:59+03:00'`;
  const orders = [];
  let cursor = null, pages = 0;
  do {
    const data = await gql(ORDERS_QUERY, { q, cursor }, `replacement scan page ${pages + 1}`);
    const conn = data.orders;
    for (const o of conn.nodes ?? []) {
      orders.push({
        id: o.id,
        day: ammanDay(o.createdAt),
        at: Date.parse(o.createdAt),
        cancelled: Boolean(o.cancelledAt),
        cancelledAt: o.cancelledAt ? Date.parse(o.cancelledAt) : null,
        src: classifySource(o.sourceName).source_name,
        sub: classifySource(o.sourceName).sub_channel,
        cust: o.customer?.id ?? null,
        // Original total. The current total of a cancelled order is 0.000.
        value: Number(o.totalPriceSet?.shopMoney?.amount ?? 0),
      });
    }
    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    pages++;
    if (pages % 25 === 0) log.info(`  ${pages} pages, ${orders.length} orders`);
  } while (cursor && pages < 8000);
  log.ok(`${orders.length} orders across ${pages} pages`);
  return orders;
}

const CACHE = argOf("--cache", "");
let orders;
if (CACHE && existsSync(CACHE)) {
  orders = JSON.parse(readFileSync(CACHE, "utf8"));
  log.ok(`${orders.length} orders from cache ${CACHE}`);
} else {
  orders = await sweep();
  if (CACHE) { writeFileSync(CACHE, JSON.stringify(orders)); log.info(`cached to ${CACHE}`); }
}

// Index non-cancelled orders by customer+day so a candidate lookup is O(1).
const liveByCustDay = new Map();
for (const o of orders) {
  if (o.cancelled || !o.cust) continue;
  const k = `${o.cust}|${o.day}`;
  if (!liveByCustDay.has(k)) liveByCustDay.set(k, []);
  liveByCustDay.get(k).push(o);
}

/** Value-similarity bands. Tighter bands are far less likely to be coincidence. */
function band(delta, base) {
  const r = base > 0 ? Math.abs(delta) / base : 1;
  if (r <= 0.02) return "exact";
  if (r <= 0.10) return "close";
  if (r <= 0.30) return "loose";
  return "weak";
}

const cancelled = orders.filter((o) => o.cancelled && ORIGIN_SUBS.has(o.sub));
const results = [];
for (const c of cancelled) {
  if (!c.cust) { results.push({ c, band: "no-customer", cand: null, n: 0 }); continue; }
  const cands = (liveByCustDay.get(`${c.cust}|${c.day}`) ?? []);
  if (!cands.length) { results.push({ c, band: "none", cand: null, n: 0 }); continue; }
  // Best candidate by value proximity.
  let best = null, bestR = Infinity;
  for (const x of cands) {
    // Relative closeness where there is a value to be relative to, absolute
    // difference otherwise, so a zero-total cancellation still picks a nearest.
    const r = c.value > 0 ? Math.abs(x.value - c.value) / c.value : Math.abs(x.value);
    if (r < bestR) { bestR = r; best = x; }
  }
  if (!best) best = cands[0];
  results.push({ c, band: band(best.value - c.value, c.value), cand: best, n: cands.length });
}

// --- 1. how many, and what were they worth ---
const BANDS = ["exact", "close", "loose", "weak", "none", "no-customer"];
const byBand = new Map(BANDS.map((b) => [b, { n: 0, value: 0, multi: 0, after: 0 }]));
for (const r of results) {
  const b = byBand.get(r.band);
  b.n++; b.value += r.c.value;
  if (r.n > 1) b.multi++;
  // Was the replacement created after the original? Supporting, not required:
  // an edit is sometimes re-placed before the original is cancelled.
  if (r.cand && r.cand.at >= r.c.at) b.after++;
}

console.log(`\n=== 1. CANCELLED APP/WEBSITE ORDERS WITH A SAME-DAY SAME-CUSTOMER ORDER ===`);
console.log(`    ${FROM} to ${TO}. Values are ORIGINAL totals.\n`);
console.log(`    ${"match".padEnd(12)} ${"orders".padStart(7)} ${"value JOD".padStart(14)} ${"multi-cand".padStart(11)} ${"repl. later".padStart(12)}`);
let totN = 0, totV = 0;
for (const b of BANDS) {
  const v = byBand.get(b);
  totN += v.n; totV += v.value;
  console.log(`    ${b.padEnd(12)} ${String(v.n).padStart(7)} ${j3(v.value).padStart(14)} ${String(v.multi).padStart(11)} ${String(v.after).padStart(12)}`);
}
console.log(`    ${"TOTAL".padEnd(12)} ${String(totN).padStart(7)} ${j3(totV).padStart(14)}`);

const confident = results.filter((r) => r.band === "exact" || r.band === "close");
const ambiguous = results.filter((r) => r.band === "loose" || r.band === "weak");
const unmatched = results.filter((r) => r.band === "none" || r.band === "no-customer");
console.log(`\n    confident (exact+close): ${confident.length} orders, ${j3(confident.reduce((a, r) => a + r.c.value, 0))} JOD`);
console.log(`    ambiguous (loose+weak) : ${ambiguous.length} orders, ${j3(ambiguous.reduce((a, r) => a + r.c.value, 0))} JOD`);
console.log(`    no same-day order      : ${unmatched.length} orders, ${j3(unmatched.reduce((a, r) => a + r.c.value, 0))} JOD`);

// --- baseline: how often does a NON-cancelled order have a same-day sibling? ---
// If ordinary customers frequently order twice a day, same-day matching alone
// is weak evidence and the confident bands carry the argument.
let baseN = 0, baseHit = 0;
for (const o of orders) {
  if (o.cancelled || !o.cust || !ORIGIN_SUBS.has(o.sub)) continue;
  baseN++;
  if ((liveByCustDay.get(`${o.cust}|${o.day}`) ?? []).length > 1) baseHit++;
}
console.log(`\n    BASE RATE: ${pctOf(baseHit, baseN).toFixed(1)}% of non-cancelled app/web orders have another`);
console.log(`    same-day order from the same customer (${n0(baseHit)} of ${n0(baseN)}).`);
console.log(`    A same-day match is that likely to be coincidence on its own.`);

// --- 2. which channel did the replacement land in ---
console.log(`\n=== 2. WHERE THE REPLACEMENT LANDED (confident matches only) ===\n`);
const landing = new Map();
for (const r of confident) {
  const k = r.cand.sub;
  const v = landing.get(k) ?? { n: 0, value: 0 };
  v.n++; v.value += r.cand.value;
  landing.set(k, v);
}
for (const [k, v] of [...landing].sort((a, b) => b[1].value - a[1].value)) {
  console.log(`    ${k.padEnd(16)} ${String(v.n).padStart(6)} orders  ${j3(v.value).padStart(14)} JOD`);
}

// --- 3. monthly trend ---
console.log(`\n=== 3. MONTHLY TREND ===`);
console.log(`    "cancelled" counts app/web cancellations. "matched" are confident replacements.\n`);
console.log(`    ${"month".padEnd(9)} ${"cancelled".padStart(10)} ${"matched".padStart(8)} ${"rate".padStart(7)} ${"moved JOD".padStart(13)} ${"to drafts".padStart(10)}`);
const months = new Map();
for (const r of results) {
  const m = r.c.day.slice(0, 7);
  const v = months.get(m) ?? { cancelled: 0, matched: 0, value: 0, toDraft: 0 };
  v.cancelled++;
  if (r.band === "exact" || r.band === "close") {
    v.matched++; v.value += r.c.value;
    if (r.cand.sub === "Draft Orders") v.toDraft++;
  }
  months.set(m, v);
}
for (const m of [...months.keys()].sort()) {
  const v = months.get(m);
  const mark = m === CHANGEOVER ? "  <- Odoo changeover" : "";
  console.log(`    ${m.padEnd(9)} ${String(v.cancelled).padStart(10)} ${String(v.matched).padStart(8)} ${(pctOf(v.matched, v.cancelled).toFixed(0) + "%").padStart(7)} ${j3(v.value).padStart(13)} ${String(v.toDraft).padStart(10)}${mark}`);
}

// --- 4. what the originating channels would look like with credit returned ---
console.log(`\n=== 4. WEBSITE AND MOBILE APP WITH REPLACEMENTS CREDITED BACK ===`);
console.log(`    Reported revenue is non-cancelled original totals by channel.`);
console.log(`    Adjusted adds back the cancelled order's value where a confident`);
console.log(`    replacement landed in a DIFFERENT channel.\n`);
const monthly = new Map();
const bump = (m, k, f) => {
  if (!monthly.has(m)) monthly.set(m, { web: 0, app: 0, webAdj: 0, appAdj: 0, draft: 0, draftAdj: 0 });
  const v = monthly.get(m); v[k] += f;
};
for (const o of orders) {
  if (o.cancelled) continue;
  const m = o.day.slice(0, 7);
  if (o.sub === "Website") { bump(m, "web", o.value); bump(m, "webAdj", o.value); }
  else if (o.sub === "Mobile App") { bump(m, "app", o.value); bump(m, "appAdj", o.value); }
  else if (o.sub === "Draft Orders") { bump(m, "draft", o.value); bump(m, "draftAdj", o.value); }
}
for (const r of confident) {
  if (r.cand.sub === r.c.sub) continue; // stayed in its own channel, nothing moved
  const m = r.c.day.slice(0, 7);
  const key = r.c.sub === "Website" ? "webAdj" : "appAdj";
  bump(m, key, r.c.value);
  if (r.cand.sub === "Draft Orders") bump(m, "draftAdj", -r.cand.value);
}
console.log(`    ${"month".padEnd(9)} ${"web rep.".padStart(11)} ${"web adj.".padStart(11)} ${"Δ%".padStart(6)} ${"app rep.".padStart(12)} ${"app adj.".padStart(12)} ${"Δ%".padStart(6)} ${"draft adj.".padStart(12)}`);
for (const m of [...monthly.keys()].sort()) {
  const v = monthly.get(m);
  const dw = pctOf(v.webAdj - v.web, v.web), da = pctOf(v.appAdj - v.app, v.app);
  console.log(`    ${m.padEnd(9)} ${j3(v.web).padStart(11)} ${j3(v.webAdj).padStart(11)} ${(dw.toFixed(1) + "%").padStart(6)} ${j3(v.app).padStart(12)} ${j3(v.appAdj).padStart(12)} ${(da.toFixed(1) + "%").padStart(6)} ${j3(v.draftAdj).padStart(12)}`);
}

// Year-on-year on the same basis, which is the claim the dashboard makes.
const sumRange = (a, b, k) => [...monthly.entries()].filter(([m]) => m >= a && m <= b).reduce((s, [, v]) => s + v[k], 0);
console.log(`\n    Year on year, same months either side:`);
for (const [label, k, kAdj] of [["Website", "web", "webAdj"], ["Mobile App", "app", "appAdj"]]) {
  const cur = sumRange("2026-01", "2026-08", k), prev = sumRange("2025-01", "2025-08", k);
  const curA = sumRange("2026-01", "2026-08", kAdj), prevA = sumRange("2025-01", "2025-08", kAdj);
  console.log(`      ${label.padEnd(11)} reported ${(pctOf(cur - prev, prev)).toFixed(1)}%   adjusted ${(pctOf(curA - prevA, prevA)).toFixed(1)}%`);
}
