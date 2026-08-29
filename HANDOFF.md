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

- **Identity table built.** 18,929 rows. 18,864 carry a LoyaltyLion id (99.7%),
  6,649 a Klaviyo profile (35.1%), 6,584 both.
  - **64 conflicts** — Klaviyo profiles whose orders belong to several Shopify
    customers, over 20 months. The worst is one profile spanning 5 customers
    and 171 orders. Tracked over time in `identity_snapshots` so the RATE is
    visible, which is the maintenance signal.
  - **9,892 Klaviyo contacts have no order since 2025-01-01** — 57% of the
    17,358 contact base. Note the window: a profile that bought in 2023 and not
    since counts here, so it is "no recent order", NOT "never bought".
  - Klaviyo linkage is 35.1% because the edge runs through orders and only
    reaches people who have bought. That is the design, not a shortfall.

- **Push clicks: closed question.** Report no longer says "under
  investigation". Klaviyo emits opens and bounces for push and no click event,
  so opens are the only push signal available to anyone.
- **Webhooks and bulk operations decided**, both recorded in the README with
  the reasoning rather than just the outcome.

- **API capability sweep done**, recorded in the README with the date. Three
  findings that change what is next:
  - **Push clicks do not exist.** Klaviyo has `Opened Push` and `Bounced Push`
    and NO push-click metric. The report says the zero is "under
    investigation"; it should say Klaviyo does not emit the event.
  - **Shopify webhooks are the right fix for retroactive changes**, better than
    polling `updated_at`. `ORDERS_CANCELLED` fires however old the order. 225
    topics, none registered, token has the scopes. Blocked on having nothing
    listening — a Supabase Edge Function would be the home.
  - **Shopify bulk operations** would replace the 11-minute sweeps with one
    job, but starting one is a mutation and `assertReadOnly` blocks all
    mutations by standing instruction. Needs a decision, not an assumption.

- **Enrolment before/after test done** — result inverts the cross-sectional
  finding. See the enrolment section above.

- **Customer section COMPLETE.** The cohort panel now states that the flat
  section is two opposing forces cancelling, not a recovery. Enrolment is a
  first-class retention dimension with its correlational caveat inline.
- **`scripts/lib/edit.mjs`** makes the edit assertion structural.

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

**TESTED WITHIN-CUSTOMER, AND THE GAP DOES NOT SURVIVE.** Comparing 4,115
customers against themselves either side of their own enrolment — 180 days each
way, enrolment-day order excluded — orders fell from 1.92 to 1.42 per customer,
**-25.9%**. The 416 who enrolled on a day they were already buying show +21.4%,
which is the bias made visible: their "after" window opens on a purchase.

So the cross-sectional gap above is almost certainly **selection, not effect** —
engaged customers enrol, rather than enrolment making customers engaged. Likely
regression to the mean: people enrol during an active spell and revert.
**Tested at 90, 180 and 365 days. The direction holds at every width**: -32.5%
(4,792 customers), -25.9% (4,115), -23.7% (2,875). The biased subset decays the
other way — +25.6%, +21.4%, +3.3% — because the purchase its window opens on
matters less over a longer span. A real effect would not dissolve on one side
and persist on the other; that pattern IS selection.

**Do not build a case for pushing enrolment at the till on these numbers.**
Neither test is causal in either direction; enrolment is chosen, never assigned.
An experiment — offering enrolment to a random half — is the only thing that
would settle it.

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

**Dated to Q2→Q3 2023, on ordinary days — but it is NOT a single switch.**
Identification on days under 60 orders: 70.9% (2023 Q1), **79.3% (Q2)**,
**55.8% (Q3)**, 41.9%, 61.1%, 41.7%, 35.2%, 52.3% (2024 Q4).

- The drop is on ORDINARY days, not an artefact of busy ones.
- It is **identity capture specifically**: customer, email and phone all fell
  together in July 2023 while tags stayed 100%, retail location 100%, and the
  app remained `pos | Point of Sale`. Nothing else about the order changed.
- **It oscillates afterwards** (41.9 → 61.1 → 41.7 → 35.2 → 52.3), which a
  connector or till change would not do. A permanent system change does not
  recover to 61% and fall again.
- High-volume days are a SECOND factor: none in 2023 Q1, sixteen by 2024 Q3,
  identifying at 24-40% against 35-79% on normal days.

**The cause is UNKNOWN and the investigation is closed.** Two explanations are
ruled out — the loyalty migration (Smile enrolments flat, 826 in 2023 H2 against
774 in H1) and a single configuration change (the oscillation). What remains is
most likely staffing, till procedure or something else in the shop that none of
these systems record. Naim is asking Anna what changed around July 2023. Do not
re-derive either story from the chart; the panel says so explicitly.

**Two findings stand on their own and are actionable without knowing the cause:**
- **Capture tracks basket size** — 83.5% over 250 JOD against 24.7% under 10.
  A threshold question with a price, not a compliance failure.
- **Busy days cost identification and there are more of them** — days with 60+
  POS orders identify at 24-40% against 35-79% on ordinary days, and went from
  none in 2023 Q1 to sixteen in 2024 Q3. Busy days alone erode capture over
  time with nobody changing behaviour.

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

