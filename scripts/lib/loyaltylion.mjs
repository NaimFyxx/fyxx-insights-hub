import { need, optional } from "./env.mjs";
import { Limiter, httpJson, withRetry, log, int } from "./log.mjs";

const BASE = "https://api.loyaltylion.com/v2";
const limiter = new Limiter(120, "LoyaltyLion"); // 20 req/s allowed; we stay well under.

export const TIERS = ["Blue", "Silver", "Gold", "Platinum"];

/**
 * LoyaltyLion now issues Bearer API keys (pat_…). The older token+secret pair
 * still works as HTTP Basic but is deprecated, so both are supported and the
 * Bearer key is preferred.
 */
function headers() {
  const apiKey = optional("LOYALTYLION_API_KEY");
  if (apiKey) return { Authorization: `Bearer ${apiKey}`, accept: "application/json" };
  const token = need("LOYALTYLION_TOKEN", "LoyaltyLion → Manage → API keys (or the deprecated token/secret pair)");
  const secret = need("LOYALTYLION_SECRET", "LoyaltyLion → Manage → API keys");
  const basic = Buffer.from(`${token}:${secret}`).toString("base64");
  return { Authorization: `Basic ${basic}`, accept: "application/json" };
}

const get = (path, label) =>
  limiter.run(() => withRetry(label, () => httpJson(`${BASE}${path}`, { headers: headers() }, label)));

/** Walks a cursor-paginated collection to the end. */
async function* paginate(path, key, label) {
  let cursor = null;
  let page = 0;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await get(url, `${label} page ${page + 1}`);
    const items = res[key] ?? [];
    yield items;
    cursor = res.cursor?.next ?? null;
    page++;
    if (page % 10 === 0) log.info(`${label}: ${page} pages read`);
  } while (cursor && page < 500);
}

/**
 * Tier counts and points outstanding.
 *
 * LoyaltyLion has no aggregate or tier-count endpoint, so the only way to get
 * "members per tier" is to page the whole customer list and count. That is
 * also precisely why we snapshot it daily: the API cannot tell you what the
 * tier split was last month, so if we do not record it today, that comparison
 * is gone forever.
 */
export async function fetchSnapshot() {
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0]));
  const unknownTiers = new Map();
  let customers = 0;      // everything the API returns, guests included
  let members = 0;        // enrolled === true — the actual loyalty programme
  let tiered = 0;         // members with a tier membership
  let approvedMembers = 0;
  let spentMembers = 0;
  let approvedAll = 0;

  for await (const batch of paginate("/customers", "customers", "customers")) {
    for (const c of batch) {
      customers++;
      approvedAll += Number(c.points_approved ?? 0);

      // The customers endpoint returns EVERY Shopify customer, not just
      // loyalty members. Roughly half are guests who never enrolled, and
      // counting their points would inflate the liability by about 5%.
      if (!c.enrolled) continue;
      members++;
      approvedMembers += Number(c.points_approved ?? 0);
      spentMembers += Number(c.points_spent ?? 0);

      // The tier name is nested two levels down. Reading the wrong path here
      // silently yields zero for every tier, which is why this is asserted
      // rather than trusted — see assertSnapshotUsable below.
      const tierName = c.loyalty_tier_membership?.loyalty_tier?.name;
      if (!tierName) continue;
      tiered++;
      const match = TIERS.find((t) => t.toLowerCase() === String(tierName).toLowerCase());
      if (match) counts[match]++;
      else unknownTiers.set(tierName, (unknownTiers.get(tierName) ?? 0) + 1);
    }
  }

  // Outstanding balance is approved MINUS already-spent. points_approved on
  // its own is the lifetime approved total, so using it alone counts points
  // that were redeemed long ago and are no longer owed to anyone.
  const pointsOutstanding = int(approvedMembers - spentMembers);

  reportPopulation({ customers, members, tiered, counts, unknownTiers });
  reportPointsLiability(pointsOutstanding, members, {
    approvedMembers: int(approvedMembers),
    spentMembers: int(spentMembers),
    approvedAll: int(approvedAll),
  });

  return {
    counts,
    pointsOutstanding,
    customers,
    members,
    tiered,
    points: {
      outstanding: pointsOutstanding,
      approved: int(approvedMembers),
      spent: int(spentMembers),
      approvedAll: int(approvedAll),
    },
  };
}

