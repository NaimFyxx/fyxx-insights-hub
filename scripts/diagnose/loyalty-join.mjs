#!/usr/bin/env node
/**
 * Join LoyaltyLion enrolment onto shopify_customers via merchant_id.
 *
 *   node scripts/diagnose/loyalty-join.mjs [--write]
 *
 * merchant_id IS the Shopify customer id, matched at 99.8%. No email needed,
 * which matters because only 79% of LoyaltyLion customers have one.
 *
 * ONLY updates customers we already hold. LoyaltyLion has 21,264 customers
 * against Shopify's 19,163, so a blind upsert INSERTS about 2,400 rows with a
 * loyalty tier and nothing else — no orders, no created date, no consent. Those
 * inflate the population and deflate every "share of customers" figure computed
 * from it. This is a UPDATE-only join by construction.
 *
 * Two paginations exist and only one is right. The response BODY carries
 * `cursor.next`; the Link header lists rel="previous" BEFORE rel="next" from
 * page two onward, so matching /cursor=/ walks backwards and the pagination
 * ping-pongs — 45,000 rows out of a 21,264 population.
 */
import { loadEnv, need } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { upsert } from "../lib/db.mjs";

loadEnv();
const WRITE = process.argv.includes("--write");
const url = need("SUPABASE_URL", "").replace(/\/+$/, "");
const key = need("SUPABASE_SERVICE_ROLE_KEY", "");
const sb = (p) => fetch(`${url}/rest/v1/${p}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });

// The customers we actually hold. Anything outside this set is not ours to add.
const known = new Set();
for (let off = 0; ; ) {
  const res = await sb(`shopify_customers?select=shopify_customer_id&limit=1000&offset=${off}`);
  const page = await res.json();
  for (const r of page) known.add(String(r.shopify_customer_id));
  if (page.length < 1000) break;
  off += page.length;
}
log.ok(`${known.size} Shopify customers on file`);

const H = { Authorization: `Bearer ${need("LOYALTYLION_API_KEY", "")}`, accept: "application/json" };
let cursor = null, pages = 0, seen = 0, matched = [], unmatched = 0;
while (pages < 300) {
  const u = new URL("https://api.loyaltylion.com/v2/customers");
  u.searchParams.set("limit", "250");
  if (cursor) u.searchParams.set("cursor", cursor);
  const r = await fetch(u, { headers: H });
  if (!r.ok) { log.error(`LoyaltyLion HTTP ${r.status}`); break; }
  const j = await r.json();
  for (const c of j.customers ?? []) {
    seen++;
    const id = c.merchant_id ? String(c.merchant_id) : null;
    if (!id || !known.has(id)) { unmatched++; continue; }
    matched.push({
      shopify_customer_id: id,
      loyalty_enrolled: Boolean(c.enrolled),
      loyalty_tier: c.loyalty_tier_membership?.loyalty_tier?.name ?? null,
      loyalty_points: Number(c.points_approved ?? 0),
    });
  }
  cursor = j.cursor?.next ?? null;   // body, never the Link header
  pages++;
  if (pages % 20 === 0) log.info(`  ${pages} pages, ${seen} customers`);
  if (!cursor) break;
}
log.ok(`${seen} LoyaltyLion customers, ${matched.length} matched to a Shopify customer`);
log.info(`  ${unmatched} had no Shopify counterpart and were SKIPPED, not inserted`);
log.info(`  enrolled among matched: ${matched.filter((m) => m.loyalty_enrolled).length}`);

if (!WRITE) { log.info("read-only; pass --write to update"); process.exit(0); }
const w = await upsert("shopify_customers", matched, "shopify_customer_id", {});
log.ok(`updated ${w}`);
