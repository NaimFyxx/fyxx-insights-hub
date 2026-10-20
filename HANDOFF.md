# Handoff, 20 October 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

The six-item work order is complete except for one part of item 5, which needs
a decision from Naim. See "Waiting on a decision".

---

## Anything that changed a previously reported figure

**Conv. rate on the report now divides unique BUYERS by delivered**, which is
the numerator Klaviyo's own conversion_rate uses. review-request-judgeme,
September 2026: 2.0 per cent (54 of 2,762), not 3.5 (98 of 2,762). All email
flows: 1.2 per cent, not 1.9. `conversions` counts ORDERS, so a customer who
orders twice was being counted twice.

**Redemption rate is now the true share: 161 of 2,701, 6.0 per cent**, rather
than 172 of 2,701, 6.4. The numerator is now redeemers who are IN the base, so
"X of Y" is literally true. The 11 members who redeemed without buying in the
window are excluded.

**The redemption rate moved off the one-day basis.** It was 0.15 per cent,
one day's redeemers over every member ever. It is now a whole month over
members who still buy. The old figure divided
ONE DAY's redeemers by every member ever, so it read near zero whatever
happened and barely moved.

**Flow open rates were overstated and are now correct.** September 2026, email
flows: 38.4 per cent, not 48.7. review-request-judgeme: 761 opens of 2,762
delivered, not 1,298. Flow push opens: 274, not 308. Campaigns were never
affected and have not moved.

**Flow and push revenue on the report is now ex VAT.** Previously the flows
table printed gross while the campaign table printed ex VAT, so the two tables
on the same page used different units. September flow revenue reads 13,141
rather than 15,244. Stored data is unchanged; only the report divides.

**September reach is now reportable at 8,787 people.** Before the repair it was
withheld, because reach covered 3 of 30 days. 49 days from 1 September to
19 October were refetched.

**September flow recipients are 21,278, not roughly 350.** The nightly sync had
been storing only the first two hours of each day since 3 September. Fixed and
repaired; the figure now matches Klaviyo exactly.

**The report redemption rate reads 0.10%, not 10.0%.** `redemption_rate` is
stored as a percentage. The report was multiplying by 100 and the Loyalty page
was not, so the two pages disagreed for weeks. The report was the wrong one.

**Share of revenue is now share of ONLINE revenue**, Mobile App plus Website,
not all channels. September reads 24.5% rather than 10.1%. Draft orders and POS
are most of turnover and Klaviyo cannot influence a till sale.

**The campaigns table now shows the top 6 by revenue** plus a rolled-up row and
a total, where it used to list every campaign. No figure changed; the total
still covers every campaign. December 2025 would print 6 rows plus
"All other campaigns (5)" instead of 11 rows.

---

## September 2026 against Klaviyo and LoyaltyLion

Ten of twelve figures match exactly.

| Figure | Dashboard | Source |
|---|---|---|
| People reached | 8,787 | 8,783 |
| Email campaigns sent | 0 | 0 |
| Push campaign messages | 4 | 4 |
| Push campaign sent | 30,540 | 30,540 |
| Push campaign opened | 152 | 152 |
| Flow recipients, email and push | 21,278 | 21,278 |
| Attributed revenue incl VAT | 17,557 | 17,489 |
| Attributed revenue ex VAT | 15,135 | 15,076 |
| Blue / Silver / Gold / Platinum | 10,165 / 1,124 / 521 / 201 | same |

**The two that differ, and why:**

*Attributed revenue, 68 JOD high, 0.39%.* Our gross is 17,800.75 and four
attributed orders worth 244.13 have since been cancelled, netting to 17,556.62.
Klaviyo's 17,489 sits between the two, so it reflects cancellations as they
stood when the screen was read. Klaviyo never retracts a Placed Order event;
our figure nets at read time and therefore keeps moving as cancellations
arrive. The two will not converge permanently, by design.

*People reached, 4 high, 0.05%.* Unexplained. A hash collision would push our
figure down rather than up, so it is more likely a difference in which day or
channel each side counts at the month boundary. Not chased at 0.05%.

