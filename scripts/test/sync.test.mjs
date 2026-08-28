/**
 * Tests for the sync script's pure logic: number handling, row shaping and
 * secret redaction. No network, no database, no credentials needed.
 *
 *   node scripts/test/sync.test.mjs
 */
import { money3, rate4, int } from "../lib/log.mjs";
import { toCampaignRows, toFlowRows } from "../lib/klaviyo.mjs";
import { toSalesRows, classifySource } from "../lib/shopify.mjs";
const kmod = { classifySource };

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
const cls = (n) => { const { classifySource } = kmod; return classifySource(n); };
const byDay = new Map([
  ["2026-08-01", new Map([
    ["web",      { revenue: 2431.6667, orders: 31, cls: { sub_channel: "Website",     channel: "Online Sales" } }],
    ["5382175",  { revenue: 900.5,     orders: 12, cls: { sub_channel: "Mobile App",  channel: "Online Sales" } }],
    ["pos",      { revenue: 400,       orders: 4,  cls: { sub_channel: "POS",         channel: "POS Sales" } }],
  ])],
]);
const sales = toSalesRows(byDay, ["2026-08-01", "2026-08-02"]);
check("one row per source, not per day", sales.length === 3, `${sales.length} rows`);
check("POS is no longer excluded", sales.some((r) => r.sub_channel === "POS"));
check("raw source_name is stored unmapped", sales.map((r) => r.source_name).sort().join(",") === "5382175,pos,web");
check("channel grouping is stored alongside", sales.find((r) => r.source_name === "5382175").channel === "Online Sales");
check("revenue at 3dp per channel", sales.find((r) => r.source_name === "web").total_online_revenue_jod === 2431.667);
check("a day with no orders produces NO rows", !sales.some((r) => r.date === "2026-08-02"));
check("attribution is NOT written onto a channel row",
  sales.every((r) => !("klaviyo_attributed_revenue_jod" in r)), Object.keys(sales[0]).join(","));

group("channel mapping");
check("web -> Website / Online Sales",
  cls("web").sub_channel === "Website" && cls("web").channel === "Online Sales");
check("Appmaker 5382175 -> Mobile App", cls("5382175").sub_channel === "Mobile App");
check("Shopney 2653365 -> Mobile App too (switchover must not break the trend)",
  cls("2653365").sub_channel === "Mobile App");
check("both mobile providers land on the same channel",
  cls("5382175").channel === cls("2653365").channel);
check("Shopify POS 'pos' -> POS", cls("pos").sub_channel === "POS");
check("Odoo 179433 -> POS too (same switchover rule)", cls("179433").sub_channel === "POS");
check("both POS providers land on the same channel",
  cls("pos").channel === cls("179433").channel && cls("pos").channel === "POS Sales");
for (const d of ["shopify_draft_order", "iphone", "android"])
  check(`${d} -> Draft Orders`, cls(d).sub_channel === "Draft Orders");
check("an unseen source is stored as Unknown, never dropped",
  cls("some_new_channel_2027").sub_channel === "Unknown" && cls("some_new_channel_2027").source_name === "some_new_channel_2027");
check("a missing source becomes 'unknown' rather than throwing", cls(undefined).source_name === "unknown");

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

/* ------------------------------------------------- amman date mapping -- */
group("attributed revenue date mapping");
{
  const { toAmmanDate } = await import("../lib/klaviyo.mjs");
  // Klaviyo returns each Amman midnight as its UTC instant. Taking the first
  // ten characters files the day under the PREVIOUS date, which then falls
  // outside the requested range and is dropped.
  check("21:00Z maps to the NEXT Amman day", toAmmanDate("2026-08-23T21:00:00+00:00") === "2026-08-24",
    toAmmanDate("2026-08-23T21:00:00+00:00"));
  check("naive slice(0,10) would have been wrong",
    "2026-08-23T21:00:00+00:00".slice(0, 10) !== toAmmanDate("2026-08-23T21:00:00+00:00"));
  check("a mid-Amman-day instant maps to that day",
    toAmmanDate("2026-08-24T12:00:00+00:00") === "2026-08-24");
  check("just before Amman midnight stays on the earlier day",
    toAmmanDate("2026-08-24T20:59:59+00:00") === "2026-08-24");
}

