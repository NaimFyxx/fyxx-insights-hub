# Handoff — 30 August 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

**One thing is waiting on Naim**, and it gates the rest: the fix list in
`FILTERS.md`. See "Waiting on a decision" below. Everything else is unblocked.

The customer section EXISTS at `/customers` and is being extended; it is not
being built from scratch.

---

## The report now carries the like-for-like caveat

For August 2026 against August 2025 the report prints, ABOVE the tiles rather
than under them:

| | Aug 2025 | Aug 2026 | Movement |
|---|---|---|---|
| Raw share of all sales | 49.5% | 60.9% | +11.4 pts |
| **Like-for-like** | **53.8%** | **61.0%** | **+7.2 pts** |
| Coverage | 92.0% | 99.8% | |

The caveat renders only when the comparison actually spans 27 February 2026
(`spansBasisChange`), so it does not clutter a period where it does not apply.
It is written for a reader who has seen none of this: "the till began recording
a customer on every in-store order", not "the Odoo connector requires a
customer". The headline tile carries the like-for-like figure inline too.

## MPP labelled, and what replaces open rate — MEASURED, not assumed

**Labelled in all four places:** Campaigns, Flows and Push pages (shared
`OpensCaveat` component so the wording cannot drift), the monthly report, and
the verification pack — where it now LEADS the "Read me first" sheet, above the
four figures that cannot be reconciled.

**What replaces it was tested on our own 64 campaigns**, not taken as received
wisdom. `scripts/diagnose/engagement-signal.mjs`:

| | open rate | click rate |
|---|---|---|
| range | 26.9% – 89.0% | 0% – 10.2% |
| mean | 45.1% | 1.4% |
| relative spread | 0.30 | **1.14** |
| correlation with revenue per delivered | 0.403 | **0.779** |
| correlation with order rate | 0.416 | **0.798** |

**Clicks explain ~61% of the variance in revenue; opens ~16%.** Click rate
carries 3.9x the relative spread, so it can rank campaigns where open rate
cannot. And opens barely predict clicks at all (0.359).

**The honest answer to "what replaces it" is three things and nothing else:**
revenue per delivered message, click rate, orders attributed. That is the whole
list — `CAMPAIGN_JUDGEMENT` in `src/lib/engagement.ts`.

**Push is the exception and is stated separately.** Push opens are unaffected by
Apple Mail, but Klaviyo emits no push click event, so for push there is nothing
to fall back to.

## Health now checks data freshness, not just job success

`SOURCES` gained `dataStaleAfterDays` beside `staleAfterHours`, and a new
`behind` state distinct from `stale` — the fixes differ: a job that has not run
needs restarting, a job that runs but lags needs its backlog cleared.

**Proven against the real situation.** On 2 September `klaviyo_reach` had
succeeded that morning and its data reached only 26 August:

    Shopify sales      state=ok      behind=0d
    Unique reach       state=behind  behind=7d  the job is succeeding, but its
                                                data only reaches 2026-08-26

`coveredThrough` was already computed and simply never used in the verdict.

## The two empty tables — one broken, one merely unused

**Activations is UNUSED, not broken.** Full CRUD policies, insert payload
matches the schema, and with zero rows it degrades correctly to "No activations
for this month". Enter one and it will work.

**Reports was BROKEN.** `saveNarrative` upserts with
`onConflict: "start_date,end_date"` and no unique constraint on that pair
existed — Postgres rejects that with **SQLSTATE 42P10**. Proven with a
rolled-back probe, not inferred. **The report page's Save button had never been
able to work**, and nobody had noticed because `reports` has 0 rows.

Fixed by adding `reports_period_unique`, then re-probed: ACCEPTED. Watched
failing, then watched passing.

**One hazard that fix created, closed in the same pass:** the Export page used a
plain `.insert()`, which would now collide on the second export of a period.
Switched to the same upsert. Before the constraint it would have written
duplicates and `fetchNarrative`'s `.maybeSingle()` would have thrown later —
so that path was broken either way, just further downstream.

## QueryFailed — partly proven, and the limit stated

**Every one of the twelve pages has a REACHABLE error branch.** Checked by
ordering, not by presence: an `isError` check placed after `isLoading || !data`
would be dead code. The report page flagged in that scan and turned out to be a
false positive — it uses sibling conditionals rather than an if/else chain.

**The mechanism the pages depend on is proven.** Every failure mode produces an
ERROR rather than empty data:

| broken query | result |
|---|---|
| missing table | THREW |
| missing column | THREW |
| empty date — the original trigger | THREW |
| empty date on the paged path | THREW |

That is what turns "No campaigns in range." into "this could not be loaded".

**NOT proven: the rendered result in a browser.** The pages sit behind a
Supabase auth guard and I will not enter credentials. So this remains a
structural and data-layer proof, not the visual one Naim asked for. To finish
it properly someone logged in should clear a custom date on each page and
confirm the red block appears. Until then QueryFailed stays in the
"only ever watched passing" column for its rendering half.

## Critical review — DONE, in `REVIEW.md`

Four splits: MEASURED / INFERRED / NEVER CHALLENGED, plus guards by whether
they have been watched failing. Everything checked against the database or the
code rather than recalled.

**The finding that matters most: email open rates carry no Apple MPP caveat
anywhere** — not in the app, the report or the verification pack. Apple
pre-fetches images and marks messages opened whether or not anyone read them.
Every open figure and every open-rate comparison in Zeid's monthly report is
inflated by an unknowable amount, unlabelled. Largest unmarked distortion in
the system, and the cheapest to fix.

**Second: health measures whether the JOB RAN, not whether the DATA IS
CURRENT.** `klaviyo_reach` reports healthy — the nightly job succeeds — while
reach data covers **3 of 31 August days**. The monthly report catches this and
refuses to total; the health page does not. A backfill can run successfully
forever while recent days stay empty.

**Two pages are backed by empty tables:** `activations` (0 rows) and
`reports` (0 rows) both have full CRUD pages and nav entries.

**The guards split is the uncomfortable one.** Ten guards have been watched
firing; nine have only ever been watched passing — including `QueryFailed` on
all ten pages, the per-step workflow isolation, and the nightly repair step,
none of which has yet run in anger. Guards protecting faults that already
happened are well tested; guards protecting faults that have not happened yet
are decoration until proven.

**Found and fixed while reviewing:** `fetchSnapshotGaps` kept its own untested
copy of the day-walk that decides whether a loyalty night is missing — the
alarm for the only irrecoverable loss in the system was the untested
implementation. It now reuses `tierSeriesWithGaps`, which has nine checks and
two watched regressions.

## /v2/orders verification — DONE, and it found something in both directions

`scripts/diagnose/verify-loyaltylion-orders.mjs [--days 30]`. Read-only.
LoyaltyLion ingests orders through its OWN Shopify integration, so this is the
only check available that does not derive from our own sweep.

**2,381 orders compared over 30 days. LoyaltyLion sees 99.67% of ours.**

**CHANNEL: no disagreement, on any order.** Every
`metadata.shopify_source_name` maps to the same sub_channel we stored. This is
the result worth having: the +831.8% Mobile App error was a source-mapping
fault, and no internal check could ever have caught it because every internal
figure derived from the same mapping. **SOURCE_MAP is now independently
confirmed** rather than merely self-consistent.

