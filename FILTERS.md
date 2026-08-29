# Filter correctness audit

Read from the query code on 30 August 2026, not from intent. Every claim below
names the file and line it came from.

Two controls are global, in the top bar: the **date presets** and **Refresh**.
A third, the **channel toggles**, is rendered by the one page that honours it.

## What each page actually does

| Page | Range filter | Channel filter | Refresh works | Right? |
|---|---|---|---|---|
| **Overview** | global, in query key | global, applied client-side after fetch | yes | yes |
| **Campaigns** | global, `sent_on` | none — Klaviyo cannot split by Shopify channel | yes | yes, unstated |
| **Flows** | global, `date` | none, same reason | yes | yes, unstated |
| **Push** | global, `sent_on` | none, same reason | yes | yes, unstated |
| **Loyalty** | global, `snapshot_date` | none — programme-wide | yes | yes, unstated |
| **Online channels** | global | **own** App/Website scope | yes | yes, and says so |
| **Customers** | **none** — all-time by design | none | **no** | design right, silent, Refresh broken |
| **Health** | **none** — it is about sync freshness | none | yes | yes, unstated |
| **Activations** | **none** — own month picker | none | **no** | design right, Refresh broken |
| **Export** | seeds from global **once**, then detaches | none | n/a | **no** |
| **Report** | **own** month picker, global range inert | none | **no** | design right, silent, Refresh broken |

Per-figure detail for the Overview, the only page with both controls:

| Figure | Range | Channel | Labelled |
|---|---|---|---|
| Messages sent | yes | ignored, correctly | yes — "whole account, not affected by the channel toggles" |
| Klaviyo revenue | yes | ignored, correctly | yes |
| Klaviyo share of all revenue | yes, settled days only | ignored — denominator is deliberately all channels | yes, plus a paragraph |
| Revenue / Orders / AOV | yes | yes | yes — "follows the channel toggles" |
| Loyalty members | yes | ignored, correctly | **no** |
| Daily revenue chart | yes | mixed — see A4 | title only |
| Messages sent by channel | yes | n/a — "channel" means email/push/flow here, not a sales channel | **no** |

`sub_channel` holds exactly four values in the database and no nulls, so the
four toggles are exhaustive: selecting all four does equal the total. Checked,
not assumed.

## A. Should respond and does not

**A1. `DATA_TODAY` is frozen at 2026-08-31.** `src/lib/ranges.ts:19`, seed
residue — its own comment still says "the seeded dataset covers June–August
2026". Every preset is computed from it. Today this is harmless by luck. **From
1 September, "This month" silently means August, "Last month" means July, and
"Last 3 months" means June–August — permanently.** The Report page is worse: it
defaults to that month and its `max` attribute will refuse to let you pick
September at all. `ammanToday()` right beside it reads the real clock, so the
two disagree already.

**A2. Refresh does nothing on four queries** — `customers`, `pos-capture-sales`
(`customers.tsx:41,44`), `activations` (`activations.tsx:41`) and `report`
(`report.tsx:50`). Their query keys omit `refreshKey`, so the click is inert.
The data is not frozen — `staleTime` is 0, so navigating away and back does
refetch — which is precisely why this is hard to spot.

**A3. The Export page detaches from the range.** `export.tsx:24-25` seeds
`from`/`to` into `useState` once. Change the preset while on that page and the
inputs keep the old dates, so the export covers a period you are no longer
looking at.

**A4. The Overview daily-revenue chart drops days.** `overview.tsx:161-169`
builds its date axis from selected-channel sales only. A day with Klaviyo
revenue but no sales in the selected channels disappears from the chart
entirely, taking its Klaviyo point with it.

## B. Responds when it should not

**Nothing.** The channel bar is rendered only by the page that reads it, so
there is no page where a control moves and the figures do not. A4 is the one
partial case: the channel selection reaches the Klaviyo series indirectly,
through the axis rather than the values.

## C. Correctly ignores it, and does not say so

This is the largest group and matches where the confusion is.

- **Customers** — every figure is lifetime or all-time. Correct, and the page
  never says the date range does not apply to it.
- **Report** — has its own month picker; the global presets do nothing.
- **Health** — about sync freshness, so a range is meaningless.
- **Activations** — own month picker.
- **Campaigns, Flows, Push, Loyalty** — no Shopify channel split is possible.
  Milder, because no channel control is rendered there to be clicked.
- **Overview loyalty tile** and **messages-sent-by-channel** chart, per table.

## D. Not asked for, but the reason confidence broke

**D1. No page except the Report checks `isError`.** Grep for it: one hit, at
`report.tsx:49`. Everywhere else a failed query leaves `data` undefined.

**D2. Which means failures are rendered as findings.** `campaigns.tsx:32` does
`const rows = data ?? []`, and its chart panel does not consult `isLoading`. A
query that errors renders **"No campaigns in range."** — a confident factual
claim, produced by a failure. Flows and Push share the pattern. The pages that
do guard (`overview`, `loyalty`, `online`, `customers`, `health`) use
`isLoading || !data`, so on error they show **"Loading…" forever**.

**D3. There is a live trigger for D1/D2.** The custom date inputs
(`TopBar.tsx:47-58`) write straight through on every keystroke, and an
`<input type="date">` emits `""` while being cleared or partially typed. That
reaches PostgREST as `date >= ''`, which the database rejects:
`invalid input syntax for type date: ""` — verified directly. So clearing a
custom date hangs the page on "Loading…", or tells you there were no campaigns.
