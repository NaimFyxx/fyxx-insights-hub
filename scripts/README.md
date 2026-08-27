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

### Backfilling points history

```bash
node scripts/import-ll-export.mjs path/to/export.csv --dry-run
node scripts/import-ll-export.mjs path/to/export.csv
```

LoyaltyLion's REST API exposes **no** programme-level accounting endpoint —
`/v2/metrics`, `/v2/analytics`, `/v2/insights` and `/v2/reports` all 404, and
`llms.txt` lists only customer-level resources. Their MCP connector does serve
a metrics series, but it authenticates separately from the API key and is not
reachable from CI, so it cannot drive the nightly job. A year of history
therefore has to come from their points accounting export.

The importer validates before writing: it checks every required column is
present (failing loudly rather than importing zeros), reconciles each day from
its own movement columns, and reports gaps in the series. Imported rows are
marked `points_source='ll_export'` and are authoritative — LoyaltyLion's own
end-of-day close, as opposed to the nightly `customer_scan`. Tier counts are
never touched by the import: they cannot be reconstructed historically, which
is the whole reason the nightly snapshot exists.

### Diagnosing a figure that looks wrong

```bash
node scripts/diagnose/loyalty.mjs
```

Read-only. Dumps a raw LoyaltyLion customer record with personal details
masked, then scans the full list and prints the population breakdown, the tier
distribution, and every candidate definition of "points outstanding" side by
side. Keep it: it is the fastest way to tell a changed API from a changed
business, and it is what established the field paths documented below. The
tier-count failure message points at it by name.

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

## Runtime notes

**No dependencies.** The sync script deliberately avoids
`@supabase/supabase-js` and talks to PostgREST over plain HTTP. That client
pulls in Realtime, which needs a native WebSocket and therefore Node 22+, and
a nightly data sync has no use for a websocket. As written the script runs on
any Node with `fetch` (18+). The frontend still uses `supabase-js` normally.

> ### ⚠️ LoyaltyLion returns HTTP 200 for filters it ignores
>
> An unsupported query parameter does **not** error. It returns 200 with the
> full unfiltered result set. `enrolled=true`, `filter=enrolled`,
> `enrolled_at_min=...` and `has_loyalty_tier=true` were all accepted on
> `/v2/customers` and all returned results identical to no filter at all.
>
> A filter can therefore look like it works — 200, valid JSON, sensible rows —
> while doing nothing, and the caller silently processes the entire customer
> list believing it was filtered. **Never validate a LoyaltyLion filter by its
> status code.** Compare the result count against the same request without the
> filter; `assertFilterHonoured()` in `lib/loyaltylion.mjs` does this for you.

**LoyaltyLion has no server-side filter for members.** `/v2/customers` returns
every Shopify customer — 21,240 here, of which 11,909 are enrolled — and the
enrolled filter has to be applied client-side. Confirmed by probing: `enrolled`,
`filter`, `enrolled_at_min` and `has_loyalty_tier` are all **silently ignored**,
returning results identical to no filter at all. Note the failure mode — an
unsupported parameter does not error, so a future attempt could look like it
worked while doing nothing. Verify any new filter by comparing counts, never by
checking for a 200.

Consequence: a full scan is ~43 pages and about 50 seconds, and that grows with
the customer list, not the member list. Fine at this size. If it climbs past a
few minutes, the options are to re-probe for a filter LoyaltyLion may have
added, or to page by `updated_at_min` and maintain a running tally rather than
rescanning everything nightly.

**Timezones.** Klaviyo reads a naive `datetime` filter as UTC but buckets
results in the requested `timezone`, and returns each bucket as the UTC instant
of that Amman midnight. So `2026-08-23T21:00:00+00:00` *is* Amman's 24th.
Both the bounds and the bucket labels are converted explicitly — reading the
first ten characters of a bucket files the day under the previous date.

## Shopify: the token has write scopes, the script does not

> ### ⚠️ The Shopify token can write to the live store
>
> The token minted for this app carries **write scopes as well as read**. The
> sync script must never use them — it is a reporting job against a live
> store, and a mutation issued from here would alter real orders or products.
>
> `assertReadOnly()` in `lib/shopify.mjs` enforces this. It runs inside
> `gql()`, which is the only path to the network, so nothing reaches Shopify
> without passing it.
>
> It is an **allowlist, not a blocklist**: every top-level definition must be a
> `query` or a `fragment`, or the document must be a bare anonymous selection
> set. Anything else is refused — including operation types that do not exist
> yet. A blocklist that rejected `mutation` would wave through whatever it had
> not been taught about; this fails closed.
>
> It parses definition by definition rather than pattern-matching the text, so
> it is not fooled by an operation named `Query`, a field called
> `mutationCount`, or the word "mutation" inside a string or a comment — and
> it still catches a mutation smuggled in after a valid query, or hidden
> behind a commented-out line.
>
> Covered by `scripts/test/shopify-readonly.test.mjs`, which also asserts at
> the source level that `gql()` still calls the guard before sending, so
> removing the call fails the tests rather than silently re-arming the write
> scopes.
>
> **If a write is ever genuinely needed, it does not belong in this script.**
> Put it somewhere with its own narrowly-scoped token.

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
> ### ⚠️ `points_approved` is a BALANCE, not a lifetime total
>
> This is the single most misleading field in the LoyaltyLion API, because
> `points_spent` sits directly beside it and reads like the other half of a
> pair. **It is not.** `points_approved` is the customer's current spendable
> balance, already net of redemptions and expiry. `points_spent` is a separate
> **lifetime** counter. Subtracting it double-counts every redemption ever
> made and understates the liability by about 25%.
>
> Measured against LoyaltyLion's own points accounting export for 2026-08-27,
> whose "Total Outstanding Points (End of Day)" was **8,776,473**:
>
> | Definition | Figure | vs LoyaltyLion |
> |---|---|---|
> | `sum(points_approved)`, all customers | 8,601,572 | **-2%** <- correct |
> | `sum(points_approved)`, members only | 8,184,625 | -7% |
> | `sum(points_approved - points_spent)` | 6,582,788 | -25% |
>
> The 2% residual is timing between our scan and their end-of-day close.
> Guests are included deliberately: an unenrolled customer's balance is still
> money owed. Note this differs from the TIER counts, which are members only.

Both LoyaltyLion figures rest on an assumption, so every run prints the
evidence needed to falsify it.

- **Points outstanding** is `sum(points_approved)` across **all** customers,
  with no subtraction. Every run prints the JOD liability at 100 points = 1 JOD
  and checks it against `LL_POINTS_EXPECTED` (8,776,473, +/-20%). That band is a
  setup-time check only and will need raising as the programme grows; the
  ongoing guard is a day-over-day comparison against our own previous
  snapshot, which refuses to write if the balance moves more than 25%
  overnight. A balance does not move that far in a day, so a jump of that size
  means the field definition changed, not the business.
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