**Two order-level disagreements, and Shopify was asked to arbitrate. One each
way:**

| Order | Shopify says | We said | LoyaltyLion said | Verdict |
|---|---|---|---|---|
| #164700 `7937149960439` | cancelled 30 Aug 13:07, current 0.0 | live, 32.200 | cancelled | **we were stale** — our sweep ran 29 Aug 23:29, before the cancellation |
| #163417 `7894644556023` | cancelled 16 Aug 10:06, current 0.0 | cancelled, 0 | **not_cancelled, 42.000** | **LoyaltyLion is wrong** |

Running `--repair 30` cleared ours. The remaining disagreement is
LoyaltyLion's: it has been carrying a cancelled order as live and full-value
for two weeks.

**So LoyaltyLion is a useful cross-check, NOT an authority.** It caught a
genuine staleness of ours and is itself wrong on another order in the same
window. Where the two agree the agreement is meaningful precisely because they
read Shopify separately; where they differ, Shopify decides.

**Two faults in the verification script itself, both found by running it:**

- It compared `total − total_refunded` against our revenue. Both figures are
  ALREADY net, so that double-counted every refund and manufactured **21
  disagreements out of 21 agreements**. Order 7936312180983 is the proof:
  LoyaltyLion 0 with 140 refunded, Shopify currentTotalPrice 0, ours 0 — three
  systems agreeing, reported as a fault by arithmetic. Same shape as the
  points-liability trap already documented in `lib/loyaltylion.mjs`: a current
  balance and a lifetime counter look interchangeable and are not.
- Its date-filter guard compared a UTC timestamp against Amman-dated bounds,
  so an order placed 00:30 Amman read as the previous day and the guard
  accused LoyaltyLion of ignoring a filter it had honoured.

Both would have been invisible without running the thing against real data.

## The gate — proven, not assumed

Naim's point: every step being `continue-on-error` with a final gate is the
pattern where one mistake turns every failure green forever. So the gate was
extracted verbatim from the YAML and run under `bash -e`, which is exactly how
GitHub Actions executes a `run:` block.

| sync | repair | backfill | reach | exit | says |
|---|---|---|---|---|---|
| success | success | success | success | **0** | All steps completed. |
| failure | success | success | success | **1** | Failed step(s): sync |
| success | failure | success | success | **1** | Failed step(s): retroactive-repair |
| success | success | success | failure | **1** | Failed step(s): unique-reach |
| failure | failure | failure | failure | **1** | names all four |
| success | skipped | skipped | skipped | **0** | dry run passes |
| (all empty) | | | | **1** | Gate cannot read steps.sync.outcome |

**One hole found and closed.** With all outcomes empty the gate passed — which
is what happens if a step id is ever renamed, and it would wave every future
failure through while looking healthy. The sync step carries no `if:`, so its
outcome can never legitimately be empty; the gate now fails loudly when it is.

Also verified the workflow reads `.outcome` and not `.conclusion`.
`continue-on-error` rewrites `conclusion` to success — reading it would have
made the gate permanently green, which is the exact failure mode being guarded
against.

## Chart interpolation across missing nights — fixed and tested

**The fault was real.** `chart` was built from scanned days only, so a missing
date was simply absent from the array — and an absent date is not "no data" to
a line chart. Recharts joins the neighbours and draws straight through, which
asserts a measurement nobody took.

**Fixed** by emitting one point per calendar day with `null` for unscanned
nights, and setting `connectNulls={false}` explicitly rather than relying on
the library default now that it is load-bearing. `TierPoint` is nullable on
purpose: the type has to be able to say "not measured".

**Extracted to `tierSeriesWithGaps()` in `src/lib/timeseries.ts` so it can be
tested.** Inline in a component it could only be checked by looking at a chart.

**Nine checks in `scripts/test/timeseries.test.mjs`, and the test was watched
failing before being trusted:**

- reverting to "omit missing days" → **3 checks FAIL**
- writing a missing night as `0` instead of `null` → **2 checks FAIL**
- restored → all pass

**Caught while writing it:** the first version of the test was appended after
`process.exit()` and used `assert` rather than this file's `check()` helper. It
was dead code that would have reported success forever. Moved above the exit
and rewritten.

## Step isolation — it was the second explanation, not a regression

Naim remembered per-source isolation being built and asked which it was before
rebuilding it. **It had not regressed.** The 31 August log proves the sync
script isolated its sources exactly as designed:

    ✓ Klaviyo: 0 campaigns, 4 flow rows, 4 push rows, 3 attributed day(s)
    ✓ Shopify: 9 day rows
    ✗ LoyaltyLion failed — ...
    ✗ 1 of 3 source(s) failed. Successful sources were still written.

Klaviyo and Shopify both completed and wrote. What was NOT isolated was the
WORKFLOW STEPS: `sync.mjs` exits 1, which failed the step, which cancelled
every step after it. The log shows the retroactive repair never executed —
"REPAIR mode" appears zero times.

So the isolation covered the main sync but not the repair, backfill and reach
steps added later. Exactly Naim's second hypothesis.

**Fixed at the workflow level.** Every step is now `continue-on-error` with
`if: !cancelled()` — a cancelled run still stops, but a failed sync no longer
prevents an unrelated repair. On its own that would silently turn a failed
night GREEN, so a final gate step reads every outcome, names which failed and
exits 1. The run summary gained a per-step outcome table. YAML validated;
9 steps.

## Missing loyalty snapshots — surfaced, and none outstanding

**No other night has been missed.** Tier snapshots run 2026-08-27 to 08-31,
five days, five recorded, zero gaps — the 31st because it was refilled
manually. The history is only five days old, so there was little opportunity
for others.

**Made loud, because it is the only irrecoverable loss in the system.**
`fetchSnapshotGaps()` in `src/lib/health.ts` walks the span day by day and
lists every date with no tier-bearing row. The health page shows it ABOVE
everything else in a destructive-bordered block naming each missing date.

There is no dismiss and no retry, deliberately. LoyaltyLion answers only "what
is true now" and keeps no history, so a missed night cannot be backfilled and
the notice cannot honestly be cleared. When there are no gaps the page states
that positively, with the span and the count, rather than staying silent —
silence is what let 31 August nearly pass unnoticed.

**Still open:** the loyalty chart interpolates across missing dates rather than
breaking the line. Not changed yet; with zero gaps there is nothing to render
differently today, but it should break rather than imply a value.

## Nightly sync failed 31 Aug — a false alarm from our own guard

**Not the repair step**, which was the obvious suspect since it landed the day
before. `sync_log` shows the run got through `klaviyo_flows`,
`klaviyo_campaigns` and `shopify_daily_sales` successfully, then errored on
`ll_snapshots` at 01:14 UTC — matching the 1m38s in the failure email.

**Cause: `assertFilterHonoured` was testing the wrong property.** It fetched 50
records with the date filter and 50 without, and threw if the two lists had the
same ids. That is not a test of whether a filter works — it is a test of
whether the unfiltered page happens to START with the same rows, which depends
on an ordering LoyaltyLion neither documents nor holds stable. On a busy
endpoint over a 3-day window the two legitimately coincide, and the guard then
fails a run in which nothing is wrong.

**Proved by probing the API minutes later:** `/transactions` and `/activities`
both honoured the filter perfectly — 50 of 50 records inside the window, while
the unfiltered page spanned 2026-08-16 to 08-31. The filter was never ignored.

