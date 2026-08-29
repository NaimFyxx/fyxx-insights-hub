#!/usr/bin/env node
/**
 * Which Shopify orders is Klaviyo blind to? Read-only, writes nothing.
 *
 *   node scripts/diagnose/coverage.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * Klaviyo saw ~43,500 distinct orders against ~51,000 non-cancelled Shopify
 * orders. If the missing ones skew to one channel, every per-channel
 * percentage computed from Klaviyo data is wrong in a direction we have not
 * established. If they skew by ORDER VALUE, the revenue-based percentages move
 * even when the count-based ones look fine.
 */
import { loadEnv, need } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import * as shopify from "../lib/shopify.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FROM = argOf("--from", "2025-01-01");
const TO = argOf("--to", "2026-08-28");

const n0 = (v) => Math.round(v).toLocaleString("en-US");
const pct = (a, b) => (b > 0 ? (100 * a) / b : 0);

async function klaviyoOrderIds() {
  const url = need("SUPABASE_URL", "").replace(/\/+$/, "");
  const key = need("SUPABASE_SERVICE_ROLE_KEY", "");
  const ids = new Set();
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${url}/rest/v1/klaviyo_order_influence?select=order_id&date=gte.${FROM}&date=lte.${TO}&limit=1000&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) throw new Error(`supabase ${res.status}`);
    const rows = await res.json();
    for (const r of rows) ids.add(String(r.order_id));
    // Advance by what the SERVER returned, not what we asked for. PostgREST
    // silently caps a page at 1000 regardless of the limit requested, so
    // "fewer rows than I asked for means the end" stops after one page and
    // reports 98% of orders missing.
    if (rows.length === 0) break;
    offset += rows.length;
    if (offset > 500000) throw new Error("pagination did not terminate");
  }
  return ids;
}

async function main() {
  log.info("reading Klaviyo-visible order ids from Supabase…");
  const seen = await klaviyoOrderIds();
  log.ok(`${n0(seen.size)} order ids known to Klaviyo`);

  log.info("pulling Shopify orders…");
  const orders = await shopify.pullOrderIdentity(FROM, TO);
  log.ok(`${n0(orders.length)} non-cancelled Shopify orders`);

  const byChannel = new Map();
  const bucketOf = (v) =>
    v < 25 ? "under 25" : v < 50 ? "25–50" : v < 100 ? "50–100" : v < 250 ? "100–250" : v < 500 ? "250–500" : "500+";
  const byValue = new Map();

  let matched = 0, missing = 0, missingRev = 0, totalRev = 0;
  for (const o of orders) {
    const hit = seen.has(String(o.id));
    totalRev += o.amount;
    const c = byChannel.get(o.sub_channel) ?? { n: 0, miss: 0, rev: 0, missRev: 0 };
    c.n++; c.rev += o.amount;
    if (hit) matched++;
    else { missing++; missingRev += o.amount; c.miss++; c.missRev += o.amount; }
    byChannel.set(o.sub_channel, c);

    const b = bucketOf(o.amount);
    const v = byValue.get(b) ?? { n: 0, miss: 0 };
    v.n++; if (!hit) v.miss++;
    byValue.set(b, v);
  }

  console.log(`\n${"=".repeat(78)}\nCOVERAGE — Shopify orders Klaviyo cannot see\n${"=".repeat(78)}`);
  console.log(`  Shopify orders   ${n0(orders.length)}   ${n0(totalRev)} JOD`);
  console.log(`  seen by Klaviyo  ${n0(matched)}   (${pct(matched, orders.length).toFixed(1)}%)`);
  console.log(`  MISSING          ${n0(missing)}   (${pct(missing, orders.length).toFixed(1)}%)   ${n0(missingRev)} JOD (${pct(missingRev, totalRev).toFixed(1)}% of revenue)`);

  console.log(`\n  by channel — does the blind spot skew?`);
  console.log(`    channel          orders    missing   miss%     revenue   missing rev   miss rev%`);
  for (const [ch, c] of [...byChannel].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `    ${ch.padEnd(14)} ${String(c.n).padStart(8)} ${String(c.miss).padStart(10)} ${pct(c.miss, c.n).toFixed(1).padStart(6)}% ${n0(c.rev).padStart(11)} ${n0(c.missRev).padStart(13)} ${pct(c.missRev, c.rev).toFixed(1).padStart(10)}%`,
    );
  }

  console.log(`\n  by order value — does the blind spot skew by size?`);
  const order = ["under 25", "25–50", "50–100", "100–250", "250–500", "500+"];
  for (const b of order) {
    const v = byValue.get(b);
    if (!v) continue;
    console.log(`    ${b.padEnd(10)} ${String(v.n).padStart(8)} orders   ${String(v.miss).padStart(7)} missing   ${pct(v.miss, v.n).toFixed(1).padStart(6)}%`);
  }

  const rates = [...byChannel.values()].map((c) => pct(c.miss, c.n));
  const spread = Math.max(...rates) - Math.min(...rates);
  console.log(
    `\n  READ: channel miss-rate spread is ${spread.toFixed(1)} percentage points. ` +
      (spread > 10
        ? "Large — per-channel percentages from Klaviyo data are skewed and must be corrected or caveated."
        : "Small — the blind spot is roughly even, so per-channel percentages are not materially distorted."),
  );
}

main().catch((e) => { log.error(e); process.exit(1); });
