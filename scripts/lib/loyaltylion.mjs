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
  let pointsOutstanding = 0;
  let customers = 0;
  const unknownTiers = new Set();

  for await (const batch of paginate("/customers", "customers", "customers")) {
    for (const c of batch) {
      customers++;
      pointsOutstanding += Number(c.points_approved ?? 0);
      const tier = c.loyalty_tier_membership?.tier?.name ?? c.loyalty_tier_membership?.name ?? null;
      if (!tier) continue;
      const match = TIERS.find((t) => t.toLowerCase() === String(tier).toLowerCase());
      if (match) counts[match]++;
      else unknownTiers.add(String(tier));
    }
  }

  if (unknownTiers.size) {
    log.warn(
      `tiers seen that are not Blue/Silver/Gold/Platinum and were NOT counted: ${[...unknownTiers].join(", ")}`,
    );
  }
  log.ok(`loyalty: ${customers} customers scanned across ${Object.values(counts).reduce((a, b) => a + b, 0)} tiered members`);

  const points = int(pointsOutstanding);
  reportPointsLiability(points, customers);
  return { counts, pointsOutstanding: points, customers };
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

export function toSnapshotRow({ counts, pointsOutstanding }, { redemptions, birthdayRewards }, snapshotDate) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
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
export const POINTS_EXPECTED = Number(process.env.LL_POINTS_EXPECTED ?? 1_500_000);

export function reportPointsLiability(points, customers) {
  const jod = points / POINTS_PER_JOD;
  const low = POINTS_EXPECTED / 10;
  const high = POINTS_EXPECTED * 10;

  log.info("");
  log.info("── points outstanding ─────────────────────────────────────");
  log.ok(`${points.toLocaleString("en-US")} points  ≈  ${jod.toLocaleString("en-US", { maximumFractionDigits: 3 })} JOD liability`);
  log.info(`  (sum of points_approved across ${customers.toLocaleString("en-US")} customers, at 100 points = 1 JOD)`);

  if (points < low || points > high) {
    log.warn(
      `this is more than an order of magnitude from the expected ~${POINTS_EXPECTED.toLocaleString("en-US")} points ` +
        `(~${(POINTS_EXPECTED / POINTS_PER_JOD).toLocaleString("en-US")} JOD).`,
    );
    log.warn(
      points < low
        ? "TOO LOW: points_approved may already be net of spent points, or most points sit in points_pending."
        : "TOO HIGH: points_approved may be a lifetime-earned total rather than a current balance.",
    );
    log.warn("Check this against the LoyaltyLion dashboard before trusting the figure.");
  } else {
    log.ok(`within the expected order of magnitude (${low.toLocaleString("en-US")} – ${high.toLocaleString("en-US")} points)`);
  }
  log.info("───────────────────────────────────────────────────────────");
}