---

## Item 1: the sync was storing two hours of each day

`eachDay(from, to)` included the day in progress. The job fetched the current
day at about 02:00 Amman, stored the handful of rows that existed by then, and
logged the day complete, so it was never refetched. 15 September held 6 rows
and 7 recipients; the same day refetched gives 34 rows and 340.

Every existing check passed throughout: the job ran, it succeeded, it wrote
rows, and the data was current to yesterday. Only the size was wrong.

The fix is `settledDays()` in `scripts/lib/log.mjs`, which drops any date not
strictly before today in Amman. Applied to flows and reach.

**The missing check is now on Sync health.** `source_volume_check` compares each
elapsed day's row count against the median for the same weekday over the
preceding eight weeks and flags anything below 40 per cent. Replayed against
the pre-repair counts before shipping: it fires on 1 September, the first day
of the break, at 22 per cent of typical. It is same-weekday rather than a flat
average because sends are strongly weekly, and it has no upper bound because a
day that brings far more than usual is normally a real campaign.

**August attributed revenue was not a shortfall.** 31,421 stored against 41,743
in Klaviyo is cancellation netting working correctly: 42,042 gross less 10,622
cancelled across 39 of 388 orders. August is an outlier at 25.3 per cent of
orders cancelled against September's 1.4 per cent.

---

## Item 6: activations save, but every completed one printed as not done

The write path works. Verified as the `authenticated` role: insert returns a
row, RLS permits it, and the probe row was removed again. The table was empty
only because none had been added.

The real defect was a case mismatch. The form offers "Planned", "Done" and
"Not done", and the column default is "Planned", all capitalised. The report
compared against the lowercase `"done"`, so an activation marked Done would
have printed as "Not done" with the tick unfilled. Nothing caught it because
the table was empty, so the wrong branch had never run. Now compared
case-insensitively, since the two spellings live in different files.

---

## Conv. rate divides buyers, not orders

Klaviyo's `conversions` counts conversion EVENTS, meaning orders, so a customer
who orders twice is two conversions but one buyer. The report was dividing
orders by delivered and so ran above Klaviyo's own figure.

September 2026, review-request-judgeme: **54 of 2,762, 2.0 per cent**, not 98
of 2,762, 3.5. All email flows: 1.2 per cent, not 1.9.

Stored from Klaviyo's `conversion_uniques` statistic rather than derived from
`conversion_rate * delivered`. The derivation happens to be exact here, but the
rate is kept to four decimal places, so on a flow delivering tens of thousands
the rounding is worth a buyer or two either way.

One caveat that cannot be removed: summing unique buyers across a flow's
messages slightly overcounts anyone who bought from two of them. Klaviyo offers
nothing finer, and this was checked rather than assumed. A flow values report
grouped by `flow_id` alone is REJECTED with "Group by flow_message_id is
required", so the message is the smallest unit it will report and the sum is
the only flow-level figure that exists.

The Flows page withholds conversion rate on any range that is not a whole
calendar month, for the same reason it withholds open rate: a buyer who orders
in two months is one buyer in each, so the figures cannot be added. Orders,
recipients, clicks and revenue are additive and stay correct for any range.

## The redemption rate, and two traps in getting there

New definition, per Naim: members who claimed a reward in the month, state
approved or expired, over members who placed a non-cancelled Shopify order in
the 12 months to the end of that month.

September 2026: **161 of 2,701, which is 5.96 per cent**, displayed as 6.0.

The numerator is redeemers who are IN the base, so the two numbers nest and
"161 of 2,701" is literally true. 172 members redeemed in all; the other 11 are
6 enrolled members with no order in the window, 3 whose enrolment flag is not
set, and 2 whose id resolves to no Shopify customer.

| Month | Redeemers | Active members | Rate |
|---|---|---|---|
| June 2026 | 150 | 2,924 | 5.1% |
| July 2026 | 163 | 2,897 | 5.6% |
| August 2026 | 161 | 2,806 | 5.7% |
| September 2026 | 161 | 2,701 | 6.0% |

