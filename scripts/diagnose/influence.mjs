#!/usr/bin/env node
/**
 * Read-only stress test of the marketing-influence claim. Writes nothing.
 *
 *   node scripts/diagnose/influence.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * Answers three objections, in the order someone would raise them:
 *
 *   1. PLACEBO — orders followed by a click within 72h AFTER the order. Those
 *      clicks cannot have caused anything, so that rate is roughly what
 *      coincidence looks like. If before and after are similar, the effect is
 *      mostly people who would have ordered anyway.
 *   2. STABILITY — the same figure month by month. One good month proves little.
 *   3. REPEAT CUSTOMERS — influenced share split by how often the customer
 *      orders. If it is concentrated in people who buy monthly regardless, the
 *      claim weakens.
 */
import { loadEnv } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import * as klaviyo from "../lib/klaviyo.mjs";

loadEnv();

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FROM = argOf("--from", "2025-01-01");
const TO = argOf("--to", "2026-08-28");
const WINDOW_H = 72;

const pct = (a, b) => (b > 0 ? (100 * a) / b : 0);
const n0 = (v) => Math.round(v).toLocaleString("en-US");

async function main() {
  const orderMetric = await klaviyo.findPlacedOrderMetricId();
  const clickMetric = await klaviyo.findMetricIdByName("Clicked Email");

  const pad = (iso, days) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  log.info(`pulling ${FROM} … ${TO} (clicks padded ±7 days for the placebo side)`);
  const clicks = await klaviyo.pullRawEvents(clickMetric, `${pad(FROM, -7)}T00:00:00`, `${pad(TO, 8)}T00:00:00`,
    (e) => ({ p: e.relationships?.profile?.data?.id, t: Date.parse(e.attributes?.datetime) }), "clicks");
  const orders = await klaviyo.pullRawEvents(orderMetric, `${FROM}T00:00:00`, `${pad(TO, 1)}T00:00:00`,
    (e) => ({
      p: e.relationships?.profile?.data?.id,
      t: Date.parse(e.attributes?.datetime),
      v: Number(e.attributes?.event_properties?.$value ?? 0),
      src: e.attributes?.event_properties?.["Source Name"],
    }), "orders");

  const byProfile = new Map();
  for (const c of clicks) {
    if (!c.p || !Number.isFinite(c.t)) continue;
    (byProfile.get(c.p) ?? byProfile.set(c.p, []).get(c.p)).push(c.t);
  }
  for (const a of byProfile.values()) a.sort((x, y) => x - y);

  // Orders per profile, for the repeat-customer split.
  const orderCount = new Map();
  for (const o of orders) if (o.p) orderCount.set(o.p, (orderCount.get(o.p) ?? 0) + 1);

  const H = 3600000;
  const rows = orders.filter((o) => Number.isFinite(o.t)).map((o) => {
    const ca = byProfile.get(o.p) ?? [];
    let before = null, after = null;
    for (const t of ca) {
      if (t <= o.t) before = t;
      else { after = t; break; }
    }
    return {
      ...o,
      month: new Date(o.t).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" }).slice(0, 7),
      hBefore: before === null ? null : (o.t - before) / H,
      hAfter: after === null ? null : (after - o.t) / H,
      freq: orderCount.get(o.p) ?? 0,
    };
  });

  const totalV = rows.reduce((a, r) => a + r.v, 0);
  const inWin = (h) => h !== null && h <= WINDOW_H;

  /* -------------------------------------------------- 1. placebo ------- */
  const beforeR = rows.filter((r) => inWin(r.hBefore));
  const afterR = rows.filter((r) => inWin(r.hAfter));
  const bV = beforeR.reduce((a, r) => a + r.v, 0);
  const aV = afterR.reduce((a, r) => a + r.v, 0);
  console.log(`\n${"=".repeat(74)}\n1. PLACEBO TEST — clicks BEFORE vs AFTER the order (${WINDOW_H}h)\n${"=".repeat(74)}`);
  console.log(`  orders ${n0(rows.length)}, revenue ${n0(totalV)} JOD`);
  console.log(`  click BEFORE order : ${String(beforeR.length).padStart(6)} orders  ${n0(bV).padStart(9)} JOD  ${pct(bV, totalV).toFixed(1)}%`);
  console.log(`  click AFTER  order : ${String(afterR.length).padStart(6)} orders  ${n0(aV).padStart(9)} JOD  ${pct(aV, totalV).toFixed(1)}%  <- coincidence baseline`);
  const lift = pct(bV, totalV) - pct(aV, totalV);
  console.log(`  difference         : ${lift.toFixed(1)} percentage points`);
  console.log(`  ratio before/after : ${aV > 0 ? (bV / aV).toFixed(2) : "n/a"}x`);
  console.log(lift > 3
    ? "  READ: before clearly exceeds the coincidence baseline — the effect looks real."
    : "  READ: before is close to the baseline — most of it may be people who would have ordered anyway.");

  /* ------------------------------------------------ 2. stability ------- */
  console.log(`\n${"=".repeat(74)}\n2. STABILITY — influenced share of revenue, by month\n${"=".repeat(74)}`);
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const shares = [];
  console.log("  month     orders   revenue      influenced   share   placebo");
  for (const m of months) {
    const mr = rows.filter((r) => r.month === m);
    const mv = mr.reduce((a, r) => a + r.v, 0);
    const bi = mr.filter((r) => inWin(r.hBefore)).reduce((a, r) => a + r.v, 0);
    const ai = mr.filter((r) => inWin(r.hAfter)).reduce((a, r) => a + r.v, 0);
    const sh = pct(bi, mv);
    shares.push(sh);
    console.log(`  ${m}  ${String(mr.length).padStart(6)}  ${n0(mv).padStart(9)}  ${n0(bi).padStart(9)}  ${sh.toFixed(1).padStart(6)}%  ${pct(ai, mv).toFixed(1).padStart(6)}%`);
  }
  const mean = shares.reduce((a, b) => a + b, 0) / (shares.length || 1);
  const sd = Math.sqrt(shares.reduce((a, b) => a + (b - mean) ** 2, 0) / (shares.length || 1));
  console.log(`\n  mean ${mean.toFixed(1)}%  sd ${sd.toFixed(1)}pp  range ${Math.min(...shares).toFixed(1)}–${Math.max(...shares).toFixed(1)}%`);
  console.log(sd < mean / 3
    ? "  READ: stable across months — not an artefact of one unusual month."
    : "  READ: swings a lot month to month — treat the headline figure with caution.");

  /* --------------------------------------- 3. repeat customers --------- */
  console.log(`\n${"=".repeat(74)}\n3. REPEAT CUSTOMERS — is the effect concentrated in habitual buyers?\n${"=".repeat(74)}`);
  const monthsSpan = Math.max(1, months.length);
  const buckets = [
    ["one-off (1 order)", (f) => f === 1],
    ["occasional (2–3)", (f) => f >= 2 && f <= 3],
    ["regular (4–11)", (f) => f >= 4 && f <= 11],
    [`habitual (12+, ~monthly over ${monthsSpan}m)`, (f) => f >= 12],
  ];
  console.log("  segment                              orders    revenue   influenced  share");
  for (const [label, test] of buckets) {
    const seg = rows.filter((r) => test(r.freq));
    const sv = seg.reduce((a, r) => a + r.v, 0);
    const si = seg.filter((r) => inWin(r.hBefore)).reduce((a, r) => a + r.v, 0);
    console.log(`  ${label.padEnd(36)} ${String(seg.length).padStart(6)}  ${n0(sv).padStart(9)}  ${n0(si).padStart(9)}  ${pct(si, sv).toFixed(1).padStart(5)}%`);
  }
  const habitual = rows.filter((r) => r.freq >= 12 && inWin(r.hBefore)).reduce((a, r) => a + r.v, 0);
  console.log(`\n  of all influenced revenue, ${pct(habitual, bV).toFixed(1)}% comes from habitual buyers (12+ orders).`);

  /* ------------------------------- draft orders specifically ----------- */
  const draft = rows.filter((r) => /draft|iphone|android/i.test(String(r.src)));
  const dv = draft.reduce((a, r) => a + r.v, 0);
  const di = draft.filter((r) => inWin(r.hBefore)).reduce((a, r) => a + r.v, 0);
  const da = draft.filter((r) => inWin(r.hAfter)).reduce((a, r) => a + r.v, 0);
  console.log(`\n${"=".repeat(74)}\nDRAFT ORDERS (the argument)\n${"=".repeat(74)}`);
  console.log(`  ${n0(draft.length)} orders, ${n0(dv)} JOD`);
  console.log(`  influenced (click before): ${n0(di)} JOD, ${pct(di, dv).toFixed(1)}%`);
  console.log(`  placebo (click after)    : ${n0(da)} JOD, ${pct(da, dv).toFixed(1)}%`);
}

main().catch((e) => { log.error(e); process.exit(1); });
