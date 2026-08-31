#!/usr/bin/env node
/**
 * LoyaltyLion's /v2/orders as a THIRD view of every order.
 *
 *   node scripts/diagnose/verify-loyaltylion-orders.mjs [--days 30]
 *
 * This is a verification exercise, not a data source. Nothing is written.
 *
 * Everything the dashboard knows about orders comes from one place: our own
 * Shopify sweep. If that sweep mis-maps a channel or misses a cancellation,
 * no amount of internal cross-checking finds it, because every internal figure
 * derives from the same read. LoyaltyLion ingests orders independently through
 * its own Shopify integration, so where it agrees the agreement means
 * something, and where it disagrees one of us is wrong.
 *
 * Three claims are checked, in rising order of how much they would cost:
 *
 *   1. CANCELLATION   `cancellation_status` against our `cancelled_at`.
 *   2. REFUNDS        `total_refunded` against the gap between LoyaltyLion's
 *                     order total and the revenue we store, which is Shopify's
 *                     currentTotalPrice and therefore already net of refunds.
 *   3. CHANNEL        `metadata.shopify_source_name` run through our own
 *                     SOURCE_MAP. This is the valuable one: the +831.8% Mobile
 *                     App error was a source-mapping fault, and nothing inside
 *                     our own data could have caught it.
 *
 * Agreement everywhere is a real result, not a boring one.
 */
import { loadEnv } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { classifySource } from "../lib/shopify.mjs";
import { selectAll } from "../lib/db.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DAYS = Number(argOf("--days", 30));
if (!Number.isFinite(DAYS) || DAYS <= 0) throw new Error(`--days must be positive, got ${DAYS}`);

const H = { Authorization: `Bearer ${process.env.LOYALTYLION_API_KEY}`, accept: "application/json" };
const BASE = "https://api.loyaltylion.com/v2";
const n0 = (v) => Math.round(v).toLocaleString("en-US");
const num = (v) => Number(v ?? 0);

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
const from = new Date(Date.parse(today) - DAYS * 86_400_000).toISOString().slice(0, 10);
log.info(`comparing LoyaltyLion /v2/orders against shopify_orders, ${from} to ${today}`);

