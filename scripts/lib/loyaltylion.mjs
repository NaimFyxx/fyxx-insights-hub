import { need, optional } from "./env.mjs";
import { Limiter, httpJson, withRetry, log, int } from "./log.mjs";

/* ===========================================================================
 * ⚠️  LOYALTYLION SILENTLY IGNORES UNKNOWN QUERY PARAMETERS
 *
 * An unsupported filter does NOT return 4xx. It returns HTTP 200 with the
 * full unfiltered result set. Probed on /v2/customers, all of these were
 * accepted and all returned results identical to no filter at all:
 *
 *     ?enrolled=true            ?filter=enrolled
 *     ?enrolled_at_min=...      ?has_loyalty_tier=true
 *
 * So a filter that "works" — 200, plausible JSON, sensible-looking rows — may
 * be doing nothing whatsoever. Anyone adding a filter here and testing it by
 * checking the status code will conclude it works and quietly process the
 * entire customer list as though it were filtered.
 *
 * NEVER validate a LoyaltyLion filter by its status code. Validate it by
 * comparing the RESULT COUNT against the same request without the filter. If
 * the counts match, the filter is being ignored. `assertFilterHonoured()`
 * below does exactly this; use it.
 * ======================================================================== */

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

/**
 * Proves a query parameter is actually honoured before trusting it.
 *
 * Fetches one page with and one without the filter and compares counts. See
 * the banner at the top of this file: LoyaltyLion answers 200 for parameters
 * it ignores, so a status code proves nothing.
 */
