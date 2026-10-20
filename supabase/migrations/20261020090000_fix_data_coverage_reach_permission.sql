-- Fix: the monthly report died with
--   "The report could not be built: permission denied for table klaviyo_reach_daily"
--
-- WHY IT BROKE
-- `data_coverage` carries security_invoker = true, so it runs as the CALLER.
-- `authenticated` has no grant on klaviyo_reach_daily, deliberately: that table
-- holds per-person profile hashes and is service-role only. Every other source
-- in the view is readable by authenticated, so the view worked right up until
-- it reached that one branch, and then failed the whole report.
--
-- Nothing in this repo set security_invoker, so it was applied from outside it,
-- almost certainly by Supabase's security advisor flagging the view as a
-- "security definer view".
--
-- WHY NOT JUST FLIP THE FLAG BACK
-- Because the advisor would flag it again, and the next person to clear that
-- warning would silently reintroduce this exact bug. Instead the single
-- restricted branch reads through a SECURITY DEFINER function. The view stays
-- caller-run and lint-clean.
--
-- WHY THIS IS SAFE
-- data_coverage is aggregate-only. Every branch emits a source name, a kind, a
-- row count and a min/max date. The function exposes exactly those three
-- values for klaviyo_reach_daily and cannot return a row.
--
-- Verified as the `authenticated` role before committing:
--   view readable            YES, 13 sources
--   reach coverage row       1302 rows, 2025-01-01 to 2026-10-20
--   table still restricted   YES, still denied
CREATE OR REPLACE FUNCTION public.reach_coverage()
RETURNS TABLE (rows bigint, covers_from date, covers_to date)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT count(*), min(date), max(date) FROM public.klaviyo_reach_daily;
$$;

REVOKE ALL ON FUNCTION public.reach_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reach_coverage() TO authenticated, service_role;

COMMENT ON FUNCTION public.reach_coverage() IS
  'Aggregate-only window onto klaviyo_reach_daily, which authenticated cannot read. Returns a count and a date range, never a row.';

CREATE OR REPLACE VIEW public.data_coverage
WITH (security_invoker = true) AS
 SELECT 'shopify_daily_sales'::text AS source, 'live'::text AS kind,
        count(*) AS rows, min(date) AS covers_from, max(date) AS covers_to
   FROM shopify_daily_sales
UNION ALL
 SELECT 'shopify_margin_monthly', 'live', count(*), min(month), max(month)
   FROM shopify_margin_monthly
UNION ALL
 SELECT 'shopify_customers', 'snapshot', count(*),
        min(customer_created_at), max(customer_created_at)
   FROM shopify_customers
UNION ALL
 SELECT 'klaviyo_attributed_orders', 'live', count(*), min(date), max(date)
   FROM klaviyo_attributed_orders
UNION ALL
 SELECT 'klaviyo_order_influence', 'live', count(*), min(date), max(date)
   FROM klaviyo_order_influence
UNION ALL
 SELECT 'klaviyo_campaigns', 'live', count(*), min(sent_on), max(sent_on)
   FROM klaviyo_campaigns
UNION ALL
 SELECT 'klaviyo_flows', 'live', count(*), min(date), max(date)
   FROM klaviyo_flows
UNION ALL
 SELECT 'klaviyo_push', 'live', count(*), min(sent_on), max(sent_on)
   FROM klaviyo_push
UNION ALL
 -- The restricted one. Same three values as every other branch, fetched
 -- through a function so the caller never touches the table.
 SELECT 'klaviyo_reach_daily', 'live', r.rows, r.covers_from, r.covers_to
   FROM public.reach_coverage() r
UNION ALL
 SELECT 'll_snapshots', 'live', count(*), min(snapshot_date), max(snapshot_date)
   FROM ll_snapshots
UNION ALL
 SELECT 'll_activities', 'imported', count(*), min(activity_date), max(activity_date)
   FROM ll_activities
UNION ALL
 SELECT 'll_transactions', 'imported', count(*),
        min(occurred_at)::date, max(occurred_at)::date
   FROM ll_transactions
UNION ALL
 SELECT 'll_rewards', 'imported', count(*),
        min(claimed_at)::date, max(claimed_at)::date
   FROM ll_rewards;

GRANT SELECT ON public.data_coverage TO authenticated, service_role;
