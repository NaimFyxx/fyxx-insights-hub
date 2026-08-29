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

> ### ⚠️ Klaviyo and Shopify name the same channel differently
>
> The same sales channel has two vocabularies. Shopify returns raw app IDs;
> Klaviyo resolves them to display names. Any cross-system comparison must map
> both to the same sub-channel, or Mobile App will appear twice and match
> nothing.
>
> | Sub-channel | Shopify `Order.sourceName` | Klaviyo `Source Name` |
> |---|---|---|
> | Website | `web` | `web` |
> | Mobile App | `5382175` (Appmaker), `2653365` (Shopney) | `Appmaker.xyz - Mobile app` |
> | POS | `pos`, `179433` (Odoo) | `Odoo Connector` |
> | Draft Orders | `shopify_draft_order`, `iphone`, `android` | `shopify_draft_order` |
>
> Klaviyo does also carry the numeric id at `$extra.app_id`, which matches
> Shopify's value — that is the reliable join key when one is needed.
>
> This is the same class of trap as `mobile_push` vs `push-notification` above:
> one system's name for a thing is not another's, and neither errors when you
> use the wrong one.

> ### ⚠️ POS changed DEFINITION on 2026-02-27, not just provider
>
> The POS column means two different things either side of that date, and
> nothing in the data says so.
>
> | Period | Source | What a POS order means |
> |---|---|---|
> | up to 2026-02-26 | `pos` (Shopify POS) | **every** retail order |
> | from 2026-02-27 | `179433` (Odoo Connector) | **only** retail orders with a customer attached in Odoo |
>
> The Odoo connector syncs only orders with an identified customer. Anonymous
> walk-ins never reach Shopify at all, so they are not missing data that could
> be recovered — they were never captured. Do not attempt to correct or
> estimate the gap.
>
> Measured like-for-like on April–July (avoiding Ramadan, which moves between
> February and March across these two years):
>
> | | Orders | Revenue | AOV |
> |---|---|---|---|
> | Apr–Jul **2025**, all retail | 5,207 | 300,584 JOD | 57.7 |
> | Apr–Jul **2026**, identified only | 1,094 | 89,254 JOD | 81.6 |
> | identified share | **21.0%** | **29.7%** | **+41%** |
>
> So roughly **four in five retail orders are anonymous walk-ins**, and the
> identified fifth spends ~41% more per order. Both figures assume footfall was
> broadly stable year on year.
>
> **Any range crossing 2026-02-27 must carry a warning**, and the UI must show a
> caption when POS is toggled on and the range spans that date. A 2025-vs-2026
> POS comparison shows a ~79% collapse that is a definition change, not a
> business one. This is the single most likely source of a confident wrong
> conclusion in this dataset.

> ### ⚠️ A THIRD channel vocabulary: ShopifyQL `sales_channel`
>
> Three systems, three names for the same channel, none of which error when you
> use the wrong one:
>
> | Sub-channel | Shopify `Order.sourceName` | Klaviyo `Source Name` | ShopifyQL `sales_channel` |
> |---|---|---|---|
> | Website | `web` | `web` | `Online Store` |
> | Mobile App | `5382175`, `2653365` | `Appmaker.xyz - Mobile app` | `Appmaker.xyz - Mobile app`, `Shopney - Mobile App` |
> | POS | `pos`, `179433` | `Odoo Connector` | `Point of Sale`, `Odoo Connector` |
> | Draft Orders | `shopify_draft_order` | `shopify_draft_order` | `Draft Orders`, `Shopify Mobile for iPhone`, `Shopify Mobile for Android`, `Shopify Web` |
>
> **`Shopify Mobile for iPhone` was 347k JOD in 2025 and has no `sourceName`
> equivalent at all** — those are draft orders created from the Shopify admin
> apps, which the order API reports simply as `shopify_draft_order`. Four
> ShopifyQL channels collapse into our one Draft Orders bucket.
>
> Mapping validated against our own 2025 revenue, ex-VAT: Draft Orders within
> 0.2%, POS 0.04%, Mobile App 2.6%, Website 3.3% — residuals consistent with
> returns, which ShopifyQL nets off and our order totals do not.

## Margin

`shopify_margin_monthly`, one row per month per sub-channel, from Shopify's own
`gross_profit`. **Margin = `gross_profit_jod / net_sales_jod`.**

**Why Shopify's figure and not our own:** cost is not on the order. `LineItem`
has no cost field, and `variant.inventoryItem.unitCost` is *today's* cost —
applying it historically would erase a real decline. Shopify snapshots cost at
time of sale, which we cannot reproduce. It also means the dashboard agrees
with Shopify's own reports.

