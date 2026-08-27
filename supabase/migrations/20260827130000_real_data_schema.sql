-- ===========================================================================
-- Step 2 schema: prepare the tables for real API data.
--
-- Nothing here deletes data. Every change is ADD COLUMN, ALTER TYPE (widening
-- only), or CREATE INDEX. Existing placeholder rows survive; the sync script
-- overwrites them by upsert on the new keys.
--
-- PART A  identity columns + unique keys (idempotent upserts)
-- PART B  widen money to numeric(14,3)
-- PART C  new columns you asked for
-- PART D  default privileges  <-- THE ONE YOU ASKED ME TO FLAG
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PART A. Identity columns, keyed on the API's own ids, never on names.
--
-- Klaviyo names change (a flow gets renamed, a campaign gets duplicated and
-- retitled). Keying on a name would make a rename look like a brand new row
-- and silently double-count. Keying on the id makes a rename just an update.
-- ---------------------------------------------------------------------------

-- klaviyo_campaigns: Klaviyo groups campaign reports by campaign_id AND
-- campaign_message_id (both are mandatory in its group_by), so an A/B test
-- returns one row per variation. The key mirrors that exactly.
ALTER TABLE public.klaviyo_campaigns
  ADD COLUMN IF NOT EXISTS campaign_id         text,
  ADD COLUMN IF NOT EXISTS campaign_message_id text,
  ADD COLUMN IF NOT EXISTS send_channel        text NOT NULL DEFAULT 'email';

-- klaviyo_flows: same idea, plus the date, because one flow produces a row
-- per day. send_channel is in the key so a flow's email and push rows for the
-- same day cannot overwrite each other.
ALTER TABLE public.klaviyo_flows
  ADD COLUMN IF NOT EXISTS flow_id         text,
  ADD COLUMN IF NOT EXISTS flow_message_id text,
  ADD COLUMN IF NOT EXISTS send_channel    text NOT NULL DEFAULT 'email';

-- klaviyo_push: rows arrive from BOTH the campaign report and the flow report
-- (push is a send channel on each), so source_type tells them apart and
-- source_id is whichever campaign_id or flow_id produced it.
ALTER TABLE public.klaviyo_push
  ADD COLUMN IF NOT EXISTS source_id  text,
  ADD COLUMN IF NOT EXISTS message_id text;

-- Backfill the placeholder rows with synthetic ids so the unique indexes can
-- be built. These are clearly marked and get replaced on the first real sync.
UPDATE public.klaviyo_campaigns
   SET campaign_id         = coalesce(campaign_id, 'seed:' || id::text),
       campaign_message_id = coalesce(campaign_message_id, 'seed:' || id::text)
 WHERE campaign_id IS NULL OR campaign_message_id IS NULL;

UPDATE public.klaviyo_flows
   SET flow_id         = coalesce(flow_id, 'seed:' || replace(lower(flow_name), ' ', '-')),
       flow_message_id = coalesce(flow_message_id, 'seed:' || id::text)
 WHERE flow_id IS NULL OR flow_message_id IS NULL;

UPDATE public.klaviyo_push
   SET source_id  = coalesce(source_id, 'seed:' || replace(lower(source_name), ' ', '-')),
       message_id = coalesce(message_id, 'seed:' || id::text)
 WHERE source_id IS NULL OR message_id IS NULL;

ALTER TABLE public.klaviyo_campaigns
  ALTER COLUMN campaign_id SET NOT NULL,
  ALTER COLUMN campaign_message_id SET NOT NULL;
ALTER TABLE public.klaviyo_flows
  ALTER COLUMN flow_id SET NOT NULL,
  ALTER COLUMN flow_message_id SET NOT NULL;
ALTER TABLE public.klaviyo_push
  ALTER COLUMN source_id SET NOT NULL,
  ALTER COLUMN message_id SET NOT NULL;

