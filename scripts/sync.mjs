#!/usr/bin/env node
/**
 * Fyxx Insights Hub — data sync.
 *
 *   node scripts/sync.mjs                          trailing 3 days + fresh loyalty snapshot
 *   node scripts/sync.mjs --from 2026-06-01 --to 2026-06-30
 *   node scripts/sync.mjs --from … --to … --dry-run    fetch and report, write nothing
 *   node scripts/sync.mjs --only shopify               one source
 *   node scripts/sync.mjs --from … --to … --force      re-sync days already done
 *
 * Every write is an upsert on a unique index, so re-running any range is safe
 * and never double counts. Backfills resume: days already recorded as a
 * success in sync_log are skipped unless --force is passed.
 */
import { loadEnv, redact } from "./lib/env.mjs";
import { log, money3 } from "./lib/log.mjs";
import { upsert, writeSyncLog, completedDays } from "./lib/db.mjs";
import * as klaviyo from "./lib/klaviyo.mjs";
import * as ll from "./lib/loyaltylion.mjs";
import * as shopify from "./lib/shopify.mjs";

loadEnv();

/* ------------------------------------------------------------------ CLI -- */

function parseArgs(argv) {
  const a = { dryRun: false, force: false, only: null, from: null, to: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--dry-run") a.dryRun = true;
    else if (k === "--force") a.force = true;
    else if (k === "--from") a.from = argv[++i];
    else if (k === "--to") a.to = argv[++i];
    else if (k === "--only") a.only = argv[++i].split(",").map((s) => s.trim());
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  return a;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function ammanToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
}

function shiftDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = shiftDays(d, 1)) out.push(d);
  return out;
}

/* ------------------------------------------------------------- reporting -- */