**Realised, not shelf.** `net_sales` is ex-VAT and after discounts (~4.9%) and
returns (~14.5%). Zeid's `(RSP ex-VAT − cost) ÷ RSP ex-VAT` on shelf prices
gives a higher number. Same arithmetic, different revenue base — always label
it realised.

**Cost coverage: 98.2% of revenue.** 89.4% of *variants* carry a cost, but the
uncosted ones are low-volume; measured on August, only 1.8% of revenue lacks
one, and the largest uncosted lines are `Tip` and `By The Glass Card Top-Up`,
which genuinely have no cost. Note the failure mode: a missing cost counts as
zero cost and **inflates** margin rather than leaving a visible gap.

Margin by sub-channel, Jan 2025 – Aug 2026:

| Sub-channel | Net sales | Gross profit | Margin |
|---|---|---|---|
| POS | 940,177 | 420,660 | **44.7%** |
| Mobile App | 872,993 | 211,385 | 24.2% |
| Website | 135,859 | 32,701 | 24.1% |
| Draft Orders | 1,287,130 | 278,492 | **21.6%** |

Draft Orders is the largest channel by revenue and the *lowest* margin; POS is
roughly double it.

> **This shapes the marketing-influenced work below.** Draft Orders at 21.6%
> against POS at 44.7% means the marketing case for phone orders **cannot be
> about profit contribution** — it is the lowest-margin channel in the business.
> Frame it as **volume and customer acquisition**, and say so before anyone
> checks. A case built on profit would collapse the moment someone pulled this
> table.
>
> Also worth knowing: **Mobile App (24.2%) and Website (24.1%) are within 0.1
> points of each other.** The two online channels differ in scale, not
> efficiency — so an argument for shifting volume between them cannot rest on
> margin either. Two things worth raising separately: blended margin fell from
33.1% (Jan 2026) to 27.5% (Aug 2026) with the drop landing in April, and returns
run at ~14.5% of gross sales, which feeds straight into realised margin. If that
returns figure is inflated by cancelled orders or Webkul refund artefacts rather
than genuine returns, the margin decline is partly an artefact too.

