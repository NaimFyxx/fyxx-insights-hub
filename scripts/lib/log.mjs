import { redact } from "./env.mjs";

const t0 = Date.now();
const stamp = () => `${String(Math.floor((Date.now() - t0) / 1000)).padStart(4, " ")}s`;

export const log = {
  info: (m) => console.log(`[${stamp()}] ${redact(m)}`),
  step: (m) => console.log(`[${stamp()}] → ${redact(m)}`),
  ok: (m) => console.log(`[${stamp()}] ✓ ${redact(m)}`),
  warn: (m) => console.warn(`[${stamp()}] ! ${redact(m)}`),
  error: (m) => {
    // Show the message, not the stack. A stack trace is noise for anyone who
    // is not debugging the script itself. Set SYNC_DEBUG=1 to get the stack.
    const msg = m instanceof Error ? (process.env.SYNC_DEBUG ? m.stack : m.message) : m;
    console.error(`[${stamp()}] ✗ ${redact(msg)}`);
  },
  /** Progress that makes a slow, rate-limited backfill look alive rather than hung. */
  progress: (done, total, label) =>
    console.log(`[${stamp()}] … ${label} ${done}/${total} (${Math.round((done / total) * 100)}%)`),
};

/**
 * Rate limiter: serialises calls and enforces a minimum gap between them.
 * Klaviyo's values-report endpoints allow 2 requests/minute steady, so the
 * gap there is 30s. Without this the backfill trips 429s and dies halfway.
 */
export class Limiter {
  constructor(minIntervalMs, name) {
    this.minIntervalMs = minIntervalMs;
    this.name = name;
    this.last = 0;
    this.chain = Promise.resolve();
  }
  run(fn) {
    const result = this.chain.then(async () => {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) {
        if (wait > 5000) log.info(`waiting ${Math.round(wait / 1000)}s for ${this.name} rate limit`);
        await new Promise((r) => setTimeout(r, wait));
      }
      this.last = Date.now();
      return fn();
    });
    // The queue must keep its place even when a task fails. Assigning the
    // rejected promise back to this.chain would poison the limiter: every
    // later run() would chain onto a rejected promise and reject immediately
    // without ever calling fn, so one failed request would kill the rest of
    // the run and report the FIRST error over and over.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** Retries on 429 and 5xx with exponential backoff, honouring Retry-After. */
export async function withRetry(label, fn, { tries = 5 } = {}) {
  let delay = 2000;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status;
      const retryable = status === 429 || (status >= 500 && status < 600) || err?.code === "ETIMEDOUT";
      if (!retryable || attempt === tries) throw err;
      const wait = err?.retryAfterMs ?? delay;
      log.warn(`${label} failed (${status ?? err?.code}), retry ${attempt}/${tries - 1} in ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      delay = Math.min(delay * 2, 60000);
    }
  }
}

/** fetch wrapper that turns non-2xx into an Error carrying the status. */
export async function httpJson(url, init, label) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`${label}: HTTP ${res.status} ${redact(body.slice(0, 400))}`);
    err.status = res.status;
    const ra = res.headers.get("retry-after");
    if (ra) err.retryAfterMs = Number(ra) * 1000;
    throw err;
  }
  return res.json();
}

/**
 * Decimal rounding that does not fall foul of binary floating point.
 *
 * `(744.0005).toFixed(3)` returns "744.000", because 744.0005 is stored as a
 * hair under the true midpoint. Shifting the exponent via the string form
 * sidesteps that and rounds the decimal value the way a person would expect.
 * It is fractions of a fils either way, but this is money and it should be
 * right rather than nearly right.
 */
function roundTo(v, places) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  // Round half AWAY FROM ZERO, so -12.3455 -> -12.346 rather than -12.345.
  // Math.round breaks ties toward +Infinity, which is asymmetric for refunds.
  const scaled = Number(`${n}e${places}`);
  const shifted = Math.sign(scaled) * Math.round(Math.abs(scaled));
  return Number(`${shifted}e-${places}`);
}

/** JOD, three decimal places, as agreed. */
export const money3 = (v) => roundTo(v, 3);
export const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
/** Klaviyo reports rates as fractions; keep four places, never a percentage. */
export const rate4 = (v) => roundTo(v, 4);
