# Handoff — 29 August 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

---

## Changed a previously reported figure

- **One-and-never-returned: 42.7% → 37.9%.** The old figure was computed
  without knowing that **74.3% of buyers first bought before 2025** (9,400 of
  12,657). Requiring the order to be old enough to have had a chance to repeat
  gives **34.6%**. Still the single largest segment, but materially smaller.
- **Concentration is sharper than reported, not softer.** Top 1% of buyers take
  **34.8%** of revenue, top 5% take 62.7%, top 10% take 76.0%. The 12+ orders
  group is 16.8% of buyers and **78.2%** of revenue.
- **Mean customer value 701.2 JOD, median 97.8.** A 7.2x gap. Never show the
  mean alone.
- **August 2026 revenue 171,018 → 176,441 JOD** after the 2019 sweep. Not a
  recomputation: 31 orders arrived after the 07:04 sync. June and July are
  byte-identical, and no historical figure moved.
- Earlier corrections still standing: Klaviyo attribution August 37,615 →
  28,260 (share 22.0% → 16.5%); Mobile App influence 35.8% → 19.2%; Mobile App
  YoY +831.8% → +23.8%; birthday rewards zero → 131 in August; pending points
  8.34% → 1.59%.

## Decisions made this turn

- **2019 Shopify sweep landed.** 163,547 orders, 9,757 cancelled, 2,364 days,
  10,415 day rows, back to 2019-09-09.
- **Zero unmapped source names** across six years and 11 distinct values. The
  three resolved pre-emptively all fired: `checkout_next` 1,904 orders,
  `580111` 686, `1830279` 82. Without that work they would have been a new
  Unknown bucket.
- `shopify_customers` now carries computed `first_order_date`,
  `last_order_date` and `revenue_jod` for 12,657 buyers, from orders rather
  than the unreliable `amountSpent`.

## Findings

**Cohort retention — what six years of history unlocks**

| Cohort | Acquired | Ever repeated | Still active (90d) | Revenue/customer |
|---|---|---|---|---|
| 2019 | 52 | 86.5% | 30.8% | 4,720.6 |
| 2020 | 1,272 | 80.0% | 16.1% | 1,606.2 |
| 2021 | 1,539 | 78.1% | 16.2% | 1,175.3 |
| 2022 | 2,850 | 65.8% | 11.3% | 728.6 |
| 2023 | 1,936 | 61.9% | 13.1% | 523.7 |
| 2024 | 1,684 | 59.4% | 12.9% | 546.5 |
| 2025 | 2,142 | 48.6% | 15.1% | 250.5 |
| 2026 | 1,110 | 39.4% | 65.9% | 162.0 |

**AGE-NORMALISED, and the decline is REAL.** `second_order_date` now captured,
so cohorts are comparable at the same age:

| Cohort | Repeat within 90d | Within 365d |
|---|---|---|
| 2019 | 55.8% | 63.5% |
| 2020 | 49.4% | 61.3% |
| 2021 | 47.1% | 62.8% |
| 2022 | 39.8% | 53.4% |
| 2023 | 36.3% | 49.5% |
| 2024 | 33.7% | 49.5% |
| 2025 | 33.0% | 46.0% |
| 2026 | 33.7% | — |

Two findings the raw table could not give:
- **90-day repeat fell from ~49% (2020-21) to ~33%**, a third of the rate lost.
  Real, not elapsed time.
- **It STOPPED falling.** 2024 33.7%, 2025 33.0%, 2026 33.7% — flat for three
  cohorts. The deterioration was 2021 to 2024 and has since stabilised.

The raw "ever repeated" column overstated it badly (86.5% to 39.4% reads as
collapse). The truth is severe but different, and the flattening is the part
worth acting on.

**Revenue concentration** (house accounts excluded, computed revenue)
- top 1% of buyers → **34.8%** of revenue
- top 5% → 62.7%, top 10% → 76.0%
- 12+ lifetime orders: 16.8% of buyers → **78.2%** of revenue
- mean 701.2 JOD, **median 97.8**, p90 1,284.7

**Reach ceiling** (unchanged, still the most actionable)
- **5,926 buyers (42.5%) reachable on neither email nor SMS — 31.6% of spend**
- workable list: **2,884 never opted in**, NOT the 1,362 who opted out
- priority: **85 customers**, ordered in last 90 days, 200+ JOD, 324,901 JOD
- **SMS: 5,427 buyers reachable ONLY by SMS**, 2,391,700 JOD. 572 subscribers
  against 14,309 phone numbers

**Identity join** — LoyaltyLion `merchant_id` 99.8%; Klaviyo via order id
99.3%; Klaviyo `external_id` useless (10.4% populated, 0% Shopify ids)

**LoyaltyLion history imported** — 101,639 rows, every one tagged
`ll_export_20260829`. Coverage in `data_coverage`.

## Open questions needing input

1. **`second_order_date` sweep** to age-normalise the cohort table? One more
   ~11 minute pass. Without it the retention decline cannot be interpreted.
2. **4% population gap** (19,163 vs 20,019) still unexplained.
3. **Should the three imports become live API sources?** `/v2/activities` and
   `/v2/transactions` both work. Agreed to decide after the sweep — it is now
   after the sweep.

## Next

1. Customer section, leading with: 37.9% bought once, top 1% take 34.8% of
   revenue, 31.6% of revenue unreachable
2. Identity table
3. `updated_at`-driven Shopify repair and the Klaviyo 90-day campaign re-fetch,
   both still unbuilt from the retroactive-change work

## Applied this turn

`ll_activities`, `ll_transactions`, `ll_rewards` and the `data_coverage` view,
which replaced the narrower `ll_import_coverage`. RLS matches every other
table.

The importer caught a fault worth recording: LoyaltyLion writes timestamp
offsets as `+00`, which `Date.parse` REJECTS. Unhandled, every timestamp parsed
to null, collapsing the rewards key to `(customer, NULL, title)` and
manufacturing **894 collisions in a file that has none**. The composite key
exposed it by colliding; a surrogate id would have imported 2,211 undated rows
and reported success.