/**
 * Refuses a snapshot that is structurally impossible rather than writing a
 * plausible-looking row of zeros.
 *
 * All four tiers reading zero while customers were scanned means the tier
 * field moved or was misread — it does not mean the programme emptied
 * overnight. Writing that would poison every "vs prior month" comparison
 * from here on, and it would look like real data.
 */
export function assertSnapshotUsable({ counts, customers, members, tiered, points }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (customers > 0 && total === 0) {
    throw new Error(
      `Refusing to write: all four tier counts are zero after scanning ${customers.toLocaleString("en-US")} customers.\n` +
        "  That is a parsing failure, not an empty programme. The tier name lives at\n" +
        "  loyalty_tier_membership.loyalty_tier.name — check LoyaltyLion has not moved it.\n" +
        "  Run `node scripts/diagnose/loyalty.mjs` to dump a raw customer record.",
    );
  }

  if (members > 0 && total < members * 0.5) {
    throw new Error(
      `Refusing to write: only ${total.toLocaleString("en-US")} of ${members.toLocaleString("en-US")} members ` +
        "resolved to a known tier (under half).\n" +
        "  Either a tier was renamed, or a new tier exists that is not in TIERS.\n" +
        `  Known tiers: ${TIERS.join(", ")}. Run scripts/diagnose/loyalty.mjs to see the real names.`,
    );
  }

  // --- structural invariants -------------------------------------------
  // A magnitude band cannot catch a wrong DEFINITION. The figure this run
  // originally produced (approved-only, all customers) was 8,601,572 — only
  // 31% above the correct 6,582,788, so it sits comfortably inside any band
  // loose enough to allow normal growth. These invariants catch it exactly,
  // because they test the RELATIONSHIP between the figures, not their size.
  const p = points ?? {};
  if (p.spent > 0 && p.outstanding >= p.approved) {
    throw new Error(
      `Refusing to write: points_outstanding (${p.outstanding.toLocaleString("en-US")}) is not less than ` +
        `points_approved (${p.approved.toLocaleString("en-US")}) even though ${p.spent.toLocaleString("en-US")} ` +
        "points have been spent.\n  points_spent is not being subtracted — the figure is lifetime earned, not money owed.",
    );
  }
  if (p.outstanding != null && p.outstanding < 0) {
    throw new Error(`Refusing to write: points_outstanding is negative (${p.outstanding.toLocaleString("en-US")}).`);
  }
  if (members > 0 && customers > 0 && members === customers) {
    log.warn(
      "every customer is enrolled, which is unusual — check the `enrolled` filter is actually being applied.",
    );
  }

  // Not fatal, but worth saying out loud.
  if (tiered > total) {
    log.warn(`${tiered - total} member(s) hold a tier that is not one of ${TIERS.join("/")} and were not counted`);
  }
}

function reportPopulation({ customers, members, tiered, counts, unknownTiers }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const n = (x) => x.toLocaleString("en-US");
  log.info("");
  log.info("── loyalty population ─────────────────────────────────────");
  log.info(`  customers returned by the API : ${n(customers)}  (includes guests who never enrolled)`);
  log.ok(`  enrolled members              : ${n(members)}`);
  log.info(`  members holding a tier        : ${n(tiered)}`);
  for (const t of TIERS) log.info(`      ${t.padEnd(10)} ${n(counts[t])}`);
  log.info(`      ${"TOTAL".padEnd(10)} ${n(total)}`);
  if (unknownTiers.size) {
    log.warn("  tier names seen that are NOT counted:");
    for (const [name, c] of unknownTiers) log.warn(`      ${name} (${n(c)})`);
  }
  log.info("───────────────────────────────────────────────────────────");
}

