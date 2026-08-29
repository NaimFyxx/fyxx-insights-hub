
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

-- shopify_daily_sales
CREATE TABLE public.shopify_daily_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  total_online_revenue_jod numeric(12,2) NOT NULL DEFAULT 0,
  klaviyo_attributed_revenue_jod numeric(12,2) NOT NULL DEFAULT 0,
  orders integer NOT NULL DEFAULT 0,
  people_reached integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_daily_sales TO authenticated;
GRANT ALL ON public.shopify_daily_sales TO service_role;
ALTER TABLE public.shopify_daily_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_shopify_daily_sales" ON public.shopify_daily_sales FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_shopify_daily_sales_updated BEFORE UPDATE ON public.shopify_daily_sales FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- klaviyo_campaigns
CREATE TABLE public.klaviyo_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sent_on date NOT NULL,
  sent integer NOT NULL DEFAULT 0,
  opened integer NOT NULL DEFAULT 0,
  clicked integer NOT NULL DEFAULT 0,
  orders integer NOT NULL DEFAULT 0,
  revenue_jod numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.klaviyo_campaigns TO authenticated;
GRANT ALL ON public.klaviyo_campaigns TO service_role;
ALTER TABLE public.klaviyo_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_klaviyo_campaigns" ON public.klaviyo_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_klaviyo_campaigns_updated BEFORE UPDATE ON public.klaviyo_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- klaviyo_flows
CREATE TABLE public.klaviyo_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_name text NOT NULL,
  date date NOT NULL,
  recipients integer NOT NULL DEFAULT 0,
  opened integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  revenue_jod numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.klaviyo_flows TO authenticated;
