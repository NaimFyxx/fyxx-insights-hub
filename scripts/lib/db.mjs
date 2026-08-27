import { createClient } from "@supabase/supabase-js";
import { need } from "./env.mjs";
import { log } from "./log.mjs";

let _client = null;

/**
 * Service-role client. Bypasses row-level security, which is exactly why this
 * key must never reach the browser. Step 1 left every table read-only for
 * `authenticated`, so this is the only identity that can write.
 */
export function db() {
  if (_client) return _client;
  const url = need("SUPABASE_URL", "Supabase → Project Settings → API → Project URL");
  const key = need("SUPABASE_SERVICE_ROLE_KEY", "Supabase → Project Settings → API keys → service_role");
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

/**
 * Upsert on a named unique index. Idempotent by construction: re-running the
 * same date range updates the same rows instead of appending new ones.
 */
export async function upsert(table, rows, conflictTarget, { dryRun }) {
  if (!rows.length) return 0;
  if (dryRun) return rows.length;
  // Chunked so a wide backfill doesn't build one enormous request body.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await db().from(table).upsert(slice, { onConflict: conflictTarget });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
    written += slice.length;
  }
  return written;
}

/**
 * One sync_log row per source per chunk. Doubles as the resume ledger: before
 * fetching a day we ask whether a success row already covers it.
 */
export async function writeSyncLog(entry, { dryRun }) {
  if (dryRun) return;
  // Logging a failure must never itself throw, or the real error gets buried
  // under a second one about the log write.
  try {
    await insertSyncLog(entry);
  } catch (err) {
    log.warn(`could not write sync_log (${err.message})`);
  }
}

async function insertSyncLog(entry) {
  const { error } = await db().from("sync_log").insert({
    source: entry.source,
    status: entry.status,
    message: entry.message ?? null,
    range_start: entry.rangeStart ?? null,
    range_end: entry.rangeEnd ?? null,
    rows_written: entry.rowsWritten ?? 0,
    duration_ms: entry.durationMs ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Which days already synced successfully for this source. Drives --resume, so
 * a backfill that hits Klaviyo's daily cap can be re-run tomorrow and will
 * carry on from where it stopped rather than starting over.
 */
export async function completedDays(source, from, to) {
  const { data, error } = await db()
    .from("sync_log")
    .select("range_start")
    .eq("source", source)
    .eq("status", "success")
    .gte("range_start", from)
    .lte("range_start", to);
  if (error) {
    log.warn(`could not read resume ledger (${error.message}); treating all days as pending`);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.range_start));
}
