#!/usr/bin/env node
/**
 * Does a customer buy more AFTER enrolling than before? Read-only.
 *
 *   node scripts/diagnose/enrolment-effect.mjs [--window 180]
 *
 * A within-customer comparison: each enrolled customer is compared against
 * THEMSELVES either side of their own enrolment date, rather than enrolled
 * people being compared to non-enrolled people. That removes the selection
 * bias in the cross-sectional split, where loyal customers are simply more
 * likely to enrol.
 *
 * IT IS STILL NOT CAUSAL, for one specific reason. Enrolment usually happens
 * AT a purchase, so the "after" window opens at a moment of demonstrated
 * engagement while the "before" window is ordinary time. That biases the
 * result toward improvement no matter what enrolment does.
 *
 * Three things are done about that, none of which make it causal:
 *   - The enrolment-day order is EXCLUDED from both windows. Counting it as
 *     "after" would manufacture most of the effect on its own.
 *   - Customers who enrolled on a day they ordered are reported separately
 *     from those who did not, since only the latter are free of the bias.
 *   - Only customers with a COMPLETE window on both sides are counted, so a
 *     recent enrolment cannot show a short "after" against a long "before".
 */
import { loadEnv, need } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { gql } from "../lib/shopify.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WINDOW = Number(argOf("--window", "180"));
const TODAY = argOf("--today", "2026-08-29");

const n0 = (v) => Math.round(v).toLocaleString("en-US");
const pc = (a, b) => (b > 0 ? ((100 * a) / b).toFixed(1) + "%" : "-");
const dayDiff = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const ammanDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

const url = need("SUPABASE_URL", "").replace(/\/+$/, "");
const key = need("SUPABASE_SERVICE_ROLE_KEY", "");
const enrolled = new Map();
for (let off = 0; ; ) {
  const r = await fetch(
    `${url}/rest/v1/shopify_customers?select=shopify_customer_id,loyalty_enrolled_at,first_order_date,is_house_account` +
    `&loyalty_enrolled=eq.true&loyalty_enrolled_at=not.is.null&limit=1000&offset=${off}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const page = await r.json();
  for (const c of page) {
    if (c.is_house_account) continue;
    enrolled.set(String(c.shopify_customer_id), { at: c.loyalty_enrolled_at, first: c.first_order_date, days: [] });
  }
  if (page.length < 1000) break;
  off += page.length;
}
log.ok(`${enrolled.size} enrolled customers with an enrolment date`);

const Q = `query($q:String!,$cursor:String){ orders(first:250, after:$cursor, query:$q, sortKey:CREATED_AT){
  pageInfo{hasNextPage endCursor} nodes{ createdAt cancelledAt customer{id} } } }`;
let cursor = null, pages = 0, scanned = 0;
do {
  const d = await gql(Q, { q: `created_at:>='2019-01-01T00:00:00+03:00' created_at:<='${TODAY}T23:59:59+03:00'`, cursor },
    `enrolment orders page ${pages + 1}`);
  for (const o of d.orders.nodes ?? []) {
    scanned++;
    if (o.cancelledAt || !o.customer?.id) continue;
    const rec = enrolled.get(String(o.customer.id).split("/").pop());
    if (rec) rec.days.push(ammanDay(o.createdAt));
  }
  cursor = d.orders.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
  pages++;
  if (pages % 100 === 0) log.info(`  ${pages} pages, ${scanned} orders`);
} while (cursor && pages < 8000);
log.ok(`${scanned} orders scanned`);

// Complete windows both sides only.
const usable = [], tooRecent = [], tooNew = [];
for (const [, rec] of enrolled) {
  if (!rec.at || !rec.first) continue;
  if (dayDiff(rec.at, TODAY) < WINDOW) { tooRecent.push(rec); continue; }
  if (dayDiff(rec.first, rec.at) < WINDOW) { tooNew.push(rec); continue; }
  usable.push(rec);
}

let onDay = { n: 0, before: 0, after: 0 }, offDay = { n: 0, before: 0, after: 0 };
for (const rec of usable) {
  const enrolledOnAnOrderDay = rec.days.includes(rec.at);
  let before = 0, after = 0;
  for (const d of rec.days) {
    const delta = dayDiff(rec.at, d);
    if (delta === 0) continue;                      // day zero excluded from both
    if (delta < 0 && delta >= -WINDOW) before++;
    if (delta > 0 && delta <= WINDOW) after++;
  }
  const bucket = enrolledOnAnOrderDay ? onDay : offDay;
  bucket.n++; bucket.before += before; bucket.after += after;
}

console.log(`\n=== ORDERS IN THE ${WINDOW} DAYS EITHER SIDE OF A CUSTOMER'S OWN ENROLMENT ===\n`);
console.log(`  enrolled customers with a date : ${n0(enrolled.size)}`);
console.log(`    excluded, enrolled too recently for a full window : ${n0(tooRecent.length)}`);
console.log(`    excluded, first order too close to enrolment      : ${n0(tooNew.length)}`);
console.log(`    USABLE                                            : ${n0(usable.length)}\n`);
const show = (label, b) => {
  if (!b.n) return console.log(`  ${label}: none`);
  const bp = b.before / b.n, ap = b.after / b.n;
  console.log(`  ${label}`);
  console.log(`    customers ${n0(b.n)}   before ${bp.toFixed(2)} orders/customer   after ${ap.toFixed(2)}   ` +
    `change ${bp > 0 ? ((ap - bp) / bp * 100).toFixed(1) + "%" : "n/a"}`);
};
show("enrolled ON a day they ordered  (biased: engagement moment)", onDay);
show("enrolled on a day they did NOT order  (cleaner)", offDay);
console.log(`\n  The second group is the one to read. The first has its "after" window`);
console.log(`  opening at a purchase, which inflates it regardless of what enrolment does.`);
console.log(`  Neither is causal: enrolment is chosen, not assigned.`);
