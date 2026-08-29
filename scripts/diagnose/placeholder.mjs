#!/usr/bin/env node
/**
 * "Shopify Draft (No Customer)" — how much revenue cannot be attributed to a
 * person, and did it contaminate the click-influence work? Read-only.
 *
 *   node scripts/diagnose/placeholder.mjs [--from 2025-01-01] [--to 2026-08-31]
 *
 * The Odoo integration requires a customer on every order, so staff attach a
 * placeholder customer when there is no real one. Those orders cannot be
 * attributed to anybody. The concern that prompted this: klaviyo_order_influence
 * joins clicks to orders by Klaviyo PROFILE, so if hundreds of draft orders
 * shared one placeholder profile, a single click by that profile would appear
 * to precede all of them, or none.
 *
 * Result, measured rather than assumed: the placeholder carries a small
 * minority of drafts, and it has no measurable effect on influence because the
 * placeholder customer has no email address, so Klaviyo has no real profile for
 * it and almost none of its orders generate an event at all.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnv, need } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { gql, classifySource } from "../lib/shopify.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FROM = argOf("--from", "2025-01-01");
const TO = argOf("--to", "2026-08-31");
const CACHE = argOf("--cache", "");
const CHANGEOVER = "2026-02-27";

const j3 = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const pc = (a, b) => (b > 0 ? ((100 * a) / b).toFixed(1) + "%" : "-");
const ammanDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

/** Find the placeholder by name rather than hardcoding an id. */
async function findPlaceholder() {
  const d = await gql(
    `query($q:String!){ customers(first:10, query:$q){ nodes{ id displayName email numberOfOrders } } }`,
    { q: "Shopify Draft" }, "find placeholder customer",
  );
  const hit = (d.customers.nodes ?? []).find((c) => /draft.*no customer/i.test(c.displayName ?? ""));
  if (!hit) { log.warn("placeholder customer not found by name"); return null; }
  log.ok(`placeholder: ${hit.displayName} (${String(hit.id).split("/").pop()}), email=${hit.email ?? "NONE"}`);
  if (!hit.email) {
    log.info("  No email. Klaviyo profiles are keyed on email or phone, so this");
    log.info("  customer has no real profile and most of its orders never reach Klaviyo.");
  }
  return hit.id;
}

const ORDERS_QUERY = `
  query($q:String!,$cursor:String){ orders(first:250, after:$cursor, query:$q, sortKey:CREATED_AT){
    pageInfo{hasNextPage endCursor}
    nodes{ id legacyResourceId createdAt cancelledAt sourceName customer{id}
           totalPriceSet{shopMoney{amount}} } } }`;

async function sweep() {
  const q = `created_at:>='${FROM}T00:00:00+03:00' created_at:<='${TO}T23:59:59+03:00'`;
  const out = []; let cursor = null, pages = 0;
  do {
    const data = await gql(ORDERS_QUERY, { q, cursor }, `placeholder scan page ${pages + 1}`);
    for (const o of data.orders.nodes ?? []) {
      out.push({
        id: String(o.legacyResourceId), day: ammanDay(o.createdAt),
        cancelled: Boolean(o.cancelledAt), sub: classifySource(o.sourceName).sub_channel,
        cust: o.customer?.id ?? null, value: Number(o.totalPriceSet?.shopMoney?.amount ?? 0),
      });
    }
    cursor = data.orders.pageInfo?.hasNextPage ? data.orders.pageInfo.endCursor : null;
    pages++;
    if (pages % 25 === 0) log.info(`  ${pages} pages, ${out.length} orders`);
  } while (cursor && pages < 8000);
  log.ok(`${out.length} orders`);
  return out;
}

const PH = await findPlaceholder();
let orders;
if (CACHE && existsSync(CACHE)) { orders = JSON.parse(readFileSync(CACHE, "utf8")); log.ok(`${orders.length} orders from cache`); }
else { orders = await sweep(); if (CACHE) writeFileSync(CACHE, JSON.stringify(orders)); }

const isPh = (o) => PH && o.cust === PH;
const live = orders.filter((o) => !o.cancelled);

