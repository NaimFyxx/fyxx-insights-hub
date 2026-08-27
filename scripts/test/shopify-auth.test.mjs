/**
 * Tests the Shopify client-credentials token lifecycle without touching the
 * network: global fetch is stubbed and every request is recorded, so we can
 * assert on the exchange body, the auth header, caching, and mid-run refresh.
 *
 *   node scripts/test/shopify-auth.test.mjs
 */
process.env.SHOPIFY_STORE_DOMAIN = "drynksapp.myshopify.com";
process.env.SHOPIFY_CLIENT_ID = "abcdef0123456789abcdef0123456789";
process.env.SHOPIFY_CLIENT_SECRET = "shpss_NOT_A_REAL_SECRET_test_fixture";
delete process.env.SHOPIFY_ADMIN_TOKEN;

let failed = 0;
const check = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  — ${detail}` : ""}`);
};
const group = (n) => console.log(`\n${n}`);

const calls = [];
let issued = 0;
let rejectNextGraphql = false;

const ordersPayload = {
  data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
    { id: "gid://1", createdAt: "2026-08-01T10:00:00+03:00", cancelledAt: null,
      currentTotalPriceSet: { shopMoney: { amount: "120.500", currencyCode: "JOD" } } },
  ] } },
};

globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, init });
  if (u.endsWith("/admin/oauth/access_token")) {
    issued++;
    return new Response(
      JSON.stringify({ access_token: `shpat_issued_token_number_${issued}`, scope: "read_orders,read_all_orders", expires_in: 86399 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (rejectNextGraphql) {
    rejectNextGraphql = false;
    return new Response(JSON.stringify({ errors: "Invalid API key or access token" }), { status: 401 });
  }
  return new Response(JSON.stringify(ordersPayload), { status: 200, headers: { "content-type": "application/json" } });
};

// Capture logs so we can prove nothing secret is printed.
const logged = [];
const orig = { log: console.log, warn: console.warn, error: console.error };
const startCapture = () => { console.log = console.warn = console.error = (m) => logged.push(String(m)); };
const stopCapture = () => Object.assign(console, orig);

const { fetchDailySales } = await import("../lib/shopify.mjs");

startCapture();
await fetchDailySales("2026-08-01", "2026-08-01");
stopCapture();

group("token exchange");
const exchange = calls.find((c) => c.url.endsWith("/admin/oauth/access_token"));
check("posts to the store's oauth endpoint",
  exchange?.url === "https://drynksapp.myshopify.com/admin/oauth/access_token", exchange?.url);
check("uses POST", exchange?.init?.method === "POST");
check("sends form-urlencoded, not JSON",
  exchange?.init?.headers?.["content-type"] === "application/x-www-form-urlencoded");
const body = String(exchange?.init?.body);
check("grant_type is client_credentials", body.includes("grant_type=client_credentials"));
check("sends client_id", body.includes(`client_id=${process.env.SHOPIFY_CLIENT_ID}`));
check("sends client_secret", body.includes("client_secret="));

group("token usage");
const graphql = calls.find((c) => c.url.includes("/graphql.json"));
check("token goes in X-Shopify-Access-Token",
  graphql?.init?.headers?.["X-Shopify-Access-Token"] === "shpat_issued_token_number_1",
  graphql?.init?.headers?.["X-Shopify-Access-Token"]);
check("exchange happened exactly once", issued === 1, `issued=${issued}`);

group("caching");
calls.length = 0;
startCapture();
await fetchDailySales("2026-08-02", "2026-08-02");
stopCapture();
check("a second run reuses the cached token, no re-exchange",
  issued === 1 && !calls.some((c) => c.url.endsWith("/admin/oauth/access_token")), `issued=${issued}`);

group("mid-run expiry");
calls.length = 0;
rejectNextGraphql = true;
startCapture();
const rows = await fetchDailySales("2026-08-03", "2026-08-03");
stopCapture();
check("a 401 triggers exactly one re-exchange", issued === 2, `issued=${issued}`);
check("the retry uses the NEW token",
  calls.filter((c) => c.url.includes("/graphql.json")).at(-1)?.init?.headers?.["X-Shopify-Access-Token"]
    === "shpat_issued_token_number_2");
check("the call succeeds after refreshing", rows instanceof Map && rows.size === 1);

group("secrets never reach the logs");
const all = logged.join("\n");
check("client secret never logged", !all.includes(process.env.SHOPIFY_CLIENT_SECRET));
check("access token never logged", !all.includes("shpat_issued_token_number_1") && !all.includes("shpat_issued_token_number_2"));
check("scopes ARE logged, so misconfiguration is visible", all.includes("read_all_orders"));

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