/* ---------------------------------------------------------- retry -- */
group("retry survives the failures a long backfill actually hits");
{
  const { withRetry } = await import("../lib/log.mjs");
  const orig = { log: console.log, warn: console.warn };
  const quiet = async (fn) => { console.log = console.warn = () => {}; try { return await fn(); } finally { Object.assign(console, orig); } };

  // A dropped connection: TypeError with the reason on .cause, no status.
  let calls = 0;
  const netErr = () => { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNRESET" }; throw e; };
  const got = await quiet(() => withRetry("net", async () => { calls++; if (calls < 3) netErr(); return "recovered"; }, { tries: 5 }));
  check("a dropped connection is retried, not fatal", got === "recovered", `after ${calls} attempts`);

  // A 400 is a real error and must NOT be retried into oblivion.
  let bad = 0;
  let threw = null;
  try {
    await quiet(() => withRetry("bad", async () => { bad++; const e = new Error("bad request"); e.status = 400; throw e; }, { tries: 4 }));
  } catch (e) { threw = e; }
  check("a 400 fails immediately rather than retrying", threw !== null && bad === 1, `attempts=${bad}`);
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

// The exact failure from the first live run: the tier name was read from the
// wrong path, so every count was zero and the row looked writable.
let threw = null;
try {
  ll.assertSnapshotUsable({ counts: { Blue: 0, Silver: 0, Gold: 0, Platinum: 0 }, customers: 21240, members: 11909, tiered: 0 });
} catch (e) { threw = e; }
check("all-zero tiers with customers scanned REFUSES to write", threw !== null);
check("and says it is a parsing failure, not an empty programme",
  /parsing failure/.test(threw?.message ?? ""));
check("and names the correct field path",
  /loyalty_tier_membership\.loyalty_tier\.name/.test(threw?.message ?? ""));

let partial = null;
try {
  ll.assertSnapshotUsable({ counts: { Blue: 100, Silver: 0, Gold: 0, Platinum: 0 }, customers: 21240, members: 11909, tiered: 100 });
} catch (e) { partial = e; }
check("mostly-unresolved tiers also refuse", partial !== null, partial?.message?.slice(0, 40));

let ok = null;
try {
  ll.assertSnapshotUsable({ counts: { Blue: 10023, Silver: 1137, Gold: 523, Platinum: 193 }, customers: 21240, members: 11909, tiered: 11876 });
} catch (e) { ok = e; }
check("the real distribution passes", ok === null, ok?.message);

// The old "outstanding must be less than approved" invariant was REMOVED: it
// was built on the wrong reading of points_approved and is false under the
// correct definition. These assert it is genuinely gone.
const realCounts = { Blue: 10023, Silver: 1137, Gold: 523, Platinum: 193 };
let correctDefinition = null;
try {
  ll.assertSnapshotUsable({
    counts: realCounts, customers: 21240, members: 11909, tiered: 11876,
    // outstanding === approved is now CORRECT and must not be blocked.
    points: { outstanding: 8_604_319, approved: 8_604_319, spent: 1_599_090 },
  });
} catch (e) { correctDefinition = e; }
check("outstanding === approved is allowed (old invariant is gone)",
  correctDefinition === null, correctDefinition?.message);

let negative = null;
try {
  ll.assertSnapshotUsable({ counts: realCounts, customers: 21240, members: 11909, tiered: 11876,
    points: { outstanding: -5, approved: 100, spent: 200 } });
} catch (e) { negative = e; }
check("negative outstanding still refuses", negative !== null);

let zeroPoints = null;
try {
  ll.assertSnapshotUsable({ counts: realCounts, customers: 21240, members: 11909, tiered: 11876,
    points: { outstanding: 0, approved: 0, spent: 0 } });
} catch (e) { zeroPoints = e; }
check("members holding zero points between them refuses", zeroPoints !== null);

// Day-over-day check, which replaces the removed invariant.
let jumped = null;
try { ll.checkDailyMove(20_000_000, { snapshot_date: "2026-08-26", points_outstanding: 8_600_000 }); }
catch (e) { jumped = e; }
check("a 133% overnight jump refuses to write", jumped !== null);
check("and blames the definition, not the business",
  /definition has not changed/.test(jumped?.message ?? ""));
check("ordinary daily movement passes",
  (() => { try { ll.checkDailyMove(8_650_000, { snapshot_date: "2026-08-26", points_outstanding: 8_600_000 }); return true; } catch { return false; } })());
check("no previous snapshot is not an error",
  (() => { try { ll.checkDailyMove(8_650_000, null); return true; } catch { return false; } })());

check("an empty account is not treated as a failure",
  (() => { try { ll.assertSnapshotUsable({ counts: { Blue: 0, Silver: 0, Gold: 0, Platinum: 0 }, customers: 0, members: 0, tiered: 0 }); return true; } catch { return false; } })());

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

// Band now sits on LoyaltyLion's own accounting figure, 8,776,473.
check("the correct figure passes the band",
  capture(() => ll.reportPointsLiability(8_604_319, 21240)).includes("within the expected band"));
check("the rejected approved-minus-spent figure trips it",
  capture(() => ll.reportPointsLiability(6_585_035, 21240)).includes("outside the expected band"));
check("the run states points_approved is a balance",
  capture(() => ll.reportPointsLiability(8_604_319, 21240)).includes("CURRENT BALANCE"));
check("and warns not to subtract points_spent",
  capture(() => ll.reportPointsLiability(8_604_319, 21240)).includes("Do not subtract points_spent"));
check("liability converts at 100 points = 1 JOD",
  capture(() => ll.reportPointsLiability(8_604_319, 21240)).includes("86,043 JOD"));

/* ---------------------------------------------------------- redaction -- */
group("secret redaction");
process.env.KLAVIYO_API_KEY = "pk_thisisaverysecretklaviyokey123456";
// Fixtures deliberately avoid Shopify's real token shape (shpat_ + 32 HEX).
// A hex-shaped fake matches GitHub's secret scanner and blocks the push, even
// though it is invented. These contain non-hex letters, so they exercise the
// redactor without tripping the scanner.
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
