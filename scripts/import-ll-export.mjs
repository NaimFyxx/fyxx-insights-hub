#!/usr/bin/env node
/**
 * One-off import of LoyaltyLion's points accounting export.
 *
 *   node scripts/import-ll-export.mjs path/to/export.csv --dry-run
 *   node scripts/import-ll-export.mjs path/to/export.csv
 *
 * LoyaltyLion's REST API exposes no programme-level accounting endpoint
 * (/v2/metrics, /v2/analytics, /v2/insights, /v2/reports all 404), so a year
 * of history can only come from their export. This backfills
 * ll_snapshots.points_outstanding plus the movement columns.
 *
 * Rows written here are marked points_source='ll_export' and are AUTHORITATIVE:
 * they are LoyaltyLion's own end-of-day close, not our derived nightly scan.
 * Tier counts are left untouched — they cannot be reconstructed historically,
 * which is exactly why the nightly snapshot exists.
 */
import { readFileSync } from "node:fs";
import { loadEnv } from "./lib/env.mjs";
import { log } from "./lib/log.mjs";
import { upsert, writeSyncLog } from "./lib/db.mjs";

loadEnv();

/** Column headings as the export ships them, mapped to our columns. */
const COLUMNS = {
  "Date": "snapshot_date",
  "Earned Points": "points_earned",
  "Earned Points Reversed": "points_earned_reversed",
  "Redeemed Points": "points_redeemed",
  "Redeemed Points Reimbursed": "points_redeemed_reimbursed",
  "Expired Points": "points_expired",
  "Total Outstanding Points (Start of Day)": "points_outstanding_start",
  "Total Outstanding Points (End of Day)": "points_outstanding",
};

/** Minimal RFC4180-ish parser: handles quoted fields and embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const num = (v) => {
  const cleaned = String(v ?? "").replace(/[,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Accepts YYYY-MM-DD, DD/MM/YYYY and D MMM YYYY, all of which exports use. */
function parseDate(v) {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) throw new Error("Usage: node scripts/import-ll-export.mjs <export.csv> [--dry-run]");

  const rows = parseCsv(readFileSync(path, "utf8"));
  if (!rows.length) throw new Error(`${path} is empty`);

  const header = rows[0].map((h) => h.trim());
  const missing = Object.keys(COLUMNS).filter((c) => !header.includes(c));
  if (missing.length) {
    throw new Error(
      `Columns not found in ${path}:\n  ${missing.join("\n  ")}\n\nHeader was:\n  ${header.join(" | ")}`,
    );
  }
  const index = Object.fromEntries(Object.entries(COLUMNS).map(([csv, col]) => [col, header.indexOf(csv)]));

  const out = [];
  const skipped = [];
  for (const r of rows.slice(1)) {
    const date = parseDate(r[index.snapshot_date]);
    if (!date) { skipped.push(r[index.snapshot_date]); continue; }
    const row = { snapshot_date: date, points_source: "ll_export" };
    for (const [col, i] of Object.entries(index)) {
      if (col === "snapshot_date") continue;
      row[col] = num(r[i]);
    }
    if (row.points_outstanding == null) { skipped.push(`${date} (no end-of-day figure)`); continue; }
    out.push(row);
  }

  out.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  log.ok(`parsed ${out.length} day(s): ${out[0]?.snapshot_date} … ${out.at(-1)?.snapshot_date}`);
  if (skipped.length) log.warn(`skipped ${skipped.length} unparseable row(s): ${skipped.slice(0, 5).join(", ")}`);

  // Arithmetic check: start + earned - reversed - redeemed + reimbursed - expired
  // should land on the end-of-day figure. A mismatch means a column moved.
  let mismatches = 0;
  for (const r of out) {
    if (r.points_outstanding_start == null) continue;
    const derived =
      r.points_outstanding_start + (r.points_earned ?? 0) - (r.points_earned_reversed ?? 0) -
      (r.points_redeemed ?? 0) + (r.points_redeemed_reimbursed ?? 0) - (r.points_expired ?? 0);
    if (Math.abs(derived - r.points_outstanding) > 1) mismatches++;
  }
  if (mismatches) {
    log.warn(`${mismatches} of ${out.length} day(s) do not reconcile from their own movement columns.`);
    log.warn("The end-of-day figure is still used as written; this only flags a possible column mismatch.");
  } else {
    log.ok("every day reconciles from its own movement columns");
  }

  // Continuity: a gap means missing days, which would show as a flat line.
  const gaps = [];
  for (let i = 1; i < out.length; i++) {
    const prev = new Date(`${out[i - 1].snapshot_date}T12:00:00Z`);
    const cur = new Date(`${out[i].snapshot_date}T12:00:00Z`);
    const days = Math.round((cur - prev) / 864e5);
    if (days !== 1) gaps.push(`${out[i - 1].snapshot_date} -> ${out[i].snapshot_date} (${days}d)`);
  }
  if (gaps.length) log.warn(`${gaps.length} gap(s) in the series: ${gaps.slice(0, 5).join(", ")}`);
  else log.ok("the series is continuous, no missing days");

  if (dryRun) {
    log.info("");
    log.info("DRY RUN — would upsert into ll_snapshots (tier counts untouched):");
    for (const r of [out[0], out[Math.floor(out.length / 2)], out.at(-1)].filter(Boolean)) {
      log.info(`  ${r.snapshot_date}  outstanding=${r.points_outstanding?.toLocaleString("en-US")}  ` +
        `earned=${r.points_earned?.toLocaleString("en-US")}  redeemed=${r.points_redeemed?.toLocaleString("en-US")}  ` +
        `expired=${r.points_expired?.toLocaleString("en-US")}`);
    }
    log.info(`  … ${out.length} rows total`);
    return;
  }

  const started = Date.now();
  const written = await upsert("ll_snapshots", out, "snapshot_date", { dryRun: false });
  await writeSyncLog(
    { source: "ll_snapshots_export", status: "success", rangeStart: out[0].snapshot_date,
      rangeEnd: out.at(-1).snapshot_date, rowsWritten: written,
      message: `imported ${written} days of LoyaltyLion points accounting`, durationMs: Date.now() - started },
    { dryRun: false },
  );
  log.ok(`imported ${written} day(s) of points accounting`);
}

main().catch((err) => { log.error(err); process.exit(1); });