/**
 * Redemptions and birthday rewards inside the period.
 *
 * A redemption is a transaction whose resource is a claimed reward. Birthday
 * rewards are identified by the rule name, because LoyaltyLion has no
 * dedicated birthday activity type — the rule is merchant-configured, so a
 * name match is the only handle available.
 *
 * Because that match is a guess, the run reports enough to falsify it. The
 * birthday reward is points-based and varies by tier (400 Blue → 700 Platinum),
 * so a CORRECT match shows a spread of point values across those tiers. A
 * single repeated value means the match has latched onto the wrong rule, and
 * the run says so rather than quietly returning a plausible number.
 */
export const BIRTHDAY_TIER_POINTS = [400, 500, 600, 700];

export async function fetchPeriodActivity(from, to) {
  const min = `${from}T00:00:00+03:00`;
  const max = `${to}T23:59:59+03:00`;
  const q = `created_at_min=${encodeURIComponent(min)}&created_at_max=${encodeURIComponent(max)}`;

  let redemptions = 0;
  for await (const batch of paginate(`/transactions?${q}`, "transactions", "transactions")) {
    for (const t of batch) {
      const isReward = t.resource === "claimed_reward" || Boolean(t.claimed_reward);
      if (isReward && t.state !== "void" && t.state !== "declined") redemptions++;
    }
  }

  let birthday = 0;
  const allRuleNames = new Set();
  const matchedRules = new Set();
  const valueSpread = new Map(); // points value -> how many times it was issued

  for await (const batch of paginate(`/activities?${q}`, "activities", "activities")) {
    for (const a of batch) {
      const name = `${a.rule?.name ?? ""} ${a.rule?.title ?? ""}`.trim();
      if (name) allRuleNames.add(name);
      if (!/birthday/i.test(name)) continue;
      matchedRules.add(name);
      if (a.state !== "approved") continue;
      birthday++;
      const v = Number(a.value ?? 0);
      valueSpread.set(v, (valueSpread.get(v) ?? 0) + 1);
    }
  }

  reportBirthdayMatch({ matchedRules, allRuleNames, birthday, valueSpread });
  return { redemptions, birthdayRewards: birthday, valueSpread, matchedRules: [...matchedRules] };
}

/** Prints the birthday-rule evidence loudly enough to be checked at a glance. */
export function reportBirthdayMatch({ matchedRules, allRuleNames, birthday, valueSpread }) {
  log.info("");
  log.info("── birthday reward match ──────────────────────────────────");
  if (!matchedRules.size) {
    log.warn("NO rule name containing 'birthday' was seen in this period.");
    log.warn("birthday_rewards_issued will be 0. Rule names that WERE seen:");
    for (const n of [...allRuleNames].slice(0, 20)) log.warn(`    ${n}`);
    if (allRuleNames.size > 20) log.warn(`    … and ${allRuleNames.size - 20} more`);
    log.info("───────────────────────────────────────────────────────────");
    return;
  }

  log.ok(`matched rule(s): ${[...matchedRules].join(" | ")}`);
  log.ok(`${birthday} approved birthday reward(s) in the period`);

  const values = [...valueSpread.entries()].sort((a, b) => a[0] - b[0]);
  if (!values.length) {
    log.warn("no approved rewards to check point values against");
  } else {
    log.info("  points issued:");
    for (const [v, n] of values) {
      const known = BIRTHDAY_TIER_POINTS.includes(v) ? "" : "   ← not a known tier value";
      log.info(`    ${String(v).padStart(5)} points  ×${n}${known}`);
    }
    // The falsification test.
    if (values.length === 1) {
      log.warn(
        `ALL rewards issued the same ${values[0][0]} points. The birthday reward should vary ` +
          `by tier (${BIRTHDAY_TIER_POINTS.join("/")}), so this match is probably the WRONG rule.`,
      );
    } else {
      const seen = values.map(([v]) => v).filter((v) => BIRTHDAY_TIER_POINTS.includes(v));
      const missing = BIRTHDAY_TIER_POINTS.filter((v) => !seen.includes(v));
      log.ok(`spread across ${values.length} distinct value(s) — consistent with a tiered birthday reward`);
      if (missing.length) {
        log.info(`  (no ${missing.join("/")} point rewards this period, which is normal for a short range)`);
      }
    }
  }
  log.info("───────────────────────────────────────────────────────────");
}