-- The unique keys the upserts target.
CREATE UNIQUE INDEX IF NOT EXISTS klaviyo_campaigns_key
  ON public.klaviyo_campaigns (campaign_id, campaign_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS klaviyo_flows_key
  ON public.klaviyo_flows (flow_id, flow_message_id, send_channel, date);

CREATE UNIQUE INDEX IF NOT EXISTS klaviyo_push_key
  ON public.klaviyo_push (source_type, source_id, message_id, sent_on);

-- Range scans the dashboard does on every page load.
CREATE INDEX IF NOT EXISTS klaviyo_flows_date_idx     ON public.klaviyo_flows (date);
CREATE INDEX IF NOT EXISTS klaviyo_campaigns_sent_idx ON public.klaviyo_campaigns (sent_on);
CREATE INDEX IF NOT EXISTS klaviyo_push_sent_idx      ON public.klaviyo_push (sent_on);


-- ---------------------------------------------------------------------------
-- PART B. Money to numeric(14,3).
--
-- Widening only. numeric(12,2) -> numeric(14,3) cannot lose data: every value
-- that fit before still fits, and the stored scale gains a decimal place.
-- ---------------------------------------------------------------------------

ALTER TABLE public.klaviyo_campaigns
  ALTER COLUMN revenue_jod TYPE numeric(14,3);

ALTER TABLE public.klaviyo_flows
  ALTER COLUMN revenue_jod TYPE numeric(14,3);

ALTER TABLE public.shopify_daily_sales
  ALTER COLUMN total_online_revenue_jod        TYPE numeric(14,3),
  ALTER COLUMN klaviyo_attributed_revenue_jod  TYPE numeric(14,3);


-- ---------------------------------------------------------------------------
-- PART C. The columns the reports actually return.
--
-- Klaviyo reports its own open_rate / click_rate / conversion_rate off
-- DELIVERED, not off recipients. If the dashboard recomputed them from
-- recipients it would quietly disagree with the Klaviyo UI. So we store both
-- the raw counts and Klaviyo's own rates, and the dashboard shows Klaviyo's.
-- Rates are stored as fractions (0.4213), not percentages.
-- ---------------------------------------------------------------------------

ALTER TABLE public.klaviyo_campaigns
  ADD COLUMN IF NOT EXISTS delivered       integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_rate       numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_rate      numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(7,4) NOT NULL DEFAULT 0;

-- flows gains `clicked`, which it was missing entirely.
ALTER TABLE public.klaviyo_flows
  ADD COLUMN IF NOT EXISTS clicked         integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered       integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_rate       numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_rate      numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(7,4) NOT NULL DEFAULT 0;

-- push gains conversions and revenue. Deliberately NO clicks column:
-- push click tracking records zero across the whole account (~20k deliveries,
-- no clicks), which is a broken tracker rather than a result. A column that
-- can only ever show 0% would be read as performance. Left out on purpose.
ALTER TABLE public.klaviyo_push
  ADD COLUMN IF NOT EXISTS delivered   integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_rate   numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversions integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue_jod numeric(14,3) NOT NULL DEFAULT 0;

-- ll_snapshots gains a redemptions COUNT beside the existing rate.
ALTER TABLE public.ll_snapshots
  ADD COLUMN IF NOT EXISTS redemptions integer NOT NULL DEFAULT 0;

-- sync_log gains enough detail to debug a bad night without opening the logs.
ALTER TABLE public.sync_log
  ADD COLUMN IF NOT EXISTS range_start  date,
  ADD COLUMN IF NOT EXISTS range_end    date,
  ADD COLUMN IF NOT EXISTS rows_written integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms  integer;

CREATE INDEX IF NOT EXISTS sync_log_synced_at_idx ON public.sync_log (synced_at DESC);


-- ---------------------------------------------------------------------------
-- PART D.  >>> THE DEFAULT-PRIVILEGES FIX YOU ASKED ME TO FLAG <<<
--
-- This is the only part of this migration that is not about data shape.
--
-- Supabase ships the `public` schema with DEFAULT PRIVILEGES that hand the
-- `anon` role full rights on every table created in future. Step 1 locked the
-- eight tables that exist today; a ninth created tomorrow would arrive wide
-- open, with row-level security as the only thing in its way.
--
-- APPLIED RESULT (verified, not assumed):
--   * Default privileges owned by `postgres`  -> anon REVOKED. This is the
--     path that matters: Lovable migrations, the Supabase SQL editor and this
--     repo's migrations all create tables as `postgres`. Verified by creating
--     a throwaway table and confirming anon received no grants on it.
--   * Default privileges owned by `supabase_admin` -> UNCHANGED. Postgres only
--     lets a role alter its own default privileges, and we are not
--     supabase_admin. Tables created by Supabase's internal tooling would
--     still grant anon. RLS still covers those, and Step 1's pattern should be
--     applied by hand to any such table.
--
-- IF THIS EVER CONFLICTS WITH A LOVABLE MIGRATION: the symptom is a new
-- Lovable-created table returning HTTP 401 "permission denied" for logged-out
-- traffic Lovable expected to work. To undo just this part, run:
--     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--       GRANT ALL ON TABLES TO anon;
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;


-- New columns must inherit Step 1's grants.
GRANT SELECT ON public.klaviyo_campaigns, public.klaviyo_flows, public.klaviyo_push,
                public.ll_snapshots, public.shopify_daily_sales, public.sync_log TO authenticated;
