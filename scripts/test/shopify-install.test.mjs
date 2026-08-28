/**
 * Exercises the OAuth callback guards by actually running the install script
 * and firing crafted callbacks at it. No Shopify contact: the script never
 * reaches the token exchange because every case here is rejected first.
 *
 *   node scripts/test/shopify-install.test.mjs
 */
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "drynksapp.myshopify.com";
const SCRIPT = fileURLToPath(new URL("../shopify-install.mjs", import.meta.url));

let failed = 0;
const check = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  — ${detail}` : ""}`);
};

if (!SECRET) {
  console.log("SHOPIFY_CLIENT_SECRET not set — skipping (these tests need it to forge a valid HMAC).");
  process.exit(0);
}

function sign(params) {
  const msg = [...Object.entries(params)]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return createHmac("sha256", SECRET).update(msg).digest("hex");
}

/** Runs the install script, sends one callback, returns {status, body, stdout}. */
function attempt(buildQuery, port) {
  return new Promise((resolve) => {
    const child = spawn("node", [SCRIPT], {
      env: { ...process.env, SHOPIFY_OAUTH_PORT: String(port) },
    });
    let out = "";
    let settled = false;
    child.stdout.on("data", async (d) => {
      out += d.toString();
      const m = out.match(/state=([a-f0-9]{64})/);
      if (m && !settled) {
        settled = true;
        const query = buildQuery(m[1]);
        let status = 0, body = "";
        try {
          const r = await fetch(`http://localhost:${port}/callback?${query}`);
          status = r.status;
          body = await r.text();
        } catch (e) { body = e.message; }
        setTimeout(() => { child.kill(); resolve({ status, body, stdout: out }); }, 150);
      }
    });
    child.stderr.on("data", (d) => { out += d.toString(); });
    setTimeout(() => { if (!settled) { child.kill(); resolve({ status: 0, body: "timeout", stdout: out }); } }, 8000);
  });
}

console.log("\ncallback guards");

const wrongState = await attempt(
  () => {
    const p = { code: "fake_code", shop: SHOP, state: "0".repeat(64), timestamp: "1" };
    return new URLSearchParams({ ...p, hmac: sign(p) }).toString();
  },
  3461,
);
check("a forged state is rejected", wrongState.status === 400, `HTTP ${wrongState.status}`);
check("and says so plainly", /state mismatch/.test(wrongState.body));
check("and confirms nothing was exchanged", /Nothing was exchanged/.test(wrongState.body));

const badHmac = await attempt(
  (state) => new URLSearchParams({ code: "fake_code", shop: SHOP, state, timestamp: "1", hmac: "deadbeef" }).toString(),
  3462,
);
check("an unsigned or mis-signed callback is rejected", badHmac.status === 400, `HTTP ${badHmac.status}`);
check("and names HMAC verification", /HMAC verification failed/.test(badHmac.body));

const wrongShop = await attempt(
  (state) => {
    const p = { code: "fake_code", shop: "attacker.myshopify.com", state, timestamp: "1" };
    return new URLSearchParams({ ...p, hmac: sign(p) }).toString();
  },
  3463,
);
check("a correctly-signed callback for a DIFFERENT shop is rejected",
  wrongShop.status === 400, `HTTP ${wrongShop.status}`);
check("and names the mismatch", /expected drynksapp\.myshopify\.com/.test(wrongShop.body));

const shopifyError = await attempt(
  (state) => new URLSearchParams({ error: "access_denied", error_description: "merchant declined", state }).toString(),
  3464,
);
check("a merchant declining is reported, not treated as success", shopifyError.status === 400);
check("and surfaces Shopify's reason", /merchant declined/.test(shopifyError.body));

console.log("\nthe install URL it prints");
const urlCheck = wrongState.stdout;
check("requests offline access (no grant_options)", !/grant_options/.test(urlCheck));
check("requests read_orders and read_all_orders",
  /scope=read_orders%2Cread_all_orders/.test(urlCheck));
check("points at the registered localhost redirect",
  /redirect_uri=http%3A%2F%2Flocalhost%3A/.test(urlCheck));
check("tells you to register the exact URI first", /must match character for character/.test(urlCheck));
check("no secret is printed", !urlCheck.includes(SECRET));

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
