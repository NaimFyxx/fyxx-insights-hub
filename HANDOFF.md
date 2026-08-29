# Handoff — 29 August 2026

State for someone picking this up cold. Rewritten every turn. No transcripts.

---

## Changed a previously reported figure

- **CORRECTION TO MY OWN LAST HANDOFF.** I reported that `/v2/activities`
  ignores `created_at_min`/`created_at_max`. **It does not.** That check used a
  window ending today, so "newest N in range" and "newest N overall" were the
  same rows. Re-tested against a window not touching today: the filter is
  honoured on `/activities`, `/transactions` and `/customers`, at every limit.
  Server-side filtering restored.
- **Birthday rewards were never zero. August 2026 is 131**, spread
  400/500/600/700 points across the tiers. ONE fault, not two: they are issued
  `pending` and the sync counted only `approved`. Report now shows the live
  figure.
- **Pending is transient, not terminal.** Full history: `$birthday` 1,753
  approved / 48 expired / 30 pending. Customers do receive them.
- **Pending points are 1.59% of approved, NOT the 8.34% I reported.** That
  figure came from a 10,000-customer API sample instead of the full 21,264.
  Third error this session from sampling; now a written rule in the README.
- **Mobile App click-influence 35.8% → 19.2%. Re-run COMPLETE and verified.**
  The `Unknown` bucket is gone: 13,099 rows and 717,166 JOD reclassified,
  almost all Mobile App. Draft Orders unchanged at 20.4%, POS 18.0%, Website
  13.3%. 41,419 rows, 2,959 duplicates collapsed on order_id. Never displayed.
- **Attributed revenue, August: 37,615 → 28,260 JOD.** Klaviyo share 22.0% →
  16.5%. 2026 YTD 132,534 → 109,876, 17.1% overstated.
- **Mobile App year on year was reported as +831.8%. It is +23.8%.**

## Decisions made this turn

- **`data_coverage` replaces `ll_import_coverage`.** One view records what
  every source actually covers, derived from the rows rather than declared, so
  the absence-vs-zero guard is data-driven instead of four special cases. There
  are **13** distinct coverage windows, not the five previously listed.
- `coverageGap()` answers only "does this source reach back far enough". Sync
  staleness stays with `sync_log` on the health page — conflating them produced
  a false positive.

- LoyaltyLion history **imported**: 38,748 activities, 60,680 transactions,
  2,211 rewards = 101,639 rows. Every row carries a `source` tag
  (`ll_export_20260829`); `ll_import_coverage` reports what each table spans so
  no reader has to remember a figure is imported rather than live.

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
- `/v2/activities` exposes `$birthday`; `/v2/transactions` exists;
  `/rewards`, `/rules`, `/events` return 404
- Date filters ARE honoured on all three parameterised endpoints
- `assertFilterHonoured` existed and had **never been called anywhere**. It now
  runs once per loyalty sync against both endpoints
- **Pending is a normal lifecycle state, not a birthday quirk.** `$purchase`
  runs 19,855 approved against 483 pending. `points_pending` is **1.59% of
  `points_approved`** across the full 21,264-customer population — 137,218
  points, about 1,372 JOD, held by 290 members — and drains into approved
  rather than accumulating
- Sampling the newest rows biases toward `pending` and toward "the filter does
  nothing". **Three** errors this turn came from that habit: the filter
  misdiagnosis, birthday rewards read as never approving, and pending points
  reported at 8.34% instead of 1.59%

**Customer population** (19,163 records; export says 20,019 — 4% gap open)
- 42.7% of buyers ordered once and never returned
- Top 15.2% of buyers drive 74.9% of orders, **78.1% of revenue**
- **5,926 buyers (42.5%) reachable on neither channel — 2,803,714 JOD, 31.6%**
- Workable list 2,884 never opted in (NOT the 1,362 who opted out); priority
  segment **85 customers**, 324,901 JOD
- **SMS: 5,427 buyers reachable ONLY by SMS, 2,391,700 JOD.** 572 subscribers
  against 14,309 phone numbers

**Expired birthday rewards — answered**
- All **48 are Blue tier**. No Silver, Gold or Platinum member lost one.
- Entirely confined to **July 2025 (7) and August 2025 (41)**. None since.
  It reads as a one-off that stopped, not an ongoing leak — consistent with
  the reward-expiry reminder flow going live around then.

**Points liability — answered**
- LoyaltyLion's own export sums `Points Approved` to **8,620,816**; we store
  **8,620,578**. **+0.00%.** Their outstanding figure counts approved only,
  same as ours. Confirmed, not inferred.
- `Points Pending` is **137,218 = 1.59%**, about 1,372 JOD, held by 290
  members, and it drains into approved rather than accumulating.

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

1. **4% population gap** still unexplained; re-check once both sides queryable.
2. **Should the three imports become live API sources?** `/v2/activities` and
   `/v2/transactions` both work and the birthday fix already pulls activities
   live. As imports they stop at 29 Aug 2026 and go stale. Recommend deciding
   after the 2019 sweep rather than widening scope now.

## Next

1. 2019 Shopify sweep, with guards: Klaviyo starts 2025-01, so pre-2025 ranges
   must not show "Klaviyo share 0%"; Mobile App gains Shopney history ending
   late 2024 then a gap
2. Customer section, leading with the three headline numbers
3. Identity table


---

## Applied this turn

`ll_activities`, `ll_transactions`, `ll_rewards`, plus the
`ll_import_coverage` view. RLS matches every other table.

The importer caught a fault worth recording: LoyaltyLion writes timestamp
offsets as `+00`, which `Date.parse` REJECTS (it wants `+00:00`). Unhandled,
every timestamp parsed to null, which collapsed the rewards key to
`(customer, null, title)` and manufactured **894 collisions in a file that has
none** — 2,211 distinct of 2,211. The importer now normalises the offset and
REFUSES to write if any timestamp fails to parse, rather than importing
undated rows.
