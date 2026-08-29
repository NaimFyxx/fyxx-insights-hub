#!/usr/bin/env node
/**
 * What changes AFTER we store it? Read-only, writes nothing.
 *
 *   node scripts/diagnose/mutation.mjs [--from 2025-01-01] [--to 2026-08-31]
 *                                      [--cache path.json] [--reach-days d1,d2]
 *
 * The nightly sync re-reads a trailing 3 days. Anything older that changes is
 * never corrected. This measures the three ways that actually bites:
 *
 *   1. Orders cancelled or refunded more than 3 days after being placed. Those
 *      days are never revisited, so stored revenue keeps counting them.
 *   2. Klaviyo profile merges against klaviyo_reach_daily. The table stores
 *      hashed profile ids per day. If a merge rewrites the profile on
 *      historical events, the stored set holds ids Klaviyo no longer reports
 *      and unique reach stays overstated, drifting further with every merge.
 *      That is the headline number on the report, so it is worth knowing.
 *   3. Klaviyo campaign statistics maturing after the send. Opens and clicks
 *      accrue for days; a campaign captured within 3 days of sending may be
 *      stored before its numbers settle.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnv, need } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { gql, classifySource } from "../lib/shopify.mjs";
import { fetchDailyReach, resolveReachMetricIds, fetchCampaignValues, findMetricIdByName } from "../lib/klaviyo.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FROM = argOf("--from", "2025-01-01");
const TO = argOf("--to", "2026-08-31");
const CACHE = argOf("--cache", "");
const REACH_DAYS = argOf("--reach-days", "").split(",").filter(Boolean);
const DAY = 86400000;
const TRAILING = 3;

const j3 = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const pc = (a, b) => (b > 0 ? ((100 * a) / b).toFixed(1) + "%" : "-");
const ammanDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
const url = need("SUPABASE_URL", "").replace(/\/+$/, "");
const key = need("SUPABASE_SERVICE_ROLE_KEY", "");
const sb = (path) => fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });

/* ---------- 1. late cancellations ---------- */
const Q = `query($q:String!,$cursor:String){ orders(first:250, after:$cursor, query:$q, sortKey:CREATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{ legacyResourceId createdAt cancelledAt sourceName totalPriceSet{shopMoney{amount}} } } }`;

async function sweep() {
  const q = `created_at:>='${FROM}T00:00:00+03:00' created_at:<='${TO}T23:59:59+03:00'`;
  const out = []; let cursor = null, pages = 0;
  do {
    const d = await gql(Q, { q, cursor }, `mutation scan page ${pages + 1}`);
    for (const o of d.orders.nodes ?? []) out.push({
      day: ammanDay(o.createdAt), at: Date.parse(o.createdAt),
      cancelled: Boolean(o.cancelledAt), cancelledAt: o.cancelledAt ? Date.parse(o.cancelledAt) : null,
      sub: classifySource(o.sourceName).sub_channel,
      value: Number(o.totalPriceSet?.shopMoney?.amount ?? 0),
    });
    cursor = d.orders.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
    pages++;
    if (pages % 25 === 0) log.info(`  ${pages} pages, ${out.length} orders`);
  } while (cursor && pages < 8000);
  return out;
}

let orders;
if (CACHE && existsSync(CACHE)) { orders = JSON.parse(readFileSync(CACHE, "utf8")); log.ok(`${orders.length} orders from cache`); }
else { orders = await sweep(); if (CACHE) writeFileSync(CACHE, JSON.stringify(orders)); log.ok(`${orders.length} orders`); }

