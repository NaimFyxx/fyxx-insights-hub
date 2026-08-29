#!/usr/bin/env node
/**
 * Build customer_identity: one row per person, holding the id each system
 * knows them by. Read-only unless --write.
 *
 *   node scripts/diagnose/identity.mjs [--write]
 *
 * Neither edge uses email, and both are hard keys:
 *
 *   LoyaltyLion -> Shopify   `merchant_id` IS the Shopify customer id.
 *   Klaviyo     -> Shopify   derived through ORDERS. A Placed Order event
 *                            carries the profile and the Shopify order id; the
 *                            order carries the customer.
 *
 * Two populations are counted that the identity rows themselves cannot show:
 *
 *   CONFLICTS — a Klaviyo profile whose orders belong to several Shopify
 *   customers. Either two customers have not been merged yet, or Klaviyo merged
 *   two people who should not have been. The COUNT OVER TIME is the point: a
 *   flat rate means merging is keeping pace, a rising one means it stopped or
 *   something upstream is making more duplicates.
 *
 *   UNLINKED — Klaviyo profiles with no order at all, so nothing to route a
 *   link through. That is the subscriber population that has never bought, a
 *   different problem from the unreachable BUYERS on the customer page.
 */
import { loadEnv, need } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { gql } from "../lib/shopify.mjs";
import { pullRawEvents, findMetricIdByName } from "../lib/klaviyo.mjs";
import { upsert } from "../lib/db.mjs";

loadEnv();
const WRITE = process.argv.includes("--write");
const FROM = "2025-01-01";                 // Klaviyo's own data does not predate this
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
const n0 = (v) => Math.round(v).toLocaleString("en-US");
const pc = (a, b) => (b > 0 ? ((100 * a) / b).toFixed(1) + "%" : "-");

const url = need("SUPABASE_URL", "").replace(/\/+$/, "");
const key = need("SUPABASE_SERVICE_ROLE_KEY", "");
const sb = (p) => fetch(`${url}/rest/v1/${p}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });

/* ---- the customers we hold, and their LoyaltyLion id ---- */
const known = new Set();
for (let off = 0; ; ) {
  const page = await (await sb(`shopify_customers?select=shopify_customer_id&limit=1000&offset=${off}`)).json();
  for (const r of page) known.add(String(r.shopify_customer_id));
  if (page.length < 1000) break;
  off += page.length;
}
log.ok(`${n0(known.size)} Shopify customers on file`);

/* ---- LoyaltyLion edge: merchant_id, a hard key ---- */
const llById = new Map();
{
  const H = { Authorization: `Bearer ${need("LOYALTYLION_API_KEY", "")}`, accept: "application/json" };
  let cursor = null, pages = 0;
  while (pages < 300) {
    const u = new URL("https://api.loyaltylion.com/v2/customers");
    u.searchParams.set("limit", "250");
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await fetch(u, { headers: H });
    if (!r.ok) { log.error(`LoyaltyLion HTTP ${r.status}`); break; }
    const j = await r.json();
    for (const c of j.customers ?? []) {
      if (c.merchant_id && known.has(String(c.merchant_id))) llById.set(String(c.merchant_id), String(c.id));
    }
    cursor = j.cursor?.next ?? null;   // body, never the Link header
    pages++;
    if (!cursor) break;
  }
}
log.ok(`${n0(llById.size)} LoyaltyLion ids matched to a Shopify customer`);

/* ---- Klaviyo edge: through orders ---- */
const orderToCustomer = new Map();
{
  const Q = `query($q:String!,$cursor:String){ orders(first:250, after:$cursor, query:$q, sortKey:CREATED_AT){
    pageInfo{hasNextPage endCursor} nodes{ legacyResourceId customer{id} } } }`;
  let cursor = null, pages = 0;
  do {
    const d = await gql(Q, { q: `created_at:>='${FROM}T00:00:00+03:00' created_at:<='${TODAY}T23:59:59+03:00'`, cursor },
      `identity orders page ${pages + 1}`);
    for (const o of d.orders.nodes ?? []) {
      if (o.customer?.id) orderToCustomer.set(String(o.legacyResourceId), String(o.customer.id).split("/").pop());
    }
    cursor = d.orders.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
    pages++;
    if (pages % 100 === 0) log.info(`  ${pages} order pages`);
  } while (cursor && pages < 8000);
}
log.ok(`${n0(orderToCustomer.size)} orders carry a customer`);

const placed = await findMetricIdByName("Placed Order");
const events = await pullRawEvents(placed, `${FROM}T00:00:00`, `${TODAY}T23:59:59`,
  (e) => ({ profile: e.relationships?.profile?.data?.id,
            orderId: String(e.attributes?.event_properties?.$event_id ?? "") }),
  "identity placed orders");

const profileToCustomers = new Map();
for (const e of events) {
  if (!e.profile) continue;
  const cust = orderToCustomer.get(e.orderId);
  if (!cust) continue;
  if (!profileToCustomers.has(e.profile)) profileToCustomers.set(e.profile, new Map());
  const m = profileToCustomers.get(e.profile);
  m.set(cust, (m.get(cust) ?? 0) + 1);
}
const profilesSeen = new Set(events.map((e) => e.profile).filter(Boolean));

// The TOTAL contact base, which the events cannot give.
//
// Counting "unlinked" from Placed Order events is circular: every profile in
// that set has an order by construction, so it returns almost zero. The real
// question — how many subscribers have never bought — needs the whole contact
// base, which lives on the "All contacts" segment.
let totalProfiles = 0;
try {
  const kh = { Authorization: `Klaviyo-API-Key ${need("KLAVIYO_API_KEY", "")}`,
               revision: "2026-07-15", accept: "application/vnd.api+json" };
  const segs = await (await fetch("https://a.klaviyo.com/api/segments", { headers: kh })).json();
  const all = (segs.data ?? []).find((s) => /^all contacts$/i.test(s.attributes?.name ?? ""));
  if (all) {
    const one = await (await fetch(
      `https://a.klaviyo.com/api/segments/${all.id}?additional-fields%5Bsegment%5D=profile_count`,
      { headers: kh })).json();
    totalProfiles = Number(one.data?.attributes?.profile_count ?? 0);
  }
  if (!totalProfiles) log.warn('no "All contacts" segment found; unlinked count will be understated');
} catch (e) { log.warn(`could not read the contact total: ${e.message}`); }

