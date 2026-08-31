/**
 * Tests for the App vs Website aggregation. The TS source is transpiled on the
 * fly by stripping types — these are plain functions with no runtime deps.
 *
 *   node scripts/test/timeseries.test.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Transpile with the real TypeScript compiler rather than stripping types by
// regex — a hand-rolled stripper silently mangles valid code, which is how the
// first version of this file failed.
const root = fileURLToPath(new URL("../..", import.meta.url));
const out = mkdtempSync(join(tmpdir(), "fyxx-ts-"));
try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    ["src/lib/timeseries.ts", "--outDir", out, "--module", "esnext", "--target", "es2022",
     "--moduleResolution", "bundler", "--skipLibCheck"],
    { cwd: root, stdio: "pipe" },
  );
} catch {
  // tsc exits non-zero on the unresolvable "@/lib/queries" type-only import,
  // which it still erases correctly. Emit is what matters, not the exit code.
}
const m = await import(`file://${join(out, "timeseries.js")}`);

let failed = 0;
const check = (n, c, d = "") => { if (!c) failed++; console.log(`${c ? "  ok  " : "FAIL  "}${n}${d ? `  — ${d}` : ""}`); };
const group = (n) => console.log(`\n${n}`);

const rows = [
  { date: "2026-08-03", sub_channel: "Mobile App", total_online_revenue_jod: 1000, orders: 20 },
  { date: "2026-08-03", sub_channel: "Website",    total_online_revenue_jod: 100,  orders: 4  },
  { date: "2026-08-04", sub_channel: "Mobile App", total_online_revenue_jod: 500,  orders: 10 },
  { date: "2026-08-10", sub_channel: "Mobile App", total_online_revenue_jod: 800,  orders: 16 },
  { date: "2026-08-10", sub_channel: "Website",    total_online_revenue_jod: 200,  orders: 5  },
  { date: "2026-08-10", sub_channel: "Draft Orders", total_online_revenue_jod: 9999, orders: 99 },
  { date: "2026-08-10", sub_channel: "POS",        total_online_revenue_jod: 8888, orders: 88 },
];

group("bucketing");
check("weeks anchor to Monday", m.bucketOf("2026-08-05", "weekly") === "2026-08-03", m.bucketOf("2026-08-05","weekly"));
check("a Monday is its own week", m.bucketOf("2026-08-03", "weekly") === "2026-08-03");
check("a Sunday belongs to the week that began", m.bucketOf("2026-08-09", "weekly") === "2026-08-03");
check("months anchor to the 1st", m.bucketOf("2026-08-27", "monthly") === "2026-08-01");
check("daily is itself", m.bucketOf("2026-08-27", "daily") === "2026-08-27");

group("series");
const weekly = m.buildSeries(rows, "weekly");
check("two weeks produced", weekly.length === 2, `${weekly.length}`);
check("Draft Orders and POS are excluded entirely",
  weekly[0].app.revenue === 1500 && weekly[0].web.revenue === 100,
  `app=${weekly[0].app.revenue} web=${weekly[0].web.revenue}`);
check("orders aggregate", weekly[0].app.orders === 30);
check("AOV is revenue over orders", weekly[0].app.aov === 50);
check("AOV is 0, not NaN, when there are no orders",
  m.buildSeries([{ date:"2026-08-03", sub_channel:"Website", total_online_revenue_jod:0, orders:0 }], "weekly")[0].web.aov === 0);
check("website share computed against the two online channels only",
  Math.abs(weekly[0].webShare - (100 * 100 / 1600)) < 1e-9, String(weekly[0].webShare));
check("share is null, not 0, when neither channel has revenue",
  m.buildSeries([{ date:"2026-08-03", sub_channel:"Website", total_online_revenue_jod:0, orders:0 }], "weekly")[0].webShare === null);
check("buckets are chronological", weekly[0].bucket < weekly[1].bucket);

group("switchover warning");
check("a range covering Aug 2025 is flagged", m.spansSwitchover("2025-01-01", "2026-08-28"));
check("a range ending before it is not", !m.spansSwitchover("2025-01-01", "2025-07-01"));
check("a range starting after it is not", !m.spansSwitchover("2025-09-01", "2026-01-01"));
check("a range touching only the first day is flagged", m.spansSwitchover("2025-08-04", "2025-08-04"));

group("year-on-year");
const ly = m.sameRangeLastYear("2026-08-01", "2026-08-28");
check("shifts back exactly one year", ly.from === "2025-08-01" && ly.to === "2025-08-28", `${ly.from}..${ly.to}`);
check("a YoY window over August spans the switchover — the trap",
  m.spansSwitchover(ly.from, ly.to), "comparing Appmaker against Shopney");

group("noise note");
const noisy = Array.from({ length: 8 }, (_, i) => ({
  bucket: `w${i}`, app: { orders: 400 }, web: { orders: 40 }, webShare: 5,
}));
const webNote = m.noiseNote(noisy, "web", "weekly");
const appNote = m.noiseNote(noisy, "app", "weekly");
check("website is flagged as noisy", webNote !== null && /±16%/.test(webNote), webNote?.slice(0, 60));
check("the app is not flagged", appNote === null);
check("too few buckets produces no claim", m.noiseNote([{ app:{orders:1}, web:{orders:1} }], "web", "weekly") === null);

group("concentration flag — the real 8 August case");
{
  // Actual stored rows for Website, week of 3 Aug 2026. Order count was NORMAL
  // at 49; two orders on the 8th were 30% of the week. A revenue line cannot
  // show that, which is the entire point of this flag.
  const wk = [
    { date:"2026-08-03", sub_channel:"Website", total_online_revenue_jod:324.16,  orders:7,  top_order_values:[112.35,50,40.95,34,32] },
    { date:"2026-08-04", sub_channel:"Website", total_online_revenue_jod:381.15,  orders:8,  top_order_values:[136,84.15,36,36,29] },
    { date:"2026-08-05", sub_channel:"Website", total_online_revenue_jod:282.11,  orders:6,  top_order_values:[149.48,36.95,30,29,19.38] },
    { date:"2026-08-06", sub_channel:"Website", total_online_revenue_jod:739.39,  orders:10, top_order_values:[183.7,110,105.7,82.5,63.99] },
    { date:"2026-08-07", sub_channel:"Website", total_online_revenue_jod:219.746, orders:6,  top_order_values:[50,45.496,43,29.25,27] },
    { date:"2026-08-08", sub_channel:"Website", total_online_revenue_jod:1191.28, orders:8,  top_order_values:[533.58,470,53.97,43.98,34] },
    { date:"2026-08-09", sub_channel:"Website", total_online_revenue_jod:154.656, orders:4,  top_order_values:[56.99,47,29.676,20.99] },
  ];
  const c = m.concentrationOf(wk, "2026-08-03", "Website", "weekly");
  check("the real spike week is flagged", c !== null, c?.note?.slice(0, 70));
  check("it names a small number of orders", c !== null && c.topN <= 4, `topN=${c?.topN}`);
  check("and a share of at least 30%", c !== null && c.share >= 30, `${c?.share?.toFixed(0)}%`);

  // A normal week must NOT be flagged, or the warning becomes noise.
  const normal = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-07-2${i}`, sub_channel: "Website", total_online_revenue_jod: 260, orders: 7,
    top_order_values: [45, 42, 40, 38, 35],
  }));
  check("an ordinary week is not flagged", m.concentrationOf(normal, m.bucketOf("2026-07-20","weekly"), "Website", "weekly") === null);

  check("works for any channel, not just the two online ones",
    m.concentrationOf([{ date:"2026-08-03", sub_channel:"Draft Orders", total_online_revenue_jod:5000, orders:12,
      top_order_values:[3364.22,900,300,100,50] }], "2026-08-03", "Draft Orders", "weekly") !== null);
}


/* ===========================================================================
 * tierSeriesWithGaps — a missed loyalty night must BREAK the line.
 *
 * The only irrecoverable loss in the system: LoyaltyLion answers "what is true
 * now" and keeps no history, so a night not recorded is gone for good. A chart
 * that draws through the gap asserts a measurement nobody took.
 * ======================================================================== */
{
  const row = (d, blue) => ({
    snapshot_date: d, blue_members: blue,
    silver_members: 10, gold_members: 5, platinum_members: 1,
  });

  const withHole = m.tierSeriesWithGaps([
    row("2026-08-27", 100), row("2026-08-28", 110),
    row("2026-09-01", 150), row("2026-09-02", 160),
  ]);
  check("every calendar day in the span is present", withHole.length === 7, `${withHole.length} points`);
  check("no date is skipped",
    withHole.map((p) => p.date).join(",") ===
      "2026-08-27,2026-08-28,2026-08-29,2026-08-30,2026-08-31,2026-09-01,2026-09-02");
  const nulls = withHole.filter((p) => p.Blue === null).map((p) => p.date);
  check("the three missing nights are null", nulls.join(",") === "2026-08-29,2026-08-30,2026-08-31", nulls.join(" "));
  // The distinction that matters. A zero would draw the programme emptying to
  // nothing and refilling overnight; null draws a break.
  check("an unmeasured night is null, NEVER zero",
    withHole.every((p) => p.Blue === null || p.Blue > 0));

  const contiguous = m.tierSeriesWithGaps([
    row("2026-08-27", 100), row("2026-08-28", 110), row("2026-08-29", 120),
  ]);
  check("a contiguous run gains no rows", contiguous.length === 3);
  check("no nulls when nothing is missing", contiguous.every((p) => p.Blue !== null));

  const unsorted = m.tierSeriesWithGaps([
    row("2026-08-29", 120), row("2026-08-27", 100), row("2026-08-28", 110),
  ]);
  check("unsorted input does not fabricate a span",
    unsorted.map((p) => p.date).join(",") === contiguous.map((p) => p.date).join(","));

  check("empty input is empty, not a crash", m.tierSeriesWithGaps([]).length === 0);
  check("a single day is one point", m.tierSeriesWithGaps([row("2026-08-27", 100)]).length === 1);
}

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
