# Handoff — 29 August 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

---

## NEEDS ACTION

**Run this delete.** An ad-hoc join upserted all 21,264 LoyaltyLion customers
into `shopify_customers`, which held 19,163. The 2,400 extra inserted as rows
with a loyalty tier and nothing else — no orders, no created date, no consent.
They inflate the population and deflate every "share of customers" figure.

```sql
SELECT count(*) FROM shopify_customers WHERE customer_created_at IS NULL;  -- expect 2400
DELETE FROM shopify_customers WHERE customer_created_at IS NULL;
```

Every genuine Shopify customer has `customer_created_at`; only the ghosts lack
it. `scripts/diagnose/loyalty-join.mjs` replaces the ad-hoc script and is
UPDATE-only by construction, but it cannot distinguish the ghosts until they
are gone, because they are now in the known-customer set it checks against.

## Changed a previously reported figure

- **The 2026 "stabilisation" is NOT a recovery.** App share of new customers
  recovered to 48.4%, pushing mix-predicted repeat to 39.9%, its highest since
  2020 — but actual was 33.7%, a **-6.2 gap, the widest recorded**. The line
  held flat only because mix gain offset continued within-channel decay. If mix
  recovery stalls it resumes falling. My earlier "it stopped" framing was too
  comfortable.
- **Retention decline is real but smaller than the raw table showed.** Age-
  normalised, 90-day repeat runs 55.8% (2019) to 33.7% (2026). The raw "ever
  repeated" column runs 86.5% to 39.4% and reads as collapse.
- **One-and-never-returned 42.7% → 37.9%**, after the 2019 sweep revealed that
  74.3% of buyers first bought before 2025.
- Standing: attribution August 37,615 → 28,260 (share 22.0% → 16.5%); Mobile
  App influence 35.8% → 19.2%; Mobile App YoY +831.8% → +23.8%; birthday
  rewards 0 → 131 in August; pending points 8.34% → 1.59%.

## Findings this turn

**Why POS retention fell 20 points — three answers**

1. **Not an identification artefact.** An unidentified POS order has no
   customer record, so it can never enter the analysis. The 23.1% is measured
   on identified customers only — real decay among people we CAN see. But
   capture at the till has collapsed: new POS customers per 100 POS orders went
   12.5 (2022) → 7.7 → **3.2 (2024)** → 3.8 → 4.1.
2. **It predates the Odoo changeover by four years.** By half-year: 43.3%
   (2021 H2), 38.5, 37.9, 34.3, 26.5, 36.2, 29.0, 30.7, 25.8, 23.1 (2026 H1).
   No discontinuity at February 2026. The connector is not the cause. 2026 H1
   is only 52 customers because the POS definition changed — different
   population, do not compare like for like.
3. **Enrolment is the largest retention difference in the project.**

| Acquired via | Enrolled | Not enrolled | Gap | Orders enrolled / not |
|---|---|---|---|---|
| Website | 56.7% | 26.6% | **+30.1** | 18.9 / 3.3 |
| Mobile App | 48.9% | 30.5% | +18.4 | 16.0 / 4.7 |
| **POS** | **40.7%** | **24.4%** | **+16.3** | 9.0 / 3.2 |
| Draft Orders | 46.0% | 31.6% | +14.4 | 23.6 / 5.4 |

An enrolled POS customer retains close to the app average. Only 2,150 of 3,480
POS customers are enrolled. **Correlational, with severe selection bias** —
loyal customers are likelier to enrol, so this shows where to look, not what to
conclude.

**Decay is concentrated, not even.** Change in 90-day repeat 2021→2026: POS
**-20.2**, Website -16.0, Mobile App -14.8, Draft Orders **-1.2**. POS decayed
worst AND grew fastest as a share of acquisition (3.9% of new customers in
2020, 48.2% in 2022). Draft Orders has barely moved.

**Acquisition channel quality**, all-time: Mobile App 44.7% repeat and 13.5
lifetime orders; Website 36.1% / 8.2; Draft Orders 34.8% / 9.5; POS 34.5% / 6.7.

**Mix versus decay:** the mix shift explains ~6 of the 16 points lost between
2019 and 2022. From 2023 actual runs BELOW mix-predicted and the gap widens to
-6.2, so the rest is every channel retaining worse than its own history.
Indicative not exact — the prediction uses all-time channel rates.

**LoyaltyLion pagination trap.** The response body carries `cursor.next`. The
**Link header lists `rel="previous"` BEFORE `rel="next"`** from page two, so a
naive `/cursor=/` match paginates backwards and ping-pongs — 45,000 rows from a
21,264 population. `scripts/lib/loyaltylion.mjs` has always been correct;
ad-hoc scripts were not, so any sample size quoted from one before today is
inflated.

## Standing findings

- **5,926 buyers (42.5%) reachable on neither channel — 31.6% of revenue.**
  Workable list 2,884 never opted in, NOT the 1,362 who opted out. Priority 85
  customers, 324,901 JOD.
- **SMS: 5,427 buyers reachable ONLY by SMS**, 2,391,700 JOD, against 572
  subscribers.
- Concentration: top 1% take 34.8% of revenue, top 5% 62.7%, top 10% 76.0%.
  Mean 701.2 JOD against median 97.8.
- Identity join: LoyaltyLion `merchant_id` 99.8%; Klaviyo via order id 99.3%;
  Klaviyo `external_id` useless.
- LoyaltyLion API surface established: `/sites`, `/customers`, `/activities`,
  `/transactions`, `/orders`, `/webhooks` work. **`/v2/orders` has never been
  used** and carries cancellation status, refunds and channel. Claimed rewards
  genuinely unavailable, so the CSV import is justified.

## Open questions

1. **4% population gap** (19,163 vs 20,019) — no orphans, cause unknown, parked.
2. **Live API sources for activities and transactions** — decided yes, unbuilt.

## Next

1. Customer section: carry the "flat because mix gain offset decay" framing
   into the UI, and surface enrolment as a retention dimension
2. Capability sweep of all three APIs, timeboxed, recorded in the README
3. Identity table
4. `updated_at` Shopify repair and the Klaviyo 90-day campaign re-fetch, both
   still unbuilt from the retroactive-change work