const withOrder = profileToCustomers.size;
const unlinked = Math.max(0, totalProfiles - withOrder);

/* ---- rows, and the conflicts ---- */
const rows = new Map();
const conflicts = [];
for (const [profile, custs] of profileToCustomers) {
  if (custs.size > 1) {
    conflicts.push({
      klaviyo_profile_id: profile,
      shopify_customer_ids: [...custs.keys()],
      order_count: [...custs.values()].reduce((a, b) => a + b, 0),
      detected_at: new Date().toISOString(),
    });
    continue;   // ambiguous: linking it would assert something untrue
  }
  const [cust, n] = [...custs.entries()][0];
  if (!known.has(cust)) continue;
  rows.set(cust, { shopify_customer_id: cust, klaviyo_profile_id: profile,
                   loyaltylion_id: llById.get(cust) ?? null,
                   matched_how: "order_id", klaviyo_order_matches: n,
                   last_confirmed_at: new Date().toISOString() });
}
// LoyaltyLion-only people: known by loyalty but with no Klaviyo order link.
for (const [cust, llId] of llById) {
  if (rows.has(cust)) continue;
  rows.set(cust, { shopify_customer_id: cust, klaviyo_profile_id: null, loyaltylion_id: llId,
                   matched_how: "merchant_id", klaviyo_order_matches: 0,
                   last_confirmed_at: new Date().toISOString() });
}

const withKlaviyo = [...rows.values()].filter((r) => r.klaviyo_profile_id).length;
const withLL = [...rows.values()].filter((r) => r.loyaltylion_id).length;

console.log(`\n=== IDENTITY ===\n`);
console.log(`  identity rows                 : ${n0(rows.size)}`);
console.log(`    with a Klaviyo profile      : ${n0(withKlaviyo)}  ${pc(withKlaviyo, rows.size)}`);
console.log(`    with a LoyaltyLion id       : ${n0(withLL)}  ${pc(withLL, rows.size)}`);
console.log(`    with both                   : ${n0([...rows.values()].filter((r) => r.klaviyo_profile_id && r.loyaltylion_id).length)}`);
console.log(`\n  CONFLICTS (profile -> several customers): ${n0(conflicts.length)}`);
for (const c of conflicts.slice(0, 8)) {
  console.log(`    ${c.klaviyo_profile_id}  ->  ${c.shopify_customer_ids.length} customers, ${c.order_count} orders`);
}
console.log(`\n  Klaviyo contacts, all           : ${n0(totalProfiles)}`);
console.log(`  with an order since ${FROM}   : ${n0(withOrder)}  ${pc(withOrder, totalProfiles)}`);
console.log(`  UNLINKED, no order in window   : ${n0(unlinked)}  ${pc(unlinked, totalProfiles)}`);
console.log(`    Subscribers with nothing to link through. Note the window: a`);
console.log(`    profile that bought in 2023 and not since counts as unlinked, so`);
console.log(`    this is "no order since ${FROM}" and NOT "never bought".`);

if (!WRITE) { log.info("\nread-only; pass --write"); process.exit(0); }
const w = await upsert("customer_identity", [...rows.values()], "shopify_customer_id", {});
const cw = conflicts.length ? await upsert("identity_conflicts", conflicts, "klaviyo_profile_id", {}) : 0;
const sw = await upsert("identity_snapshots", [{
  measured_on: TODAY,
  shopify_customers: known.size,
  linked_klaviyo: withKlaviyo,
  linked_loyaltylion: withLL,
  conflicts: conflicts.length,
  klaviyo_profiles_seen: totalProfiles,
  klaviyo_unlinked: unlinked,
}], "measured_on", {});
log.ok(`wrote ${w} identity, ${cw} conflict(s), ${sw} snapshot`);
