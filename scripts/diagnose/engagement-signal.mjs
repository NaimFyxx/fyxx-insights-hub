#!/usr/bin/env node
/**
 * Which engagement metric actually carries information?
 *
 *   node scripts/diagnose/engagement-signal.mjs [--min-sent 50]
 *
 * Written because "open rate is unusable, use clicks" is received wisdom, and
 * received wisdom is exactly the category this project keeps finding to be
 * wrong. So it is measured on our own campaigns instead.
 *
 * Two questions, and they are different:
 *
 *   DISCRIMINATION — does the metric separate campaigns from each other? A
 *   metric squeezed into a narrow band cannot rank anything, however
 *   accurately it is measured. Compared as relative spread (sd / mean), which
 *   is unit-free and so comparable between a 45% figure and a 1.4% one.
 *
 *   PREDICTION — does it move with the outcome we care about? Correlation
 *   against revenue per delivered message and against order rate.
 *
 * Re-run this rather than re-estimating ENGAGEMENT_SIGNAL in
 * src/lib/engagement.ts, and update the constants from the output.
 */
import { loadEnv } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { selectAll } from "../lib/db.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MIN_SENT = Number(argOf("--min-sent", 50));

const rows = (
  await selectAll("klaviyo_campaigns", "select=name,sent,delivered,opened,clicked,orders,revenue_jod")
).filter((c) => Number(c.sent) >= MIN_SENT && Number(c.delivered) > 0);

if (rows.length < 8) {
  log.warn(`only ${rows.length} campaign(s) at >= ${MIN_SENT} recipients — too few to conclude anything`);
  process.exit(0);
}

const openRate = rows.map((c) => Number(c.opened) / Number(c.delivered));
const clickRate = rows.map((c) => Number(c.clicked) / Number(c.delivered));
const revPer = rows.map((c) => Number(c.revenue_jod) / Number(c.delivered));
const orderRate = rows.map((c) => Number(c.orders) / Number(c.delivered));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const corr = (xs, ys) => {
  const mx = mean(xs), my = mean(ys);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    n += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? n / Math.sqrt(dx * dy) : 0;
};
const p = (x) => (100 * x).toFixed(1) + "%";
const r3 = (x) => x.toFixed(3);

console.log(`\n=== ${rows.length} campaigns, ${MIN_SENT}+ recipients ===\n`);
console.log("DISCRIMINATION — can the metric tell campaigns apart?\n");
console.log(`  open rate    ${p(Math.min(...openRate))} … ${p(Math.max(...openRate))}   mean ${p(mean(openRate))}   relative spread ${(sd(openRate) / mean(openRate)).toFixed(2)}`);
console.log(`  click rate   ${p(Math.min(...clickRate))} … ${p(Math.max(...clickRate))}   mean ${p(mean(clickRate))}   relative spread ${(sd(clickRate) / mean(clickRate)).toFixed(2)}`);
const ratio = (sd(clickRate) / mean(clickRate)) / (sd(openRate) / mean(openRate));
console.log(`\n  Click rate carries ${ratio.toFixed(1)}x the relative spread of open rate.`);

console.log("\nPREDICTION — does it move with the outcome?\n");
console.log(`  open rate  vs revenue per delivered   ${r3(corr(openRate, revPer))}`);
console.log(`  click rate vs revenue per delivered   ${r3(corr(clickRate, revPer))}`);
console.log(`  open rate  vs order rate              ${r3(corr(openRate, orderRate))}`);
console.log(`  click rate vs order rate              ${r3(corr(clickRate, orderRate))}`);
console.log(`  open rate  vs click rate              ${r3(corr(openRate, clickRate))}`);

const oR = corr(openRate, revPer), cR = corr(clickRate, revPer);
console.log(`\n  Clicks explain ~${Math.round(cR * cR * 100)}% of the variance in revenue; opens ~${Math.round(oR * oR * 100)}%.`);
console.log(`\n  Apple Mail pre-fetching inflates opens and the inflation is unknowable, so a`);
console.log(`  high open rate is partly a measure of how many iPhones are on the list. The`);
console.log(`  numbers above are the reason to prefer clicks, not the theory.\n`);