/** Prints what a dry run would have written, so it can be eyeballed first. */
function preview(table, rows, sampleCols) {
  log.info(`  ${table}: ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  for (const r of rows.slice(0, 3)) {
    const bits = sampleCols.map((c) => `${c}=${r[c]}`).join("  ");
    log.info(`      ${bits}`);
  }
  if (rows.length > 3) log.info(`      … and ${rows.length - 3} more`);
}

/* ------------------------------------------------------------- the sync -- */

async function syncKlaviyo({ from, to, dryRun, force }) {
  const started = Date.now();
  const metricId = await klaviyo.findPlacedOrderMetricId();

  // --- campaigns: one call, send-date basis -------------------------------
  const meta = await klaviyo.fetchCampaignMeta(from, to);
  const campaignResults = await klaviyo.fetchCampaignValues({ from, to, conversionMetricId: metricId });
  const { email: campaignRows, push: campaignPush } = klaviyo.toCampaignRows(campaignResults, meta);

  // --- flows: one call per day, send-date basis ---------------------------
  const days = eachDay(from, to);
  // A dry run touches nothing, not even a read: it must work with no Supabase
  // credentials at all, so the resume ledger is skipped rather than queried.
  const done = force || dryRun ? new Set() : await completedDays("klaviyo_flows", from, to);
  const pending = days.filter((d) => !done.has(d));
  if (done.size) log.info(`resuming: ${done.size} day(s) already synced, ${pending.length} to go`);
  if (pending.length > 2) {
    const mins = Math.ceil((pending.length * 31) / 60);
    log.info(`flow reports are rate limited to 2/min — this will take about ${mins} minute(s)`);
  }

  const flowRows = [];
  const flowPush = [];
  let dayIndex = 0;
  for (const day of pending) {
    dayIndex++;
    const results = await klaviyo.fetchFlowValuesForDay({ day, conversionMetricId: metricId });
    const { flows, push } = klaviyo.toFlowRows(results, day);
    flowRows.push(...flows);
    flowPush.push(...push);

    // Each day is committed and logged as it completes, so an interrupted
    // backfill keeps everything it already fetched.
    if (!dryRun) {
      const w = await upsert("klaviyo_flows", flows, "flow_id,flow_message_id,send_channel,date", { dryRun });
      await upsert("klaviyo_push", push, "source_type,source_id,message_id,sent_on", { dryRun });
      await writeSyncLog(
        { source: "klaviyo_flows", status: "success", rangeStart: day, rangeEnd: day, rowsWritten: w,
          message: `${flows.length} flow rows, ${push.length} push rows` },
        { dryRun },
      );
    }
    log.progress(dayIndex, pending.length, "flow days");
  }

  // --- attributed revenue: event-date basis, a different question ---------
  const attributed = await klaviyo.fetchAttributedRevenueByDay({ from, to, conversionMetricId: metricId });

  const pushRows = [...campaignPush, ...flowPush];

  if (dryRun) {
    log.info("Klaviyo — would write:");
    preview("klaviyo_campaigns", campaignRows, ["name", "sent_on", "sent", "orders", "revenue_jod"]);
    preview("klaviyo_flows", flowRows, ["flow_name", "date", "recipients", "conversions", "revenue_jod"]);
    preview("klaviyo_push", pushRows, ["source_name", "source_type", "sent_on", "sent", "conversions"]);
    const total = [...attributed.values()].reduce((a, b) => a + b, 0);
    log.info(`  attributed revenue (event date): ${money3(total)} JOD across ${attributed.size} days`);
    return { rows: campaignRows.length + flowRows.length + pushRows.length, attributed };
  }

  const cw = await upsert("klaviyo_campaigns", campaignRows, "campaign_id,campaign_message_id", { dryRun });
  const pw = await upsert("klaviyo_push", campaignPush, "source_type,source_id,message_id,sent_on", { dryRun });
  await writeSyncLog(
    { source: "klaviyo_campaigns", status: "success", rangeStart: from, rangeEnd: to, rowsWritten: cw,
      message: `${cw} campaign rows, ${pw} campaign push rows`, durationMs: Date.now() - started },
    { dryRun },
  );
  log.ok(`Klaviyo: ${cw} campaigns, ${flowRows.length} flow rows, ${pushRows.length} push rows`);
  return { rows: cw + flowRows.length + pushRows.length, attributed };
}

async function syncShopify({ from, to, dryRun, attributed }) {
  const started = Date.now();
  const byDay = await shopify.fetchDailySales(from, to);
  const rows = shopify.toSalesRows(byDay, attributed, eachDay(from, to));

  if (dryRun) {
    log.info("Shopify — would write:");
    preview("shopify_daily_sales", rows, ["date", "total_online_revenue_jod", "orders", "klaviyo_attributed_revenue_jod"]);
    return rows.length;
  }
  const w = await upsert("shopify_daily_sales", rows, "date", { dryRun });
  await writeSyncLog(
    { source: "shopify_daily_sales", status: "success", rangeStart: from, rangeEnd: to, rowsWritten: w,
      message: `${w} days of online sales, POS excluded`, durationMs: Date.now() - started },
    { dryRun },
  );
  log.ok(`Shopify: ${w} day rows`);
  return w;
}

async function syncLoyalty({ from, to, dryRun }) {
  const started = Date.now();
  // The snapshot is always "as of today" — LoyaltyLion cannot report historic
  // tier counts, which is the entire reason this table exists.
  const snapshotDate = ammanToday();
  const snap = await ll.fetchSnapshot();

  // Refuses an impossible snapshot before anything else happens. A row of
  // zero tier counts would look like real data and would silently break every
  // "vs prior month" comparison built on top of it.
  ll.assertSnapshotUsable(snap);

  const period = await ll.fetchPeriodActivity(from, to);
  const row = ll.toSnapshotRow(snap, period, snapshotDate);

  if (dryRun) {
    log.info("LoyaltyLion — would write:");
    preview("ll_snapshots", [row], ["snapshot_date", "blue_members", "silver_members", "gold_members", "platinum_members"]);
    log.info(`      points_outstanding=${row.points_outstanding} (≈ ${money3(row.points_outstanding / ll.POINTS_PER_JOD)} JOD liability)`);
    log.info(`      redemptions=${row.redemptions}  birthday_rewards_issued=${row.birthday_rewards_issued}`);
    return 1;
  }
  const w = await upsert("ll_snapshots", [row], "snapshot_date", { dryRun });
  await writeSyncLog(
    { source: "ll_snapshots", status: "success", rangeStart: snapshotDate, rangeEnd: snapshotDate, rowsWritten: w,
      message: `tiers B${row.blue_members}/S${row.silver_members}/G${row.gold_members}/P${row.platinum_members}, ${row.points_outstanding} points outstanding`,
      durationMs: Date.now() - started },
    { dryRun },
  );
  log.ok(`LoyaltyLion: snapshot for ${snapshotDate}`);
  return w;
}

/* ----------------------------------------------------------------- main -- */

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(readmeUsage());
    return;
  }

  const to = args.to ?? ammanToday();
  const from = args.from ?? shiftDays(to, -2); // trailing 3 days inclusive
  if (!isDate(from) || !isDate(to)) throw new Error(`--from/--to must be YYYY-MM-DD (got ${from} … ${to})`);
  if (from > to) throw new Error(`--from (${from}) is after --to (${to})`);

  const sources = args.only ?? ["klaviyo", "shopify", "loyaltylion"];
  const unknown = sources.filter((s) => !["klaviyo", "shopify", "loyaltylion"].includes(s));
  if (unknown.length) throw new Error(`--only: unknown source(s) ${unknown.join(", ")}`);

  preflight(sources, args.dryRun);
  log.info(`range ${from} … ${to}  sources: ${sources.join(", ")}${args.dryRun ? "  [DRY RUN — nothing will be written]" : ""}`);

  const failures = [];
  let attributed = null;
  let totalRows = 0;

  if (sources.includes("klaviyo")) {
    try {
      const r = await syncKlaviyo({ from, to, dryRun: args.dryRun, force: args.force });
      attributed = r.attributed;
      totalRows += r.rows;
    } catch (err) {
      failures.push(["klaviyo", err]);
      log.error(`Klaviyo failed — ${redact(err.message)}`);
      if (!args.dryRun) await writeSyncLog({ source: "klaviyo", status: "error", rangeStart: from, rangeEnd: to, message: redact(String(err.message)).slice(0, 500) }, { dryRun: false });
    }
  }

  if (sources.includes("shopify")) {
    try {
      totalRows += await syncShopify({ from, to, dryRun: args.dryRun, attributed });
    } catch (err) {
      failures.push(["shopify", err]);
      log.error(`Shopify failed — ${redact(err.message)}`);
      if (!args.dryRun) await writeSyncLog({ source: "shopify_daily_sales", status: "error", rangeStart: from, rangeEnd: to, message: redact(String(err.message)).slice(0, 500) }, { dryRun: false });
    }
  }

  if (sources.includes("loyaltylion")) {
    try {
      totalRows += await syncLoyalty({ from, to, dryRun: args.dryRun });
    } catch (err) {
      failures.push(["loyaltylion", err]);
      log.error(`LoyaltyLion failed — ${redact(err.message)}`);
      if (!args.dryRun) await writeSyncLog({ source: "ll_snapshots", status: "error", rangeStart: from, rangeEnd: to, message: redact(String(err.message)).slice(0, 500) }, { dryRun: false });
    }
  }

  if (failures.length) {
    log.error(`${failures.length} of ${sources.length} source(s) failed. Successful sources were still written.`);
    process.exitCode = 1;
  } else {
    log.ok(`done — ${totalRows} rows ${args.dryRun ? "would be written" : "written"} for ${from} … ${to}`);
  }
}

/**
 * Checks every credential the run needs before making a single API call, and
 * reports all the missing ones together. Nothing here prints a key value.
 */
function preflight(sources, dryRun) {
  const required = [];
  if (!dryRun) {
    required.push(["SUPABASE_URL", "Supabase → Project Settings → API → Project URL"]);
    required.push(["SUPABASE_SERVICE_ROLE_KEY", "Supabase → Project Settings → API keys → service_role"]);
  }
  if (sources.includes("klaviyo"))
    required.push(["KLAVIYO_API_KEY", "Klaviyo → Settings → Account → API keys → Create Private API Key (campaigns:read, flows:read, metrics:read)"]);
  const missing = required.filter(([k]) => !process.env[k]);

  // Shopify accepts either the Dev Dashboard client credentials (current) or a
  // legacy shpat_ token, if one still exists from an admin-created custom app.
  if (sources.includes("shopify")) {
    const hasLegacy = Boolean(process.env.SHOPIFY_ADMIN_TOKEN);
    const hasId = Boolean(process.env.SHOPIFY_CLIENT_ID);
    const hasSecret = Boolean(process.env.SHOPIFY_CLIENT_SECRET);
    if (!hasLegacy && !(hasId && hasSecret)) {
      if (hasId !== hasSecret) {
        // Half-configured is worth calling out separately: it is nearly always
        // a paste that missed one of the two fields.
        missing.push([
          hasId ? "SHOPIFY_CLIENT_SECRET" : "SHOPIFY_CLIENT_ID",
          `Shopify Dev Dashboard → Fyxx Insights Hub → ${hasId ? "Client secret" : "Client ID"} (the other half is already set)`,
        ]);
      } else {
        missing.push([
          "SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET",
          "Shopify Dev Dashboard → Fyxx Insights Hub → API credentials (or set a legacy SHOPIFY_ADMIN_TOKEN)",
        ]);
      }
    }
  }

  // LoyaltyLion accepts either the current Bearer key or the deprecated pair.
  if (sources.includes("loyaltylion")) {
    const hasKey = Boolean(process.env.LOYALTYLION_API_KEY);
    const hasPair = Boolean(process.env.LOYALTYLION_TOKEN && process.env.LOYALTYLION_SECRET);
    if (!hasKey && !hasPair) {
      missing.push(["LOYALTYLION_API_KEY", "LoyaltyLion → Manage → API keys (or set LOYALTYLION_TOKEN + LOYALTYLION_SECRET)"]);
    }
  }

  if (missing.length) {
    const lines = missing.map(([k, hint]) => `  • ${k}\n      ${hint}`).join("\n");
    throw new Error(
      `Missing ${missing.length} credential(s):\n${lines}\n\nAdd them to .env (local) or GitHub Secrets (CI). See .env.example.`,
    );
  }
}

function readmeUsage() {
  return `Usage: node scripts/sync.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
                            [--dry-run] [--force] [--only klaviyo,shopify,loyaltylion]

Defaults to the trailing 3 days. See scripts/README.md.`;
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
