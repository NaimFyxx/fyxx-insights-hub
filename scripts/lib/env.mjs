import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Minimal .env reader. Deliberately dependency-free so the sync script can run
 * in CI with no dependencies installed at all — the sync script needs none.
 * Real environment variables always win, so GitHub Secrets override any .env.
 */
export function loadEnv() {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return;
  const malformed = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) { malformed.push(line); continue; }
    const key = line.slice(0, eq).trim();
    // A line that is not KEY=value is usually a shell command pasted in by
    // mistake. That is dangerous, not merely useless: anything that runs
    // `source .env` will EXECUTE it. Say so rather than skipping in silence.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { malformed.push(line); continue; }
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // An empty placeholder must not shadow a real value later in the file.
    if (val === "") continue;
    if (!process.env[key]) process.env[key] = val;
  }

  if (malformed.length) {
    console.warn(`\n! .env has ${malformed.length} line(s) that are not KEY=value and were IGNORED:`);
    for (const l of malformed.slice(0, 5)) console.warn(`    ${l.slice(0, 70)}${l.length > 70 ? "…" : ""}`);
    console.warn("  If you meant to paste a value, the line must read KEY=value with no spaces");
    console.warn("  around the =. A shell command left in .env is a hazard: `source .env` RUNS it.\n");
  }
}

/** Every secret this script knows about. Used to build the redaction list. */
const SECRET_KEYS = [
  "KLAVIYO_API_KEY",
  "LOYALTYLION_API_KEY",
  "LOYALTYLION_TOKEN",
  "LOYALTYLION_SECRET",
  "SHOPIFY_ADMIN_TOKEN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
];

/**
 * Scrubs any known secret out of a string before it reaches a log line.
 * Errors from fetch libraries love to echo request headers back at you; this
 * is the last line of defence against a key landing in a CI transcript.
 */
export function redact(input) {
  let s = typeof input === "string" ? input : String(input?.stack ?? input?.message ?? input);
  for (const k of SECRET_KEYS) {
    const v = process.env[k];
    if (v && v.length > 6) s = s.split(v).join(`«${k} redacted»`);
  }
  // Belt and braces: catch anything that merely looks like a credential.
  s = s.replace(/\b(pk_|sk_|pat_|shpat_|shpss_|sb_secret_)[A-Za-z0-9_-]{8,}/g, "«redacted»");
  s = s.replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "«jwt redacted»");
  return s;
}

/** Reads a required variable, or explains exactly what to do about it. */
export function need(key, hint) {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `Missing ${key}.\n  ${hint}\n  Add it to .env (local) or GitHub Secrets (CI). See .env.example.`,
    );
  }
  return v;
}

export function optional(key) {
  return process.env[key] || null;
}