- **A silent no-op edit is the same fault as a silent zero.** `str.replace`
  does nothing when its target has been reformatted, and `git add -A` commits
  the unrelated files without complaint — so a change can be reported as landed
  when it was not. It happened twice: a handoff rewrite and a panel rewrite.
  **Now structural: use `scripts/lib/edit.mjs`.** `mustReplace` throws on a
  missing target, an ambiguous one, an already-applied one, and on a write that
  did not take. The check is inside the function, as `assertReadOnly` is inside
  `gql()`, so an edit cannot be done without it. Covered by the test suite. It
  caught a reformatted target on its first real use.

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

1. ~~Identity table~~ DONE. Next: **retroactive-change fixes** — `customer_identity` joining Shopify, Klaviyo and
   LoyaltyLion ids with `matched_how`, plus the Klaviyo profiles mapping to
   several Shopify customers as a merge-detection list. **DDL at the bottom of
   this file, awaiting approval.**
2. **Retroactive-change fixes**: the `updated_at`-driven Shopify repair and the
   Klaviyo trailing-90-day campaign re-fetch (one API call). **Decided: poll
   now, webhooks later** — approximate and observable beats exact and silent.
3. **`/v2/orders` on LoyaltyLion** — a VERIFICATION exercise, not a data
   source. It carries `cancellation_status`, `total_refunded` and
   `metadata.shopify_source_name`, so it is a third view of every order that is
   not Shopify. Compare against what we hold and report where they disagree.
   Agreement everywhere is itself a useful result.
4. **Critical review of the whole dashboard and report** — once the queue is
   empty. Not bugs: what is thin, what would mislead a tired reader at 8am,
   what exists because it was built rather than because it would be used.
   **Include a three-way split of every number: MEASURED, INFERRED, and NEVER
   CHALLENGED.** Two believed hypotheses have now been tested and both were
   artefacts — the draft-order marketing-influence story and the enrolment
   retention gap. Untested numbers deserve the same scepticism, and the third
   category is where the next wrong belief is sitting.


---

## DDL awaiting approval — customer_identity

```sql
-- One row per person, holding the id each system knows them by.
--
-- Two of the three edges are HARD KEYS and neither uses email:
--   LoyaltyLion -> Shopify   customers.merchant_id IS the Shopify customer id.
--                            99.8% of 2,000 sampled. Email would have been
--                            worse: only 79% of LoyaltyLion customers have one.
--   Klaviyo -> Shopify       derived through ORDERS. A Placed Order event
--                            carries the Klaviyo profile and the Shopify order
--                            id; the order carries the customer. 99.3% of
--                            profiles resolve to exactly one customer.
--
-- Klaviyo's own external_id is useless here: populated on 10.4% of profiles and
-- zero of those are Shopify ids.
--
-- The Klaviyo edge only reaches people who have ORDERED. A subscriber who has
-- never bought has no order to route through and stays unlinked. Fine for every
-- question asked so far, all of which are about buyers.
CREATE TABLE public.customer_identity (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_customer_id   text NOT NULL,
  klaviyo_profile_id    text,
  loyaltylion_id        text,

  -- Audit trail, not a confidence score. Both edges are hard keys, so this
  -- records WHICH key was used rather than how sure we are.
  matched_how           text NOT NULL,   -- 'merchant_id' | 'order_id' | 'manual'
  klaviyo_order_matches integer NOT NULL DEFAULT 0,

  first_confirmed_at    timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at     timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shopify_customer_id)
);
CREATE INDEX customer_identity_klaviyo_idx ON public.customer_identity (klaviyo_profile_id);
CREATE INDEX customer_identity_ll_idx      ON public.customer_identity (loyaltylion_id);

-- A Klaviyo profile whose orders belong to more than one Shopify customer.
-- Not noise: either Lori has not merged two customers yet, or Klaviyo merged
-- two people who should not have been. Twenty cases in four months, and
-- currently no other way to see them.
CREATE TABLE public.identity_conflicts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  klaviyo_profile_id   text NOT NULL,
  shopify_customer_ids text[] NOT NULL,
  order_count          integer NOT NULL DEFAULT 0,
  detected_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (klaviyo_profile_id)
);

ALTER TABLE public.customer_identity  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customer_identity_select_authenticated"
  ON public.customer_identity FOR SELECT TO authenticated USING (true);
CREATE POLICY "identity_conflicts_select_authenticated"
  ON public.identity_conflicts FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.customer_identity  FROM anon, authenticated;
REVOKE ALL ON public.identity_conflicts FROM anon, authenticated;
GRANT SELECT ON public.customer_identity, public.identity_conflicts TO authenticated;
GRANT ALL    ON public.customer_identity, public.identity_conflicts TO service_role;
```

Three notes:

- **No email column**, consistent with `shopify_customers`. Neither edge needs
  one and storing it would add PII for no join.
- **`matched_how` is an audit trail, not a confidence score.** It was scoped as
  provenance for an email match; both edges turned out to be hard keys, so it
  records which key was used.
- **Conflicts get their own table** rather than a flag, because the useful thing
  is the LIST — which profiles, which customers — not a count.
