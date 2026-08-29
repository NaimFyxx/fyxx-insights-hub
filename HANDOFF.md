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
  runs 19,855 approved against 483 pending. `points_pending` is **8.34% of
  `points_approved`** in a 10,000-customer sample (~618 JOD there), and drains
  into approved rather than accumulating
- Sampling the newest rows biases toward `pending` and toward "the filter does
  nothing". Both errors this turn came from that habit

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

1. **DDL for the three import tables** — full text at the bottom of this file,
   needs approval before applying.
2. **4% population gap** still unexplained; re-check once both sides queryable.
3. **Should the three imports become live API sources?** `/v2/activities` and
   `/v2/transactions` both work and the birthday fix already pulls activities
   live. As imports they stop at 29 Aug 2026 and go stale. Recommend deciding
   after the 2019 sweep rather than widening scope now.

## Next

1. Importers for the three approved exports — DDL below needs approval first
2. 2019 Shopify sweep, with guards: Klaviyo starts 2025-01, so pre-2025 ranges
   must not show "Klaviyo share 0%"; Mobile App gains Shopney history ending
   late 2024 then a gap
3. Customer section, leading with the three headline numbers
4. Identity table


---

## DDL awaiting approval — the three import tables

```sql
-- LoyaltyLion activities. Immutable event history, safe to import.
-- $birthday is now collected live via the API; this backfills 2023-02-21 on,
-- which predates the fix.
CREATE TABLE public.ll_activities (
  activity_id       text PRIMARY KEY,
  ll_customer_id    text NOT NULL,
  shopify_order_id  text,              -- "Order Reference", joins to orders
  kind              text NOT NULL,     -- rule | import | manual_deduction | challenge | manual_addition
  detail            text,              -- $purchase | $birthday | fyxx_cup_win | $signup | ...
  state             text NOT NULL,     -- approved | pending | expired | declined | void
  initial_points    integer NOT NULL DEFAULT 0,
  points_remaining  integer NOT NULL DEFAULT 0,
  points_expired    integer NOT NULL DEFAULT 0,
  activity_date     date NOT NULL,
  expires_at        date,
  pre_enrollment    boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ll_activities_date_idx   ON public.ll_activities (activity_date);
CREATE INDEX ll_activities_detail_idx ON public.ll_activities (detail, state);
CREATE INDEX ll_activities_order_idx  ON public.ll_activities (shopify_order_id);

-- Per-member points movement. 39,567 of 60,680 carry an Order ID, which is
-- what makes points-earned-against-spend answerable per customer.
CREATE TABLE public.ll_transactions (
  transaction_id    text PRIMARY KEY,
  ll_customer_id    text NOT NULL,
  shopify_order_id  text,
  resource          text NOT NULL,     -- activity | adjustment | claimed_reward | expiry
  activity_title    text,
  flow_title        text,
  points_approved   integer NOT NULL DEFAULT 0,
  points_pending    integer NOT NULL DEFAULT 0,
  occurred_at       timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ll_transactions_when_idx  ON public.ll_transactions (occurred_at);
CREATE INDEX ll_transactions_order_idx ON public.ll_transactions (shopify_order_id);

-- Claimed rewards. NOTE: starts 2025-08-04. That is a DATA LIMIT, not the
-- start of the programme -- redemption history before it does not exist in
-- this export and must not be read as zero.
CREATE TABLE public.ll_rewards (
  ll_customer_id    text NOT NULL,
  claimed_at        timestamptz NOT NULL,
  title             text,
  cost_points       integer NOT NULL DEFAULT 0,
  state             text NOT NULL,     -- approved | expired | void
  discount_type     text,
  amount            numeric(12,3),
  first_used_at     timestamptz,
  order_total_jod   numeric(14,3),
  used_with_orders  text,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ll_customer_id, claimed_at, title)
);
CREATE INDEX ll_rewards_claimed_idx ON public.ll_rewards (claimed_at);

ALTER TABLE public.ll_activities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ll_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ll_rewards      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ll_activities_select_authenticated"   ON public.ll_activities   FOR SELECT TO authenticated USING (true);
CREATE POLICY "ll_transactions_select_authenticated" ON public.ll_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "ll_rewards_select_authenticated"      ON public.ll_rewards      FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.ll_activities, public.ll_transactions, public.ll_rewards FROM anon, authenticated;
GRANT SELECT ON public.ll_activities, public.ll_transactions, public.ll_rewards TO authenticated;
GRANT ALL    ON public.ll_activities, public.ll_transactions, public.ll_rewards TO service_role;
```

Four decisions in it:

- **No email columns**, though all three exports carry them. `ll_customer_id`
  joins to LoyaltyLion and `merchant_id` reaches Shopify at 99.8%, so email
  adds PII without adding a join.
- **`ll_rewards` has no natural id.** The export gives none, so the key is
  `(customer, claimed_at, title)`. A customer claiming two identical rewards in
  the same second would collide. Flagged rather than papered over with a
  surrogate that hides duplicates.
- **`shopify_order_id` on both event tables** — the join worth having.
- **Dates stay as exported**, all predating the 2025-01-01 baseline, so these
  need the same pre-2025 guards as the 2019 sweep.
