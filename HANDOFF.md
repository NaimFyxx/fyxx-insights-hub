# Handoff — 29 August 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

**Nothing is blocking.** The customer section EXISTS at `/customers` and is
being extended; it is not being built from scratch. Remaining work on it is
listed under Next.

---

## Where things stand

The dashboard has Overview, Online channels, Email campaigns, Flows, Push,
**Customers** (new), Loyalty, Activations, Export report and Sync health.
The `/report` route renders the monthly A4 page from live data and refuses any
section it cannot report honestly.

Six years of Shopify history are loaded (2019-09-09 on, 163,547 orders).
LoyaltyLion history is imported (101,639 rows). Klaviyo attribution is netted
of cancellations at read time. 19,163 customers carry first, second and last
order dates, computed revenue, acquisition channel and loyalty enrolment.

## Resolved

- 2,400 ghost customer rows deleted. `shopify_customers` is back to 19,163 with
  zero rows lacking `customer_created_at`. `loyalty-join.mjs` is UPDATE-only and
  verified: 2,401 LoyaltyLion customers with no Shopify counterpart skipped.
- **POS capture is a tracked monthly metric** on `/customers`, framed as a
  policy question with a price rather than a compliance failure, with the
  27 Feb 2026 series break shown as a row in the table rather than the series
  silently stopping.
- **Smile.io export inspected and NOT imported.** Read in place, never copied.

## Changed a previously reported figure

- **The 2026 "stabilisation" is NOT a recovery.** App share of new customers
  recovered to 48.4%, pushing mix-predicted repeat to 39.9%, its highest since
  2020 — actual was 33.7%, a **-6.2 gap, the widest recorded**. The line held
  flat only because mix gain offset continued within-channel decay. If mix
  recovery stalls it resumes falling.
- **Retention decline is real but smaller than the raw table showed.** Age-
  normalised 90-day repeat: 55.8% (2019) to 33.7% (2026). The raw "ever
  repeated" column runs 86.5% to 39.4% and reads as collapse.
- **One-and-never-returned 42.7% → 37.9%**, after the sweep revealed 74.3% of
  buyers first bought before 2025.
- Standing: attribution August 37,615 → 28,260 (share 22.0% → 16.5%); Mobile
  App influence 35.8% → 19.2%; Mobile App YoY +831.8% → +23.8%; birthday
  rewards 0 → 131 in August; pending points 8.34% → 1.59%.

## The customer picture

**Headlines** — 37.9% bought once and never returned; top 1% of buyers take
34.8% of revenue; 31.6% of revenue belongs to buyers we cannot reach.

**Acquisition channel quality**, all-time:

| Acquired via | Customers | Repeat ≤90d | Lifetime orders | Median revenue |
|---|---|---|---|---|
| Mobile App | 4,787 | **44.7%** | **13.5** | 131.0 |
| Website | 2,403 | 36.1% | 8.2 | 65.0 |
| Draft Orders | 1,336 | 34.8% | 9.5 | 128.8 |
| POS | 3,480 | 34.5% | 6.7 | 93.0 |

**Decay is concentrated.** Change 2021→2026: POS **-20.2**, Website -16.0,
Mobile App -14.8, Draft Orders **-1.2**. POS decayed worst AND grew fastest as
a share of acquisition (3.9% of new customers in 2020, 48.2% in 2022).

**Mix versus decay.** The mix shift explains ~6 of the 16 points lost 2019-2022.
From 2023 actual runs BELOW mix-predicted, gap widening to -6.2, so the rest is
every channel retaining worse than its own history. Indicative not exact: the
prediction uses all-time channel rates.

**Enrolment is the largest retention difference measured.** Within the same
acquisition channel:

| Acquired via | Enrolled | Not enrolled | Gap |
|---|---|---|---|
| Website | 56.7% | 26.6% | **+30.1** |
| Mobile App | 48.9% | 30.5% | +18.4 |
| POS | 40.7% | 24.4% | +16.3 |
| Draft Orders | 46.0% | 31.6% | +14.4 |

An enrolled POS customer retains close to the app average. **Correlational with
severe selection bias** — loyal customers are likelier to enrol. It shows where
to look, not what to conclude. If this reaches Zeid it must read "enrolled
customers retain far better", never "enrolling customers makes them retain".

**Why POS fell.** Not identification: an unidentified POS order has no customer
record, so the 23.1% is measured on identified customers only. Not Odoo: the
decline runs from 2021 H2 with no discontinuity at February 2026.

**Capture at the till collapsed in 2023 H2 and is flat since.** New customers
per 100 POS orders: 13.2 (2022 H2), 12.0 (2023 H1), **5.2 (2023 H2)**, 3.2,
3.2, 3.5, 4.0, 3.0 (2026 H1). It did not drift — it fell in one half-year and
has sat at 3.0-4.0 for three years. Whatever changed, changed then.

**Capture tracks basket size**, so it is a triage habit not an absence: 83.5%
of POS orders over 250 JOD carry a customer against 24.7% of orders under 10,
rising monotonically. Day of week barely matters (53.4% to 66.0%). 6,554
anonymous orders worth 279,461 JOD in fourteen months. Staff ARE asking, just
not on small baskets — which is a different fix, and a policy question with a
price rather than a compliance failure.

