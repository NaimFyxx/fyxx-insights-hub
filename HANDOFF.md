# Handoff, 20 October 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

The six-item work order is complete except for one part of item 5, which needs
a decision from Naim. See "Waiting on a decision".

---

## Anything that changed a previously reported figure

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

## Waiting on a decision: the page fits September, not a month with campaigns

Measured by mounting the real report component at A4 width with fixture data,
not estimated.

| Month shape | Rendered height | Verdict |
|---|---|---|
| September 2026, no campaigns | 283mm content, 297mm page | fits, 14mm spare |
| December 2025, 11 campaigns | 351mm | 54mm over |

Removing the acquisition section, shortening every note to one line, capping
the campaigns table, tightening the section gap to 1.6mm and row padding to
0.7mm together took roughly 90mm out of the page. September now fits
comfortably. A month with campaigns does not, and roughly one month in three
has six or more.

The remaining 54mm cannot come out without changing something Zeid approved.
The options, in the order I would pick them:

1. **Accept two pages in months with campaigns.** Costs nothing, changes no
   figure, and the second sheet carries the footer rather than losing rows.
2. **Drop the type scale**, tables from 7.4pt to about 6.6pt and the tiers with
   them. Keeps one page in every month, but the page will not look like the one
   he signed off.
3. **Move Activations and Next month to a second sheet** in heavy months only,
   which makes the page count vary by month in a way nobody can predict.

Nothing has been done on this, because picking for him is how a figure or a
layout gets redefined without being asked. **This one is Naim's call.**

---

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
