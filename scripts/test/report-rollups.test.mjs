/**
 * Tests for the monthly report's aggregation: the flows table and the push
 * table that Zeid's approved template asks for.
 *
 * These exist because the push table was rewritten from "biggest senders by
 * name" to "grouped by type", and the row labels in the flows table are read
 * off the page by someone who cannot click anything. A label or a total that
 * silently changes is indistinguishable from a figure that changed.
 *
 *   node scripts/test/report-rollups.test.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const out = mkdtempSync(join(tmpdir(), "fyxx-ts-"));
try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    ["src/lib/rollups.ts", "--outDir", out, "--module", "esnext", "--target", "es2022",
     "--moduleResolution", "bundler", "--skipLibCheck"],
    { cwd: root, stdio: "pipe" },
  );
} catch {
  // tsc exits non-zero on the unresolvable type-only "@/lib/queries" import,
  // which it still erases correctly. Emit is what matters, not the exit code.
}
const m = await import(`file://${join(out, "rollups.js")}`);

let failed = 0;
const check = (n, c, d = "") => {
  if (!c) failed++;
  console.log(`${c ? "  ok  " : "FAIL  "}${n}${d ? `  (${d})` : ""}`);
};
const group = (n) => console.log(`\n${n}`);

const flow = (name, recipients, revenue, extra = {}) => ({
  flow_name: name,
  recipients,
  delivered: recipients,
  opened: extra.opened ?? 0,
  clicked: 0,
  conversions: extra.conversions ?? 0,
  revenue_jod: revenue,
});

group("flows: row labels the report prints verbatim");
{
  // Ten flows that sent, so there is a top 8 and a remainder.
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push(flow(`Flow ${i}`, 100 * i, 1000 - i));
  const r = m.rollUpFlows(rows);
  check("top is capped at 8", r.top.length === 8, `got ${r.top.length}`);
  check("top is ordered by revenue, highest first", r.top[0].name === "Flow 1");
  check(
    'the rolled-up row is "All other flows with sends (n)"',
    r.other.name === "All other flows with sends (2)",
    r.other.name,
  );
  check('the total row is "All flows"', r.total.name === "All flows", r.total.name);
  check(
    "the total covers every flow that sent, not just the top 8",
    r.total.recipients === rows.reduce((a, f) => a + f.recipients, 0),
    `${r.total.recipients}`,
  );
  check(
    "top plus other equals the total, so the table adds up on the page",
    r.top.reduce((a, f) => a + f.recipients, 0) + r.other.recipients === r.total.recipients,
  );
}

group("flows: a flow that exists but did not send");
{
  const r = m.rollUpFlows([flow("Sent", 50, 10), flow("Silent", 0, 0)]);
  check("is left out rather than shown as a zero row", r.top.length === 1 && r.top[0].name === "Sent");
  check("and is not counted in the total", r.total.recipients === 50);
  check("no rollup row appears when nothing is left over", r.other === null);
}

group("flows: the same flow across many days");
{
  // 985 rows across September is one row per flow message per day, so the
  // table only means anything if same-name rows are summed.
  const r = m.rollUpFlows([flow("Welcome", 10, 5), flow("Welcome", 7, 3), flow("Welcome", 3, 2)]);
  check("is one row", r.top.length === 1);
  check("with recipients summed", r.top[0].recipients === 20);
  check("and revenue summed", r.top[0].revenue === 10);
}

const push = (type, sent, opened) => ({
  source_type: type,
  source_name: "x",
  sent,
  delivered: sent,
  opened,
  conversions: 0,
  revenue_jod: 0,
});

group("push: grouped by type, September 2026 figures");
{
  // The real shape of a month: 4 campaign sends and hundreds of flow sends.
  const rows = [push("Campaign", 30540, 152)];
  for (let i = 0; i < 492; i++) rows.push(push("Flow", 17, 1));
  const r = m.rollUpPushByType(rows);
  check("two rows, not one per message", r.types.length === 2, `got ${r.types.length}`);
  check("campaign sends are summed", r.types[0].sent === 30540);
  check("campaign opens are summed", r.types[0].opened === 152);
  check("flow sends are summed", r.types[1].sent === 492 * 17);
  check(
    "the total equals the rows above it",
    r.total.sent === r.types[0].sent + r.types[1].sent,
    `${r.total.sent}`,
  );
  check('the total row is labelled "Total"', r.total.name === "Total");
}

// Ordering is checked ONLY with the smaller type first, because when
// Campaigns happen to be the biggest sender a plain volume sort passes too.
// The first version of this file made exactly that mistake: deleting the rank
// comparator broke nothing, because every fixture put Campaigns on top anyway.
group("push: Campaigns lead even in a month where Flows sent more");
{
  const r = m.rollUpPushByType([push("Flow", 90000, 900), push("Campaign", 10, 1)]);
  check("Campaigns first", r.types[0].name === "Campaigns", r.types.map((t) => t.name).join(", "));
  check("Flows second", r.types[1].name === "Flows");
  check("and the total still covers both", r.total.sent === 90010);
}

group("push: a type Klaviyo has not sent us before");
{
  // Deliberately the LARGEST sender, so a volume-only sort would put it first.
  const r = m.rollUpPushByType([push("Transactional", 999, 9), push("Campaign", 10, 1)]);
  check(
    "is kept under its own name rather than folded into Campaigns or Flows",
    r.types.some((t) => t.name === "Transactional"),
    r.types.map((t) => t.name).join(", "),
  );
  check("and is counted in the total", r.total.sent === 1009);
  check("but sorts after the two known types", r.types[0].name === "Campaigns");
}

group("push: a type with no sends");
{
  const r = m.rollUpPushByType([push("Campaign", 10, 1), push("Flow", 0, 0)]);
  check("is dropped rather than printed as a zero row", r.types.length === 1, r.types.length);
  check("and the total is unaffected", r.total.sent === 10);
}

group("push: an empty month");
{
  const r = m.rollUpPushByType([]);
  check("has no rows", r.types.length === 0);
  check("and a zero total rather than a crash", r.total.sent === 0 && r.total.name === "Total");
}

const monthly = (name, channel, recipients, delivered, opened, buyers = 0, orders = 0) => ({
  month: "2026-09-01", flow_id: "F" + name, flow_message_id: "M" + name + channel,
  send_channel: channel, flow_name: name,
  recipients, delivered, opened, clicked: 0,
  conversions: orders, unique_buyers: buyers, revenue_jod: 0,
});

group("flows table reads WHOLE-MONTH opens, never the daily sum");
{
  // The bug: Klaviyo counts unique people inside the window asked about, so
  // daily opens cannot be added up. September 2026 review-request-judgeme
  // summed to 1,298 against Klaviyo's 761 for the month.
  const r = m.rollUpFlowsMonthly([
    monthly("review-request-judgeme", "email", 1366, 1362, 387, 17, 34),
    monthly("review-request-judgeme", "email", 1403, 1400, 374, 37, 64),
    // Push sent BY a flow belongs in the push table, not this one.
    monthly("review-request-judgeme", "push", 500, 499, 40, 9, 11),
  ]);
  check("push rows are excluded from the flows table", r.total.recipients === 1366 + 1403,
    `${r.total.recipients}`);
  check("the month's opens are Klaviyo's 761", r.total.opened === 761, `${r.total.opened}`);
  check("open rate is 27.6 per cent, not 47",
    Math.abs((r.total.opened / r.total.delivered) * 100 - 27.55) < 0.05,
    ((r.total.opened / r.total.delivered) * 100).toFixed(2));

  // Conv. rate divides BUYERS by delivered, not orders. 98 orders came from
  // 54 people, so dividing orders reads 3.5 per cent against Klaviyo's 2.0.
  check("unique buyers are summed, orders are not mistaken for them",
    r.total.uniqueBuyers === 54, `${r.total.uniqueBuyers}`);
  check("orders are still carried separately", r.total.conversions === 98,
    `${r.total.conversions}`);
  check("conv rate is 2.0 per cent, not 3.5",
    Math.abs((r.total.uniqueBuyers / r.total.delivered) * 100 - 1.96) < 0.05,
    ((r.total.uniqueBuyers / r.total.delivered) * 100).toFixed(2));
  check("push buyers are not folded into the email flows table",
    r.total.uniqueBuyers !== 54 + 9);
}

group("push table takes each row from the source that is right for it");
{
  // Campaign push is fetched in ONE call and is correct. Flow push is fetched
  // per day, so its opens must come from the monthly figures instead.
  const campaignPush = [
    { source_type: "Campaign", source_name: "x", sent: 30540, delivered: 30399, opened: 152 },
    // A flow push row from the daily table, carrying the inflated 308.
    { source_type: "Flow", source_name: "y", sent: 8658, delivered: 8635, opened: 308 },
  ];
  const r = m.pushByTypeForMonth(campaignPush, [monthly("f", "push", 8658, 8635, 274)]);
  // Looked up by NAME, not by index. Indexing blew up with a TypeError when a
  // regression dropped the Flows row, which killed the run and hid every check
  // after it; a missing row should read as one failure, not as a crash.
  const row = (n) => r.types.find((t) => t.name === n) ?? { sent: 0, delivered: 0, opened: -1 };
  check("campaign opens come from the campaign rows", row("Campaigns").opened === 152);
  check("there is a Flows row at all", r.types.some((t) => t.name === "Flows"),
    r.types.map((t) => t.name).join(", ") || "no rows");
  check("flow opens come from the monthly figure, not the daily 308",
    row("Flows").opened === 274, `${row("Flows").opened}`);
  check("the daily flow-push row is not double counted into sends",
    r.total.sent === 30540 + 8658, `${r.total.sent}`);
  check("total opens are 426, not 460", r.total.opened === 426, `${r.total.opened}`);
}

group("a range is only a whole month when it is exactly one");
{
  check("1 to 30 September", m.wholeMonthOf({ from: "2026-09-01", to: "2026-09-30" }) === "2026-09-01");
  check("February in a leap year", m.wholeMonthOf({ from: "2024-02-01", to: "2024-02-29" }) === "2024-02-01");
  check("February in a common year", m.wholeMonthOf({ from: "2026-02-01", to: "2026-02-28" }) === "2026-02-01");
  check("a month one day short is not", m.wholeMonthOf({ from: "2026-09-01", to: "2026-09-29" }) === null);
  check("a month one day over is not", m.wholeMonthOf({ from: "2026-09-01", to: "2026-10-01" }) === null);
  check("not starting on the first is not", m.wholeMonthOf({ from: "2026-09-02", to: "2026-09-30" }) === null);
  check("two whole months is not one", m.wholeMonthOf({ from: "2026-09-01", to: "2026-10-31" }) === null);
  check("31-day month", m.wholeMonthOf({ from: "2026-08-01", to: "2026-08-31" }) === "2026-08-01");
}

console.log(`\n${failed === 0 ? "all checks passed" : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