export async function assertFilterHonoured(path, filterQuery, key = "customers") {
  const sep = path.includes("?") ? "&" : "?";
  const [filtered, unfiltered] = await Promise.all([
    get(`${path}${sep}limit=50&${filterQuery}`, "filter probe (with)"),
    get(`${path}${sep}limit=50`, "filter probe (without)"),
  ]);
  const a = (filtered[key] ?? []).length;
  const b = (unfiltered[key] ?? []).length;
  const sameIds =
    a === b && (filtered[key] ?? []).every((x, i) => x.id === (unfiltered[key] ?? [])[i]?.id);
  if (sameIds) {
    throw new Error(
      `LoyaltyLion is IGNORING the filter "${filterQuery}" — it returned HTTP 200 with the same ` +
        `${a} records as the unfiltered request.\n  Do not trust this filter. Filter client-side instead.`,
    );
  }
  log.ok(`filter "${filterQuery}" is honoured (${a} vs ${b} unfiltered)`);
  return true;
}

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

  // points_approved IS the current balance, already net of spend and expiry.
  // points_spent is a separate LIFETIME counter and must not be subtracted.
  // Established against LoyaltyLion's own points accounting export for
  // 2026-08-27, which reported 8,776,473 outstanding:
  //     approved, all customers   8,604,319   -2%   <- this definition
  //     approved, members only    8,184,625   -7%
  //     approved minus spent      6,585,035  -25%
  // The residual 2% is timing between our scan and their end-of-day close.
  // Guests are included because their balances are part of the liability.
  const pointsOutstanding = int(approvedAll);

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

  // --- points sanity ----------------------------------------------------
  const p = points ?? {};
  // NOTE: there was previously an invariant here asserting that outstanding
  // must be strictly less than approved whenever spend existed. That was
  // built on the wrong reading of points_approved (see reportPointsLiability)
  // and is FALSE under the correct definition — outstanding IS approved — so
  // it would block every valid run. Removed deliberately; do not reinstate.
  if (p.outstanding != null && p.outstanding < 0) {
    throw new Error(`Refusing to write: points_outstanding is negative (${p.outstanding.toLocaleString("en-US")}).`);
  }
  if (members > 0 && p.outstanding === 0) {
    throw new Error(
      `Refusing to write: ${members.toLocaleString("en-US")} members hold zero points between them.\n` +
        "  That is a parsing failure, not an empty programme — check points_approved is still present.",
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
 * >>> READ THIS BEFORE TOUCHING points_approved <<<
 *
 * `points_approved` is the customer's CURRENT SPENDABLE BALANCE. It is
 * already net of redemptions and expiry. It is NOT a lifetime total.
 *
 * This is the most misleading field in the LoyaltyLion API, because
 * `points_spent` sits right next to it and reads like the other half of a
 * pair. It is not: `points_spent` is a separate LIFETIME counter. Subtracting
 * it double-counts every redemption ever made and understates the liability
 * by about 25%.
 *
 * The evidence, against LoyaltyLion's own points accounting export for
 * 2026-08-27, whose "Total Outstanding Points (End of Day)" was 8,776,473:
 *
 *     sum(points_approved), ALL customers   8,604,319    -2%   <- correct
 *     sum(points_approved), members only    8,184,625    -7%
 *     sum(points_approved - points_spent)   6,585,035   -25%   <- was used
 *
 * The 2% residual is timing between our scan and their end-of-day close.
 * Guests are included on purpose: an unenrolled customer's balance is still
 * money owed. Note this differs from the TIER counts, which are members only.
 */
export const POINTS_EXPECTED = Number(process.env.LL_POINTS_EXPECTED ?? 8_776_473);
export const POINTS_TOLERANCE = Number(process.env.LL_POINTS_TOLERANCE ?? 0.2);

/**
 * Largest day-over-day move in points outstanding treated as plausible.
 *
 * This is the ONGOING guard. The static band above is only a setup-time
 * sanity check and will need raising as the programme grows; this one
 * compares against our own last snapshot and keeps working indefinitely.
 *
 * This replaces the structural invariant that the corrected definition
 * invalidated. It is a weaker check but a real one, and unlike a static band
 * it compares against our OWN most recent snapshot, so it keeps working as
 * the programme grows. Daily movement observed so far is well under 1%.
 */
export const MAX_DAILY_POINTS_MOVE = Number(process.env.LL_MAX_DAILY_MOVE ?? 0.25);

export function reportPointsLiability(points, members, parts = {}) {
  const jod = (p) => (p / POINTS_PER_JOD).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const n = (x) => Math.round(x).toLocaleString("en-US");
  const low = Math.round(POINTS_EXPECTED * (1 - POINTS_TOLERANCE));
  const high = Math.round(POINTS_EXPECTED * (1 + POINTS_TOLERANCE));

  log.info("");
  log.info("── points outstanding ─────────────────────────────────────");
  log.ok(`  ${n(points)} points  =  ${jod(points)} JOD currently owed`);
  log.info("  definition: sum(points_approved) across ALL customers");
  log.info("  points_approved is a CURRENT BALANCE, already net of spend and expiry.");
  log.info("  Do not subtract points_spent — that is a separate lifetime counter.");

  if (parts.approvedMembers != null) {
    log.info("  rejected definitions, kept visible so the mistake is not repeated:");
    log.info(`      members only              ${n(parts.approvedMembers).padStart(12)} pts = ${jod(parts.approvedMembers).padStart(7)} JOD  (excludes guest balances)`);
    log.info(`      approved minus spent      ${n(points - parts.spentMembers).padStart(12)} pts = ${jod(points - parts.spentMembers).padStart(7)} JOD  (double-counts redemptions)`);
  }

  if (points < low || points > high) {
    log.warn(`outside the expected band ${n(low)}–${n(high)} points (${jod(low)}–${jod(high)} JOD).`);
    log.warn("Compare against LoyaltyLion's points accounting export before trusting it.");
    log.warn("If the programme genuinely grew, raise LL_POINTS_EXPECTED.");
  } else {
    log.ok(`within the expected band ${n(low)}–${n(high)} points`);
  }
  log.info("───────────────────────────────────────────────────────────");
}

/**
 * Compares today's figure against our own most recent snapshot. A balance
 * that leaps overnight means the definition moved, not the business.
 */
export function checkDailyMove(points, previous) {
  if (!previous || !previous.points_outstanding) return;
  const prev = Number(previous.points_outstanding);
  const move = (points - prev) / prev;
  const pct = (move * 100).toFixed(1);
  if (Math.abs(move) > MAX_DAILY_POINTS_MOVE) {
    throw new Error(
      `Refusing to write: points_outstanding moved ${pct}% since ${previous.snapshot_date} ` +
        `(${prev.toLocaleString("en-US")} -> ${points.toLocaleString("en-US")}).\n` +
        "  A balance does not move that far overnight. Check the field definition has not changed.\n" +
        `  If this is genuine, raise LL_MAX_DAILY_MOVE (currently ${MAX_DAILY_POINTS_MOVE}).`,
    );
  }
  log.ok(`points moved ${pct}% since ${previous.snapshot_date} — plausible`);
}
