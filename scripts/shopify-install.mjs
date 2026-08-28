#!/usr/bin/env node
/**
 * One-off Shopify OAuth install, to mint a PERMANENT offline access token.
 *
 *   node scripts/shopify-install.mjs
 *
 * Run this once from your own machine, with a browser available and signed
 * into the Shopify admin. It:
 *
 *   1. starts a temporary local HTTP server purely to catch the callback,
 *   2. prints an install URL for you to open,
 *   3. verifies `state` and Shopify's HMAC when the callback arrives,
 *   4. exchanges the code for an offline token,
 *   5. prints the token ONCE, then shuts the server down.
 *
 * The token is never written to disk and never passed through the logger.
 * Paste it into .env as SHOPIFY_ADMIN_TOKEN.
 *
 * WHY OFFLINE, NOT CLIENT CREDENTIALS: omitting `grant_options[]` requests an
 * offline token, which does not expire — it lasts until the app is uninstalled
 * or the secret is revoked. Client-credentials tokens last 24 hours.
 *
 * SCOPES ARE FROZEN AT MINT TIME. A token carries only the scopes it was
 * created with; needing another later means re-running this. read_all_orders
 * is included from the start because without it Shopify silently returns only
 * the last 60 days and backfills come back empty rather than erroring.
 */
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { loadEnv, need, optional } from "./lib/env.mjs";

loadEnv();

const WRITE_ENV = process.argv.includes("--write-env");
const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");

/**
 * Writes the token straight into .env, so it never has to be copied by hand.
 * Shuttling a secret through a terminal and a clipboard is where it gets
 * pasted into the wrong place — including into .env as a shell command, which
 * then RUNS whenever anything sources the file.
 */
function writeToEnv(token) {
  const line = `SHOPIFY_ADMIN_TOKEN=${token}`;
  let existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  if (/^SHOPIFY_ADMIN_TOKEN=.+$/m.test(existing)) {
    throw new Error(
      ".env already has a non-empty SHOPIFY_ADMIN_TOKEN. Refusing to add a second one.\n" +
        "  Remove or comment out the existing line first, then re-run with --write-env.",
    );
  }
  const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(ENV_PATH, `${prefix}${line}\n`);
  return ENV_PATH;
}

const SHOP = optional("SHOPIFY_STORE_DOMAIN") || "drynksapp.myshopify.com";
const PORT = Number(optional("SHOPIFY_OAUTH_PORT") ?? 3456);
const REDIRECT_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${PORT}${REDIRECT_PATH}`;
const SCOPES = ["read_orders", "read_all_orders"];
const TIMEOUT_MS = 5 * 60 * 1000;

if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(SHOP)) {
  throw new Error(`SHOPIFY_STORE_DOMAIN looks wrong: ${SHOP}`);
}

const CLIENT_ID = need("SHOPIFY_CLIENT_ID", "Shopify Dev Dashboard → Fyxx Insights Hub → Client ID");
const CLIENT_SECRET = need("SHOPIFY_CLIENT_SECRET", "Shopify Dev Dashboard → Fyxx Insights Hub → Client secret");

/** Shopify signs the callback query with the app secret. Verify it. */
function hmacValid(url) {
  const params = new URLSearchParams(url.search);
  const sent = params.get("hmac") ?? "";
  params.delete("hmac");
  params.delete("signature");
  const message = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", CLIENT_SECRET).update(message).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(sent, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui;padding:3rem;max-width:38rem;margin:auto">` +
  `<h1 style="font-size:1.2rem">${title}</h1><p>${body}</p></body>`;