**Smile.io rules the platform migration OUT as the cause of the cliff.** Smile
enrolments by half-year: 1,410 (2022 H2), 774, **826 (2023 H2)**, 738, 857, 723
(2025 H1) — flat straight through the window where POS capture fell 12.0 to 5.2
to 3.2. Staff kept enrolling people at a steady rate while they stopped
attaching customers to POS orders in Shopify. The two are **decoupled**, which
points at how POS orders reach Shopify — the Odoo connector or till config —
rather than at staff engagement. Suggestive not conclusive: a Smile enrolment
could come through a web widget rather than the till. **A connector or till
change in H2 2023 is the thing to look for.**

The metric stops at 27 Feb 2026: after that only identified POS orders sync, so
the denominator changes meaning and 2026 H2 reads 12.1, an artefact.

**Reach ceiling.** 5,926 buyers (42.5%) on neither channel, 31.6% of revenue.
Workable list 2,884 never opted in, NOT the 1,362 who opted out. Priority 85
customers, 324,901 JOD. **SMS: 5,427 buyers reachable only by SMS**,
2,391,700 JOD, against 572 subscribers.

## Smile.io export — read, not imported

`/Users/fyxx/Downloads/Project_Smile.io Old Loyalty Program Back Up Data`.
Inspected 29 Aug 2026, deliberately not imported, no `data_coverage` entry.

| Question asked of it | Answer |
|---|---|
| Fills the 2019-2023 loyalty hole? | **No.** Points transactions cover 2025-07-22 to 2025-08-20 — one month, not five years |
| Enrolment history over a longer window? | Marginal. Dates run to 2020-10-13, but **98.7% of Smile customers (14,620 of 14,814) are already in LoyaltyLion**, and joining needs EMAIL, which this project deliberately does not store |
| The 2023 H2 cliff? | **Yes, decisively** — see above. Needed reading, not importing |
| Carries a Shopify customer id? | **No.** Email is the only key |

Also learned: Smile ran until 2025-08-20 while LoyaltyLion activities begin
2023-02-21, so the two **overlapped for over two years** rather than being a
clean cutover. Nothing spanning the migration is comparable — different
programme, tiers and point values.

## Traps worth knowing

- **LoyaltyLion Link header lists `rel="previous"` BEFORE `rel="next"`.** Read
  `cursor.next` from the body. A naive `/cursor=/` match paginates backwards.
  `lib/loyaltylion.mjs` is correct; ad-hoc scripts were not.
- **Resolve an unknown Shopify source id by app lookup**, never by name:
  `node(id:"gid://shopify/App/<id>"){ ...on App { title handle developerName } }`.
- **Sampling**: use a window not touching today when testing a filter; sample
  the full range for a state distribution; use the whole population for a total.
- **`amount_spent_jod` is unreliable** — ranking only. Use `revenue_jod`.
- **`numberOfOrders` includes cancelled orders.** Verified 808 of 808.
- Five distinct data start dates. Query `data_coverage`, never a constant.

## Open questions

1. **4% population gap** (19,163 vs a ShopifyQL export's 20,019) — no orphans
   found, cause unknown, parked.
2. **Live API sources for activities and transactions** — decided yes, unbuilt.
   `/v2/rewards` genuinely does not exist, so that import stays.
3. **Enrolment before/after test — FEASIBLE.** `enrolled_at` is present on
   every enrolled customer (79 of 79 sampled). Comparing a customer's order
   rate before and after their own enrolment is a within-customer comparison
   and much stronger than the cross-sectional split. It needs order dates
   relative to enrolment, which is one sweep storing counts either side.
   **It still would not be causal**: enrolment usually happens AT a purchase,
   so the "after" window begins at a moment of demonstrated engagement, which
   biases toward showing improvement. Worth doing, worth labelling.

## Next

1. **Finish the customer section** — two items left. Carry the "flat because
   mix gain offset decay" framing into the cohort panel so it cannot be
   misread, and surface enrolment as a retention dimension. The headlines,
   acquisition channel, mix-versus-decay, POS capture, life cycle,
   concentration and reach panels are all built.
2. **Enrolment before/after test** — approved, `enrolled_at` confirmed present
   on every enrolled customer. Compare a customer's order rate before and after
   their own enrolment. **Label it exactly**: enrolment usually happens AT a
   purchase, so the "after" window starts at a moment of demonstrated
   engagement and biases toward improvement. Closer than cross-sectional, never
   presented as causal.
3. **Capability sweep** of Shopify, Klaviyo and LoyaltyLion — documented
   surface, then one real probe per untried endpoint, timeboxed, into the
   README with the date. **Include `/v2/orders` on LoyaltyLion**: never used,
   carries `cancellation_status`, `total_refunded` and
   `metadata.shopify_source_name`, so it is a third independent view of every
   order and would let Shopify be cross-checked against something other than
   itself.
4. **Identity table** — `customer_identity` joining Shopify, Klaviyo and
   LoyaltyLion ids, with `matched_how`; surface the 20 Klaviyo profiles that
   map to several Shopify customers as a merge-detection list
5. **Retroactive-change fixes, still unbuilt**: `updated_at`-driven Shopify
   repair, and the Klaviyo trailing-90-day campaign re-fetch (one API call)