const canc = orders.filter((o) => o.cancelled && o.cancelledAt);
const late = canc.filter((o) => (o.cancelledAt - o.at) / DAY > TRAILING);
console.log(`\n=== 1. CANCELLED MORE THAN ${TRAILING} DAYS AFTER BEING PLACED ===\n`);
console.log(`  all cancellations      : ${canc.length}, ${j3(canc.reduce((a, o) => a + o.value, 0))} JOD`);
console.log(`  beyond the window      : ${late.length} (${pc(late.length, canc.length)}), ${j3(late.reduce((a, o) => a + o.value, 0))} JOD`);
console.log(`  These days are never revisited, so stored revenue still counts them.\n`);
console.log("  " + "month placed".padEnd(14) + "late cancels".padStart(13) + "value JOD".padStart(15));
const m = new Map();
for (const o of late) { const k = o.day.slice(0, 7); const v = m.get(k) ?? { n: 0, val: 0 }; v.n++; v.val += o.value; m.set(k, v); }
for (const k of [...m.keys()].sort()) console.log("  " + k.padEnd(14) + String(m.get(k).n).padStart(13) + j3(m.get(k).val).padStart(15));

/* ---------- 2. reach set drift ---------- */
if (REACH_DAYS.length) {
  console.log(`\n=== 2. REACH SETS vs KLAVIYO TODAY ===\n`);
  const metricIds = await resolveReachMetricIds();
  console.log("  " + "day / channel / source".padEnd(34) + "stored".padStart(8) + "now".padStart(7) + "gone".padStart(7) + "new".padStart(6));
  let tS = 0, tG = 0, tN = 0;
  for (const day of REACH_DAYS) {
    const stored = await (await sb(`klaviyo_reach_daily?select=channel,source,profile_hashes&date=eq.${day}`)).json();
    if (!stored.length) { console.log(`  ${day}: not stored, skipped`); continue; }
    const fresh = await fetchDailyReach(day, metricIds);
    for (const s of stored) {
      const f = fresh.find((x) => x.channel === s.channel && x.source === s.source);
      const A = new Set(s.profile_hashes.map(Number)), B = new Set((f?.profile_hashes ?? []).map(Number));
      const gone = [...A].filter((h) => !B.has(h)).length, added = [...B].filter((h) => !A.has(h)).length;
      tS += A.size; tG += gone; tN += added;
      console.log("  " + `${day} ${s.channel}/${s.source}`.padEnd(34) + String(A.size).padStart(8) + String(B.size).padStart(7) + String(gone).padStart(7) + String(added).padStart(6));
    }
  }
  console.log(`\n  ${tS} stored ids compared: ${tG} gone, ${tN} new.`);
  if (!tG && !tN) log.ok("  No merge drift on these days.");
  else log.warn(`  Unique reach overstated by about ${((tG / tS) * 100).toFixed(2)}% on these days.`);
}

/* ---------- 3. campaign stat maturation ---------- */
console.log(`\n=== 3. CAMPAIGN STATS: STORED vs KLAVIYO TODAY ===\n`);
const cm = await findMetricIdByName("Placed Order");
const fresh = await fetchCampaignValues({ from: FROM, to: TO, conversionMetricId: cm });
const stored = await (await sb(`klaviyo_campaigns?select=campaign_id,campaign_message_id,name,opened,clicked,orders,revenue_jod&sent_on=gte.${FROM}&sent_on=lte.${TO}`)).json();
let dO = 0, dC = 0, dOr = 0, dR = 0, n = 0;
for (const s of stored) {
  const f = fresh.find((x) => x.campaignId === s.campaign_id && x.messageId === s.campaign_message_id);
  if (!f) continue;
  n++;
  dO += (f.s.opens_unique ?? 0) - s.opened; dC += (f.s.clicks_unique ?? 0) - s.clicked;
  dOr += (f.s.conversions ?? 0) - s.orders; dR += (f.s.conversion_value ?? 0) - Number(s.revenue_jod);
}
console.log(`  ${n} campaigns compared. Net change since stored:`);
console.log(`    opens ${dO >= 0 ? "+" : ""}${dO}   clicks ${dC >= 0 ? "+" : ""}${dC}   orders ${dOr >= 0 ? "+" : ""}${dOr}   revenue ${dR >= 0 ? "+" : ""}${dR.toFixed(3)} JOD`);
if (!dO && !dC && !dOr && Math.abs(dR) < 0.001) log.ok("  Stored campaign stats still match Klaviyo exactly.");