async function main() {
  const state = randomBytes(32).toString("hex");

  const authorizeUrl =
    `https://${SHOP}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&scope=${encodeURIComponent(SCOPES.join(","))}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${state}`;
    // No grant_options[] — that is what makes the token OFFLINE and permanent.

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404).end("not found");
        return;
      }

      const fail = (why) => {
        res.writeHead(400, { "content-type": "text/html" }).end(page("Install failed", why));
        reject(new Error(why));
      };

      if (url.searchParams.get("error")) {
        return fail(`Shopify returned: ${url.searchParams.get("error_description") ?? url.searchParams.get("error")}`);
      }
      // Constant-time state comparison: this is the CSRF defence.
      const got = url.searchParams.get("state") ?? "";
      if (got.length !== state.length || !timingSafeEqual(Buffer.from(got), Buffer.from(state))) {
        return fail("state mismatch — this callback did not come from the install you started. Nothing was exchanged.");
      }
      if (!hmacValid(url)) {
        return fail("HMAC verification failed — the callback was not signed by Shopify. Nothing was exchanged.");
      }
      const shop = url.searchParams.get("shop");
      if (shop !== SHOP) return fail(`callback was for ${shop}, expected ${SHOP}. Nothing was exchanged.`);

      const c = url.searchParams.get("code");
      if (!c) return fail("no authorization code in the callback");

      res.writeHead(200, { "content-type": "text/html" }).end(
        page("Authorised", "You can close this tab and return to the terminal."),
      );
      resolve(c);
    });

    server.on("error", (err) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(
              `Port ${PORT} is already in use.\n  The redirect URI is registered with Shopify and must match exactly,\n` +
                `  so this cannot just move to another port. Free port ${PORT} and retry, or set\n` +
                "  SHOPIFY_OAUTH_PORT and register the matching URL in the Dev Dashboard.",
            )
          : err,
      );
    });

    server.listen(PORT, "127.0.0.1", () => {
      console.log("");
      console.log("─".repeat(72));
      console.log("  1. Confirm this EXACT redirect URI is registered in the Dev Dashboard:");
      console.log("");
      console.log(`       ${REDIRECT_URI}`);
      console.log("");
      console.log("     Dev Dashboard → Fyxx Insights Hub → Configuration → URLs →");
      console.log("     Allowed redirection URL(s). It must match character for character.");
      console.log("");
      console.log(`  2. Open this URL in a browser signed into the ${SHOP} admin:`);
      console.log("");
      console.log(`       ${authorizeUrl}`);
      console.log("");
      console.log(`  Waiting for the callback… (gives up after ${TIMEOUT_MS / 60000} minutes)`);
      console.log("─".repeat(72));
    });

    const timer = setTimeout(() => {
      reject(new Error("timed out waiting for the callback — nothing was exchanged"));
    }, TIMEOUT_MS);

    const shutdown = () => { clearTimeout(timer); server.close(); };
    // Close the moment we settle, either way.
    process.on("beforeExit", shutdown);
    const done = (fn) => (v) => { shutdown(); return fn(v); };
    resolve = done(resolve);
    reject = done(reject);
  });

  // --- exchange the code for a permanent offline token --------------------
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    // `expiring` omitted on purpose: that is what yields a NON-expiring token.
  });
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("token exchange returned no access_token");

  const granted = String(json.scope ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const missing = SCOPES.filter((s) => !granted.includes(s));

  console.log("");
  console.log("─".repeat(72));
  if (json.expires_in) {
    console.log(`  ⚠️  This token EXPIRES in ${json.expires_in}s. It is not permanent.`);
    console.log("     That means the app is set to public distribution — only custom and");
    console.log("     merchant-created apps receive non-expiring offline tokens.");
  } else {
    console.log("  ✓ Permanent offline token (no expiry reported).");
  }
  console.log(`  Scopes granted: ${granted.join(", ") || "(none reported)"}`);
  if (missing.length) {
    console.log("");
    console.log(`  ⚠️  MISSING: ${missing.join(", ")}`);
    if (missing.includes("read_all_orders")) {
      console.log("     Without read_all_orders, Shopify silently returns only the last");
      console.log("     60 days. Backfills will come back EMPTY rather than failing.");
      console.log("     Tick it in the app's configured scopes and re-run this script.");
    }
  }
  console.log("");
  if (WRITE_ENV) {
    const path = writeToEnv(json.access_token);
    console.log(`  ✓ Written straight into ${path} as SHOPIFY_ADMIN_TOKEN.`);
    console.log("    Not shown here, and never copied by hand.");
  } else {
    console.log("  Copy the WHOLE line below into .env, exactly as it appears.");
    console.log("  It is a variable assignment, not a command — do not paste anything else.");
    console.log("  (Or re-run with --write-env and the script will do it for you.)");
    console.log("");
    console.log(`SHOPIFY_ADMIN_TOKEN=${json.access_token}`);
  }
  console.log("");
  console.log("  Then clear SHOPIFY_CLIENT_SECRET if you no longer need the 24h flow.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  // Deliberately not the shared logger: nothing from this script should ever
  // reach a log formatter that might echo a token.
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