> ### ⚠️ Klaviyo emits DUPLICATE Placed Order events
>
> About 2% of orders produce the event twice — identical timestamp, value and
> channel. Not two orders, not an edit: the same event twice.
>
> Two consequences:
>
> * **Any count taken from the raw event stream is ~2% overstated** unless
>   de-duplicated. `klaviyo_attributed_daily` is unaffected because it comes
>   from metric-aggregates, where Klaviyo aggregates its own side.
> * **Postgres rejects the whole command, not the duplicate row**: `ON CONFLICT
>   DO UPDATE command cannot affect row a second time`. A 44,000-row write died
>   this way after a 20-minute pull had already succeeded.
>
> `upsert()` now de-duplicates on the conflict target for every source and
> warns when it collapses rows.
>
> **This is the fourth trap of the same shape in this project**, and the shape
> is worth naming: *a system returning something plausible instead of erroring.*
>
> | Trap | What it returns instead of an error |
> |---|---|
> | LoyaltyLion ignores unknown filters | HTTP 200 and the full unfiltered set |
> | Shopify without `read_all_orders` | An empty result for anything over 60 days |
> | Klaviyo `mobile_push` vs `push-notification` | A 400 blaming "channel", not the vocabulary |
> | Klaviyo duplicate order events | A plausible count, 2% too high |
> | **Shopify order search ignores `source_name`** | HTTP 200 and the full unfiltered set |
> | **PostgREST caps every response at 1000 rows** | Exactly 1000 rows and no indication there are more |
>
> **The Shopify one is worth spelling out**, because it produces a confident
> wrong answer about the very thing this project splits by. Querying
> `orders(query: "source_name:web ...")` returns HTTP 200 and results — but the
> filter is not applied. Verified: three orders returned by a `source_name:web`
> search (#163007, #162563, #162518) are all `shopify_draft_order`. Anyone
> checking "what drove the website spike" that way gets Draft Orders back and
> believes it is Website.
>
> **The PostgREST one bit our own code, twice.** `.limit(5000)` on a 2,364-row
> table returns 1000 rows and no error — so the dashboard was showing 58% of
> the data as though it were all of it, and a diagnostic reported 98% of orders
> missing when the real figure was nothing like it. The limit you ask for is a
> maximum, not a request; the server cap is lower and silent.
>
> Page with `.range(from, to)` and **advance by the number of rows the server
> returned**, stopping only on a short page. "Fewer rows than I asked for means
> the end" is exactly the wrong test, because that is true on the first page.
>
> **Use the stored `shopify_daily_sales` rows for channel questions**, not order
> search. Those come from `Order.sourceName` read off each order individually,
> which is accurate.
>
> None of these announce themselves. Assume any new integration does the same
> until measured: compare counts against a known quantity rather than checking
> for a 200.

## Who reads what

Two audiences, and they are not the same person. Several contracts below were
originally written as though the dashboard had an outside reader; it does not.

**The dashboard has exactly one user — Naim.** It is a working tool for running
marketing and producing reports quickly. There is no sharing, no second
account, no colleague who might misread a figure. So:

* Captions exist so the *operator* does not forget the state they left it in —
  which channels are toggled, which date range is loaded, which figures are
  measured versus derived. That is a real need and those captions stay.
* Captions written to stop a hypothetical third party drawing a wrong
  conclusion are unnecessary. The dashboard can be blunt.
* Where a choice is between hedging and being direct, be direct.

**The exported PDF is the only thing Zeid ever sees**, and he sees it with no
other context — no filters visible, no ability to click through, no knowledge
this tool exists. So everything about the report holds in full:

* It must be self-explaining: any figure has to carry what it covers.
* It must match what he would find in Klaviyo if he checked.
* Send-date and order-date figures must be labelled distinctly.
* Channel coverage must be stated, since he cannot see the toggles that
  produced it.

**The analytical caution is not about either audience.** The reason not to
trust a figure that fails its own placebo test is not that someone might catch
it — it is that it would be wrong, and decisions would be made on it. That
stands whether anyone else ever looks.

## Frontend contract (for the dashboard — single user)

Decisions made while building the data layer that the dashboard must honour.

**Default channel toggles: Online Sales only — Website ON, Mobile App ON,
Draft Orders OFF, POS OFF.**

This default deliberately excludes a large share of real revenue. Over
2025-01-01 to 2026-08-28, Draft Orders alone was **39.3% of revenue**
(1,491,908 JOD) and POS a further 28.8%, so the default view shows roughly a
third of the business.

The caption naming the included channels renders on first load, not only after
a toggle changes — so the state is visible without having to remember it. On
the **report**, stating the channel coverage is mandatory for a different and
stronger reason: Zeid cannot see the toggles that produced the figure.

**Attributed revenue is whole-account and cannot follow the channel toggles.**
Its numerator is fixed while the denominator changes. On the dashboard a short
note suffices; on the **report** it needs the full sentence, since the reader
has no other way to know. Report wording:

> **Klaviyo-attributed share — 19.6%**
> 1,387.250 JOD attributed by Klaviyo across all channels, against
> 7,060.927 JOD from the channels selected (Website, Mobile App). Attribution
> cannot be split by channel, so the numerator is fixed while the denominator
> follows your filters.

**Two revenue bases must never be summed or compared.** `klaviyo_campaigns` and
`klaviyo_flows` carry SEND-date revenue; `klaviyo_attributed_daily` carries
ORDER-date revenue. This is not a presentation concern — adding them produces a
wrong number regardless of who is reading. Label them distinctly in both places.

**`shopify_daily_sales.klaviyo_attributed_revenue_jod` is dead.** Read
`klaviyo_attributed_daily` instead. The column is retained only so the current
frontend keeps rendering, and should be dropped during Step 4.

**`total_online_revenue_jod` is misnamed.** It is now per-channel revenue, not
online-only. Rename it to `revenue_jod` during Step 4.

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

## Long backfills finish on their own

Klaviyo allows **225 values-report calls a day** and flows need one call per
day of history, so a 600-day backfill cannot complete in one run. It is not
left to someone remembering to re-trigger it.

Set the repository variable **`BACKFILL_FROM`** (Settings → Secrets and
variables → Actions → *Variables*, not Secrets) to e.g. `2025-01-01`. From then
on the nightly Action does its trailing-3-day job and then spends the rest of
its daily quota working through the backfill, up to `--max-days` (default 190,
leaving headroom under the cap). Days already recorded as successful in
`sync_log` are skipped, so it stops doing work once the range is full.

Each run reports how much is left:

```
resuming: 190 day(s) already synced
190 flow day(s) this run, ~99 minute(s) at 2 calls/min
! 230 day(s) deferred to later runs (~2 more run(s) to finish the backfill)
```

**Clear `BACKFILL_FROM` once it reports no days outstanding.** Leaving it set is
harmless — every night it finds nothing to do — but clearing it makes the
nightly run finish in seconds again.

To check progress at any time:

```sql
select count(*) as days_done, min(range_start) as earliest, max(range_start) as latest
from sync_log where source = 'klaviyo_flows' and status = 'success';
```

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

> ### ⚠️ The project is in Tokyo, not Frankfurt
>
> `ap-northeast-1` was a setup mistake, not a decision. Amman → Tokyo is roughly
> 9,000 km against 2,800 km to Frankfurt, so every database round trip carries
> perhaps 200ms more latency than it needs to. A page making several queries
> feels it.
>
> **If the dashboard ever feels sluggish, check this before optimising queries.**
> The slowness would be distance, not the SQL.
>
> Supabase cannot move a project between regions in place. Migrating means a new
> project in `eu-central-1`, restoring a dump into it, and re-pointing
> everything: `.env`, the five GitHub Secrets, `SUPABASE_DB_URL`, and Lovable's
> connection. The data itself is the cheap part.
>
> Worth knowing: **once the weekly dumps are working, migrating stops being
> expensive.** The original argument against it was the cost of re-running a
> 20-hour backfill. With a restorable dump that argument goes away — it becomes
> a restore plus an afternoon of re-pointing credentials. Revisit it then if the
> latency ever actually bothers anyone.

## Backups: which connection string

`pg_dump` must use the **session-mode pooler**, and the hostname must carry the
project's **own region**:

    postgres://postgres.<project-ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres

This project is in **ap-northeast-1 (Tokyo)**, Postgres **17.6**.

Why not the other two:

| Method | Port | Verdict |
|---|---|---|
| Direct `db.<ref>.supabase.co` | 5432 | **Unusable.** IPv6-only without the paid IPv4 add-on; GitHub Actions runners are IPv4-only |
| Session pooler | 5432 | **Correct.** Supports the session semantics pg_dump needs |
| Transaction pooler | 6543 | **Unusable.** No prepared statements, which pg_dump requires |

**A caveat to write down now rather than rediscover during a restore:** Supabase's
own docs recommend the **direct** connection for `pg_dump`, and we cannot use it
— it is IPv6-only without the paid add-on and Actions runners are IPv4. Session
mode is the documented fallback and provides the session semantics `pg_dump`
needs, but it is not the recommended path. If a restore ever behaves oddly, that
is the first thing to suspect, and taking a dump from a machine with IPv6 over
the direct connection is the comparison to make.

A wrong region gives a misleading error that looks like a credentials problem:

    FATAL: (ENOTFOUND) tenant/user postgres.<ref> not found

The tenant exists — just in a different region's pooler. Check the region in
Project Settings before assuming the password is wrong.

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
> The token minted for this app carries **write scopes as well as read**, kept
> deliberately for future use by other tooling. The sync script must never
> touch them: it is a reporting job against a live store, and a mutation
> issued from here would alter real orders, products or themes.
>
> Because the scopes are staying, the guard below is the only thing separating
> this script from write access. It is not belt-and-braces — it is load-bearing.
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

## Getting a permanent Shopify token

```bash
npm run shopify:install
```

Run once, from a machine with a browser signed into the Shopify admin. It
starts a temporary local server, prints an install URL, verifies `state` and
Shopify's HMAC on the callback, exchanges the code, and prints the token once.
The token is never written to disk and never passed through the logger.

**Register the redirect URI first**, exactly as the script prints it:
`http://localhost:3456/callback`, at Dev Dashboard → Fyxx Insights Hub →
Configuration → URLs → Allowed redirection URL(s). It must match character for
character, which is why the port is fixed rather than chosen at random — the
script refuses to move to a free port instead of failing.

Offline (permanent) tokens come from omitting `grant_options[]`. Only **custom
and merchant-created** apps get non-expiring tokens; public apps must use
expiring ones. If the response carries `expires_in`, the script says so
loudly — that means the app is set to public distribution.

**Scopes are frozen at mint time.** A token carries only the scopes it was
created with, so needing another later means re-running this. The script
checks what was granted and warns if `read_all_orders` is missing, because
without it Shopify silently returns only the last 60 days and backfills come
back empty rather than erroring.

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

### Placeholder data that reads as real

Lovable's seed migration `20260827105917` inserted invented rows into **eight**
tables: `shopify_daily_sales`, `ll_snapshots`, `klaviyo_campaigns`,
`klaviyo_flows`, `klaviyo_push`, `activations`, `reports` and `sync_log`. Its
seed block is commented out now, and the `'unknown'`/`'Unknown'` column
defaults it relied on have been dropped from `shopify_daily_sales`, so an
insert in that old shape fails loudly instead of arriving as a valid-looking
Unknown channel row.

**The `reports` row is the one to remember.** Every other seeded row is a
number, and a wrong number can be caught by reconciling against the source.
That row was *narrative*: a fluent, plausible paragraph about Champagne Week
and a humidor drop, written into the table the `/report` route reads for
`month_highlight`. Had it survived, selecting July 2026 would have rendered
invented prose as the operator's own writing, above real figures, on the page
that goes to Zeid. Nothing in the pipeline would have flagged it, because
nothing was numerically wrong.

The general rule this project keeps re-learning: **anything that writes
narrative text to a table the report reads is higher risk than anything writing
numbers.** A wrong number is falsifiable against its source. Wrong prose is
not, and it inherits the author's credibility on the way out.

The sync health page probes all eight tables for the seed signatures on every
load (`SEED_PROBES` in `src/lib/health.ts`) and shows a red banner if any
return rows. This exists because commenting out the seed block changed that
migration file's checksum, and it is not known whether Lovable's tooling
re-applies migrations by checksum or by version. If it ever re-seeds, the
dashboard says so rather than it being discovered inside a total.

### Prefer a key that CAN collide to a surrogate that cannot

`ll_rewards` has no natural id in the export, so its key is
`(ll_customer_id, claimed_at, title)`. A surrogate `uuid` would have been
easier and would never collide.

The composite key is why the import worked. LoyaltyLion writes timestamp
offsets as `+00`, which `Date.parse` **rejects** — it wants `+00:00`. Every
timestamp parsed to null. With the composite key that collapsed to
`(customer, NULL, title)` and the dry run reported **894 collisions in a file
containing none** (2,211 distinct keys, 2,211 rows), which is what exposed the
parsing fault. A surrogate id would have accepted all 2,211 rows, every one of
them undated, and reported success.

The rule: **when a key can fail, a fault in the data announces itself. When a
key cannot fail, the same fault is absorbed and shipped.** The collision risk
of the composite key is real — two identical rewards claimed in the same second
would merge — and it is still the better trade, because that failure is visible
and the other is not.

This is the second time loud failure has caught something convenience would
have hidden. The first: `shopify_daily_sales` had DEFAULT `'unknown'` on
`source_name`, so a pre-migration insert produced a valid-looking Unknown
channel row instead of an error, and 24 to 26 August 2026 were double counted
until a hard bound caught it. Dropping the default made the same insert fail
immediately.

Both cases share a shape. The convenient option does not remove the fault, it
removes the *evidence* of the fault.

### What changed between 2021 and 2024

The 90-day repeat rate fell from 47.1% to 33.7%. Two things happened at once
and the acquisition channel per customer separates them.

**Channel quality differs sharply.** All-time, by the channel a customer was
ACQUIRED through:

| Acquired via | Customers | Repeat ≤90d | Avg lifetime orders | Median revenue |
|---|---|---|---|---|
| Mobile App | 4,787 | **44.7%** | **13.5** | 131.0 |
| Website | 2,403 | 36.1% | 8.2 | 65.0 |
| Draft Orders | 1,336 | 34.8% | 9.5 | 128.8 |
| POS | 3,480 | 34.5% | 6.7 | 93.0 |

An app-acquired customer repeats ten points more often and places twice the
lifetime orders.

**And the mix moved away from the app.** Share of new customers acquired via
the app: 92.3% (2019), 71.0% (2020), 60.4% (2021), **29.9% (2022)**, 33.0%,
36.4%, 25.5%, 48.4% (2026). POS went from 3.9% of acquisition in 2020 to 48.2%
in 2022.

Holding each channel at its all-time rate, the mix shift alone predicts a fall
from 43.9% to 37.8% — **roughly 6 points of the 16-point drop between 2019 and
2022.** The rest is within-channel: from 2023 the actual rate runs BELOW what
the mix predicts, and the gap widens (-1.8, -4.9, -4.7, -6.2 points). Every
channel now retains worse than its own history.

So: about a third of the decline is who we acquired, and the rest is that the
same channels stopped holding people as well.

**Treat the split as indicative, not exact.** The prediction uses each
channel's all-time repeat rate, which for the app is dominated by its early
years, so it flatters the mix explanation in later cohorts. What is solid is
the direction and the ordering, not the precise six points.

### The first measurable outcome we have for any flow

Birthday rewards that expired unredeemed: **48 in total, every one of them
Blue tier**, and confined entirely to **July 2025 (7) and August 2025 (41)**.
None since. That coincides with the reward-expiry reminder flow going live.

This is worth more than the problem it describes. It is the first time a flow
can be tied to a measurable change in customer behaviour rather than to its own
open and click rates. 41 expiries in a month, then zero for a year.

It is not proof — nothing was held back as a control, and other things changed
in the same period. But it is the strongest evidence of a flow working that
this project has produced, and the shape of it (a sharp stop, sustained) is
what a working intervention looks like.

### Points liability reconciles to LoyaltyLion exactly

Settled 29 August 2026, after two wrong definitions and several turns:

| | Points |
|---|---|
| LoyaltyLion's own export, `Points Approved` summed | 8,620,816 |
| our stored `points_outstanding` | 8,620,578 |
| **difference** | **+0.00%** — 238 points in 8.6M |

Both count **approved only**. Pending is a separate 137,218 (1.59%) that drains
into approved rather than accumulating. The question is closed; do not reopen it
without an export to compare against.

### The LoyaltyLion v2 Admin API surface, established rather than inferred

Probed against the live account on 29 August 2026, after four scattered 404s
had been treated as evidence that endpoints did not exist.

| Endpoint | Status | We use it |
|---|---|---|
| `/v2/sites` | 200 | no |
| `/v2/customers` | 200 | **yes** — tiers, points balances |
| `/v2/activities` | 200 | **yes** — birthday rewards, rule completions |
| `/v2/transactions` | 200 | **yes** — redemptions |
| `/v2/orders` | 200 | **NO — and it should be** |
| `/v2/webhooks` | 200 (empty) | no |
| `/v2/rewards`, `/v2/rules`, `/v2/tiers` | 404 | — |
| `/v2/customers/{id}` and any nested path | 404 | — |
| `/v2/whoami`, `/v2/unsubscribes` | 404 | — |

Two things this settled that inference had got wrong:

- **Claimed rewards are genuinely not exposed.** Not just `/v2/rewards`: the
  per-customer nested path 404s too. The docs list "List Available Rewards"
  under the *Headless* API, not the Admin one. The CSV import for rewards is
  therefore justified rather than lazy — established, not assumed.
- **`/v2/orders` exists and has never been used.** It carries
  `merchant_id` (the Shopify order id), `merchant_number`, `total`,
  `total_tax`, `total_shipping`, `total_discounts`, `total_paid`,
  `total_refunded`, `payment_status`, `fulfillment_status`, `refund_status`,
  **`cancellation_status`**, and `metadata.shopify_source_name`.

That last one is a THIRD independent view of every order, carrying both
cancellation state and channel. It could cross-check Shopify's figures without
a Shopify sweep, and it holds `total_refunded`, which we have never had.

### Coverage is DERIVED, not declared — and that is the whole point

`data_coverage` computes each source's real window with `min()`/`max()` over
the rows. It would have been easier to write the dates into a constant.

The reason not to: **the constant said five distinct start dates. The view found
thirteen.** Every one of the other eight would have surfaced the same way the
first five did — as a wrong number somebody questioned months later, traced
back one at a time. A declared list is only as good as the last time someone
remembered to update it, and this project has already shipped four channel
errors that all came from a written-down fact drifting from a measured one.

A derived view also cannot go stale as sources are backfilled. The reach
backfill moves its own start date every night; `klaviyo_attributed_orders` moved
when the netting was rebuilt. Neither needed anyone to notice.

The rule generalises: **if a fact about the data can be computed from the data,
compute it.** A constant is for things the data cannot know — the POS
definition change, the mobile app switchover, the Ramadan effect on March.

### Coverage windows, none of which is the start of the business

Thirteen sources, thirteen windows. Query `data_coverage` for the live list
rather than trusting this table, which is a snapshot taken 29 August 2026.

| Source | Earliest data |
|---|---|
| Shopify orders | **2019-09-09** |
| LoyaltyLion activities and transactions | **2023-02-21** |
| Klaviyo (attributed, influence) | **2025-01-01** |
| Klaviyo campaigns and flows | 2025-06-18 |
| LoyaltyLion rewards | **2025-08-04** |
| LoyaltyLion tier snapshots | 2025-08-26 |

Any range spanning one of these boundaries must show an **absence**, never a
zero. A "Klaviyo share of revenue: 0.0%" for early 2024 does not mean Klaviyo
drove nothing; it means Klaviyo was not the platform. `ll_import_coverage`
reports what each imported table actually spans.

### REQUIRED: how to sample when testing an assumption

Two wrong conclusions in one session came from the same habit — sampling the
newest rows — and both looked convincing.

- **Testing whether a filter works: use a window that does NOT touch today.**
  A check on 1–29 August "proved" LoyaltyLion ignored its date filter, because
  the newest 250 rows *inside* that range and the newest 250 rows *overall*
  are necessarily the same rows. Re-run against 1–10 July, the filter was
  honoured on every endpoint. Nothing was broken.
- **Sampling for a state distribution: sample across the full range.** Reading
  the newest activities showed birthday rewards 138 of 138 `pending` and
  suggested customers never receive them. Across the full history it is 1,753
  approved to 30 pending. The newest rows are pending *by construction* —
  they have not had time to approve.
- **Sampling for a total: use the whole population or say it is a sample.**
  Pending points were reported at 8.34% from 10,000 of 21,264 customers. The
  true figure is 1.59%.

The common failure is that a biased sample does not look biased. If the answer
would change the conclusion, size the sample against the full population first.

### REQUIRED: resolve an unknown source id by app lookup, never by name

A numeric Shopify `sourceName` is an app id. Ask Shopify what it is:

```graphql
query { node(id: "gid://shopify/App/1830279") {
  ... on App { title handle developerName } } }
```

That returns `Shopify Web` / `shopify_web` / `Shopify`. Then confirm against the
orders themselves before adding a row to `SOURCE_MAP` — for 1830279, all 92 of
them carried `app = "Draft Orders"` and a customer, which is what settled it as
staff-created drafts rather than a web channel.

**Do not pattern-match a name.** Every channel error this project has had came
from inferring meaning from a string: `2653365` sat in Unknown because no
pattern matched a bare id, `checkout_next` looked like a separate channel and
was not, and a Mobile App year-on-year figure was reported as +831.8% when it
was +23.8% because a script matched one of two app ids.

Confirmed by lookup: 580111 Online Store, 5382175 Appmaker, 179433 Odoo
Connector (Webkul), 1354745 Draft Orders, 1830279 Shopify Web.

### UNRESOLVED: the customer population differs by about 4%

A full customer sweep (`scripts/diagnose/customers.mjs`, 77 pages to
exhaustion) and a ShopifyQL export grouped by lifetime order count disagree:

| | Sweep | Export | Delta |
|---|---|---|---|
| customer records | 19,163 | 20,019 | -856 |
| never ordered | 5,133 | 5,547 | -414 |
| at least one order | 14,030 | 14,472 | -442 |
| implied lifetime orders | 137,326 | 138,923 | -1,597 |

The **distribution agrees closely** — 1 order 42.5% vs 43.4%, 2-3 22.5% vs
22.3%, 4-11 19.5% vs 19.1%, 12+ 15.5% vs 15.2% driving 77.5% vs 77.3% of
orders — so both sides see the same shape and no conclusion depends on the gap.
The counts still differ and it is **not explained**. The sweep paginated to
exhaustion so it is not truncation, and the two ran at different times.

**Re-checked 29 August 2026, both sides queryable. Still unexplained.**

What the pass ruled out:
- **Not a missed customer.** Zero customers appear in the full order history
  who are absent from `shopify_customers`. The sweep is not skipping anyone.
- **Not a counting error on our side.** 1,373 customers report
  `orders_lifetime > 0` while having no non-cancelled order, which is exactly
  the cancelled-only case and confirms `numberOfOrders` includes cancellations.
  That fully explains our internal 14,030 vs 12,657.

Both sides are internally consistent and disagree by 856 customers and 1,595
orders. No conclusion rests on it — the distribution agrees on every band —
so it is documented and left. Do not quietly adopt either number.

### Cancelled orders inflate Klaviyo attribution

Klaviyo's `Placed Order` event is never retracted when an order is cancelled.
Attributed revenue computed from the metric aggregate therefore keeps counting
cancelled orders at full value, and **no re-sync can correct it** — re-reading
the day returns the same inflated figure. `fetchAttributedByOrder` reads events
individually and drops orders that appear in `Cancelled Order`.

Share of Klaviyo `Placed Order` value subsequently cancelled, 2026:

| Month | Placed JOD | Cancelled JOD | Share |
|---|---|---|---|
| 2026-01 | 158,954.607 | 6,721.869 | 4.2% |
| 2026-02 | 154,162.600 | 13,047.008 | 8.5% |
| 2026-03 | 88,933.976 | 14,259.925 | **16.0%** |
| 2026-04 | 170,689.184 | 14,163.065 | 8.3% |
| 2026-05 | 179,593.105 | 11,044.138 | 6.1% |
| 2026-06 | 194,330.466 | 14,521.940 | 7.5% |
| 2026-07 | 180,638.429 | 10,845.793 | 6.0% |
| 2026-08 | 199,297.309 | 27,671.196 | **13.9%** |

A 6 to 8% baseline with spikes to 14 to 16%, not a steady rate. The spikes are
what make single days impossible rather than merely high.

Effect on attributed revenue, 2026 to date: **132,534 JOD before, 109,876
after — 17.1% overstated.** August alone was 27.3% over, February 38.9%.

**Zero of the attributed events in 2026 carried more than one attribution**, so
double-counting across channels — the first hypothesis — was never happening.

### Orders that cannot be attributed to a person

The Odoo integration requires a customer on every order, so staff attach a
placeholder, **"Shopify Draft (No Customer)"** (customer `9857059324151`), when
there is no real one. Measured by `scripts/diagnose/placeholder.mjs` over
2025-01-01 to 2026-08-29:

| Channel | Orders | Placeholder | No customer | Neither identifiable |
|---|---|---|---|---|
| Draft Orders | 10,932 | 164 | 249 | **3.8%** |
| POS | 17,613 | 0 | 7,052 | **40.0%** |
| Mobile App | 18,654 | 0 | 0 | 0.0% |
| Website | 3,900 | 0 | 0 | 0.0% |

Two results worth keeping, both the opposite of what was assumed:

- **The placeholder is a small minority of drafts, not most of them.** It first
  appears in January 2026, rises around the changeover, and runs at 2 to 6.4%
  of drafts a month. Draft orders are spread across 1,664 distinct customers
  and no single one exceeds 2.6%. Combined with genuinely absent customers, at
  most 6.7% of drafts in any month cannot be attributed.
- **POS is the real gap.** 28.3% of POS orders since the changeover carry no
  customer at all, against 41.3% before it. Note this sits awkwardly against
  the understanding that the Odoo connector only syncs POS orders with a
  customer attached; either it syncs some without, or the customer exists in
  Odoo and does not reach Shopify. Unresolved, and it means any "identifiable
  retail" percentage derived from POS order counts is overstated.

**It did not contaminate the influence work.** `klaviyo_order_influence` joins
clicks to orders by Klaviyo *profile*, so the fear was that one placeholder
profile would make a single click appear to precede hundreds of draft orders.
It did not happen: only **5** of 10,825 draft influence rows belong to the
placeholder and all five have no prior click. The draft click-influence rate is
**20.4% including it and 20.4% excluding it**. The mechanism is that the
placeholder customer has **no email address**, and Klaviyo profiles are keyed on
email or phone, so 159 of its 164 orders never reached Klaviyo at all.

### Cancel-and-re-place moves revenue between channels, but not much

Since the Odoo changeover, an app or website order needing an edit is cancelled
and re-placed the same day, sometimes as a draft order. That moves revenue out
of the originating channel and into Draft Orders, which is reclassification
rather than a real channel shift.

Measured over 2025-01-01 to 2026-08-31 with
`scripts/diagnose/replacements.mjs`, matching each cancelled `web` or
`5382175` order against a same-day, same-customer non-cancelled order and
grading by value closeness:

- **The practice is real and it does start at the changeover.** The confident
  match rate runs 0-14% through 2025, then 9% in March 2026, **35% in April**
  and 29% in May, settling around 15%. Replacements landing in Draft Orders go
  from 0-4 a month to 14, 20 and 11.
- **It is immaterial to every trend on the dashboard.** Year on year, Website
  is -43.0% reported against **-42.9% adjusted** — a tenth of a percentage
  point. The peak single month is Mobile App in April 2026 at 2,139 JOD on
  55,239, under 4%; Website never exceeds 1.2%.

  > **Correction.** The first run of this analysis also reported Mobile App
  > year on year as +831.8%. That was wrong. The script bucketed Mobile App on
  > `5382175` (Appmaker) alone, while Shopney (`2653365`) ran until 6 August
  > 2025 and carried 5,659 orders worth 315,633 JOD in 2025. Counting both, as
  > `SOURCE_MAP` and the dashboard do, Mobile App is **+23.8%** year on year,
  > not +831.8%. The stored `shopify_daily_sales` rows were always correct —
  > both ids carry `sub_channel = 'Mobile App'` — so nothing on the dashboard
  > was affected. Any ad-hoc script that groups by `source_name` must fold the
  > two app ids together, or it will invent a channel launch that never
  > happened.
- Only **172 of 1,462** app/web cancellations have a confident same-day
  replacement (10,432 JOD over 20 months). 1,169 have no same-day order from
  that customer at all, so most cancellations are simply cancellations.
- Confidence: the base rate of a same-day repeat among *non-cancelled* app/web
  orders is **5.9%**, so a same-day match alone is weak evidence. The value
  bands carry the argument, supported by 97 of 114 exact matches having the
  replacement created after the original. 121 matches are ambiguous and are
  reported separately rather than folded in.

**Conclusion: the ~40% Website year-on-year decline is real, not an artefact of
reclassification.** No dashboard caveat was added, because a correction of
0.1pp invites more misreading than it prevents. Re-run the script rather than
re-deriving this if it is questioned.

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
>
> **Pending points are a SEPARATE pool, and LoyaltyLion excludes them too.**
> Checked against LoyaltyLion's own customers export, 29 August 2026:
>
> | | Points |
> |---|---|
> | LoyaltyLion's `Points Approved`, summed | 8,620,816 |
> | our stored `points_outstanding` | 8,620,578 |
> | difference | **+0.00%** (238 points in 8.6M) |
> | LoyaltyLion's `Points Pending`, summed | 137,218 — **1.59%** of approved |
>
> So our definition matches theirs exactly and both count approved only.
> Pending is roughly 1,372 JOD of liability outside the figure, held by 290
> members, and it DRAINS into approved rather than accumulating: over the full
> exported history `$purchase` runs 19,855 approved against 483 pending, and
> `$birthday` 1,753 approved against 30 pending. It is a lifecycle stage, not a
> parallel balance.
>
> An earlier note put pending at 8.34%. That was wrong — it came from a
> 10,000-customer API sample rather than the full 21,264. See the sampling rule
> below.

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