**Fixed by asserting the property we actually depend on:** every record
returned falls inside the requested window. The unfiltered page is now used
only to confirm the endpoint HAS out-of-window rows to exclude; if it does not,
the result is INCONCLUSIVE rather than failed, because a quiet endpoint cannot
prove anything either way.

**Not a weakening — verified.** Tested against a deliberately unsupported
parameter (`nonsense_param=whatever`), which LoyaltyLion silently ignores per
the banner in that file. The new guard still throws.

**The missed snapshot has been taken.** Tier counts cannot be reconstructed
after the fact — the API has no history — so a skipped day is permanent. The
2026-08-31 snapshot is now written.

**Worth noting about the failure mode:** the run aborts entirely on the first
source error, so a false alarm in LoyaltyLion also cost that night's Shopify
repair step, which never ran. Whether each source should fail independently is
a design question, not a bug, and is not changed here.

## Orphaned loyalty sign-ups — swept, detailed, and the cause established

`scripts/diagnose/orphan-loyalty.mjs`. Swept **11,925 enrolled LoyaltyLion
members** against Shopify rather than checking only the accounts we suspected.

### 1. It is FOUR, not three

| Account | Email captured | Enrolled | Their spend that day |
|---|---|---|---|
| Table 3 | `amani.semaan@gmail.com` | 2025-09-06 | **376.750 JOD**, 4 orders |
| Terrace 1 | `thaee@thejamfam.com` | 2025-11-27 | **185.250 JOD**, 2 orders |
| Communal Table | `dinksewtaye@yahoo.com` | 2026-01-12 | **130.000 JOD**, 2 orders |
| Table 8 | `emilija.georgieva@eda.admin.ch` | 2026-02-04 | **102.750 JOD**, 2 orders |

Communal Table was missed first time because Shopify records it as HAVING an
email — so the "no email in Shopify" test passed it. The address is a personal
Yahoo account on a venue table, which is the same fault.

**All four are BLOCKED in LoyaltyLion with 0 points.** Order ids for each are in
the query in this file's git history. **794.750 JOD of spend across four
customers who signed up and earned nothing.**

The other 16 internal members flagged are staff using their OWN addresses
(`y.mazahreh@myfyxx.com`) or company addresses (`info@myfyxx.com` on Retail
FOC) — not orphaned customers, no action needed beyond the cleanup already
planned.

### 2. The cause is settled: the ORDER creates the enrolment

Enrolment fires **within seconds of an order at that till**:

| Account | Last order before enrolment | Enrolled at | Gap |
|---|---|---|---|
| Communal Table | 15:44:20 | 15:44:25.527 | **5s** |
| Table 3 | 20:46:37 | 20:46:43.320 | **6s** |
| Terrace 1 | 20:35:31 | 20:35:37.732 | **6s** |
| Table 8 | 19:57:31 | 19:57:48.145 | **17s** |

Four for four, at second resolution. This is not a nightly sync or a bulk
import; it is the checkout itself.

**And the address did not come from Shopify.** Three of the four have
`has_email = false` on their Shopify customer record while LoyaltyLion holds a
full address. LoyaltyLion cannot have read it from a Shopify field that is
empty, so it was supplied at the point of sale.

Together those two facts mean: **the till collects an email at checkout and
LoyaltyLion enrols whatever customer record the order carries.** Since
27 February 2026 the Odoo connector puts a customer on every POS order, so
there is now always a record for it to attach to.

**Likelier fix is at the till, not LoyaltyLion.** LoyaltyLion is behaving
consistently — enrol the customer on the order. The fault is that the order
carries a shared table account instead of the person. What would settle it
beyond doubt: LoyaltyLion's audit log for those four ids showing the enrolment
source, and whether the POS integration has an "enrol on order" setting.

### 3. Two numbers worth watching, neither the same problem

- **18 members hold an email LoyaltyLion has and Shopify does not; 15 are
  ACTIVE and on real customer accounts.** That is the same till capture working
  CORRECTLY — a person giving their address against their own record.
- **813 enrolled members have no Shopify customer row at all.** Unexplained,
  possibly related to the open 4% population gap. Not investigated.

## How venue tables enrolled in LoyaltyLion — and what it revealed

Naim asked how Table 3 got into a loyalty programme, since whatever route let
it in will let the next one in. Answered from LoyaltyLion's own records, not
inferred from ours.

**Each venue-table account holds a REAL CUSTOMER'S EMAIL in LoyaltyLion that
Shopify does not have.**

| Account | Email held in LoyaltyLion | Enrolled | State |
|---|---|---|---|
| Table 3 | `amani.semaan@gmail.com` | 2025-09-06 | guest, **blocked**, 0 points |
| Terrace 1 | `thaee@thejamfam.com` | 2025-11-27 | guest, **blocked**, 0 points |
| Table 8 | `emilija.georgieva@eda.admin.ch` | 2026-02-04 | guest, **blocked**, 0 points |

All three enrolled **on a day that account placed POS orders**, and our
`shopify_customers` row says `has_email = false` for each — so the address did
not come from Shopify. The mechanism is a customer giving their email at the
till while the sale is rung against a shared table account. LoyaltyLion then
enrols the TABLE as a guest member under that person's address.

**This is a customer-facing problem, not just data hygiene.** A real customer
who handed over their email at the till had their loyalty attached to "Table 8"
and earned nothing. Three known cases; there may be more where the customer had
no Shopify record to compare against.

**It is contained, for now.** LoyaltyLion has these accounts `blocked`, which is
why all three hold zero points. Blocking is the safety net that stopped this
mattering — not the tagging, and not anything on our side.

**It will keep happening.** Enrolment is partly order-triggered: 662 of 1,516
enrolments since September 2025 landed on a day the customer ordered, 332 of
them POS. And since 27 February 2026 the Odoo connector requires a customer on
every POS order, so every till sale now has an account attached to enrol.

Not provable from our data alone: whether LoyaltyLion's POS integration changed
in mid-2025, which would explain why accounts trading since 2022 only enrolled
from September 2025. That needs LoyaltyLion's own configuration history.

## Yousef Mazahreh — everything the account touches

One account, four separate problems. Naim asked for it in one place rather than
fixing it in pieces.

| System | What it holds |
|---|---|
| Shopify | `5320661500057`, 1,151 live orders, **28,027 JOD**, 2021-04-07 to 2026-08-24, across **all four channels** |
| | Tagged `CUSTOMER_INTERNAL` + `CUSTOMER TYPE_Employee` + `INTERNAL_EMPLOYEE` |
| LoyaltyLion | `561296048`, email `y.mazahreh@myfyxx.com`, **4,096 points approved, 0 spent**, enrolled 2023-02-21, **blocked** |
| Klaviyo | Profile `01GSE2S2VR4ZG9ZQ7QVY75Q4DH`, **SUBSCRIBED** |
| Identity | **Absent from `customer_identity`** — quarantined, because its profile is conflicted |
| Conflicts | In the worst conflict: **5 Shopify customers, 171 orders** on one Klaviyo profile |

**Its share of each problem:**
- **4.5%** of all excluded revenue (28,027 of 616,391)
- **34.6%** of all internal loyalty points (4,096 of 11,847)
- Shares a Klaviyo profile with **Omar Khamash (436 real orders, 17,673 JOD)**
  and three restaurant companies

