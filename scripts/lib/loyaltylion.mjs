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

  return { counts, pointsOutstanding: int(pointsOutstanding), customers };
}

/**
 * Redemptions and birthday rewards inside the period.
 *
 * A redemption is a transaction whose resource is a claimed reward. Birthday
 * rewards are identified by the rule name, because LoyaltyLion has no
 * dedicated birthday activity type — the rule is merchant-configured. The
 * matched rule names are logged on every run so a renamed rule shows up as a
 * visible warning rather than a silent zero.
 */
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
  const ruleNames = new Set();
  for await (const batch of paginate(`/activities?${q}`, "activities", "activities")) {
    for (const a of batch) {
      const name = `${a.rule?.name ?? ""} ${a.rule?.title ?? ""}`.trim();
      if (name) ruleNames.add(name);
      if (/birthday/i.test(name) && a.state === "approved") birthday++;
    }
  }
  const birthdayRules = [...ruleNames].filter((n) => /birthday/i.test(n));
  if (birthdayRules.length) log.ok(`birthday rules matched: ${birthdayRules.join(", ")}`);
  else log.warn("no rule name containing 'birthday' was seen in this period — birthday_rewards_issued will be 0");

  return { redemptions, birthdayRewards: birthday };
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
