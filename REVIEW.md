# Critical review — 31 August 2026

Not a bug list. What is thin, what would mislead a tired reader at 8am, what
exists because it was built rather than because it would be used — plus the
four splits Naim asked for.

Everything here was checked against the database or the code, not recalled.

---

## 1. MEASURED — computed live, recomputes on every load

These derive from stored rows at read time. If the underlying data changes,
the figure changes without anyone re-running anything.

| Figure | Source | Notes |
|---|---|---|
| Revenue and orders by channel by day | `shopify_daily_sales_net` over `shopify_orders` | nets cancellations at read time, excludes internal accounts |
| Klaviyo attributed revenue | `klaviyo_attributed_daily_net` | netted; **disagrees with Klaviyo's own UI on purpose** |
| Campaign / flow / push metrics | `klaviyo_*` tables | Klaviyo's own numbers, stored verbatim |
| Loyalty tier counts, points outstanding | `ll_snapshots` | only for nights actually scanned |
| Customer counts, lapsed segment, cohorts, retention | `shopify_customers` | lifetime, all-time |
| Revenue by acquisition channel, the 61%, the migration | `revenue_by_acquisition` | monthly buckets, netted |
| Excluded accounts and the 6% gap | `excluded_accounts` | one definition, three consumers |
| Acquisition coverage % | computed per range | **was a constant; now live** |
| Missing loyalty snapshots | `ll_snapshots` via `tierSeriesWithGaps` | shares the tested day-walk |

**The strongest single result in the system:** LoyaltyLion's `/v2/orders`
agrees with our channel mapping on **all 2,381 orders** over 30 days. That is
the only check available that does not derive from our own Shopify read.

---

## 2. INFERRED — correct arithmetic on an assumption

Each of these is defensible. None is a measurement.

| Figure | The assumption |
|---|---|
| **Acquisition channel** | The channel of a customer's FIRST order is where they "came from". Derived retroactively in the 2019 sweep, not recorded at the time. Validated only in that no channel is claimed before it existed. |
| **The 61%** | First-touch attribution. Someone acquired at POS in 2020 who has bought online for six years counts entirely as POS. |
| **The migration (34.7% / 35.0%)** | That "later orders" means everything after the customer's own first order. A different cut-off gives a different number. |
| **Identity links** | Klaviyo↔Shopify joined through order ids; LoyaltyLion↔Shopify through `merchant_id`. Both hard keys, but 64 profiles resolve to several customers and are quarantined rather than solved. |
| **House-account classification** | Two Shopify tags applied by hand. Hashim El akabi and Ahmad Ayman had identical tag signatures and opposite answers — the tag flagged the right pair and could not tell them apart. |
| **"Historic" on `/excluded`** | 180 days of silence. Arbitrary, and not labelled as arbitrary. |
| **Lapsed = no order since 2025-01-01** | A fixed date, not a rolling window. It will age badly and nothing will say so. |
| **POS capture rate** | Assumes Klaviyo's POS visibility is the only reason for the gap. The cause was never established. |

---

## 3. NEVER CHALLENGED — believed, untested

The category where the next wrong belief is sitting. Two beliefs have already
been tested this month and **both were artefacts** (the draft-order influence
story; the enrolment retention gap).

- **The 4% population gap.** 19,163 customers against a ShopifyQL export's
  20,019. No orphans found, cause unknown, parked weeks ago.
- **813 LoyaltyLion members with no Shopify customer row.** Found on 30 August
  by the orphan sweep, not investigated. May be the same 4%.
- **Every Klaviyo engagement rate.** Opens and clicks are stored exactly as
  Klaviyo reports them and have never been checked against anything. See §4 for
  why open rates specifically are worse than untested.
- **Unique reach.** The `profile_hashes` machinery has never been validated
  against an independent count.
- **`amount_spent_jod` vs `revenue_jod`.** Tested on 808 customers, applied to
  19,163. The conclusion is almost certainly right; the sample is 4%.
- **The enrolment within-customer result** (−25.9%). Computed once by a script,
  frozen into `ENROLMENT_WITHIN_CUSTOMER`, never re-run. Same for
  `BUSY_DAY_IDENTIFICATION`, `UNATTRIBUTABLE` and `INTERNAL_IN_MARKETING`.
- **Push "conversions".** Displayed on two pages. Nothing defines what a push
  conversion is or what window it uses.
- **Klaviyo's attribution window.** We net cancellations from Klaviyo's
  attributed orders but have never established what attribution rule Klaviyo
  applied in the first place.

---

## 4. Would mislead a tired reader at 8am

Ranked by how likely the wrong conclusion is.

1. **Email open rates carry no Apple MPP caveat — anywhere.** Grep finds no
   mention of Mail Privacy Protection in the app, the report or the pack. Apple
   pre-fetches images and marks messages opened regardless of whether anyone
   read them, which inflates open rates by a large and unknowable amount.
   Every open figure and every open-rate comparison in the monthly report is
   affected. **This is the single largest unlabelled distortion in the system**,
   and it goes to Zeid monthly.