**Three of the four are already contained.** Revenue is excluded. The points
are blocked in LoyaltyLion, so the 4,096 cannot be redeemed and the liability
is nominal. The identity table quarantines the profile rather than guessing.

**One is not: the Klaviyo profile.** It is SUBSCRIBED and carries the merged
order history of a staff member, a major real customer and three companies. Any
segment built on purchase behaviour sees that blend. This cannot be fixed from
here — the merge lives in Klaviyo.

**A staff account trading on all four channels for five years is worth a
second question.** 1,151 orders and 28,027 JOD is large for staff purchasing.
Whether that is genuine staff buying, orders placed on behalf of customers, or
a till account used as a catch-all is a question about how the business
operates, not one the data can settle.

## Internal accounts in marketing lists — measured, NOT material

Naim's question, from the "Free of Charge Goods FOC is SUBSCRIBED" finding:
are reach, member and tier counts inflated by accounts that are not people?
Yes, but barely. Measured 30 August 2026:

| | Internal | Of | Share |
|---|---|---|---|
| Email subscribers | 12 | 11,162 | **0.107%** |
| SMS subscribers | **0** | 572 | 0% |
| LoyaltyLion members | 20 | 11,891 | **0.17%** |
| Outstanding points | 11,847 | 8,630,831 | **0.137%** |

Nothing moves by more than about one part in six hundred. **Not adjusted for**
— an adjustment smaller than the rounding on the tile would add machinery
without changing a displayed number. Listed instead, so they can be cleaned at
source, which fixes it permanently.

Two things worth knowing beyond the totals:

- **Four VENUE TABLES are enrolled in the loyalty programme** — Communal Table,
  Table 3, Table 8, Terrace 1. They hold no points so nothing is distorted, but
  enrolment is evidently not gated against non-people.
- **Yousef Mazahreh holds 4,096 points**, a third of the internal total, and is
  the same staff account at the centre of the worst identity conflict.

Full list of all 20 on `/excluded`, with ids, Klaviyo consent state, tier and
points, ordered so the 12 to unsubscribe are obvious.

## The two ambiguous accounts — resolved

Naim confirmed: **Hashim El akabi (11,614 JOD) IS a real customer** and is now
exempt; **Ahmad Ayman (11,636 JOD) is not** and stays excluded. The tag pattern
— `CUSTOMER_INTERNAL` on a person's name with no employee tag — flagged the
right pair and could not tell them apart. Flagging rather than deciding was
therefore the correct call, and would have been wrong 50% of the time either
way.

**All-time revenue is now 9,844,063** (70 excluded accounts, 616,391 excluded).
The two pages still agree: August reads 177,193.521 on both.

**Fixed while doing this:** `/excluded` hardcoded the all-time figure, and it
was stale one exemption later. It is now derived from the same view the
Overview reads — a literal that drifts is precisely the failure this page
exists to prevent.

## DECIDED — internal accounts are excluded

Naim's call, 30 August 2026, after seeing the breakdown: exclude all of them.
Venue tables, By The Glass, terraces, write-offs, events and named staff.
Nothing about them is customer-attributable.

**All-time revenue is now 9,832,449 JOD** against a gross of 10,460,454 —
628,005 excluded across **71 accounts**.

**Talabat and Careem are EXEMPT**, on Naim's correction: tagged
`CUSTOMER_INTERNAL` but third-party delivery, real sales, active as of 27 Aug.
7,896 JOD returned to ordinary revenue. Listed by ID in the `excluded_accounts`
view; when the Shopify tag is fixed the exemption becomes a harmless no-op.

**One definition, three consumers.** `excluded_accounts` is the single source;
`shopify_daily_sales_net` and `revenue_by_acquisition` both read it, so they
cannot drift. That is what makes the two pages agree by construction rather
than by coincidence.

### Both confirmations Naim asked for

1. **The nine dropped days are all internal.** 2020-01-26 to 2022-04-22,
   679.75 JOD, and **zero non-internal orders lost** — verified by counting
   orders on those days that belong to neither an excluded account nor a
   cancellation. Listed by date in the README.
2. **The two pages agree.** August 2026 reads **177,193.521** on the Overview
   and 177,193.521 as the acquisition denominator. Identical, because both
   derive from the same view.

### Flagged, not changed

**Hashim El akabi (11,614 JOD, last order 2026-04-25) and Ahmad Ayman (11,636
JOD, last 2024-07-26)** are the only person-named accounts carrying
`CUSTOMER_INTERNAL` WITHOUT an employee tag. Every account that is clearly
staff carries `CUSTOMER TYPE_Employee` or `INTERNAL_EMPLOYEE`;
`CUSTOMER_INTERNAL` alone is otherwise used only for tables, write-offs and
events. They remain excluded — this is a flag for Naim, not a change made on
his behalf. Both appear on `/excluded` under "Worth a second look".

Consent and loyalty flags were tested as mistagging signals and are useless
here: "Free of Charge Goods FOC" is itself SUBSCRIBED and loyalty-enrolled.

### The exclusion is visible

New page at **`/excluded`**: every account by name, tag and category, with
order count, lifetime revenue, revenue in the selected range, and last order
date with a "historic" marker for anything quiet 180 days. Plus excluded vs
included for the range with the percentage, and the all-time figure both ways.

Every revenue figure carries `<ExcludesHouseAccounts />` — one shared component
so the wording cannot drift — linking to that page. Overview, acquisition and
online channels.

## Superseded — the earlier revert

**I made a call I had written was Naim's to make.** He asked which total the
dashboard should use so two pages would stop disagreeing; I answered by
redefining revenue for the whole dashboard. Those are different questions.
`fetchDailySales` reads `shopify_daily_sales` again. All-time revenue is back
to **10,461,794 JOD**. Build clean.

The consequence of reverting, stated so it is not rediscovered: the Overview
total and the acquisition denominator differ again by the house-account share
of the period — 1,161.900 JOD for August 2026. That gap is captioned on
`/acquisition` and in the report (`DENOMINATOR_NOTE`), not hidden.

### The 635,901 JOD, grouped for the decision

| Category | Accounts | Orders | Revenue | Share | Last order |
|---|---|---|---|---|---|
| Write-offs and freebies (FOC, Damaged Goods, Bar Washing) | 11 | 1,334 | 37,120 | 5.8% | 2023-03-12 |
| **Third-party delivery (Talabat, Careem)** | 2 | 61 | **7,896** | 1.2% | 2026-08-27 |
| Venue tables, terraces, bar, By The Glass | 31 | 8,535 | **485,055** | **76.3%** | 2026-02-21 |
| Events (Cohiba 55th, wine tastings) | 8 | 19 | 15,968 | 2.5% | 2022-11-13 |
| Named individuals (staff) | 21 | 4,084 | 89,862 | 14.1% | 2026-08-29 |

Three things this makes obvious that the single 635,901 figure hid:

- **Talabat and Careem are tagged `CUSTOMER_INTERNAL` and are plainly not
  internal.** They are third-party delivery channels — real sales to real
  customers, still active (last order 27 Aug 2026). This is a tagging error in
  Shopify, not a judgement call, and it is the one clear-cut item in the list.
- **Venue tables are 76.3% of the whole question.** Whatever is decided about
  "Table 3" and "Terrace 5" decides this; everything else is rounding. Note
  they STOP in February 2026 — same month the Odoo connector changed — so this
  may already be historic rather than ongoing.
