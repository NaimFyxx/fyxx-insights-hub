# Handoff, 20 October 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

The six-item work order is complete except for one part of item 5, which needs
a decision from Naim. See "Waiting on a decision".

---

## Anything that changed a previously reported figure

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

## One change is NOT in the repo and needs Naim to apply it

The nightly sync does not yet refresh `klaviyo_flow_monthly`, so flow opens
will go stale from 20 October onward until this lands. August to October are
already loaded, so nothing is wrong today.

The change is one word in three places in `.github/workflows/sync.yml`, on the
lines reading:

    SOURCES: ${{ inputs.sources || 'klaviyo,shopify,loyaltylion' }}

becoming:

    SOURCES: ${{ inputs.sources || 'klaviyo,shopify,loyaltylion,flow-monthly' }}

All three have to match, because they are the preview step, the run and the
summary, and a preview that advertises a source the run does not do is worse
than not changing it at all.

It could not be pushed from here: the token has no `workflow` scope, and GitHub
rejects any push that touches `.github/workflows/`. Either apply it in the
GitHub web editor or grant the scope and say so.

Until then it can be run by hand, and it is cheap, one call per month:

    node scripts/sync.mjs --only flow-monthly --from 2026-10-01 --to <yesterday>

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
