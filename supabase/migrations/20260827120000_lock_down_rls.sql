-- Step 1: lock down row-level security.
-- Read: authenticated users only. Write: service_role only, except the two
-- hand-maintained tables (activations, reports) which the dashboard writes to.
-- service_role needs no policy: Postgres exempts it from RLS entirely.

-- klaviyo_campaigns — read-only
DROP POLICY IF EXISTS "authenticated_all_klaviyo_campaigns" ON public.klaviyo_campaigns;
CREATE POLICY "klaviyo_campaigns_select_authenticated"
  ON public.klaviyo_campaigns FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.klaviyo_campaigns FROM anon, authenticated;
GRANT SELECT ON public.klaviyo_campaigns TO authenticated;
GRANT ALL ON public.klaviyo_campaigns TO service_role;

-- klaviyo_flows — read-only
DROP POLICY IF EXISTS "authenticated_all_klaviyo_flows" ON public.klaviyo_flows;
CREATE POLICY "klaviyo_flows_select_authenticated"
  ON public.klaviyo_flows FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.klaviyo_flows FROM anon, authenticated;
GRANT SELECT ON public.klaviyo_flows TO authenticated;
GRANT ALL ON public.klaviyo_flows TO service_role;

-- klaviyo_push — read-only
DROP POLICY IF EXISTS "authenticated_all_klaviyo_push" ON public.klaviyo_push;
CREATE POLICY "klaviyo_push_select_authenticated"
  ON public.klaviyo_push FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.klaviyo_push FROM anon, authenticated;
GRANT SELECT ON public.klaviyo_push TO authenticated;
GRANT ALL ON public.klaviyo_push TO service_role;

-- ll_snapshots — read-only
DROP POLICY IF EXISTS "authenticated_all_ll_snapshots" ON public.ll_snapshots;
CREATE POLICY "ll_snapshots_select_authenticated"
  ON public.ll_snapshots FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.ll_snapshots FROM anon, authenticated;
GRANT SELECT ON public.ll_snapshots TO authenticated;
GRANT ALL ON public.ll_snapshots TO service_role;

-- shopify_daily_sales — read-only
DROP POLICY IF EXISTS "authenticated_all_shopify_daily_sales" ON public.shopify_daily_sales;
CREATE POLICY "shopify_daily_sales_select_authenticated"
  ON public.shopify_daily_sales FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.shopify_daily_sales FROM anon, authenticated;
GRANT SELECT ON public.shopify_daily_sales TO authenticated;
GRANT ALL ON public.shopify_daily_sales TO service_role;

-- sync_log — read-only
DROP POLICY IF EXISTS "authenticated_all_sync_log" ON public.sync_log;
CREATE POLICY "sync_log_select_authenticated"
  ON public.sync_log FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.sync_log FROM anon, authenticated;
GRANT SELECT ON public.sync_log TO authenticated;
GRANT ALL ON public.sync_log TO service_role;

-- activations — hand-maintained by the dashboard, so authenticated may write
DROP POLICY IF EXISTS "authenticated_all_activations" ON public.activations;
CREATE POLICY "activations_select_authenticated"
  ON public.activations FOR SELECT TO authenticated USING (true);
CREATE POLICY "activations_insert_authenticated"
  ON public.activations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "activations_update_authenticated"
  ON public.activations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "activations_delete_authenticated"
  ON public.activations FOR DELETE TO authenticated USING (true);
REVOKE ALL ON public.activations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activations TO authenticated;
GRANT ALL ON public.activations TO service_role;

-- reports — hand-maintained by the dashboard, so authenticated may write
DROP POLICY IF EXISTS "authenticated_all_reports" ON public.reports;
CREATE POLICY "reports_select_authenticated"
  ON public.reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "reports_insert_authenticated"
  ON public.reports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "reports_update_authenticated"
  ON public.reports FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "reports_delete_authenticated"
  ON public.reports FOR DELETE TO authenticated USING (true);
REVOKE ALL ON public.reports FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
