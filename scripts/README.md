# Data sync

Pulls real data from Klaviyo, LoyaltyLion and Shopify into Supabase.

## Setup

1. `cp .env.example .env`
2. Fill in the keys. `.env` is gitignored and must stay that way.
3. `npm install`

## Running it

```bash
node scripts/sync.mjs                                    # trailing 3 days
node scripts/sync.mjs --from 2026-06-01 --to 2026-06-30  # a specific range
node scripts/sync.mjs --from 2026-06-01 --to 2026-06-30 --dry-run
node scripts/sync.mjs --only shopify
node scripts/sync.mjs --from … --to … --force            # redo days already done
```

`--dry-run` fetches everything and prints what it *would* write, touching
neither the tables nor `sync_log`. Always worth doing first on a new range.

Tests (no network or credentials needed):

```bash
npm run test:sync
```

## Two revenue figures, on purpose

There are two Klaviyo revenue numbers in the database and they will not tie
out to each other. That is correct, not a bug.

| Figure | Basis | Where it lives | Answers |
|---|---|---|---|
| Campaign / flow revenue | **Send date** | `klaviyo_campaigns.revenue_jod`, `klaviyo_flows.revenue_jod` | "How did that send perform?" |
| Attributed revenue | **Order date** | `shopify_daily_sales.klaviyo_attributed_revenue_jod` | "What share of the day's sales did Klaviyo drive?" |

A campaign sent on the 3rd that converts on the 7th books its revenue on the
3rd in the first figure and on the 7th in the second. The second is the one
that can be compared against Shopify's daily total, because both are dated by
when the order happened.

## Klaviyo channel names

Klaviyo uses two different names for the push channel depending on the
endpoint, and mixing them up returns a 400 that blames "channel" without
saying which vocabulary it wanted:

| Endpoint | Field | Push value |
|---|---|---|
| `/api/campaigns` | `messages.channel` | `mobile_push` |
| `/api/campaign-values-reports`, `/api/flow-values-reports` | `send_channel` | `push-notification` |

`LIST_CHANNEL` and `REPORT_CHANNEL` in `lib/klaviyo.mjs` hold these separately
so the difference is stated once. `isPush()` accepts either spelling, because
groupings arrive from the report endpoints and metadata from the list endpoint.

## Idempotency

Every write is an upsert against a unique index:

| Table | Key |
|---|---|
| `klaviyo_campaigns` | `campaign_id, campaign_message_id` |
| `klaviyo_flows` | `flow_id, flow_message_id, send_channel, date` |
| `klaviyo_push` | `source_type, source_id, message_id, sent_on` |
| `shopify_daily_sales` | `date` |
| `ll_snapshots` | `snapshot_date` |

Keys are the APIs' own ids, never names, so renaming a flow updates its row
instead of creating a duplicate. Re-running any range is always safe.

## Resuming a backfill

Klaviyo's values-report endpoints allow **2 requests per minute** and **225 per
day**. Flows need one call per day, so:

- 3 days ≈ 8 calls, about two minutes.
- 90 days ≈ 95 calls, about 45 minutes, and close to the daily cap.

Each flow day is written and logged to `sync_log` as it completes. If a
backfill is interrupted, hits the cap, or the machine dies, just run the same
command again: days already recorded as successful are skipped. `--force`
overrides that and redoes everything.

## What lands in sync_log

One row per source per chunk, so that in three months you can see what the
sync actually did rather than guessing:

`source`, `status`, `synced_at`, `range_start`, `range_end`, `rows_written`,
`duration_ms`, `message`.

Failures are logged too, with a redacted message.

## Shopify authentication

Shopify removed admin-created custom apps on 1 January 2026, so new apps no
longer issue a permanent `shpat_` token. The app "Fyxx Insights Hub" is a Dev
Dashboard app, which uses the **client credentials grant**:

    POST https://drynksapp.myshopify.com/admin/oauth/access_token
    Content-Type: application/x-www-form-urlencoded
    grant_type=client_credentials & client_id=… & client_secret=…
    -> { access_token, scope, expires_in: 86399 }

The token lasts about 24 hours and is refreshed by repeating the same request.
The script exchanges once at the start of a run, keeps the token in memory
only, refreshes it five minutes before expiry, and retries once on a 401 in
case a long backfill outlives it anyway. The token is never written to disk,
to a log line, or to `sync_log`; the client secret and the token are both on
the redaction list.

If `SHOPIFY_ADMIN_TOKEN` is set it takes precedence and no exchange happens,
so a legacy app still works if we ever need one.

Note: this grant only works when the app and the store are in the **same
Shopify organization**. A 400 or 403 on the exchange usually means that, not a
bad secret, and the error message says so.

## Secrets

Read from `.env` locally and from GitHub Secrets in CI (real environment
variables always win over `.env`). Every log line passes through a redactor
that strips known key values and anything key-shaped, so a failing API call
cannot echo a credential into a CI transcript. Nothing here is ever imported
by frontend code — the service-role key bypasses row-level security entirely.

## Known assumptions worth checking on the first real run

### LoyaltyLion field paths, established from live data

- The tier name is at **`loyalty_tier_membership.loyalty_tier.name`**. It is
  nested two levels down; reading `…membership.tier.name` yields `undefined`
  for every customer and produces a snapshot of four zeros that looks valid.
- `/v2/customers` returns **every Shopify customer**, not just members. Only
  rows with `enrolled === true` are counted. On this account that is 11,909 of
  21,240 — the rest are guests who never joined.
- **Points outstanding is `points_approved - points_spent`**, over enrolled
  members only. `points_approved` alone is the lifetime approved total and
  overstates the liability by whatever has already been redeemed.

Both figures rest on an assumption, so every run prints the
evidence needed to falsify it.

- **Points outstanding** is the sum of `points_approved` across all customers.
  The run prints the JOD liability at 100 points = 1 JOD and checks it against
  an expected order of magnitude (~1.5M points ≈ 15,000 JOD). Outside that band
  it warns, and names the likely cause: too low usually means `points_approved`
  is already net of spent points or the balance sits in `points_pending`; too
  high usually means it is a lifetime-earned total rather than a current
  balance. Override the reference with `LL_POINTS_EXPECTED` if the programme
  genuinely outgrows the band.
- **Birthday rewards** are matched by looking for "birthday" in the rule name,
  since LoyaltyLion has no dedicated birthday activity type. Because that is a
  guess, the run prints the matched rule names and a histogram of the points
  issued. The birthday reward is tiered (400 Blue → 700 Platinum), so a correct
  match shows a spread across those values. A single repeated value is flagged
  as probably the wrong rule, and no match at all lists the rule names that
  were actually seen.
- **Shopify totals** are `currentTotalPriceSet` for non-cancelled, non-POS
  orders, VAT-inclusive at 16% exactly as Shopify reports them. No VAT is
  stripped at fetch time.
