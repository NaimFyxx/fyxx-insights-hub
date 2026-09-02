/**
 * What an email open is worth, and what to use instead.
 *
 * Apple Mail Privacy Protection pre-fetches every image in a message on
 * Apple's servers, whether or not the recipient ever opens it. That fires our
 * open pixel. Gmail and others pre-fetch too. So an "open" is not a person
 * reading an email — it is a mail client touching an image, and the share of
 * recipients on such clients is unknown to us and changes over time.
 *
 * Two consequences, and the second is the one that gets forgotten:
 *   - Opens and open rates are INFLATED by an unknown amount.
 *   - They are NOT COMPARABLE ACROSS TIME, because the inflation grows as
 *     Apple's share of the list grows. A rising open rate can be a rising
 *     iPhone share and nothing else.
 *
 * This is not a caveat about our data collection. Klaviyo reports what it can
 * see, and what it can see is a pre-fetch.
 */
export const MPP_NOTE =
  "Apple Mail pre-fetches images and marks a message opened whether or not anyone read it, " +
  "so opens and open rates are inflated by an unknown amount. They are also not comparable " +
  "across time, because the inflation grows with Apple's share of the list.";

export const MPP_NOTE_SHORT =
  "Opens are inflated by Apple Mail pre-fetching and are not comparable across time.";

/**
 * Measured on our own 64 campaigns of 50+ recipients, 31 August 2026.
 *
 * The case for clicks is not received wisdom here — it was tested. Two things
 * came out of it, and both point the same way:
 *
 *   DISCRIMINATION. Open rate runs 26.9%-89.0% with a relative spread of 0.30.
 *   Click rate runs 0%-10.17% with a relative spread of 1.14 — nearly four
 *   times as much signal. A metric compressed into a narrow band cannot rank
 *   campaigns, which is what a mean open rate of 45.1% on a retail list looks
 *   like once pre-fetching is added to it.
 *
 *   PREDICTION. Against revenue per delivered message, click rate correlates
 *   at 0.778 and open rate at 0.403 — so clicks explain roughly 61% of the
 *   variance in revenue and opens about 16%. Against order rate it is 0.798
 *   against 0.416, the same story.
 *
 *   And opens barely predict clicks: 0.359. A campaign that is "opened a lot"
 *   is only weakly the same campaign that gets clicked.
 *
 * Re-run scripts/diagnose/engagement-signal.mjs rather than re-estimating.
 */
export const ENGAGEMENT_SIGNAL = {
  measuredOn: "2026-08-31",
  campaigns: 64,
  openMeanPct: 45.1,
  openMinPct: 26.9,
  openMaxPct: 89.0,
  openRelativeSpread: 0.3,
  clickMeanPct: 1.4,
  clickMinPct: 0,
  clickMaxPct: 10.17,
  clickRelativeSpread: 1.14,
  openVsRevenue: 0.403,
  clickVsRevenue: 0.778,
  openVsOrders: 0.416,
  clickVsOrders: 0.798,
  openVsClick: 0.359,
} as const;

/**
 * What to judge a campaign on, in order.
 *
 * Deliberately short. The honest answer to "if open rate is unusable, what
 * replaces it" is that we have clicks, orders and revenue, and nothing else
 * that survives scrutiny — so the list is three items, not a dashboard.
 */
export const CAMPAIGN_JUDGEMENT = [
  {
    metric: "Revenue per delivered message",
    why: "The outcome itself. Divides out list size, so a small send and a large one compare directly.",
  },
  {
    metric: "Click rate",
    why: "A click is a deliberate act that no mail client performs on the recipient's behalf. Correlates with revenue at 0.778 against open rate's 0.403.",
  },
  {
    metric: "Orders attributed",
    why: "Klaviyo's own attribution, netted of cancellations. Smaller numbers, but it is the thing being optimised.",
  },
  {
    metric: "Unsubscribe rate",
    why: "The cost side, and the one engagement figure Apple Mail cannot distort — no mail client unsubscribes on someone's behalf. A campaign that earns well while burning list is not a success. Read it beside revenue, never on its own.",
  },
] as const;

/**
 * A rate above this is worth a second look.
 *
 * NOT a hard threshold and deliberately not enforced anywhere. Klaviyo's own
 * guidance and general email practice put a healthy unsubscribe rate below
 * about 0.2-0.5%; our own campaigns will establish what normal looks like here
 * once the column has a few months of history. Until then this only decides
 * whether a figure is tinted, and the tint means "look", not "bad".
 */
export const UNSUBSCRIBE_WATCH_RATE = 0.005;

/** True where a figure counts opens and therefore needs the caveat. */
export const OPEN_METRICS = ["opened", "open_rate", "opens"] as const;