- **Only 5.8% is unambiguous write-off.** The "Free of Charge Goods" case that
  makes exclusion feel obvious is the smallest real category.

Full per-account list with ids: run the query in this file's git history or
re-derive from `shopify_customers` where `is_house_account`.

## Changed a previously reported figure

- **The August headline is 60.9%, not 61.0%.** The drift repair removed the ten
  cancelled orders and two refunds, so the denominator fell to 176,695.021 and
  online-acquired revenue to 107,613.336. The figure quoted all through
  yesterday was computed before the repair ran. It is a rounding-scale change,
  but it is the number going to Zeid, so it is recorded rather than glossed.
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
- **"10.7% of orders have no customer" was wrong — it is 16.4%.** Estimated
  from comparing two aggregates before order-level data existed; measured at
  25,197 of 153,827 live orders. The REVENUE half of that claim was right and
  is unchanged at 9.5%, as is the 84.4% assignable ceiling built on it.
- **Revenue moved to 9,825,893 and is now back at 10,461,794.** The
  house-account exclusion was applied and then REVERTED, because it was not
  mine to decide. Every historical figure is as it was. See the section above.
- **August total revenue 176,440.643 → 179,196.321 → 178,034.421.** Three
  numbers, one month, all explicable: the first was `shopify_daily_sales`
  before the nightly sync caught up on 29–30 August; the second is every
  non-cancelled order; the third is the same minus 55 house-account orders
  worth 1,161.900, and is what the dashboard now shows everywhere.
- **August revenue was overstated by 1,339.400 JOD (1.55%) until the drift
  repair ran.** Ten orders cancelled after we stored them, two silent revenue
  edits, three orders never stored. Now 0.000.
- **The rise in online-acquired share is ~9 points, not ~17.** Raw share runs
  44.1% (Dec 2025) to 61.0% (Aug 2026), but the denominator changed in April
  when POS orders began carrying customers. Like-for-like it is 50.9% → 60.2%.
  The 61.0% is correct for August; the COMPARISON was not.
- **The filter audit (30 Aug) changed no stored figure.** It read code and found
  nothing displayed to be wrong that day. `DATA_TODAY` would have made every
  range figure wrong from 1 September; fixed before it expressed itself.
- **Identity conflicts, house-account share 7.8% → 39.4%.** The first number
  counted conflicts; the second weights them by orders (588 of 1,494), which is
  the denominator that matters. Conflicts are very unequal in size and house
  accounts carry the large ones. Counting understated it fivefold.

## The 61% needs a caveat it did not have

**61.0% is correct for August 2026 and safe to say. Comparing it to last
year's ~45% is NOT.** Found while building the trend Naim asked for.

The Odoo connector began requiring a customer on every POS order after
27 February 2026. POS orders carrying no customer ran 42-50% through late 2025,
spiked to 87.3% in March 2026, and have been ~0% since April. Unattributable
revenue therefore left the denominator almost entirely, and the raw share
jumped with it.

| | Dec 2025 | Aug 2026 | Apparent rise |
|---|---|---|---|
| Share of ALL revenue (raw) | 44.1% | 61.0% | +16.9 pts |
| Like-for-like share | 49.6% | 61.1% | **+11.5 pts** |

**Roughly a third of the apparent rise is the denominator changing, not the
business.** On a trailing year: like-for-like averages **50.9% across the 8
months before the break and 60.2% across the 5 months since — +9.2 points.**

That is still a real rise and still the argument Naim wants. It is just
9 points, not 17. The trend panel leads with the break notice, prints both
columns with the like-for-like one bold, and rules a line across the table at
2026-04.

## Where things stand

The dashboard has Overview, Online channels, Email campaigns, Flows, Push,
**Customers** (new), Loyalty, Activations, Export report and Sync health.
The `/report` route renders the monthly A4 page from live data and refuses any
section it cannot report honestly.

Six years of Shopify history are loaded (2019-09-09 on, 163,547 orders).
LoyaltyLion history is imported (101,639 rows). Klaviyo attribution is netted
of cancellations at read time. 19,163 customers carry first, second and last
order dates, computed revenue, acquisition channel and loyalty enrolment.

## Next

1. **The filter fixes, then the verification pack** — both described under
   "Waiting on a decision". These come first: everything else assumes the
   dashboard can be trusted, and right now Naim does not trust it.
2. **Retroactive-change fixes**: the `updated_at`-driven Shopify repair and the
   Klaviyo trailing-90-day campaign re-fetch (one API call). Decided: poll now,
   webhooks later.
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

## Refund without cancellation — #164665, and why nothing needs fixing

Checked directly against Shopify rather than taken on either agent's word.

**#164665 (`7936312180983`, Alaa Al Khatib)** — `cancelledAt` is genuinely
null. Financial status REFUNDED, fulfillment FULFILLED, original total 140.0,
**currentTotal 0.0**, totalRefunded 140.0. So it is a completed order that was
fulfilled and then fully refunded, never formally cancelled. The other
session's diagnosis is correct on this point.

**Our figures are already right, and no Shopify surgery is needed.** We store
`currentTotalPriceSet`, which nets refunds, so this order contributes **0 JOD**
to every revenue figure. Cancelling it in Shopify or adding a
`status:cancelled` tag would not move a single dashboard number. Both were
suggested as fixes; neither is one, for our purposes. Whether it should appear
in Shopify's own cancelled-orders filter is a Shopify UI question, separate
from whether our revenue is correct.

**One detail from the other session is wrong.** It attributed the 16 JOD
discount edit to #164665. That edit was on **#164664** (`7936289308919`) — same
customer, created 7 minutes earlier, still PAID with currentTotal **140.0** and
zero refunded. These are two distinct orders that both now read 140:

| | #164664 | #164665 |
|---|---|---|
| status | PAID | REFUNDED |
| original → current | 156 → 140 (edited) | 140 → 0 (refunded) |
| contributes to revenue | 140 JOD | 0 JOD |

The drift check caught them as two separate rows for exactly this reason, and
its "revenue changed without cancellation" category exists for this case.

**Small open item for the critical review.** An order refunded to zero still
counts as an ORDER. In August that is 15 orders, 0.68% of the 2,218 live ones,
moving AOV from 80.734 to 80.188 — a 0.55 JOD difference. Revenue is
unambiguously right; whether a fully refunded order should count in the order
COUNT is a definitional choice, currently made in favour of counting it.

## Drift: measured, not estimated — and repaired

A real cancellation batch on 30 August 2026 was measured against a baseline
taken beforehand. `scripts/drift-check.mjs`, baseline in
`drift-baseline-2026-08-30.json`.

**Net drift over the trailing fortnight: −1,339.400 JOD, −1.55%.** Composition:

| | JOD |
|---|---|
| 10 orders cancelled after we stored them | −1,400.750 |
| 2 silent revenue edits, no cancellation (156→140, 140→0) | −156.000 |
| 3 orders in Shopify we had never stored | +217.350 |
| **Net** | **−1,339.400** |