// --- 1. share by channel ---
console.log("\n=== 1. UNATTRIBUTABLE ORDERS BY CHANNEL ===\n");
console.log("  " + "channel".padEnd(14) + "orders".padStart(8) + "placeholder".padStart(12) + "no customer".padStart(13) + "neither ident.".padStart(15) + "revenue JOD".padStart(15));
const bySub = new Map();
for (const o of live) {
  const v = bySub.get(o.sub) ?? { n: 0, ph: 0, none: 0, val: 0, unVal: 0 };
  v.n++; v.val += o.value;
  if (isPh(o)) { v.ph++; v.unVal += o.value; } else if (!o.cust) { v.none++; v.unVal += o.value; }
  bySub.set(o.sub, v);
}
for (const [k, v] of [...bySub].sort((a, b) => b[1].val - a[1].val)) {
  console.log("  " + k.padEnd(14) + String(v.n).padStart(8) + String(v.ph).padStart(12) + String(v.none).padStart(13) +
    pc(v.ph + v.none, v.n).padStart(15) + j3(v.val).padStart(15));
}

// --- 2. monthly trend on drafts ---
console.log("\n=== 2. DRAFT ORDERS BY MONTH ===\n");
console.log("  " + "month".padEnd(9) + "drafts".padStart(8) + "placeholder".padStart(13) + "no cust".padStart(9) + "unattributable".padStart(16));
const m = new Map();
for (const o of live) {
  if (o.sub !== "Draft Orders") continue;
  const k = o.day.slice(0, 7);
  const v = m.get(k) ?? { n: 0, ph: 0, none: 0 };
  v.n++; if (isPh(o)) v.ph++; else if (!o.cust) v.none++;
  m.set(k, v);
}
for (const k of [...m.keys()].sort()) {
  const v = m.get(k);
  console.log("  " + k.padEnd(9) + String(v.n).padStart(8) + String(v.ph).padStart(13) + String(v.none).padStart(9) +
    pc(v.ph + v.none, v.n).padStart(16) + (k === CHANGEOVER.slice(0, 7) ? "  <- Odoo changeover" : ""));
}

// --- 3. POS either side of the definition change ---
console.log("\n=== 3. POS, EITHER SIDE OF " + CHANGEOVER + " ===\n");
for (const label of ["before", "after"]) {
  const set = live.filter((o) => o.sub === "POS" && ((o.day >= CHANGEOVER) === (label === "after")));
  const noCust = set.filter((o) => !o.cust);
  const ph = set.filter(isPh);
  console.log(`  ${label.padEnd(7)} ${String(set.length).padStart(6)} orders   placeholder ${ph.length}   no customer ${String(noCust.length).padStart(5)} (${pc(noCust.length, set.length)})`);
}

// --- 4. did it contaminate the influence work? ---
const url = need("SUPABASE_URL", "").replace(/\/+$/, "");
const key = need("SUPABASE_SERVICE_ROLE_KEY", "");
const inf = []; let offset = 0;
for (;;) {
  const res = await fetch(`${url}/rest/v1/klaviyo_order_influence?select=order_id,hours_since_click,revenue_jod&limit=1000&offset=${offset}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  const page = await res.json();
  inf.push(...page);
  if (page.length < 1000) break;
  offset += page.length;
}
const byId = new Map(orders.map((o) => [o.id, o]));
console.log(`\n=== 4. INFLUENCE CONTAMINATION (${inf.length} rows) ===\n`);
const groups = new Map();
for (const r of inf) {
  const o = byId.get(String(r.order_id));
  if (!o) continue;
  const who = isPh(o) ? "placeholder" : !o.cust ? "no customer" : "real customer";
  const k = `${o.sub} / ${who}`;
  const v = groups.get(k) ?? { n: 0, w: 0, rev: 0 };
  v.n++; v.rev += Number(r.revenue_jod);
  if (r.hours_since_click !== null) v.w++;
  groups.set(k, v);
}
console.log("  " + "channel / identity".padEnd(32) + "orders".padStart(8) + "prior click".padStart(13) + "rate".padStart(8) + "revenue JOD".padStart(15));
for (const [k, v] of [...groups].sort()) {
  console.log("  " + k.padEnd(32) + String(v.n).padStart(8) + String(v.w).padStart(13) + pc(v.w, v.n).padStart(8) + j3(v.rev).padStart(15));
}
const dr = [...groups].filter(([k]) => k.startsWith("Draft Orders"));
const agg = (f) => dr.filter(f).reduce((a, [, v]) => ({ n: a.n + v.n, w: a.w + v.w }), { n: 0, w: 0 });
const all = agg(() => true), noPh = agg(([k]) => !k.endsWith("placeholder"));
console.log("\n  Draft Orders click-influence rate:");
console.log(`    including placeholder : ${all.w}/${all.n} = ${pc(all.w, all.n)}`);
console.log(`    excluding placeholder : ${noPh.w}/${noPh.n} = ${pc(noPh.w, noPh.n)}`);
