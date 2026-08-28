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
import { upsert, writeSyncLog, completedDays, previousSnapshot } from "./lib/db.mjs";
import * as klaviyo from "./lib/klaviyo.mjs";
import * as ll from "./lib/loyaltylion.mjs";
import * as shopify from "./lib/shopify.mjs";

loadEnv();

/* ------------------------------------------------------------------ CLI -- */

function parseArgs(argv) {
  const a = { dryRun: false, force: false, only: null, from: null, to: null, maxDays: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--dry-run") a.dryRun = true;
    else if (k === "--force") a.force = true;
    else if (k === "--from") a.from = argv[++i];
    else if (k === "--to") a.to = argv[++i];
    else if (k === "--only") a.only = argv[++i].split(",").map((s) => s.trim());
    else if (k === "--max-days") {
      a.maxDays = Number(argv[++i]);
      if (!Number.isFinite(a.maxDays) || a.maxDays < 0) throw new Error("--max-days must be 0 or a positive number");
    }
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
    // A column absent from the payload is deliberately not written; say so
    // rather than printing "undefined", which reads like a bug.
    const bits = sampleCols
      .map((c) => `${c}=${c in r ? r[c] : "(left unchanged)"}`)
      .join("  ");
    log.info(`      ${bits}`);
  }
  if (rows.length > 3) log.info(`      … and ${rows.length - 3} more`);
}

/* ------------------------------------------------------------- the sync -- */

