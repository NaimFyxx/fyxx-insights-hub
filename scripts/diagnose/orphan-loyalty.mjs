#!/usr/bin/env node
/**
 * Real customers whose loyalty is attached to an account that is not them.
 *
 *   node scripts/diagnose/orphan-loyalty.mjs
 *
 * Found by accident: "Table 8" is enrolled in LoyaltyLion under
 * emilija.georgieva@eda.admin.ch. Someone gave their email at the till, the
 * sale was rung against a shared table account, and LoyaltyLion enrolled the
 * TABLE under that person's address. They earn nothing.
 *
 * The first three were found by checking accounts we already suspected. This
 * goes the other way: every LoyaltyLion member, checked against what Shopify
 * says about the customer it is attached to. Three cases and twenty cases are
 * different problems.
 *
 * Two signals, deliberately kept separate because they catch different things:
 *
 *   INTERNAL   the member is attached to an account we classify as internal —
 *              a venue table, a write-off, a staff account. Anyone enrolled
 *              here is enrolled against a thing, not a person.
 *
 *   NO_EMAIL_IN_SHOPIFY
 *              LoyaltyLion holds an email address that Shopify has no record
 *              of for that customer. That address came from somewhere else —
 *              in every confirmed case, the till.
 *
 * Read-only. Reports; changes nothing.
 */
import { loadEnv } from "../lib/env.mjs";
import { log } from "../lib/log.mjs";
import { paginate } from "../lib/loyaltylion.mjs";
import { selectAll } from "../lib/db.mjs";

loadEnv();
const n0 = (v) => Math.round(v).toLocaleString("en-US");

// What Shopify says. shopify_customers deliberately stores has_email rather
// than the address itself, so the comparison is "does Shopify know of ANY
// address for this customer", not a string match.
const shop = new Map(
  (
    await selectAll(
      "shopify_customers",
      "select=shopify_customer_id,display_name,has_email,is_house_account,orders_lifetime,revenue_jod",
    )
  ).map((c) => [String(c.shopify_customer_id), c]),
);
const excluded = new Set(
  (await selectAll("excluded_accounts", "select=shopify_customer_id")).map((x) =>
    String(x.shopify_customer_id),
  ),
);
log.ok(`${n0(shop.size)} Shopify customers, ${n0(excluded.size)} classified internal`);

const findings = [];
let members = 0;
let scanned = 0;
let noMerchantId = 0;

for await (const batch of paginate("/customers", "customers", "customers")) {
  for (const c of batch) {
    scanned++;
    if (!c.enrolled) continue;
    members++;

    const mid = c.merchant_id ? String(c.merchant_id) : null;
    if (!mid) {
      noMerchantId++;
      continue;
    }
    const s = shop.get(mid);
    const reasons = [];

    if (excluded.has(mid)) reasons.push("INTERNAL");
    // An address LoyaltyLion holds and Shopify does not is the signature of
    // the till capture. Only meaningful when we have the Shopify row at all.
    if (c.email && s && !s.has_email) reasons.push("NO_EMAIL_IN_SHOPIFY");
    if (!s) reasons.push("NOT_IN_SHOPIFY");

    if (!reasons.length) continue;
    findings.push({
      reasons,
      ll_id: c.id,
      merchant_id: mid,
      ll_email: c.email ?? null,
      ll_name: c.untrusted_data?.name ?? null,
      shopify_name: s?.display_name ?? null,
      shopify_has_email: s?.has_email ?? null,
      internal: excluded.has(mid),
      blocked: !!c.blocked,
      guest: !!c.guest,
      points: Number(c.points_approved ?? 0),
      spent: Number(c.points_spent ?? 0),
      enrolled_at: c.enrolled_at ?? null,
      orders: s?.orders_lifetime ?? null,
      revenue: s ? Number(s.revenue_jod ?? 0) : null,
    });
  }
  if (scanned % 5000 === 0) log.info(`  ${n0(scanned)} scanned, ${n0(findings.length)} flagged`);
}

log.ok(`${n0(scanned)} LoyaltyLion records, ${n0(members)} enrolled members`);
if (noMerchantId) log.info(`  ${n0(noMerchantId)} members carry no merchant_id and were skipped`);

const has = (f, r) => f.reasons.includes(r);
const orphans = findings.filter((f) => has(f, "INTERNAL") && f.ll_email);
const tillCapture = findings.filter((f) => has(f, "NO_EMAIL_IN_SHOPIFY"));

console.log("\n=== A REAL PERSON'S EMAIL ON AN INTERNAL ACCOUNT ===");
console.log("    The recoverable cases: someone signed up and earns nothing.\n");
if (!orphans.length) console.log("    none");
for (const f of orphans.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))) {
  console.log(
    `  ${(f.ll_name ?? f.shopify_name ?? "?").padEnd(26)} ${String(f.ll_email).padEnd(34)}` +
      ` enrolled ${String(f.enrolled_at ?? "").slice(0, 10)}` +
      ` ${f.blocked ? "BLOCKED" : "ACTIVE "}` +
      ` ${String(f.points).padStart(6)} pts` +
      `  shopify=${f.merchant_id}` +
      `  ${f.shopify_has_email === false ? "(Shopify has no email)" : ""}`,
  );
}

console.log("\n=== EMAIL IN LOYALTYLION THAT SHOPIFY DOES NOT HAVE ===");
console.log("    The signature of an address captured outside Shopify.\n");
console.log(`    ${n0(tillCapture.length)} members`);
console.log(`    of which on internal accounts: ${n0(tillCapture.filter((f) => f.internal).length)}`);
console.log(`    of which ACTIVE (not blocked): ${n0(tillCapture.filter((f) => !f.blocked).length)}`);

const notInShopify = findings.filter((f) => has(f, "NOT_IN_SHOPIFY"));
if (notInShopify.length) {
  console.log(`\n=== ENROLLED BUT NO SHOPIFY CUSTOMER: ${n0(notInShopify.length)} ===`);
  console.log("    Cannot be checked either way; listed so the gap is not silent.");
}

console.log("\n=== SUMMARY ===");
console.log(`  enrolled members scanned        ${n0(members)}`);
console.log(`  flagged for any reason          ${n0(findings.length)}`);
console.log(`  recoverable (person on internal)${n0(orphans.length).padStart(7)}`);
console.log(`  of those, still ACTIVE          ${n0(orphans.filter((f) => !f.blocked).length)}`);
console.log(
  `  points stranded on them         ${n0(orphans.reduce((a, f) => a + f.points, 0))}\n`,
);
