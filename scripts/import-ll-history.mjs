#!/usr/bin/env node
/**
 * Import the LoyaltyLion CSV exports: activities, transactions, rewards.
 *
 *   node scripts/import-ll-history.mjs --dir "/path/to/exports" [--dry-run]
 *
 * These are ONE-OFF imports of a point-in-time export. Activities and
 * transactions are immutable event history so they stay correct, but they stop
 * at the export's last date and do not extend. Every row therefore carries a
 * `source` naming the export it came from, on the same principle as
 * ll_snapshots.points_source, and ll_import_coverage reports the span so no
 * reader has to remember that a figure is imported rather than live.
 *
 * Three distinct start dates now exist across the project and none of them is
 * the start of the business:
 *   Shopify orders   2019-09-09
 *   LL activities    2023-02-21
 *   Klaviyo          2025-01-01
 *   LL rewards       2025-08-04
 * A range spanning any of those boundaries must show an ABSENCE, never a zero.
 *
 * The files are read where they are. They are never copied into the repo.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./lib/env.mjs";
import { log } from "./lib/log.mjs";
import { upsert } from "./lib/db.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = argOf("--dir", "");
const DRY = args.includes("--dry-run");
if (!DIR || !existsSync(DIR)) {
  log.error("Pass --dir pointing at the export folder. The files are read in place, never copied.");
  process.exit(1);
}

/** Minimal RFC-4180 parser: the exports contain commas and quotes in notes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.replace(/^﻿/, "").trim());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function find(prefix) {
  const f = readdirSync(DIR).find((x) => x.startsWith(prefix) && x.endsWith(".csv"));
  if (!f) throw new Error(`no export found starting "${prefix}" in ${DIR}`);
  return { path: join(DIR, f), name: f };
}

const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const int = (v) => Math.round(num(v));
const day = (v) => (v ? String(v).slice(0, 10) : null);
// LoyaltyLion writes offsets as "+00", which Date.parse REJECTS — it wants
// "+00:00". Left unhandled every timestamp parsed to null, which then made the
// rewards key collapse to (customer, null, title) and manufacture 894
// collisions out of a file that has none. Normalise before parsing.
const ts = (v) => {
  const s = String(v ?? "").trim().replace(/([+-]\d{2})$/, "$1:00");
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) { badTimestamps++; return null; }
  return new Date(t).toISOString();
};
let badTimestamps = 0;
const txt = (v) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

/** The export's own filename carries the date it was taken. */
const sourceTag = (name) => {
  const m = name.match(/_(\d{8})\d*_from_(\d{8})_to_(\d{8})/);
  return m ? `ll_export_${m[1]}` : `ll_export_${name.slice(0, 24)}`;
};

let total = 0;
for (const [prefix, table, conflict, map] of [
  ["customeractivities", "ll_activities", "activity_id", (r, src) => ({
    activity_id: String(r["Activity ID"]),
    ll_customer_id: String(r["Customer ID"]),
    shopify_order_id: txt(r["Order Reference"]),
    kind: r["Activity Kind"] || "unknown",
    detail: txt(r["Activity Detail"]),
    state: r["State"] || "unknown",
    initial_points: int(r["Initial Points"]),
    points_remaining: int(r["Points Remaining"]),
    points_expired: int(r["Points Expired"]),
    activity_date: day(r["Activity Date"]),
    expires_at: day(r["Projected Expiration"]),
    pre_enrollment: String(r["Pre-Enrollment Purchase"]).toUpperCase() === "TRUE",
    source: src,
  })],
  ["customertransactions", "ll_transactions", "transaction_id", (r, src) => ({
    transaction_id: String(r["Transaction ID"]),
    ll_customer_id: String(r["Customer ID"]),
    shopify_order_id: txt(r["Order ID"]),
    resource: r["Resource"] || "unknown",
    activity_title: txt(r["Activity Title"]),
    flow_title: txt(r["Flow Title"]),
    points_approved: int(r["Points Approved"]),
    points_pending: int(r["Points Pending"]),
    occurred_at: ts(r["Created At"]),
    source: src,
  })],
  ["rewards", "ll_rewards", "ll_customer_id,claimed_at,title", (r, src) => ({
    ll_customer_id: String(r["Customer ID"]),
    claimed_at: ts(r["Claimed At"]),
    title: r["Title"] || "(untitled)",
    cost_points: int(r["Cost"]),
    state: r["State"] || "unknown",
    discount_type: txt(r["Discount Type"]),
    amount: num(r["Amount"]),
    first_used_at: ts(r["First Used At"]),
    order_total_jod: num(r["Order Total"]),
    used_with_orders: txt(r["Used With Order Numbers"]),
    expires_at: ts(r["Expires At"]),
    source: src,
  })],
]) {
  const { path, name } = find(prefix);
  const src = sourceTag(name);
  const raw = parseCsv(readFileSync(path, "utf8"));
  const rows = raw.map((r) => map(r, src)).filter((r) => Object.values(r)[0]);

  // The rewards key is composite and has no natural id, so collisions are
  // possible. Report them rather than letting the upsert silently keep one.
  const seen = new Set(), dupes = [];
  for (const r of rows) {
    const k = conflict.split(",").map((c) => r[c.trim()]).join("|");
    if (seen.has(k)) dupes.push(k); else seen.add(k);
  }

  const dates = rows.map((r) => r.activity_date ?? r.occurred_at ?? r.claimed_at).filter(Boolean).sort();
  if (badTimestamps) {
    log.error(`   ${badTimestamps} timestamp(s) failed to parse. Refusing: a null date silently corrupts the key.`);
    process.exit(1);
  }
  if (!dates.length) {
    log.error("   no parseable dates in this file. Refusing rather than importing undated rows.");
    process.exit(1);
  }
  log.info(`${table}: ${rows.length} row(s) from ${name}`);
  log.info(`   source tag "${src}", covers ${String(dates[0]).slice(0, 10)} .. ${String(dates[dates.length - 1]).slice(0, 10)}`);
  if (dupes.length) log.warn(`   ${dupes.length} duplicate key(s) on (${conflict}) — collapsed, NOT a surrogate id`);

  if (DRY) { log.info("   dry run, nothing written"); continue; }
  const w = await upsert(table, rows, conflict, { dryRun: false });
  log.ok(`   wrote ${w}`);
  total += w;
}
log.ok(`${total} row(s) imported. Query ll_import_coverage to see what each table covers.`);
