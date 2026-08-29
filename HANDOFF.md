# Handoff — 29 August 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

---

## Changed a previously reported figure

- **Birthday rewards were never zero. August 2026 alone is 131.** Spread
  400/500/600/700 points, matching the tier structure. Two faults, both
  producing a silent zero: (a) `/v2/activities` **ignores** `created_at_min`
  and `created_at_max` — sending them and sending nothing return identical
  pages; (b) birthday activities are issued `pending` and stay pending, and
  the sync counted only `approved`. Measured: 115 of 115 were pending. Both
  fixed. **The report's "not collected" wording is now wrong in the other
  direction and must change to the live figure.**
- **Mobile App click-influence 35.8% → 19.1% true.** 13,060 mobile orders sat
  in `Unknown`. Never displayed. Mapping fixed; re-run in progress.
- **Attributed revenue, August: 37,615 → 28,260 JOD.** Klaviyo share 22.0% →
  16.5%. 2026 YTD 132,534 → 109,876, 17.1% overstated.
- **Mobile App year on year was reported as +831.8%. It is +23.8%.**

## Decisions made this turn

- `1830279` → **Draft Orders**, verified: app lookup returns "Shopify Web"
  (`shopify_web`, Shopify) and all 92 orders carry `app = "Draft Orders"`.
- Unknown source ids are now resolved by **app lookup**, not name matching:
  `node(id:"gid://shopify/App/<id>"){ ...on App { title handle developerName } }`.
  Confirmed 580111 Online Store, 5382175 Appmaker, 179433 Odoo Connector
  (Webkul), 1354745 Draft Orders, 1830279 Shopify Web.
- `subChannelFromKlaviyoSource` consults `SOURCE_MAP` first. One taxonomy.
- Birthday collection fixed in the pipeline, not pasted from the export.
- Import `customeractivities`, `customertransactions`, `rewards`. Compare
  `saleschannelbreakdown` without importing. Skip `integrationprogramevents`
  and `customers`.

## Findings

**LoyaltyLion API, newly established**
- `/v2/activities` exposes `$birthday` — the sync was not wrong to look there,
  it was filtering on the wrong state and trusting an ignored date parameter
- `/v2/transactions` exists; `/rewards`, `/rules`, `/events` return 404
- The file's own `assertFilterHonoured` guard existed for exactly fault (a)
  and had never been applied to this call

**Customer population** (19,163 records; export says 20,019 — 4% gap open)
- 42.7% of buyers ordered once and never returned
- Top 15.2% of buyers drive 74.9% of orders, **78.1% of revenue**
- **5,926 buyers (42.5%) reachable on neither channel — 2,803,714 JOD, 31.6%**
- Workable list 2,884 never opted in (NOT the 1,362 who opted out); priority
  segment **85 customers**, 324,901 JOD
- **SMS: 5,427 buyers reachable ONLY by SMS, 2,391,700 JOD.** 572 subscribers
  against 14,309 phone numbers

**Identity join**
- LoyaltyLion → Shopify via `merchant_id`: **99.8%**
- Klaviyo `external_id`: useless, 10.4% populated, 0% Shopify ids
- Klaviyo → Shopify via order id: **99.3%** resolve to one customer; 20 map to
  several = merge-detection signal

**Exports** (6 files, read in place, never copied into the repo)

| File | Rows | Span | Verdict |
|---|---|---|---|
| customeractivities | 38,748 | 2023-02-21+ | Import |
| customertransactions | 60,680 | 2023-02-21+ | Import — 39,567 carry an Order ID |
| rewards | 2,211 | **2025-08-04+** | Import — start date is a DATA LIMIT, not a beginning |
| saleschannelbreakdown | 14,717 | 2019-12-03+ | Compare only |
| integrationprogramevents | 51,988 | 2025-08-04+ | Skip — all `location=klaviyo` |
| customers | 21,264 | snapshot | Skip — no Shopify id column |

## Open questions needing input

1. **Report wording on birthday rewards** — now that it is collected live,
   confirm switching from "not collected" to the figure.
2. **4% population gap** still unexplained; re-check once both sides queryable.

## Next

1. Influence re-run finishing (recomputes `sub_channel` on stored rows)
2. Importers for the three approved exports
3. 2019 Shopify sweep, with guards: Klaviyo starts 2025-01, so pre-2025 ranges
   must not show "Klaviyo share 0%"; Mobile App gains Shopney history ending
   late 2024 then a gap
4. Customer section, leading with the three headline numbers
5. Identity table
