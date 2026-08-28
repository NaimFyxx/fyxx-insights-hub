import { need } from "./env.mjs";
import { log, httpJson, withRetry } from "./log.mjs";

/**
 * Supabase writes over plain PostgREST HTTP.
 *
 * This deliberately does NOT use @supabase/supabase-js. That client pulls in
 * Realtime, which needs a native WebSocket and therefore Node 22+, and a
 * nightly data sync has no use for a websocket. Talking to PostgREST directly
 * keeps the script dependency-free and running on any Node with fetch.
 *
 * The service-role key bypasses row-level security, which is exactly why it
 * must never reach the browser. Step 1 left every table read-only for
 * `authenticated`, so this is the only identity that can write.
 */
function config() {
  const url = need("SUPABASE_URL", "Supabase → Project Settings → API → Project URL").replace(/\/+$/, "");
  const key = need("SUPABASE_SERVICE_ROLE_KEY", "Supabase → Project Settings → API keys → service_role");
  return { url, key };
}

function authHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

/**
 * Upsert on a named unique index. Idempotent by construction: re-running the
 * same date range updates the same rows instead of appending new ones.
 */
export async function upsert(table, rows, conflictTarget, { dryRun }) {
  if (!rows.length) return 0;

  // Postgres refuses ON CONFLICT DO UPDATE when the same command carries the
  // same key twice: "cannot affect row a second time". Klaviyo emits duplicate
  // Placed Order events for ~2% of orders — identical in every field — which
  // is enough to fail an entire 44,000-row write after the pull has already
  // cost twenty minutes. De-duplicate here rather than in each caller, so no
  // future source can rediscover this.
  const keyCols = conflictTarget.split(",").map((c) => c.trim());
  const seen = new Map();
  for (const r of rows) seen.set(keyCols.map((c) => r[c]).join("\u0000"), r);  // last wins
  const deduped = [...seen.values()];
  if (deduped.length !== rows.length) {
    log.warn(`${table}: ${rows.length - deduped.length} duplicate row(s) on (${conflictTarget}) collapsed before writing`);
  }
  rows = deduped;

  if (dryRun) return rows.length;
  const { url, key } = config();

  // Chunked so a wide backfill doesn't build one enormous request body.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await withRetry(`upsert ${table}`, () =>
      httpJson(
        `${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictTarget)}`,
        {
          method: "POST",
          headers: {
            ...authHeaders(key),
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(slice),
        },
        `upsert ${table}`,
      ),
    );
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
    const { url, key } = config();
    await httpJson(
      `${url}/rest/v1/sync_log`,
      {
        method: "POST",
        headers: { ...authHeaders(key), Prefer: "return=minimal" },
        body: JSON.stringify({
          source: entry.source,
          status: entry.status,
          message: entry.message ?? null,
          range_start: entry.rangeStart ?? null,
          range_end: entry.rangeEnd ?? null,
          rows_written: entry.rowsWritten ?? 0,
          duration_ms: entry.durationMs ?? null,
        }),
      },
      "sync_log insert",
    );
  } catch (err) {
    log.warn(`could not write sync_log (${err.message})`);
  }
}

/**
 * Which days already synced successfully for this source. Drives resuming, so
 * a backfill that hits Klaviyo's daily cap can be re-run tomorrow and will
 * carry on from where it stopped rather than starting over.
 */
export async function completedDays(source, from, to) {
  try {
    const { url, key } = config();
    const q =
      `select=range_start&source=eq.${encodeURIComponent(source)}&status=eq.success` +
      `&range_start=gte.${from}&range_start=lte.${to}`;
    const rows = await httpJson(`${url}/rest/v1/sync_log?${q}`, { headers: authHeaders(key) }, "resume ledger");
    return new Set((rows ?? []).map((r) => r.range_start));
  } catch (err) {
    log.warn(`could not read resume ledger (${err.message}); treating all days as pending`);
    return new Set();
  }
}

/** The most recent snapshot before `before`, for day-over-day comparison. */
export async function previousSnapshot(before) {
  try {
    const { url, key } = config();
    const q = `select=snapshot_date,points_outstanding&snapshot_date=lt.${before}&order=snapshot_date.desc&limit=1`;
    const rows = await httpJson(`${url}/rest/v1/ll_snapshots?${q}`, { headers: authHeaders(key) }, "previous snapshot");
    return (rows ?? [])[0] ?? null;
  } catch (err) {
    log.warn(`could not read the previous snapshot (${err.message}); skipping the day-over-day check`);
    return null;
  }
}
