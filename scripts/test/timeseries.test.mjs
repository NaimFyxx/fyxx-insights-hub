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

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