2. **The acquisition trend prints the raw column beside the like-for-like one.**
   Reading across the wrong column gives +17 points instead of +9. The break is
   flagged above the table, but the wrong number is still on screen.
3. **Health says "Unique reach: ok" while reach covers 3 of 31 August days.**
   The health check measures whether the JOB RAN, not whether the DATA REACHES
   TODAY. A backfill can run successfully forever while recent days stay empty.
   The monthly report catches this and refuses to total — the health page does
   not.
4. **The loyalty tier chart looks like a trend and has five days of history.**
   The caption says so; the chart still draws a line.
5. **"Messages sent" counts sends, not people.** Labelled, but it is the
   biggest number on the Overview and reads as reach.
6. **Two date controls on the report page.** The global presets do nothing
   there. Captioned now, but the control is still visible and still inert.

---

## 5. Exists because it was built

- **Activations page — `activations` has 0 rows.** A full CRUD page, a nav
  entry and a sync-log source for a table nobody has ever written to.
- **Export report page — `reports` has 0 rows.** It saves a narrative that the
  report page also edits directly. Two ways in, neither used.
- **`shopify_margin_monthly`** — 80 rows, latest 2026-08-01, referenced twice
  in the frontend. Margin never appears in any conclusion or recommendation.
- **`klaviyo_order_influence`** — 41,419 rows maintained nightly. Its finding
  (Mobile App influence 19.2%) was reported once and is not on any page.

None of these is harmful. All of them cost a nightly job, a table, or a page
that has to keep working.

---

## 6. Guards and tests — watched failing, or only watched passing

Naim's addition, and the most useful column here. A guard nobody has seen fail
is an assumption wearing a guard's clothes.

### Watched failing — proven to fire

| Guard | How it was seen to fail |
|---|---|
| `assertFilterHonoured` | Fired wrongly in production 31 Aug (ordering coincidence); after the rewrite, deliberately fed `nonsense_param` and threw correctly |
| `mustReplace` (`edit.mjs`) | Six failure modes under test; caught a real ambiguous-anchor edit on 31 Aug |
| `assertReadOnly` | 27 checks assert it throws on mutations |
| GraphQL brace / empty-document guards | Asserted throwing in `sync.test.mjs` |
| `tierSeriesWithGaps` | Two deliberate regressions — omit-days fails 3 checks, zero-instead-of-null fails 2 |
| **Workflow gate** | Seven-case matrix under `bash -e`; found and closed the empty-outcome hole |
| `drift-check` pass condition | Watched at −1,339.400 JOD, then at 0.000 after the repair |
| `splitAnomalousDays` | Fired on the phantom all-Unknown day that produced 11,802 JOD of ghost revenue |
| Attribution bound assertion | Fired at 11.69× on 29 Aug — which is how we learned the bound itself was wrong |
| Report reach availability | **Currently firing** — refusing to total August reach, naming 3 of 31 days |

### Only ever watched passing — no evidence they work

| Guard | Why that matters |
|---|---|
| `MAX_DAILY_POINTS_MOVE` (25%) | Log says "−0.1% plausible" every night. Never fired. |
| `POINTS_EXPECTED` band (7.0M–10.5M) | Band is ±20% of a figure from weeks ago. Never fired. |
| Negative-points refusal | Never fired. |
| `selectAll` non-termination | Never fired. |
| Klaviyo metric-not-found | Never fired in anger. |
| `QueryFailed` error states | Added 30 Aug to all ten pages. **Never seen in production.** |
| Snapshot-gap alarm | Shares the tested day-walk now, but the DB half has never met a real gap. |
| **Per-step isolation** | The gate logic is tested; the isolation itself has never run in CI. First real proof is the next failing night. |
| **Nightly repair step** | Runs correctly by hand. Has never completed inside the workflow — the 31 Aug run cancelled it. |

**The honest summary:** the guards protecting things that have already gone
wrong are well tested. The guards protecting things that have not yet gone
wrong are decoration until proven otherwise. That is not an argument for
testing all of them — it is an argument for not counting them as safety.

---

## 7. What I would fix, in order

1. **Add the Apple MPP caveat to every open-rate figure** — app, report and
   pack. Cheapest fix here, largest misleading figure.
2. **Make health check data recency, not job recency.** Reach is the proof
   that "the job ran" and "the data is current" are different claims.
3. **Delete or fill Activations and Export.** Two pages backed by empty tables.
4. **Re-run the frozen constants** (`ENROLMENT_WITHIN_CUSTOMER`,
   `UNATTRIBUTABLE`, `BUSY_DAY_IDENTIFICATION`, `INTERNAL_IN_MARKETING`) and
   print their measurement date beside every figure they produce.
5. **Investigate the 813** LoyaltyLion members with no Shopify row, against the
   4% population gap. Two unexplained numbers of similar size.
6. **Decide what "lapsed" means as a rolling window**, before 2025-01-01 ages
   into meaninglessness.
