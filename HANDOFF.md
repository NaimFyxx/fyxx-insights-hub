# Handoff — 29 August 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

---

## Changed a previously reported figure

- **Birthday rewards ARE issued.** The report currently says "not collected".
  The LoyaltyLion *activities* export shows **1,831 `$birthday` activities,
  1,022 of them in 2026**, at 400/500/600/700 points — exactly the tier spread.
  The API field `birthday_rewards_issued` is zero on all 369 snapshots, so our
  pipeline never saw them, but the data exists. **The report wording is wrong
  and should change from "not collected" to a real number.**
- **Mobile App click-influence was 35.8%, truly 19.1%.** 13,060 mobile orders
  sat in `Unknown` because Klaviyo sends the bare id `2653365` for Shopney.
  Never displayed (influence has no UI), fixed now.
- **Attributed revenue, August: 37,615 → 28,260 JOD.** Klaviyo share 22.0% →
  16.5%. 2026 YTD 132,534 → 109,876, 17.1% overstated.
- **Mobile App year-on-year was reported as +831.8%. It is +23.8%.** An
  ad-hoc script grouped on one of two app source ids. Stored data was always
  correct.

## Decisions made this turn

- `subChannelFromKlaviyoSource` now consults `SOURCE_MAP` first, then Klaviyo's
  display names. One taxonomy, not two.
- `shopify_customers` applied and populated. Email/phone stored as booleans
  only; `revenue_jod` left NULL until computable from orders.
- Identity join approved, deferred until after the 2019 sweep.
- LoyaltyLion exports stay outside the repo. Not copied, read in place.

## Findings

**Customer population** (19,163 records; ShopifyQL export says 20,019 — 4% gap
unresolved, distribution agrees on every band)
- 42.7% of buyers ordered once and never returned
- Top 15.2% of buyers drive 74.9% of orders and **78.1% of revenue**
- 73 house/employee accounts, by tag, holding 10.4% of all orders
- **5,926 buyers (42.5%) reachable on neither email nor SMS — 2,803,714 JOD,
  31.6% of lifetime spend**
- Workable list: 2,884 never opted in (NOT 1,362 who opted out). Priority
  segment **85 customers**, ordered in last 90 days, 200+ JOD lifetime,
  324,901 JOD between them
- **SMS: 5,427 buyers reachable ONLY by SMS, 2,391,700 JOD.** 572 subscribers
  against 14,309 phone numbers

**Identity join match rates**
- LoyaltyLion → Shopify via `merchant_id`: **99.8%**, a hard key we already had
- Klaviyo `external_id`: useless — 10.4% populated, 0% are Shopify ids
- Klaviyo → Shopify *via order id*: **99.3%** of profiles resolve to exactly
  one customer. 20 profiles map to several = merge-detection signal

**LoyaltyLion exports** (6 files, 2019-07-02 → 2026-08-29, read in place)

| File | Rows | Span | Verdict |
|---|---|---|---|
| customeractivities | 38,748 | 2023-02-21+ | **Import.** Settles birthday rewards |
| customertransactions | 60,680 | 2023-02-21+ | **Import.** Per-member points, 39,567 carry an Order ID |
| rewards | 2,211 | 2025-08-04+ | **Import.** Redemption detail we have never had |
| saleschannelbreakdown | 14,717 | 2019-12-03+ | **Compare, don't import.** Independent channel check |
| integrationprogramevents | 51,988 | 2025-08-04+ | **Skip.** All `location=klaviyo`, reward-reminder sends |
| customers | 21,264 | snapshot | **Skip.** No Shopify id column; the API's `merchant_id` is better |

- `saleschannelbreakdown` independently confirms every id in our `SOURCE_MAP`,
  and surfaces one we do not have: **`1830279`, 15 rows**
- Activity kinds: `$purchase` 21,579, `fyxx_cup_win` 2,078, `$signup` 1,845,
  `$birthday` 1,831, `$pageview` 1,551, `$newsletter_signup` 1,255

## Open questions needing input

1. **`1830279`** — unknown Shopify app id in LoyaltyLion's export. Map it or
   leave it Unknown?
2. **Report wording on birthday rewards** — change to the real number from
   activities, or leave blank until the sync collects it properly?
3. **Which exports to import** — recommendation above; confirm before building
   importers.

## Next

1. Influence re-run finishing (recomputes `sub_channel` on stored rows)
2. 2019 Shopify sweep, with guards: Klaviyo starts 2025-01 so pre-2025 ranges
   must not show "Klaviyo share 0%"; Mobile App gains Shopney history ending
   late 2024 then a gap
3. Customer section, leading with the three numbers above
4. Identity table