**The export Naim sent understated his own batch.** It listed 10 orders, but 2
of those (#164582, #164604) were cancelled on the 28th and we already had them.
Meanwhile 2 orders NOT in the export were cancelled in the same minute-wide
window: **#164048 (674.250 JOD, cancelled 9 days after the order) and #164499
(245.000 JOD)**. Those two are **919.250 JOD — 66% of the cancellation value**.
The CSV was presumably filtered by created-date and missed the older ones.

**Only 1 of 10 was more than 3 days old, and it was the largest.** So a repair
window sized to "most cancellations" would have caught nine orders and left
half the money behind.

**REPAIRED.** `scripts/sync-orders.mjs --repair N` fetches orders UPDATED in
the last N days, whenever created, and upserts them. Run at 30 days it read
3,711 orders in 15 pages and 15 seconds, against 163,584 orders and 14 minutes
for a full sweep. After running it, `drift-check --compare` reports a gap of
**0.000 JOD (0.00%)**. That is the pass condition, and it passes.

**Wired into the nightly job**, not left as a manual step — `.github/workflows/
sync.yml`, after the main sync, skipped on dry runs. YAML validated.

## The three August totals, reconciled

Naim found three figures in circulation. All three are now explained, and one
has resolved itself.

| Figure | August revenue | Orders | What it is |
|---|---|---|---|
| Verification pack, as generated 30 Aug | 176,440.643 | 2,188 | `shopify_daily_sales` BEFORE the nightly sync caught up |
| `shopify_orders`, and `shopify_daily_sales` now | **179,196.321** | 2,225 | Every non-cancelled order, house accounts included |
| Acquisition page denominator | **178,034.421** | 2,170 | The same, **house accounts excluded** |

- **The first is gone.** The nightly sync has since run; `shopify_daily_sales`
  now reads 179,196.321, identical to the order table. It was staleness, and it
  corrected itself. A regenerated pack shows the new figure.
- **The third is house accounts: exactly 55 orders worth 1,161.900 JOD.**
  179,196.321 − 1,161.900 = 178,034.421, and 2,225 − 55 = 2,170. Not an error
  in either. The acquisition view joins orders to customers so it CAN exclude
  staff and venue-table accounts, as every customer-level figure already does.
  `shopify_daily_sales` has no customer dimension and cannot.

**Stated on the page now, not left to be rediscovered** — `DENOMINATOR_NOTE` in
`src/lib/acquisition.ts` appears under the coverage note on `/acquisition` and
in the report caption.

**RESOLVED — the dashboard now reads `shopify_daily_sales_net` everywhere.**
Naim asked twice which total to use everywhere, so this was decided rather than
deferred a third time. The Overview and the acquisition page now both divide by
**178,034.421** for August and the 61.0% recomputes off that same denominator.

**What moved: all-time revenue 10,461,794 → 9,825,893 JOD, −635,901 (6.1%).**
That is 73 accounts the store itself tags `CUSTOMER_INTERNAL` (57 customers,
597,676) or `CUSTOMER TYPE_Employee` (20 customers, 70,760). Every revenue
figure on the dashboard moves down by the house-account share of its period.

**Reverting is one line** — change the table name back in `fetchDailySales`
(`src/lib/queries.ts`); nothing else depends on which of the two is read. The
open judgement is whether venue tables and "By The Glass" are sales or internal
transfers. "Free of Charge Goods" plainly is not. If some are genuine sales the
narrower fix is to split the `CUSTOMER_INTERNAL` tag, not to revert wholesale.

**Nine days drop out of the series**, all between 2020 and 2022, each one a day
where every order was cancelled or a house account — 679.75 JOD across six
years. Checked before switching rather than discovered afterwards.

**The verification pack deliberately still reads the RAW table**, because its
job is to be compared against Shopify admin and Shopify admin includes these
accounts. The Sales sheet now states the gap and names the figure to subtract
to reach the dashboard number.

**Superseded note:** A view over
`shopify_orders` that excludes house accounts, nets cancellations at read time
and is never stale. It ties to the acquisition denominator exactly. Switching
the dashboard to it would make every revenue figure consistent and fix trailing
-day staleness in one move — **but it moves all-time revenue from 10,461,794 to
9,825,893, a drop of 635,901 JOD (6.1%)**, because house accounts leave every
historical figure. That is Naim's call, not a change to make quietly. The
question is whether venue tables and "By The Glass" are sales or internal
transfers; "Free of Charge Goods" clearly is not.

## Built, in order

**The 61% now appears in three places, as asked.** Overview (headline block
above the channel figures, linking to the detail), `/acquisition` (full trend),
and the monthly report — same wording in all three, with the coverage figure
for the period stated alongside. The report block is deliberately separate from
attributed revenue and captioned never to be added to it, since an order can be
both.

**Acquisition channel — all three items built, at `/acquisition`.**

Backed by `revenue_by_acquisition`, a VIEW over `shopify_orders` so
cancellations net at read time. 1,669 rows; reconciles to the underlying orders
exactly (9,825,893 JOD both ways). House accounts excluded; orders with no
customer KEPT and labelled.

- **The headline, as one number.** August 2026: **61.0% of revenue came from
  customers acquired online** — 108,591 of 178,034 JOD. All-time it is 51.1%.
  The tile is worded "revenue from customers marketing brought in", NOT
  "revenue marketing caused", and the page says why the second claim is
  indefensible.
- **Revenue by acquisition channel by month, beside revenue by order channel**,
  same months and same revenue cut both ways, so the divergence is visible
  rather than described.
- **The migration panel shows orders and revenue side by side**, with the ratio
  stated: Mobile App 22.1% of later orders offline against **34.7% of later
  revenue, 1.6x**; Website 23.5% against **35.0%, 1.5x**. Verified against SQL.
- **A separate acquisition-channel filter**, local to the page, dashed border,
  captioned that it is not the Overview's order-channel control and that the
  two giving different totals for the same range is correct.

**Coverage is computed live, not printed as a constant.** It varies from 83.7%
(2024) to 99.8% (2020), so the fixed 84.4% Naim asked for would have misstated
most ranges — in August 2026 the real figure is 99.8%, because POS orders now
carry a customer. The panel states the in-range figure, then gives 84.4% as
all-time context and names the spread. Same instruction, honoured in the form
that does not create a new wrong number.

**Filter fixes — all applied, build clean.**

- **A1 first, as asked, because it had a deadline.** `DATA_TODAY` is gone.
  Presets now read the real Amman clock; verified at three dates — on
  2026-09-01 "This month" correctly returns September, which it would not have.
  The report month picker follows the same clock, so September is selectable.
- **A2** `refreshKey` added to `customers`, `pos-capture-sales`, `activations`
  and `report`. Zero query keys now lack it. Two `invalidateQueries` calls
  pointed at keys that had gained a member and would silently have stopped
  matching; both switched to prefix matching.
- **A3** Export page now FOLLOWS the range instead of seeding from it once.
- **A4** The overview chart axis is the union of both series, so a day with
  Klaviyo revenue but no selected-channel sales no longer vanishes.
- **D1/D2** `QueryFailed` added to primitives and wired into **all ten pages**.
  A failed query can no longer render as "No campaigns in range." or hang on
  "Loading…" forever.
- **D3** The custom date inputs ignore an empty value, so a keystroke can no
  longer send `date >= ''` to PostgREST and break every page.
- **C** Captions added where a control correctly does not apply: the Customers
  page says every figure is lifetime across all channels, Activations and
  Report name their own month pickers, and Campaigns/Flows/Push say Klaviyo
  cannot split by Shopify sales channel.

**Verification pack — built and self-verified.**
`scripts/verify-pack.mjs --month 2026-08`. Eight sheets; totals are live Excel
formulas so filtering recomputes them. Output is gitignored — regenerate rather
than committing it.

Every total was read back out of the workbook and reconciled against SQL:
sales 2,188 orders / 176,440.643 JOD over 115 rows; campaigns 72,211 sent /
10,127.485; flows 1,690 recipients / 516.900; push 126,853 sent / 1,947.818;
attribution 37,615.045 gross and 28,260.112 net. All exact.

The pack names what CANNOT be checked, which was the requirement: netted
attribution has no Klaviyo equivalent, "messages sent" counts sends so its
total compares to nothing, push clicks do not exist in Klaviyo at all, loyalty
tier blanks mean unmeasured rather than zero, and the 4% population gap
(20,019 vs 19,163) is stated as open.

**Order-level sweep — DONE.** 163,584 orders in `shopify_orders`, 655 pages,
13m43s, **zero unmapped source names**. 9,757 cancelled and 26,209 with no
customer, both stored rather than skipped.

**It reconciles.** Against `shopify_daily_sales` for August, all 110 settled
day-and-channel combinations match EXACTLY. The only five that disagree are
2026-08-29 and 08-30 — the daily table is stale on the trailing days, which is
the retroactive-change problem already queued as Next item 2, not a fault in
either table. Order-level: 2,225 orders / 179,196 JOD; daily table: 2,188 /
176,440.

**The migration pattern is real, and bigger by revenue than by orders.** Of
customers acquired ONLINE, excluding each customer's own first order:

| Acquired via | Later orders | Still online | Phone/draft | In store | Later revenue OFFLINE |
|---|---|---|---|---|---|
| Mobile App | 55,749 | 77.9% | 13.7% | 8.5% | **34.7%** |
| Website | 16,362 | 76.5% | 15.1% | 8.4% | **35.0%** |

About a fifth of later ORDERS from online-acquired customers go offline, but
**over a third of their later REVENUE** does — offline baskets from these
customers are materially bigger. This is the effect Naim predicted: marketing
acquired them, the sales channels get credited.

**Coverage confirmed at 84.4% of revenue**, exactly as estimated before the
sweep. Only 2 orders have a customer but no acquisition channel.

**Superseded sweep note.** `scripts/sync-orders.mjs`, populating
`shopify_orders`. Naim approved it mid-turn; it is a backend job that changes
nothing on screen, so it ran alongside the filter work rather than ahead of it.
At last check 80,000 of ~154,000 rows, **zero Unknown channels**, 10,550 with
no customer, 5,845 cancelled (stored, not skipped). When it finishes, items 1
and 2 of the acquisition-channel request become buildable.

## Acquisition channel vs order channel — feasibility, answered

The distinction: the channel toggles filter by ORDER channel (where an order
came from). Acquisition channel is where the CUSTOMER first came from. An
app-acquired customer who now phones orders in shows as Draft Orders revenue —
marketing acquired them, the dashboard credits the sales team.

**Acquisition channel IS reliable, including pre-2025.** Two independent
checks:

- **No channel is claimed before it existed.** Earliest acquisition date
  matches the earliest order on that channel EXACTLY, four times over: Mobile
  App 2019-12-02, POS 2019-12-03, Website 2019-12-25, Draft Orders 2020-01-27.
  A derivation that guessed or defaulted would not line up four for four.
- **The sweep ran AFTER the SOURCE_MAP corrections**, not before. The app-id
  fix is commit `46b5443` at 18:13 on 29 Aug; the 2019 sweep is `4d4da23` at
  19:15, an hour later. So it used both Mobile App ids, `checkout_next`,
  `580111` and `1830279` — the mapping errors that produced the +831.8%
  Mobile App figure were already fixed. Populated for 100% of buyers, no NULL
  and no "Unknown".

**All three asks are feasible, and all three need the same one sweep.**
`shopify_customers` stores only `first_order_channel`; there is no order-level
table, so nothing can currently be cut by acquisition channel OVER TIME.
Shopify holds the data — we have simply never stored it. Better: the existing
`scripts/diagnose/customer-history.mjs` ALREADY derives per-order channel per
day (`channelByDay`, line 57) and throws it away, keeping only the first. The
migration analysis is being computed and discarded on every run.

**Proposed: a `shopify_orders` table** — order_id, shopify_customer_id,
ordered_at, sub_channel, revenue_jod. ~154,000 rows. Acquisition-channel
revenue then becomes a view joining `first_order_channel`, and cancellations
net at read time against `cancelled_orders` the way attribution already does.

**The ceiling, which must be on the panel: 84.4% of revenue.** An order with no
customer attached can never carry an acquisition channel, and 16,462 orders
(10.7%) and 997,898 JOD (9.5%) have none — the POS and draft-order placeholder
problem, already measured. House accounts hold a further 635,901 JOD. So
8,825,239 of 10,459,038 JOD is assignable. The remainder is not a rounding
error and cannot be closed.

**One framing caution for Zeid.** Crediting a customer's whole lifetime revenue
to their acquisition channel is a strong claim: someone acquired at POS in 2020
who has bought online ever since would count entirely as POS. It answers
"revenue from customers marketing brought in", which is the question asked, but
it is not "revenue marketing caused". Label it as the former.

## House-account contamination — measured, and confined

Naim's concern: house activity sitting inside a real customer's Klaviyo profile
would corrupt any per-customer figure touching them, and any segment they are
in. Measured rather than assumed:

- **Inside this database: zero.** `customer_identity` holds 18,929 rows, 6,649
  with a Klaviyo profile, and **every one of those profiles maps to exactly one
  customer**. All 64 conflicted profiles are ABSENT from the table — the loader
  quarantines an ambiguous profile rather than picking a winner. So no figure
  computed here mixes a house account with a real customer. This was by
  construction, not by luck, but it had never been checked.
- **Inside Klaviyo: 3 profiles, 7 real customers.** Those 7 hold 611 lifetime
  orders and 21,105 JOD — **0.50% of orders and 0.24% of revenue**. Confined.
- **But severe for those 7 individually**: 1,502 house orders sit on the same
  three profiles, so in Klaviyo those people's profiles carry roughly 2.5x more
  house activity than their own.
- **Two of the three profiles are SUBSCRIBED**, so they can receive campaigns
  and sit in behavioural segments shaped by that mixed history. The affected
  real customers are Omar Muhammad Khamash (`6607593505015`), Jireas Haddad
  (`8312268947703`), Caroline Zawaideh (`4535572037785`), Jireas Sahawneh
  (`9121758085367`) and three company records with no email.

**Not fixable from here.** The merge lives in Klaviyo; this database only
observes it. Unpicking it is manual work in Klaviyo's own UI.

## The lapsed panel — built

Live at `/customers`, directly under the headline tiles, because it is the only
panel on that page naming a specific action for a specific list of people.
`lapsed()` in `src/lib/customers.ts`; figures verified against SQL before
shipping.

- **6,392 lapsed** (bought at least once, nothing since 2025-01-01),
  **1,478,104 JOD** lifetime between them.
- **2,878 contactable today** — subscribed, no opt-in step — holding
  **721,183 JOD**.
- The other 3,514 are broken out and stated on the panel: 1,684 have an address
  but were never asked, 771 unsubscribed, 1,059 have no address. The four
  groups sum to 6,392 exactly.
- **Start-here tile: 69 customers, 183,771 JOD** — subscribed, 1,000+ JOD
  lifetime, last bought in 2024.
- Value is concentrated: of the 2,878, **130 people at 1,000+ JOD hold 317,563
  JOD — 4.5% of the people, 44% of the value**, averaging 36.9 lifetime orders.
- Recency and value point the same way: the 1,029 who lapsed in 2024 are both
  the largest group and the most valuable (355,049 JOD).

Both tables on the panel split the SAME 2,878 people two ways, which the panel
says explicitly so they are never added together.

## The filter audit — what it found

Full detail and line references in `FILTERS.md`. The three that matter:

- **`DATA_TODAY` is frozen at 2026-08-31** (`src/lib/ranges.ts:19`), Lovable
  seed residue whose comment still says "the seeded dataset covers June–August
  2026". Every date preset derives from it. Harmless today by luck. **From
  1 September "This month" silently means August and "Last month" means July,
  permanently**, and the Report page's `max` will refuse September outright.
  `ammanToday()` ten lines below reads the real clock, so they already
  disagree.
- **Refresh is inert on four queries** — `customers`, `pos-capture-sales`,
  `activations`, `report` omit `refreshKey` from the query key. Hard to spot
  because `staleTime` is 0, so navigating away and back does refetch.
- **Only the Report page checks `isError`** — one grep hit in the codebase.
  `campaigns.tsx:32` does `data ?? []` with an unguarded chart panel, so a
  FAILED query renders **"No campaigns in range."**, a confident factual claim
  produced by an error. Flows and Push share it; guarded pages show "Loading…"
  forever instead. Live trigger: clearing a custom date input sends
  `date >= ''` to PostgREST, which rejects it — verified, not inferred.

Two clean results, worth as much as the faults: **no figure responds to a
filter it should ignore**, because the channel bar is rendered only by the page
that reads it; and **`sub_channel` holds exactly four values with no nulls**, so
the toggles are exhaustive and all four selected does equal the total.

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

## Resolved

- **Identity table built.** 18,929 rows. 18,864 carry a LoyaltyLion id (99.7%),
  6,649 a Klaviyo profile (35.1%), 6,584 both.
  - **64 conflicts** over 20 months, tracked in `identity_snapshots` so the
    RATE becomes visible. **The worst spans 5 Shopify customers and 171
    orders**, mixing an employee (Yousef Mazahreh, 1,220 lifetime orders, house
    account), a major real customer (Omar Khamash, 436 orders, 17,673 JOD) and
    three companies with no email address. Those are not one person.

    **House accounts are 7.8% of conflicts but 39.4% of conflicted orders**
    (588 of 1,494). Counting conflicts understates them fivefold, because
    conflicts are wildly unequal in size and house accounts carry the large
    ones. Four of the top five involve a house account and one is two house
    accounts merged into each other. Separately, **26 of 64 (41%)** involve a
    customer with **no email** — the case where Klaviyo has to fall back to
    another identifier.

    Neither is a diagnosis. Top five with ids, for checking in Shopify:

    | Klaviyo profile | Orders | Shopify customers |
    |---|---|---|
    | `01GSE2S2VR4ZG9ZQ7QVY75Q4DH` | 171 | 5320661500057 Yousef Mazahreh (1,220, **house**) · 6607593505015 Omar Muhammad Khamash (436) · 9381827117303 شركة جمع للمطاعم العالمة (6, no email) · 9121758085367 Jireas Sahawneh (4, no email) · 9079041917175 شركة الكميه للمطاعم السياحيه (4, no email) |
    | `01J925FFSAAT36B9T86RCASXX9` | 148 | 8312268947703 Jireas Haddad (151) · 9208254726391 Mousa Sweiss (64, **house**) · 9079041917175 شركة الكميه (4, no email) |
    | `01GSE3EEV7DWXF2TJPB8Y6ZPZB` | 146 | 6371814768887 Essa Gacaman (218, **house**) · 4535572037785 Caroline Zawaideh (6) |
    | `01GSE3G85T6GJREFK148WMN86N` | 107 | 5028813242521 Shafiq Ghattas (253, **house**) · 6371814768887 Essa Gacaman (218, **house**) |
    | `01GSE3H7RNQGKV5GAKZCKTB7KN` | 74 | 2826198843488 Fadi Afram (203) · 3663652094105 Mercedes Alonso (45) |

    `9079041917175` appears in three separate conflicts. The last row is the
    one with no house account and no missing email, so it is the cleanest
    candidate for a genuine mis-merge.
  - **The population split, on the Shopify side where six years exist** (19,090
    real customers):

    | | Customers | Note |
    |---|---|---|
    | never bought | **6,505** | 34% — on file, never ordered |
    | lapsed before 2025 | **6,392** | 33% — **1,478,104 JOD lifetime**, 5,333 have an email, **2,878 already subscribed** |
    | bought since 2025 | 6,193 | 32% |

    The lapsed group is the actionable one: 2,878 of them are subscribed right
    now, so they can be contacted today without asking anyone to opt in.

    **The 9,892 Klaviyo figure CANNOT be split this way.** The Klaviyo link runs
    through 2025+ orders, so a pre-2025-only buyer has no order to route
    through. Splitting it needs an email join, which this project does not
    store. The Shopify split above is the answerable version and covers a
    different population — 19,090 customers against 17,358 Klaviyo contacts.
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

- **A feature that has never been used has never been tested — by anyone.** The
  report page's Save button could never have worked: it upserts on
  `(start_date, end_date)` and no unique constraint existed, so Postgres would
  have rejected it with 42P10 every time. Nobody noticed because `reports` had
  0 rows, so the failure had never fired. Same shape as the Lovable seed data
  and the unused guards: **absence of evidence reading as evidence of absence.**
  When adding an upsert, check the conflict target against the actual
  constraint — this was then caught a second time, before shipping, on
  `ll_rewards`, whose primary key turned out to be three columns rather than
  the two the code named.

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

## Historic — the filter fix list, as proposed

Nothing here is outstanding. Kept only as the record of what was proposed and
why, and of the sequencing Naim asked for.

**The filter fix list.** A correctness pass over every page and figure is
written up in `FILTERS.md` — which range filter each uses, which channel
filter, and whether it should. Nothing has been CHANGED in the frontend yet,
deliberately: Naim asked to see broken separated from by-design before code
moved, because the complaint was "I can't tell which is which".

Proposed, awaiting a yes or a narrower yes:

- **A1–A3** — mechanical: real clock instead of the frozen one, `refreshKey`
  into four query keys, Export page following the range.
- **D1–D3** — error states, so a failed query stops rendering as a finding.
- **C** — captions on the pages that correctly ignore the date range, saying so.

**The verification pack is gated behind this** — an August 2026 spreadsheet,
one sheet per section (Shopify revenue and orders by channel by day, campaigns,
flows, push, loyalty snapshot, customer counts), totallable in Excel against
Shopify admin, Klaviyo and LoyaltyLion directly. Requirement worth preserving:
**where a figure cannot be checked against a source, the sheet must say so.**
That is as useful as the ones that can. The point is not bug-hunting; it is
Naim rebuilding first-hand confidence rather than taking figures on trust.