### Trap one: ll_rewards holds two different kinds of id

`ll_customer_id` means different things depending on which sync wrote the row,
and nothing in the column says which:

| source | id kind | length | period |
|---|---|---|---|
| `v2_transactions` | LoyaltyLion id | 9 to 10 | 31 Aug 2026 onward |
| `ll_export_20260829` | **Shopify customer id** | 13 to 14 | everything before |

Joining on `loyaltylion_id` alone silently drops 2,211 of 2,678 reward rows,
which is 82 per cent of the history. That is why only 173 of 816 redeemers
matched in the first rough count. Both joins are tried now and whichever
resolves is used.

### Trap two: loyaltylion_id is not a membership flag

`customer_identity.loyaltylion_id` is an identity LINK, set for 18,864
customers, far more than are actually members. Using it as the membership test
gives **4,314** active members, which is exactly the figure that looked wrong.
`shopify_customers.loyalty_enrolled` is the enrolment flag and gives **2,701**.

### The base reconciles, and which one is right

LoyaltyLion's `trailing_12m_customers` for September 2026 is 4,531 unfiltered.
Split by engagement status it is 662 redeeming plus 2,041 non-redeeming
members, so **2,703 members**, which is where that number comes from. Against
2,701 here, a difference of 2, or 0.07 per cent. The 4,314 was wrong.

Earlier months drift: June 2026 reads 2,924 here against LoyaltyLion's 2,808.
The cause is known. `loyalty_enrolled` is a CURRENT flag, while LoyaltyLion
counts a customer as a member only if they were already enrolled at their
latest order in the window. Testing enrolment date instead tracks July and
August better (within 3 and 9) but September worse (2,663 against 2,703).
Naim's definition says "LoyaltyLion members", present tense, so the current
flag is what is implemented, and recent months are the accurate ones.

### The numerator is not inside the denominator

172 redeemers, of whom 161 are in the base. The other 11 are 6 enrolled members
with no order in the window, 3 whose enrolment flag is not set, and 2 whose id
resolves to no Shopify customer at all. So the figure is redeemers per active
member, not the share of active members who redeemed. The view carries
`redeemers_in_base` so the gap is visible, and the Loyalty page says so.

If the share is wanted instead, it is 161 of 2,701, or 5.96 per cent, and the
change is one column name.

### Why it says 172 and not 173

The 173 in the brief counts a void claim. Void means the claim was cancelled
and nothing was redeemed, and the agreed definition excludes it. No timezone
effect: 172 either way.

### The old figure

`ll_snapshots.redemption_rate` is kept, because the nightly snapshot records it
and the Sync health seed probe tests against it, but it is no longer shown
anywhere. It is documented in queries.ts and health.ts as the one-day figure so
the two cannot be confused.

## Why flow opens were wrong, and why there is no per-day fix

Klaviyo's `opens_unique` counts unique PEOPLE inside the window it is asked
about. It is therefore not a quantity that can be split across days and added
back up: someone who opens on three days is one person in a monthly report and
three in the sum of three daily ones.

The sync was already storing `opens_unique` rather than total opens, so that
was not it. Measured on review-request-judgeme, 1 to 5 September:

| | delivered | opens_unique |
|---|---|---|
| one call for the range | 405 | 183 |
| five daily calls, summed | 405 | 197 |

Delivered agrees exactly. Only opens disagree, and only upward, and the gap
widens with the window because a longer window dedups more: over the full month
the daily rows sum to 1,298 against Klaviyo's 761, a factor of 1.71.

A second, smaller error ran the other way. Klaviyo returns no row at all for a
flow message that sent nothing that day, and the sync drops any row with zero
recipients anyway, so opens of an earlier send that land on a quiet day are
never recorded. Flows that send in bursts lose opens; flows that send daily
double count them. Checked directly: on 4 September the API returned 52 rows
and not one had opens without sends.