// Page the endpoint. Read cursor.next from the BODY: the Link header lists
// rel="previous" before rel="next", and a naive regex grabs the wrong one —
// that mistake once produced 45,000 rows from a 21,264-row population.
const ll = new Map();
let cursor = null, pages = 0;
do {
  const url =
    `${BASE}/orders?limit=250` +
    `&created_at_min=${encodeURIComponent(`${from}T00:00:00+03:00`)}` +
    `&created_at_max=${encodeURIComponent(`${today}T23:59:59+03:00`)}` +
    (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
  const res = await fetch(url, { headers: H });
  if (!res.ok) throw new Error(`LoyaltyLion /orders HTTP ${res.status}`);
  const j = await res.json();
  for (const o of j.orders ?? []) ll.set(String(o.merchant_id), o);
  cursor = j.cursor?.next ?? null;
  pages++;
} while (cursor && pages < 400);
log.ok(`${n0(ll.size)} order(s) from LoyaltyLion over ${pages} page(s)`);

// The filter is proven the same way the snapshot path proves it: by checking
// the DATES of what came back, not by trusting a 200.
//
// The window is expressed in Amman time (+03:00) and LoyaltyLion answers in
// UTC, so the comparison must convert before comparing. Slicing the first ten
// characters off a UTC timestamp reports an order placed at 00:30 Amman on the
// 1st as 2026-07-31 and accuses the API of ignoring a filter it honoured —
// which is exactly what the first version of this check did.
const ammanDay = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" }) : "";
const outOfRange = [...ll.values()].filter((o) => {
  const d = ammanDay(o.created_at);
  return d && (d < from || d > today);
});
if (outOfRange.length) {
  throw new Error(
    `LoyaltyLion ignored the date filter on /orders — ${outOfRange.length} of ${ll.size} ` +
      `records fall outside ${from}..${today} (e.g. ${String(outOfRange[0].created_at).slice(0, 10)}).`,
  );
}
log.ok(`date filter honoured — every record inside ${from}..${today}`);

const ours = new Map(
  (
    await selectAll(
      "shopify_orders",
      `select=order_id,ordered_on,revenue_jod,cancelled_at,sub_channel,source_name` +
        `&ordered_on=gte.${from}&ordered_on=lte.${today}`,
    )
  ).map((r) => [String(r.order_id), r]),
);
log.ok(`${n0(ours.size)} order(s) in shopify_orders over the same range`);

const both = [...ll.keys()].filter((id) => ours.has(id));
const onlyLL = [...ll.keys()].filter((id) => !ours.has(id));
const onlyOurs = [...ours.keys()].filter((id) => !ll.has(id));

const cancelMismatch = [];
const refundMismatch = [];
const channelMismatch = [];
const unmappedSource = new Map();

for (const id of both) {
  const l = ll.get(id), s = ours.get(id);

  const llCancelled = String(l.cancellation_status ?? "") === "cancelled";
  const weCancelled = s.cancelled_at !== null;
  if (llCancelled !== weCancelled) {
    cancelMismatch.push({ id, ll: l.cancellation_status, ours: weCancelled ? "cancelled" : "live",
      day: s.ordered_on });
  }

  // BOTH figures are already NET of refunds, so they compare directly.
  //
  // The first version of this check subtracted `total_refunded` from
  // `total` and compared that — which double-counted every refund and
  // manufactured 21 disagreements out of 21 agreements. Order 7936312180983
  // is the proof: LoyaltyLion reports total 0 with 140 refunded, Shopify
  // reports currentTotalPrice 0, and we store 0. All three agree that nothing
  // was kept. "0 − 140 = −140" was arithmetic, not a finding.
  //
  // This is the same shape as the points-liability trap in lib/loyaltylion.mjs:
  // a current balance and a lifetime counter look interchangeable and are not.
  const refunded = num(l.total_refunded);
  if (Math.abs(num(l.total) - num(s.revenue_jod)) > 0.01) {
    refundMismatch.push({ id, day: s.ordered_on, llTotal: num(l.total), refunded,
      ours: num(s.revenue_jod) });
  }

  const llSource = l.metadata?.shopify_source_name ?? null;
  if (llSource) {
    const mapped = classifySource(llSource).sub_channel;
    if (mapped === "Unknown") {
      unmappedSource.set(llSource, (unmappedSource.get(llSource) ?? 0) + 1);
    } else if (mapped !== s.sub_channel) {
      channelMismatch.push({ id, day: s.ordered_on, llSource, mapped, ours: s.sub_channel,
        oursSource: s.source_name });
    }
  }
}

const pc = (a, b) => (b > 0 ? `${((100 * a) / b).toFixed(2)}%` : "-");
console.log("\n=== COVERAGE ===\n");
console.log(`  in both systems          ${n0(both.length).padStart(7)}`);
console.log(`  LoyaltyLion only         ${n0(onlyLL.length).padStart(7)}   ${pc(onlyLL.length, ll.size)} of its orders`);
console.log(`  ours only                ${n0(onlyOurs.length).padStart(7)}   ${pc(onlyOurs.length, ours.size)} of ours`);
console.log(`\n  LoyaltyLion sees ${pc(both.length, ours.size)} of our orders. It ingests through its own`);
console.log(`  Shopify integration, so a shortfall is its coverage, not our gap.`);

const section = (title, rows, render, note) => {
  console.log(`\n=== ${title}: ${rows.length === 0 ? "NO DISAGREEMENT" : `${n0(rows.length)} DISAGREE`} ===\n`);
  if (note) console.log(`  ${note}\n`);
  for (const r of rows.slice(0, 15)) console.log("  " + render(r));
  if (rows.length > 15) console.log(`  … and ${n0(rows.length - 15)} more`);
};

section("CANCELLATION", cancelMismatch,
  (r) => `${r.day}  order ${r.id}  LoyaltyLion=${r.ll}  ours=${r.ours}`,
  "Ours is netted at read time, so a cancellation we have not re-swept shows here.");

section("ORDER VALUE", refundMismatch,
  (r) => `${r.day}  order ${r.id}  LoyaltyLion=${r.llTotal.toFixed(3)}  ours=${r.ours.toFixed(3)}` +
    (r.refunded > 0 ? `   (${r.refunded.toFixed(3)} refunded)` : ""),
  "Both sides are net of refunds, so these compare directly. A gap means one side has not seen a refund or an edit the other has.");

section("CHANNEL", channelMismatch,
  (r) => `${r.day}  order ${r.id}  LL source "${r.llSource}" → ${r.mapped}   ours=${r.ours} (from "${r.oursSource}")`,
  "The independent check on SOURCE_MAP. Both sides map the same source name through OUR table, so a mismatch means the two systems disagree about the source itself.");

if (unmappedSource.size) {
  console.log(`\n=== SOURCE NAMES OUR MAP DOES NOT KNOW: ${unmappedSource.size} ===\n`);
  for (const [k, v] of [...unmappedSource].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(k).padEnd(28)} ${n0(v)} order(s)`);
  }
  console.log(`\n  Resolve these before trusting any channel figure — this is exactly`);
  console.log(`  the fault that produced the +831.8% Mobile App error.`);
}

const faults = cancelMismatch.length + refundMismatch.length + channelMismatch.length + unmappedSource.size;
console.log("\n=== VERDICT ===\n");
if (faults === 0) {
  console.log(`  ${n0(both.length)} orders checked on three independent claims — cancellation,`);
  console.log(`  refunds and channel — and LoyaltyLion agrees with us on every one.`);
  console.log(`  Agreement across two systems that read Shopify separately is the`);
  console.log(`  strongest evidence available that our sweep is correct.\n`);
} else {
  console.log(`  ${n0(faults)} disagreement(s). Each is one of us being wrong; neither`);
  console.log(`  system is automatically right.\n`);
}
process.exit(0);