export function toSnapshotRow({ counts, pointsOutstanding, members }, { redemptions, birthdayRewards }, snapshotDate) {
  const total = members ?? Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    snapshot_date: snapshotDate,
    blue_members: counts.Blue,
    silver_members: counts.Silver,
    gold_members: counts.Gold,
    platinum_members: counts.Platinum,
    points_outstanding: pointsOutstanding,
    redemptions,
    // Kept for continuity with the existing dashboard tile.
    redemption_rate: total > 0 ? Number(((redemptions / total) * 100).toFixed(2)) : 0,
    birthday_rewards_issued: birthdayRewards,
  };
}

/** 100 points = 1 JOD, for the outstanding-liability figure. */
export const POINTS_PER_JOD = 100;

/**
 * Expected order of magnitude for points outstanding, used only to sanity
 * check the assumption that "outstanding" means the sum of points_approved.
 * The reference point is roughly 1.5M points ≈ 15,000 JOD; anything an order
 * of magnitude off in either direction means the assumption is wrong, not
 * that the business changed overnight. Override with LL_POINTS_EXPECTED if
 * the programme genuinely grows past the band.
 */
/**
 * Expected points outstanding, used to catch a wrong DEFINITION rather than a
 * change in the business.
 *
 * The first real scan measured 6,582,788 points outstanding across 11,909
 * enrolled members (approved minus spent). The band is deliberately narrow:
 * the previous ±10x band spanned 150k–15M and waved through a figure that was
 * wrong by every definition, which made it worse than no check at all. ±60%
 * is wide enough for ordinary growth between nightly runs and narrow enough
 * that picking the wrong points field trips it immediately.
 */
export const POINTS_EXPECTED = Number(process.env.LL_POINTS_EXPECTED ?? 6_582_788);
export const POINTS_TOLERANCE = Number(process.env.LL_POINTS_TOLERANCE ?? 0.6);

export function reportPointsLiability(points, members, parts = {}) {
  const jod = (p) => (p / POINTS_PER_JOD).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const n = (x) => Math.round(x).toLocaleString("en-US");
  const low = Math.round(POINTS_EXPECTED * (1 - POINTS_TOLERANCE));
  const high = Math.round(POINTS_EXPECTED * (1 + POINTS_TOLERANCE));

  log.info("");
  log.info("── points outstanding ─────────────────────────────────────");
  log.ok(`  ${n(points)} points  =  ${jod(points)} JOD currently owed`);
  log.info(`  definition: sum(points_approved - points_spent) over ENROLLED members only`);

  // Show the alternatives, so a mismatch against the LoyaltyLion dashboard
  // can be diagnosed by reading rather than by re-instrumenting the script.
  if (parts.approvedMembers != null) {
    log.info("  other definitions, for comparison against the dashboard:");
    log.info(`      approved only, members    ${n(parts.approvedMembers).padStart(12)} pts = ${jod(parts.approvedMembers).padStart(7)} JOD  (lifetime earned)`);
    log.info(`      approved only, ALL people ${n(parts.approvedAll).padStart(12)} pts = ${jod(parts.approvedAll).padStart(7)} JOD  (includes guests)`);
    log.info(`      already redeemed          ${n(parts.spentMembers).padStart(12)} pts = ${jod(parts.spentMembers).padStart(7)} JOD  (NOT a liability)`);
  }
  log.info(`  across ${n(members)} enrolled members`);

  if (points < low || points > high) {
    log.warn(
      `outside the expected band ${n(low)}–${n(high)} points (${jod(low)}–${jod(high)} JOD).`,
    );
    log.warn(
      points < low
        ? "TOO LOW: check whether points_spent is being subtracted twice, or members are being over-filtered."
        : "TOO HIGH: check whether guests are being included, or points_spent is no longer being subtracted.",
    );
    log.warn("Compare against LoyaltyLion before trusting it. Adjust LL_POINTS_EXPECTED if the programme genuinely grew.");
  } else {
    log.ok(`within the expected band ${n(low)}–${n(high)} points`);
  }
  log.info("───────────────────────────────────────────────────────────");
}
