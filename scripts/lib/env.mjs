import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Minimal .env reader. Deliberately dependency-free so the sync script can run
 * in CI with nothing installed but @supabase/supabase-js.
 * Real environment variables always win, so GitHub Secrets override any .env.
 */
export function loadEnv() {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
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
