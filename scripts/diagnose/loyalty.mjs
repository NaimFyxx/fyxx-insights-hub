/**
 * Read-only LoyaltyLion diagnostic. Writes nothing anywhere.
 *
 *   node scripts/diagnose/loyalty.mjs
 *
 * Dumps one customer record verbatim (with personal details masked) so the
 * real field names can be read rather than guessed, then scans the full list
 * to answer three questions: how many customers are actually members, how the
 * tiers are distributed, and which points field represents money owed.
 */
import { loadEnv, need } from "../lib/env.mjs";
loadEnv();

const BASE = "https://api.loyaltylion.com/v2";
const auth = { Authorization: `Bearer ${need("LOYALTYLION_API_KEY", "LoyaltyLion → Manage → API keys")}`, accept: "application/json" };

/**
 * Masks anything that identifies a person, WITHOUT masking structural names.
 * A blanket "name" rule also hides loyalty_tier.name, which is the one value
 * this diagnostic exists to reveal — so masking is scoped by path.
 */
const MASK_PATHS = new Set([
  "email", "referral_id", "external_id", "referral_url", "receipt_upload_url",
  "properties.name", "properties.first_name", "properties.last_name", "properties.phone",
]);
function mask(v, path = "") {
  if (Array.isArray(v)) return v.map((x) => mask(x, path));
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, val]) => {
        const p = path ? `${path}.${k}` : k;
        return [k, MASK_PATHS.has(p) ? "«masked»" : mask(val, p)];
      }),
    );
  }
  return v;
}

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: auth });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
};

/* ---- 1. one raw record, so we can both read the real field names ------- */
const first = await get("/customers?limit=3");
const sample = (first.customers ?? [])[0];
console.log("=".repeat(74));
console.log("RAW CUSTOMER RECORD (personal details masked, structure untouched)");
console.log("=".repeat(74));
console.log(JSON.stringify(mask(sample), null, 2));

/* ---- 2. an enrolled one, which may differ in shape --------------------- */
const enrolledSample = (first.customers ?? []).find((c) => c.enrolled && c.loyalty_tier_membership);
if (enrolledSample && enrolledSample !== sample) {
  console.log("\n" + "=".repeat(74));
  console.log("AN ENROLLED CUSTOMER WITH A TIER");
  console.log("=".repeat(74));
  console.log(JSON.stringify(mask(enrolledSample), null, 2));
}

/* ---- 3. full scan: membership, tiers, and both points definitions ------ */
console.log("\n" + "=".repeat(74));
console.log("FULL SCAN");
console.log("=".repeat(74));

const tally = {
  customers: 0, enrolled: 0, guests: 0, blocked: 0,
  withTierMembership: 0, tierNull: 0,
  tiers: new Map(),
  tierPaths: new Set(),
  sums: { approvedAll: 0, spentAll: 0, pendingAll: 0, approvedEnrolled: 0, spentEnrolled: 0 },
};

let cursor = null, page = 0;
do {
  const res = await get(`/customers?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  for (const c of res.customers ?? []) {
    tally.customers++;
    if (c.enrolled) tally.enrolled++;
    if (c.guest) tally.guests++;
    if (c.blocked) tally.blocked++;

    const ap = Number(c.points_approved ?? 0), sp = Number(c.points_spent ?? 0), pe = Number(c.points_pending ?? 0);
    tally.sums.approvedAll += ap; tally.sums.spentAll += sp; tally.sums.pendingAll += pe;
    if (c.enrolled) { tally.sums.approvedEnrolled += ap; tally.sums.spentEnrolled += sp; }

    const m = c.loyalty_tier_membership;
    if (!m) { tally.tierNull++; continue; }
    tally.withTierMembership++;
    // Record which path actually holds the name, rather than assuming one.
    if (m.loyalty_tier?.name) tally.tierPaths.add("loyalty_tier_membership.loyalty_tier.name");
    if (m.tier?.name) tally.tierPaths.add("loyalty_tier_membership.tier.name");
    if (m.name) tally.tierPaths.add("loyalty_tier_membership.name");
    const name = m.loyalty_tier?.name ?? m.tier?.name ?? m.name ?? "(unresolved)";
    tally.tiers.set(name, (tally.tiers.get(name) ?? 0) + 1);
  }
  cursor = res.cursor?.next ?? null;
  page++;
  if (page % 10 === 0) process.stderr.write(`  … ${page} pages, ${tally.customers} customers\n`);
} while (cursor && page < 500);

const n = (x) => Math.round(x).toLocaleString("en-US");
console.log(`\nPopulation`);
console.log(`  total customers returned : ${n(tally.customers)}`);
console.log(`  enrolled === true        : ${n(tally.enrolled)}`);
console.log(`  guests                   : ${n(tally.guests)}`);
console.log(`  blocked                  : ${n(tally.blocked)}`);
console.log(`  has loyalty_tier_membership : ${n(tally.withTierMembership)}`);
console.log(`  membership is null          : ${n(tally.tierNull)}`);

console.log(`\nWhere the tier name actually lives`);
console.log(tally.tierPaths.size ? [...tally.tierPaths].map((p) => `  ${p}`).join("\n") : "  NONE FOUND");

console.log(`\nTier distribution`);
for (const [name, count] of [...tally.tiers].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(name).padEnd(24)} ${n(count)}`);
}
const tierTotal = [...tally.tiers.values()].reduce((a, b) => a + b, 0);
console.log(`  ${"TOTAL".padEnd(24)} ${n(tierTotal)}`);

const s = tally.sums;
console.log(`\nPoints, and what each definition implies in JOD at 100 pts = 1 JOD`);
const row = (label, pts) => console.log(`  ${label.padEnd(46)} ${n(pts).padStart(12)} pts  =  ${n(pts / 100).padStart(8)} JOD`);
row("sum(points_approved), ALL customers", s.approvedAll);
row("sum(points_approved), enrolled only", s.approvedEnrolled);
row("sum(points_approved - points_spent), ALL", s.approvedAll - s.spentAll);
row("sum(points_approved - points_spent), enrolled only", s.approvedEnrolled - s.spentEnrolled);
row("sum(points_spent), ALL", s.spentAll);
row("sum(points_pending), ALL", s.pendingAll);
