/**
 * Tests for the sync script's pure logic: number handling, row shaping and
 * secret redaction. No network, no database, no credentials needed.
 *
 *   node scripts/test/sync.test.mjs
 */
import { money3, rate4, int } from "../lib/log.mjs";
import { toCampaignRows, toFlowRows } from "../lib/klaviyo.mjs";
import { toSalesRows } from "../lib/shopify.mjs";

let failed = 0;
const check = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  — ${detail}` : ""}`);
};
const group = (n) => console.log(`\n${n}`);

/* -------------------------------------------------- money and rounding -- */
group("rounding");
for (const [inp, want] of [
  [744.0005, 744.001],        // the case plain toFixed(3) gets wrong
  [9840.4567, 9840.457],
  [0.0005, 0.001],
  [1.9995, 2],
  [-12.3455, -12.346],        // refunds round away from zero, not toward +inf
  [123456789.12349, 123456789.123],
]) check(`money3(${inp}) === ${want}`, money3(inp) === want, String(money3(inp)));
check("money3 survives null/undefined/NaN", money3(null) === 0 && money3(undefined) === 0 && money3(NaN) === 0);
check("int survives NaN", int(NaN) === 0);
check("rate4 keeps fractions, not percentages", rate4(0.456792) === 0.4568);

/* ------------------------------------------------------ campaign rows -- */
group("campaign shaping");
const meta = new Map([
  ["camp1", { name: "  End of Summer  VAULT sale ", sentOn: "2026-08-26", channel: "email" }],
  ["camp2", { name: "Flash Restock Alert", sentOn: "2026-08-20", channel: "push-notification" }],
  ["camp3", { name: "Never sent draft", sentOn: null, channel: "email" }],
]);
const { email, push } = toCampaignRows(
  [
    { campaignId: "camp1", messageId: "m1", channel: "email",
      s: { recipients: 14210, delivered: 14002, opens_unique: 6395, open_rate: 0.456792,
           clicks_unique: 1278, click_rate: 0.091273, conversions: 124, conversion_rate: 0.008856,
           conversion_value: 9840.4567 } },
    { campaignId: "camp2", messageId: "m2", channel: "push-notification",
      s: { recipients: 1900, delivered: 1880, opens_unique: 589, open_rate: 0.3133,
           conversions: 7, conversion_value: 412.1239 } },
    { campaignId: "camp3", messageId: "m3", channel: "email", s: { recipients: 0 } },
  ],
  meta,
);
check("push goes to klaviyo_push, not klaviyo_campaigns", email.length === 1 && push.length === 1);
check("campaign name stored verbatim", email[0].name === "  End of Summer  VAULT sale ");
check("money at 3dp", email[0].revenue_jod === 9840.457);
check("rates as fractions", email[0].open_rate === 0.4568);
check("push row has NO click columns", !("clicked" in push[0]) && !("click_rate" in push[0]));
check("push carries conversions and revenue", push[0].conversions === 7 && push[0].revenue_jod === 412.124);
check("campaign with no send date is dropped", !email.some((r) => r.campaign_id === "camp3"));

/* ---------------------------------------------------------- flow rows -- */
group("flow shaping");
const { flows, push: flowPush } = toFlowRows(
  [
    { flowId: "f1", messageId: "fm1", flowName: "Welcome Series", channel: "email",
      s: { recipients: 310, delivered: 305, opens_unique: 161, open_rate: 0.5279,
           clicks_unique: 22, click_rate: 0.0721, conversions: 12, conversion_value: 744.0005 } },
    { flowId: "f2", messageId: "fm2", flowName: "Utility — internal alert", channel: "email",
      s: { recipients: 0 } },
    { flowId: "f3", messageId: "fm3", flowName: "Birthday Reward", channel: "push-notification",
      s: { recipients: 90, delivered: 88, opens_unique: 49, open_rate: 0.5568, conversions: 4, conversion_value: 231.5 } },
  ],
  "2026-08-15",
);
check("flows with zero sends are not stored", flows.length === 1 && flows[0].flow_name === "Welcome Series");
check("flow push split out", flowPush.length === 1 && flowPush[0].source_type === "Flow");
check("flow money at 3dp", flows[0].revenue_jod === 744.001);
check("flow has the new clicked column", flows[0].clicked === 22);
check("flow row carries its date", flows[0].date === "2026-08-15");

const legacySpelling = toFlowRows(
  [{ flowId: "f9", messageId: "fm9", flowName: "Push Flow", channel: "mobile_push",
     s: { recipients: 10, opens_unique: 3, conversions: 1, conversion_value: 12.5 } }],
  "2026-08-15",
);
check("a row tagged mobile_push still routes to push, not flows",
  legacySpelling.flows.length === 0 && legacySpelling.push.length === 1);

/* --------------------------------------------------------- sales rows -- */
group("shopify shaping");
const sales = toSalesRows(
  new Map([["2026-08-01", { revenue: 2431.6667, orders: 31 }]]),
  new Map([["2026-08-01", 512.3339]]),
  ["2026-08-01", "2026-08-02"],
);
check("every day in range gets a row", sales.length === 2);
check("revenue at 3dp", sales[0].total_online_revenue_jod === 2431.667);
check("attributed revenue at 3dp", sales[0].klaviyo_attributed_revenue_jod === 512.334);
check("a day with no orders is zero, not null", sales[1].total_online_revenue_jod === 0 && sales[1].orders === 0);