async function syncKlaviyo({ from, to, dryRun, force, maxDays }) {
  const started = Date.now();
  const metricId = await klaviyo.findPlacedOrderMetricId();

  // --- campaigns: one call, send-date basis -------------------------------
  const meta = await klaviyo.fetchCampaignMeta(from, to);
  // Klaviyo rejects a timeframe over a year, so a multi-year backfill is split.
  const chunks = klaviyo.chunkRange(from, to);
  if (chunks.length > 1) log.info(`range exceeds Klaviyo's 1-year timeframe limit — split into ${chunks.length} chunk(s)`);

  const campaignResults = [];
  for (const c of chunks) {
    if (chunks.length > 1) log.info(`  campaign values ${c.from} … ${c.to}`);
    campaignResults.push(...(await klaviyo.fetchCampaignValues({ ...c, conversionMetricId: metricId })));
  }
  const { email: campaignRows, push: campaignPush } = klaviyo.toCampaignRows(campaignResults, meta);

  // --- flows: one call per day, send-date basis ---------------------------
  const days = eachDay(from, to);
  // A dry run touches nothing, not even a read: it must work with no Supabase
  // credentials at all, so the resume ledger is skipped rather than queried.
  const done = force || dryRun ? new Set() : await completedDays("klaviyo_flows", from, to);
  const allPending = days.filter((d) => !done.has(d));

  // Klaviyo allows 225 values-report calls per day. A long backfill therefore
  // has to span several runs. --max-days caps how many flow days one run
  // attempts, so the nightly Action can chip away at a backfill automatically
  // instead of someone remembering to re-trigger it.
  // `maxDays` of 0 is meaningful: do the campaign and attribution calls but no
  // flow days at all. A truthiness check would read 0 as "no cap" and attempt
  // the entire range — the exact opposite.
  const pending = Number.isFinite(maxDays) ? allPending.slice(0, Math.max(0, maxDays)) : allPending;
  const deferred = allPending.length - pending.length;

  if (done.size) log.info(`resuming: ${done.size} day(s) already synced`);
  if (pending.length) {
    const mins = Math.ceil((pending.length * 31) / 60);
    log.info(`${pending.length} flow day(s) this run, ~${mins} minute(s) at 2 calls/min`);
  }
  if (deferred > 0) {
    const runs = maxDays > 0 ? Math.ceil(deferred / maxDays) : null;
    log.warn(
      `${deferred} day(s) deferred to later runs` +
        (runs ? ` (~${runs} more run(s) to finish the backfill)` : " (flows skipped entirely this run)"),
    );
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

  if (deferred > 0) {
    log.warn(`backfill INCOMPLETE: ${deferred} flow day(s) still outstanding after this run.`);
    log.warn("  The nightly Action continues automatically; nothing to trigger by hand.");
  } else if (allPending.length) {
    log.ok("backfill complete for this range — no flow days outstanding");
  }

  // --- attributed revenue: event-date basis, a different question ---------
  const attributed = new Map();
  for (const c of chunks) {
    if (chunks.length > 1) log.info(`  attributed revenue ${c.from} … ${c.to}`);
    const part = await klaviyo.fetchAttributedRevenueByDay({ ...c, conversionMetricId: metricId });
    for (const [d, v] of part) attributed.set(d, v);
  }

  // Attributed revenue is a whole-account, order-date figure. It is written
  // to its own table because it cannot be split by Shopify sales channel.
  const attributedRows = [...attributed.entries()].map(([date, revenue]) => ({
    date,
    revenue_jod: money3(revenue),
  }));

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

  const aw = await upsert("klaviyo_attributed_daily", attributedRows, "date", { dryRun });
  const cw = await upsert("klaviyo_campaigns", campaignRows, "campaign_id,campaign_message_id", { dryRun });
  const pw = await upsert("klaviyo_push", campaignPush, "source_type,source_id,message_id,sent_on", { dryRun });
  await writeSyncLog(
    { source: "klaviyo_campaigns", status: "success", rangeStart: from, rangeEnd: to, rowsWritten: cw,
      message: `${cw} campaign rows, ${pw} campaign push rows`, durationMs: Date.now() - started },
    { dryRun },
  );
  log.ok(`Klaviyo: ${cw} campaigns, ${flowRows.length} flow rows, ${pushRows.length} push rows, ${aw} attributed day(s)`);
  return { rows: cw + flowRows.length + pushRows.length, attributed };
}

/**
 * Unique reach. Slow — roughly two minutes per day — because it walks every
 * send event to collect distinct profiles. Runs one day at a time and resumes,
 * exactly like the flow reports, so a long backfill spans several nights.
 */
/** Monthly gross margin from Shopify's own analytics. One query per year. */
async function syncMargin({ from, to, dryRun }) {
  const started = Date.now();
  const rows = await shopify.fetchMonthlyMargin(from, to);
  if (dryRun) {
    log.info("Margin — would write:");
    preview("shopify_margin_monthly", rows, ["month", "sub_channel", "net_sales_jod", "gross_profit_jod"]);
    for (const r of rows.slice(0, 3)) {
      const m = r.net_sales_jod > 0 ? (100 * r.gross_profit_jod / r.net_sales_jod).toFixed(1) : "-";
      log.info(`      ${r.month} ${r.sub_channel.padEnd(13)} margin ${m}%  from [${r.source_channels.join(", ")}]`);
    }
    return rows.length;
  }
  const w = await upsert("shopify_margin_monthly", rows, "month,sub_channel", { dryRun });
  await writeSyncLog(
    { source: "shopify_margin_monthly", status: "success", rangeStart: from, rangeEnd: to, rowsWritten: w,
      message: `${w} month/channel rows`, durationMs: Date.now() - started },
    { dryRun },
  );
  log.ok(`Margin: ${w} month/channel row(s)`);
  return w;
}

async function syncReach({ from, to, dryRun, force, maxDays }) {
  const started = Date.now();
  const metricIds = await klaviyo.resolveReachMetricIds();
  log.ok(`reach metrics resolved: ${Object.entries(metricIds).map(([c, i]) => `${c}=${i}`).join(", ")}`);

  const days = eachDay(from, to);
  const done = force || dryRun ? new Set() : await completedDays("klaviyo_reach", from, to);
  const allPending = days.filter((d) => !done.has(d));
  const pending = Number.isFinite(maxDays) ? allPending.slice(0, Math.max(0, maxDays)) : allPending;
  const deferred = allPending.length - pending.length;

  if (done.size) log.info(`reach: ${done.size} day(s) already stored`);
  if (pending.length) log.info(`reach: ${pending.length} day(s) this run, roughly ${Math.ceil(pending.length * 2)} minute(s)`);
  if (deferred > 0) log.warn(`reach: ${deferred} day(s) deferred to later runs`);

  let written = 0;
  let i = 0;
  for (const day of pending) {
    i++;
    const rows = await klaviyo.fetchDailyReach(day, metricIds);
    const people = rows.reduce((a, r) => a + r.profile_count, 0);
    const sends = rows.reduce((a, r) => a + r.event_count, 0);

    if (!dryRun) {
      const w = await upsert("klaviyo_reach_daily", rows, "date,channel,source", { dryRun });
      written += w;
      await writeSyncLog(
        { source: "klaviyo_reach", status: "success", rangeStart: day, rangeEnd: day, rowsWritten: w,
          message: `${sends} sends, ${people} profile rows across ${rows.length} bucket(s)` },
        { dryRun },
      );
    }
    log.progress(i, pending.length, `reach days (${day}: ${sends} sends)`);
  }

  if (dryRun) {
    log.info("Reach — would write per day: one row per channel and source, holding hashed profile ids.");
    return pending.length;
  }
  await writeSyncLog(
    { source: "klaviyo_reach_summary", status: "success", rangeStart: from, rangeEnd: to,
      rowsWritten: written, message: `${pending.length} day(s) processed, ${deferred} deferred`,
      durationMs: Date.now() - started },
    { dryRun },
  );
  log.ok(`Reach: ${pending.length} day(s) stored${deferred ? `, ${deferred} still outstanding` : ""}`);
  return written;
}

async function syncShopify({ from, to, dryRun, attributed }) {
  const started = Date.now();

  const byDay = await shopify.fetchDailySales(from, to);
  const rows = shopify.toSalesRows(byDay, eachDay(from, to));

  if (dryRun) {
    log.info("Shopify — would write:");
    preview("shopify_daily_sales", rows, ["date", "source_name", "sub_channel", "total_online_revenue_jod", "orders"]);
    return rows.length;
  }
  const w = await upsert("shopify_daily_sales", rows, "date,source_name", { dryRun });
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

  // Compare against our own last snapshot. A balance that leaps overnight
  // means the field definition moved, not the business.
  if (!dryRun) ll.checkDailyMove(snap.pointsOutstanding, await previousSnapshot(snapshotDate));

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
  const unknown = sources.filter((s) => !["klaviyo", "shopify", "loyaltylion", "reach", "margin"].includes(s));
  if (unknown.length) throw new Error(`--only: unknown source(s) ${unknown.join(", ")}`);

  preflight(sources, args.dryRun);
  log.info(`range ${from} … ${to}  sources: ${sources.join(", ")}${args.dryRun ? "  [DRY RUN — nothing will be written]" : ""}`);

  const failures = [];
  let attributed = null;
  let totalRows = 0;

  if (sources.includes("klaviyo")) {
    try {
      const r = await syncKlaviyo({ from, to, dryRun: args.dryRun, force: args.force, maxDays: args.maxDays });
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

  if (sources.includes("margin")) {
    try {
      totalRows += await syncMargin({ from, to, dryRun: args.dryRun });
    } catch (err) {
      failures.push(["margin", err]);
      log.error(`Margin failed — ${redact(err.message)}`);
      if (!args.dryRun) await writeSyncLog({ source: "shopify_margin_monthly", status: "error", rangeStart: from, rangeEnd: to, message: redact(String(err.message)).slice(0, 500) }, { dryRun: false });
    }
  }

  if (sources.includes("reach")) {
    try {
      totalRows += await syncReach({ from, to, dryRun: args.dryRun, force: args.force, maxDays: args.maxDays });
    } catch (err) {
      failures.push(["reach", err]);
      log.error(`Reach failed — ${redact(err.message)}`);
      if (!args.dryRun) await writeSyncLog({ source: "klaviyo_reach", status: "error", rangeStart: from, rangeEnd: to, message: redact(String(err.message)).slice(0, 500) }, { dryRun: false });
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
  if (sources.includes("klaviyo") || sources.includes("reach"))
    required.push(["KLAVIYO_API_KEY", "Klaviyo → Settings → Account → API keys → Create Private API Key (campaigns:read, flows:read, metrics:read, events:read)"]);
  const missing = required.filter(([k]) => !process.env[k]);

  // Shopify accepts either the Dev Dashboard client credentials (current) or a
  // legacy shpat_ token, if one still exists from an admin-created custom app.
  if (sources.includes("shopify") || sources.includes("margin")) {
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
                            [--dry-run] [--force] [--only klaviyo,shopify,loyaltylion,reach,margin]

  --max-days N   cap how many flow days one run attempts, so a long backfill
                 can span several runs within Klaviyo's 225/day limit

Defaults to the trailing 3 days. See scripts/README.md.`;
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
