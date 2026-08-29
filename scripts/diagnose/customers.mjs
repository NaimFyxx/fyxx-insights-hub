#!/usr/bin/env node
/**
 * Customer population: how many, how many buy, how concentrated, and how many
 * we can actually reach. Read-only, writes nothing.
 *
 *   node scripts/diagnose/customers.mjs [--cache customers.json]
 *
 * Field semantics, verified against 808 customers whose entire order history
 * falls inside the swept window and who have at least one cancelled order:
 *
 *   numberOfOrders  INCLUDES cancelled orders. 808 of 808 matched the
 *                   all-orders count; none matched the non-cancelled count.
 *                   Netting is required before quoting it.
 *   amountSpent     Mostly excludes cancelled orders, but NOT reliably: 572 of
 *                   808 matched the non-cancelled sum, 175 matched the
 *                   all-orders sum, 61 matched neither. Good enough for
 *                   ranking, not for a revenue figure. Compute per-customer
 *                   revenue from orders when precision matters.
 *
 * House accounts are identified by TAG, not by order count. Venue tables
 * ("Table 4", "Terrace 7"), "By The Glass" and "Free of Charge Goods FOC" carry
 * CUSTOMER_INTERNAL; staff carry "CUSTOMER TYPE_Employee". Excluding by order
 * count instead would wrongly drop genuine top customers: one real buyer has
 * 708 orders and 79,840 JOD with no internal tag.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnv } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { gql } from "../lib/shopify.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CACHE = argOf("--cache", "");

const n0 = (v) => Math.round(v).toLocaleString("en-US");
const pc = (a, b) => (b > 0 ? ((100 * a) / b).toFixed(1) + "%" : "-");

const Q = `query($cursor:String){ customers(first:250, after:$cursor, sortKey:CREATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{ id displayName createdAt numberOfOrders amountSpent{amount}
         email phone emailMarketingConsent{marketingState}
         smsMarketingConsent{marketingState} tags } } }`;

async function sweep() {
  const out = []; let cursor = null, pages = 0;
  do {
    const d = await gql(Q, { cursor }, `customers page ${pages + 1}`);
    for (const c of d.customers.nodes ?? []) out.push({
      id: String(c.id).split("/").pop(), name: c.displayName, created: c.createdAt?.slice(0, 10),
      orders: Number(c.numberOfOrders ?? 0), spent: Number(c.amountSpent?.amount ?? 0),
      email: Boolean(c.email), phone: Boolean(c.phone),
      emailConsent: c.emailMarketingConsent?.marketingState ?? null,
      smsConsent: c.smsMarketingConsent?.marketingState ?? null, tags: c.tags ?? [],
    });
    cursor = d.customers.pageInfo?.hasNextPage ? d.customers.pageInfo.endCursor : null;
    pages++;
    if (pages % 20 === 0) log.info(`  ${pages} pages, ${out.length} customers`);
  } while (cursor && pages < 500);
  return out;
}

let all;
if (CACHE && existsSync(CACHE)) { all = JSON.parse(readFileSync(CACHE, "utf8")); log.ok(`${all.length} customers from cache`); }
else { all = await sweep(); if (CACHE) writeFileSync(CACHE, JSON.stringify(all)); log.ok(`${all.length} customers`); }

export const isHouseAccount = (c) =>
  c.tags.some((t) => /^CUSTOMER_INTERNAL$/i.test(t) || /CUSTOMER TYPE_Employee/i.test(t));

const house = all.filter(isHouseAccount);
const real = all.filter((c) => !isHouseAccount(c));
const buyers = real.filter((c) => c.orders > 0);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const allOrders = sum(all, (x) => x.orders);

console.log("\n=== POPULATION ===\n");
console.log(`  customer records        ${n0(all.length).padStart(9)}`);
console.log(`  house / employee        ${n0(house.length).padStart(9)}  ${pc(house.length, all.length)} of records, ` +
            `${pc(sum(house, (x) => x.orders), allOrders)} of orders, ${n0(sum(house, (x) => x.spent))} JOD`);
console.log(`  real customers          ${n0(real.length).padStart(9)}`);
console.log(`    ever ordered          ${n0(buyers.length).padStart(9)}  ${pc(buyers.length, real.length)}`);
console.log(`    never ordered         ${n0(real.length - buyers.length).padStart(9)}  ${pc(real.length - buyers.length, real.length)}`);

console.log("\n=== CONCENTRATION (real customers only) ===\n");
const ro = sum(buyers, (x) => x.orders), rs = sum(buyers, (x) => x.spent);
for (const [label, lo, hi] of [["1 order", 1, 1], ["2-3", 2, 3], ["4-11", 4, 11], ["12+", 12, null]]) {
  const g = buyers.filter((x) => x.orders >= lo && (hi ? x.orders <= hi : true));
  console.log(`  ${label.padEnd(9)} ${n0(g.length).padStart(7)} buyers ${pc(g.length, buyers.length).padStart(7)}` +
              `   ${pc(sum(g, (x) => x.orders), ro).padStart(7)} of orders   ${pc(sum(g, (x) => x.spent), rs).padStart(7)} of spend`);
}

console.log("\n=== THE REACHABLE CEILING ===\n");
const sub = (x) => x.emailConsent === "SUBSCRIBED", sms = (x) => x.smsConsent === "SUBSCRIBED";
const unreachable = buyers.filter((x) => !sub(x) && !sms(x));
for (const [k, v] of [
  ["have an email address", real.filter((x) => x.email).length],
  ["email SUBSCRIBED", real.filter(sub).length],
  ["have a phone number", real.filter((x) => x.phone).length],
  ["SMS SUBSCRIBED", real.filter(sms).length],
  ["reachable on either", real.filter((x) => sub(x) || sms(x)).length],
]) console.log(`  ${k.padEnd(24)} ${n0(v).padStart(9)} ${pc(v, real.length).padStart(8)}`);
console.log(`\n  BUYERS WE CANNOT REACH  ${n0(unreachable.length).padStart(9)} ${pc(unreachable.length, buyers.length).padStart(8)} of buyers`);
console.log(`  their lifetime spend    ${n0(sum(unreachable, (x) => x.spent)).padStart(9)} JOD ${pc(sum(unreachable, (x) => x.spent), rs).padStart(7)} of all spend`);