GRANT ALL ON public.klaviyo_flows TO service_role;
ALTER TABLE public.klaviyo_flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_klaviyo_flows" ON public.klaviyo_flows FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_klaviyo_flows_updated BEFORE UPDATE ON public.klaviyo_flows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- klaviyo_push
CREATE TABLE public.klaviyo_push (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  source_type text NOT NULL DEFAULT 'Flow',
  sent_on date NOT NULL,
  sent integer NOT NULL DEFAULT 0,
  opened integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.klaviyo_push TO authenticated;
GRANT ALL ON public.klaviyo_push TO service_role;
ALTER TABLE public.klaviyo_push ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_klaviyo_push" ON public.klaviyo_push FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_klaviyo_push_updated BEFORE UPDATE ON public.klaviyo_push FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ll_snapshots
CREATE TABLE public.ll_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE,
  blue_members integer NOT NULL DEFAULT 0,
  silver_members integer NOT NULL DEFAULT 0,
  gold_members integer NOT NULL DEFAULT 0,
  platinum_members integer NOT NULL DEFAULT 0,
  redemption_rate numeric(5,2) NOT NULL DEFAULT 0,
  points_outstanding bigint NOT NULL DEFAULT 0,
  birthday_rewards_issued integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ll_snapshots TO authenticated;
GRANT ALL ON public.ll_snapshots TO service_role;
ALTER TABLE public.ll_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_ll_snapshots" ON public.ll_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_ll_snapshots_updated BEFORE UPDATE ON public.ll_snapshots FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- activations
CREATE TABLE public.activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  date date NOT NULL,
  status text NOT NULL DEFAULT 'Planned',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activations TO authenticated;
GRANT ALL ON public.activations TO service_role;
ALTER TABLE public.activations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_activations" ON public.activations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_activations_updated BEFORE UPDATE ON public.activations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- reports
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date date NOT NULL,
  end_date date NOT NULL,
  month_highlight text NOT NULL,
  next_month_bullets text[] NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_reports" ON public.reports FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- sync_log
CREATE TABLE public.sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  synced_at timestamptz NOT NULL DEFAULT now(),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_log TO authenticated;
GRANT ALL ON public.sync_log TO service_role;
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_sync_log" ON public.sync_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== SEED DATA — DISABLED, DO NOT RE-ENABLE =====
--
-- Everything below this line is commented out deliberately. It is Lovable's
-- original placeholder data, and it is kept rather than deleted so this
-- migration's checksum and Lovable's migration history stay intact.
--
-- Why it is off:
--   The shopify_daily_sales insert below writes the PRE-migration column
--   shape, with no source_name, sub_channel or channel. Those columns were
--   later added with defaults of 'unknown'/'Unknown', so every seeded row
--   arrived as a fully formed "Unknown channel" row that looked real. A sync
--   run then overwrote part of three of them with genuine revenue, and
--   24 to 26 August 2026 were each counted twice. August read 182,820 JOD
--   against a true 171,018.
--
--   Those defaults have since been dropped, so re-running this block would now
--   fail on a NOT NULL violation rather than insert silently. That is better,
--   but a failing migration would also block anything legitimate running after
--   it, so the block is disabled outright instead.
--
--   The other seven inserts are placeholder marketing data: invented campaign
--   and flow names, invented activations, an invented July report, and three
--   fabricated sync_log success rows. None of it should ever reach a database
--   that holds real figures.
--
-- If you genuinely need to seed an empty environment, copy this into a
-- separate, clearly named seed file. Do not turn this back on.


-- INSERT INTO public.shopify_daily_sales (date, total_online_revenue_jod, klaviyo_attributed_revenue_jod, orders, people_reached)
-- SELECT d::date,
--        round((2200 + 900*sin(extract(doy from d)/3.1) + 420*cos(extract(doy from d)/1.7) + (extract(dow from d) IN (4,5))::int * 850)::numeric, 2),
--        round((520 + 260*sin(extract(doy from d)/2.4) + 130*cos(extract(doy from d)/4.3))::numeric, 2),
--        (28 + 12*sin(extract(doy from d)/3.1))::int,
--        (1400 + 700*sin(extract(doy from d)/2.9) + 300*cos(extract(doy from d)/1.3))::int
-- FROM generate_series('2026-06-01'::date, '2026-08-31'::date, '1 day') d;

-- INSERT INTO public.ll_snapshots (snapshot_date, blue_members, silver_members, gold_members, platinum_members, redemption_rate, points_outstanding, birthday_rewards_issued)
-- SELECT d::date,
--        5200 + (d::date - '2026-06-01'::date) * 11,
--        1840 + (d::date - '2026-06-01'::date) * 4,
--        760 + (d::date - '2026-06-01'::date) * 2,
--        184 + ((d::date - '2026-06-01'::date) / 6)::int,
--        round((21 + 3*sin(extract(doy from d)/5.0))::numeric, 2),
--        1240000 + (d::date - '2026-06-01'::date) * 3100,
--        (3 + 2*abs(sin(extract(doy from d)/2.0)))::int
-- FROM generate_series('2026-06-01'::date, '2026-08-31'::date, '1 day') d;

-- INSERT INTO public.klaviyo_campaigns (name, sent_on, sent, opened, clicked, orders, revenue_jod) VALUES
-- ('June Cellar Release — Barolo & Brunello','2026-06-03',12840,5136,822,64,4180.00),
-- ('Father''s Day Cigar Edit','2026-06-10',13110,5768,943,88,6120.50),
-- ('Summer Spritz Kit — Limited','2026-06-17',12620,4795,706,51,3260.75),
-- ('Single Malt Restock: Islay Arrivals','2026-06-24',12980,5322,851,73,5410.00),
-- ('July Champagne Week','2026-07-01',13340,6003,1010,96,7240.25),
-- ('Rosé All Month — Provence Selection','2026-07-08',13210,5416,795,68,4380.00),
-- ('Cohiba & Partagás Humidor Drop','2026-07-15',13490,5936,1024,84,7980.00),
-- ('Mid-Summer Tasting Invite — Abdoun','2026-07-22',13020,5598,880,47,2940.00),
-- ('Agave Season: Mezcal & Tequila','2026-07-29',13620,5311,838,71,5120.40),
-- ('August Grand Cru Preview','2026-08-05',13880,6106,1096,102,8460.00),
-- ('Back to the Cellar — Storage Edit','2026-08-12',13740,5222,764,58,3620.00),
-- ('Cigar Lounge Reopening','2026-08-19',13950,6138,1157,93,7310.60),
-- ('End of Summer Vault Sale','2026-08-26',14210,6395,1278,124,9840.00);

-- INSERT INTO public.klaviyo_flows (flow_name, date, recipients, opened, conversions, revenue_jod)
-- SELECT f.flow_name, d::date,
--        (f.base + 40*sin(extract(doy from d)/2.2))::int,
--        ((f.base + 40*sin(extract(doy from d)/2.2)) * f.orate)::int,
--        ((f.base + 40*sin(extract(doy from d)/2.2)) * f.crate)::int,
--        round(((f.base + 40*sin(extract(doy from d)/2.2)) * f.crate * f.aov)::numeric, 2)
-- FROM generate_series('2026-06-01'::date, '2026-08-31'::date, '1 day') d
-- CROSS JOIN (VALUES
--   ('Welcome Series', 310, 0.52, 0.041, 62.0),
--   ('Abandoned Checkout', 240, 0.47, 0.078, 88.0),
--   ('Browse Abandonment', 420, 0.38, 0.021, 54.0),
--   ('Post-Purchase Thank You', 180, 0.61, 0.014, 46.0),
--   ('Winback 90 Days', 150, 0.29, 0.032, 74.0),
--   ('Loyalty Tier Upgrade', 95, 0.58, 0.048, 110.0),
--   ('Birthday Reward', 40, 0.66, 0.095, 58.0)
-- ) AS f(flow_name, base, orate, crate, aov);

-- INSERT INTO public.klaviyo_push (source_name, source_type, sent_on, sent, opened)
-- SELECT s.source_name, s.source_type, d::date,
--        (s.base + 60*sin(extract(doy from d)/2.6))::int,
--        ((s.base + 60*sin(extract(doy from d)/2.6)) * s.orate)::int
-- FROM generate_series('2026-06-01'::date, '2026-08-31'::date, '3 days') d
-- CROSS JOIN (VALUES
--   ('Welcome Series', 'Flow', 520, 0.33),
--   ('Abandoned Checkout', 'Flow', 380, 0.41),
--   ('Birthday Reward', 'Flow', 90, 0.55),
--   ('Weekly Drop Alert', 'Campaign', 2400, 0.27),
--   ('Flash Restock Alert', 'Campaign', 1900, 0.31)
-- ) AS s(source_name, source_type, base, orate);

-- INSERT INTO public.activations (title, date, status, notes) VALUES
-- ('Barolo tasting night — Abdoun', '2026-06-05', 'Done', 'Sold out, 42 guests. Strong Gold tier turnout.'),
-- ('Father''s Day cigar pairing', '2026-06-14', 'Done', 'Partnered with the lounge; 28 walk-ins.'),
-- ('Summer spritz pop-up — Boulevard', '2026-06-21', 'Not done', 'Cancelled due to venue scheduling.'),
-- ('Islay whisky masterclass', '2026-06-28', 'Done', 'Waitlist of 15, consider repeating.'),
-- ('Champagne week launch', '2026-07-02', 'Done', 'Window display plus in-store sampling.'),
-- ('Rosé garden evening — Jabal Amman', '2026-07-11', 'Done', 'Best attended activation of the quarter.'),
-- ('Humidor drop private preview', '2026-07-16', 'Done', 'Platinum members only, 18 attendees.'),
-- ('Mezcal tasting flight', '2026-07-30', 'Planned', 'Awaiting supplier confirmation.'),
-- ('Grand Cru preview dinner', '2026-08-06', 'Planned', 'Ticketed, 30 seats.'),
-- ('Cigar lounge reopening party', '2026-08-20', 'Planned', 'Press list being finalised.'),
-- ('End of summer vault sale — in store', '2026-08-27', 'Planned', 'Three day event, staff roster pending.');

-- INSERT INTO public.reports (start_date, end_date, month_highlight, next_month_bullets) VALUES
-- ('2026-07-01','2026-07-31','July was driven by Champagne Week and the humidor drop, which together delivered the two highest revenue campaigns of the quarter. Loyalty membership grew steadily with Gold tier showing the strongest relative gain.', ARRAY['Repeat the Islay masterclass with a larger room','Launch the Grand Cru preview to Platinum members first','Test push notifications on the browse abandonment flow']);

-- INSERT INTO public.sync_log (source, status, synced_at, message) VALUES
-- ('klaviyo','success','2026-08-27 06:15:00+00','Campaigns, flows and push synced'),
-- ('shopify','success','2026-08-27 06:18:00+00','Daily sales synced'),
-- ('loyaltylion','success','2026-08-27 06:20:00+00','Tier snapshot written');