/* --------------------------------------------------- channel vocabularies -- */
group("klaviyo channel vocabularies");
{
  const k = await import("../lib/klaviyo.mjs");
  // Klaviyo uses two different names for push depending on the endpoint.
  // Getting these the wrong way round is a 400 that blames "channel".
  check("campaigns LIST endpoint uses mobile_push", k.LIST_CHANNEL.push === "mobile_push", k.LIST_CHANNEL.push);
  check("VALUES REPORT endpoints use push-notification",
    k.REPORT_CHANNEL.push === "push-notification", k.REPORT_CHANNEL.push);
  check("the two vocabularies are genuinely different",
    k.LIST_CHANNEL.push !== k.REPORT_CHANNEL.push);
  check("email is spelled the same in both", k.LIST_CHANNEL.email === k.REPORT_CHANNEL.email);
  check("isPush accepts the report spelling", k.isPush("push-notification"));
  check("isPush accepts the list spelling", k.isPush("mobile_push"));
  check("isPush rejects email", !k.isPush("email"));
  check("isPush rejects sms and whatsapp", !k.isPush("sms") && !k.isPush("whatsapp"));
  check("isPush rejects undefined", !k.isPush(undefined));
}

/* ------------------------------------------------------------ limiter -- */
group("rate limiter");
{
  const { Limiter } = await import("../lib/log.mjs");
  const lim = new Limiter(0, "test");

  // Regression: a failed task must not poison the queue. Assigning the
  // rejected promise back to the chain made every later call reject
  // immediately with the FIRST error, without running — which would have
  // killed a backfill at its first hiccup and then blamed the wrong day.
  let ran = 0;
  await lim.run(() => { ran++; return "first"; });
  let caught = null;
  try {
    await lim.run(() => { ran++; throw new Error("boom"); });
  } catch (e) { caught = e; }
  check("a failing task rejects to its own caller", caught?.message === "boom");

  const after = await lim.run(() => { ran++; return "third"; });
  check("the limiter still works after a failure", after === "third", String(after));
  check("every queued task actually ran", ran === 3, `ran=${ran}`);

  const order = [];
  await Promise.all([
    lim.run(async () => { order.push("a"); }),
    lim.run(async () => { order.push("b"); }),
    lim.run(async () => { order.push("c"); }),
  ]);
  check("tasks stay serialised in submission order", order.join("") === "abc", order.join(""));
}

/* ------------------------------------------ loyalty sanity checks -- */
group("loyalty sanity checks");
const ll = await import("../lib/loyaltylion.mjs");

/** Runs fn while capturing everything it logs, so warnings can be asserted. */
function capture(fn) {
  const out = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (m) => out.push(String(m));
  try { fn(); } finally { Object.assign(console, orig); }
  return out.join("\n");
}

const healthy = capture(() =>
  ll.reportBirthdayMatch({
    matchedRules: new Set(["Birthday Reward"]),
    allRuleNames: new Set(["Birthday Reward"]),
    birthday: 23,
    valueSpread: new Map([[400, 12], [500, 6], [600, 4], [700, 1]]),
  }),
);
check("tiered spread is reported as consistent", healthy.includes("consistent with a tiered birthday reward"));
check("tiered spread raises no wrong-rule warning", !healthy.includes("WRONG rule"));

const oneValue = capture(() =>
  ll.reportBirthdayMatch({
    matchedRules: new Set(["Birthday Email"]),
    allRuleNames: new Set(["Birthday Email"]),
    birthday: 31,
    valueSpread: new Map([[50, 31]]),
  }),
);
check("a single repeated value is flagged as the wrong rule", oneValue.includes("WRONG rule"));
check("an unknown tier value is called out", oneValue.includes("not a known tier value"));

const noMatch = capture(() =>
  ll.reportBirthdayMatch({
    matchedRules: new Set(),
    allRuleNames: new Set(["Order", "Enrolled"]),
    birthday: 0,
    valueSpread: new Map(),
  }),
);
check("no match lists the rule names that were seen", noMatch.includes("Enrolled"));

check("plausible liability passes the band",
  capture(() => ll.reportPointsLiability(1_487_320, 8214)).includes("within the expected order of magnitude"));
check("10x too high is flagged with the likely cause",
  capture(() => ll.reportPointsLiability(48_900_000, 8214)).includes("lifetime-earned total"));
check("10x too low is flagged with the likely cause",
  capture(() => ll.reportPointsLiability(94_100, 8214)).includes("points_pending"));
check("liability is converted at 100 points = 1 JOD",
  capture(() => ll.reportPointsLiability(1_500_000, 100)).includes("15,000 JOD"));

/* ---------------------------------------------------------- redaction -- */
group("secret redaction");
process.env.KLAVIYO_API_KEY = "pk_thisisaverysecretklaviyokey123456";
process.env.SHOPIFY_ADMIN_TOKEN = "shpat_NOT_A_REAL_TOKEN_test_fixture_only";
const { redact } = await import("../lib/env.mjs");
const secrets = [process.env.KLAVIYO_API_KEY, process.env.SHOPIFY_ADMIN_TOKEN];
for (const c of [
  `HTTP 401 Authorization: Klaviyo-API-Key ${secrets[0]}`,
  `X-Shopify-Access-Token: ${secrets[1]}`,
  new Error(`boom with ${secrets[0]} inside`),
]) {
  const out = redact(c);
  check("secret does not survive redaction", !secrets.some((s) => out.includes(s)), out.slice(0, 60));
}
check("unknown key-shaped strings are caught too",
  !redact("stray shpat_NOT_A_REAL_TOKEN_stray_fixture here").includes("stray_fixture"));

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