So there is no per-day figure to store. The only way to match Klaviyo over a
period is to ask Klaviyo for that period, which is what
`klaviyo_flow_monthly` now holds: one call per calendar month, which is also
the window the monthly report reads. Three calls cover August to October,
against about ninety for the same span one day at a time.

`klaviyo_flows` is unchanged and still right about everything else. Summing a
month of daily rows reproduces Klaviyo's delivered, conversions and revenue
exactly, which is why only the opens column moved.

**Campaigns were never affected.** The campaign sync already makes ONE call for
the whole range, and all seven August 2026 campaigns match Klaviyo exactly on
delivered and opens. Nothing there needed changing.

**The Flows page cannot show an open rate for an arbitrary range**, because no
true figure exists for one. It shows the rate when the range is exactly one
calendar month and withholds it otherwise, with the reason on the page.
Recipients, clicks, conversions and revenue are correct for any range.

## How Conv. rate is worked out, and a discrepancy in it

On the report it is **conversions divided by delivered**, where `conversions`
is Klaviyo's count of conversion EVENTS, meaning orders.

That is not the same as Klaviyo's own `conversion_rate`, which is **unique
buyers divided by delivered**. The two differ whenever a customer orders twice.
7 September, VW5Gsd: 76 delivered, 6 conversions, so the report shows 7.89 per
cent while Klaviyo shows 6.58, which is 5 buyers over 76.

Both denominators are delivered, so that part matches. Only the numerator
differs: orders here, people at Klaviyo. Worth deciding which one the report
should carry, since the stored `conversion_rate` column already holds
Klaviyo's version and nothing reads it.

## Two pages in heavy months, decided and built

Naim's call, 20 October: a month that does not fit prints on two sheets, the
type size stays as it is, and the split is always in the same place.

    sheet 1   month highlight, total reach, email campaigns, flows
    sheet 2   push, LoyaltyLion, activations, next month, footer

Whether a month needs the second sheet is MEASURED after layout, not guessed
from row counts, because what decides it is how many flow and campaign names
wrap onto a second line. The threshold is 292mm rather than 297mm: print
rounds differently from screen, and a month that overflows by a millimetre
without a deliberate break gets an accidental one, which usually strands the
footer alone on sheet two.

Verified through the real print pipeline, not by estimate. Headless Chrome
printed both shapes to PDF:

| Month shape | Sheet 1 | Sheet 2 | Pages in the PDF |
|---|---|---|---|
| September 2026, no campaigns | 283mm | none | 1 |
| December 2025, 11 campaigns | 240mm | 119mm | 2 |

No table crosses a boundary: `break-inside: avoid` on every table, section and
column block, and each is well under a sheet. The campaigns and flows tables
both sit whole on sheet 1 in the heavy month.

One trap worth keeping. `.rp` is a column flex container and the page-two
wrapper is one of its flex items, and page breaking inside a flex container is
the weakest corner of fragmentation support. A `break-before` that is silently
ignored would have printed the overflow wherever it landed, which is the exact
thing this is meant to prevent. Printing switches `.rp` to block layout and
restores the flex gap as margins.

## Also carried over, not started

- Whether Refresh should trigger the `updated_at` order repair.
- Two tracked lockfiles, `bun.lock` and `package-lock.json`. Pick the package
  manager the build actually uses and delete the other.
- Keep or revert `docs/BUILD-ENVIRONMENT.md`.
- Naim's own browser check of the query error states.

---

## Where things are

- `src/lib/rollups.ts` holds the three table aggregations, with no runtime
  imports so `scripts/test/report-rollups.test.mjs` can load it. 28 checks,
  watched failing against two deliberate regressions. Suite now 248 checks.
- The first version of those tests was wrong in a way worth remembering: every
  fixture happened to put Campaigns on top, so deleting the type ordering broke
  nothing. The ordering is now checked only with the smaller type first.
- `source_volume_check` is a view, granted to `authenticated`, surfaced on
  `/health`.
- The report preview renders from the draft in the editor, so typing shows on
  the page and only Save report writes. It used to render the saved value,
  which made Save the only way to preview.
