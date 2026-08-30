import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/queries";
import type { DateRange } from "@/lib/ranges";

/**
 * The accounts left OUT of every revenue figure on this dashboard.
 *
 * This page exists because an exclusion nobody can see is indistinguishable
 * from a wrong number. Every revenue figure on the dashboard is 6% smaller
 * than Shopify's own total, and the only defence against that reading as an
 * error is being able to answer "what isn't in this number" without asking
 * anyone.
 *
 * The exclusion itself is defined ONCE, in the `excluded_accounts` view, which
 * both `shopify_daily_sales_net` and `revenue_by_acquisition` read. This file
 * only reports it, so the page can never describe a rule the figures do not
 * actually follow.
 */
export type ExcludedAccount = {
  shopify_customer_id: string;
  display_name: string | null;
  category: string;
  classified_by: string;
};

export type ExcludedOrderAgg = {
  shopify_customer_id: string;
  orders: number;
  revenue: number;
  lastOrder: string | null;
  firstOrder: string | null;
};

/**
 * Talabat and Careem carry CUSTOMER_INTERNAL but are third-party delivery —
 * real sales to real customers. They are EXEMPT from the exclusion and count
 * as ordinary revenue. Named here so the page can say so rather than leaving
 * their absence from the list unexplained.
 */
export const MISTAGGED_EXEMPTIONS = [
  { id: "9310102290679", name: "Talabat", why: "third-party delivery, not an internal account" },
  { id: "9421262094583", name: "Careem", why: "third-party delivery, not an internal account" },
  { id: "6368239517943", name: "Hashim El akabi", why: "a real customer, confirmed 30 Aug 2026" },
] as const;

/**
 * Internal accounts sitting in marketing lists.
 *
 * "Free of Charge Goods FOC" turned out to be SUBSCRIBED and loyalty-enrolled,
 * which raised a fair question: are reach, member and tier counts inflated by
 * accounts that are not people?
 *
 * MEASURED, 30 August 2026 — the answer is yes, but barely:
 *   12 of 11,162 email subscribers are internal   (0.107%)
 *   20 of 11,891 loyalty members are internal     (0.17%)
 *   11,847 of 8,630,831 outstanding points        (0.137%)
 *   0 SMS subscribers are internal
 *
 * So no figure moves by more than about one part in six hundred. Recorded
 * rather than corrected: an adjustment smaller than the rounding on the tile
 * would add machinery without changing a displayed number. The accounts are
 * listed so they can be cleaned at source, which fixes it permanently.
 */
export const INTERNAL_IN_MARKETING = {
  measuredOn: "2026-08-30",
  emailSubscribed: 12,
  emailSubscribedOutOf: 11162,
  loyaltyEnrolled: 20,
  loyaltyEnrolledOutOf: 11891,
  smsSubscribed: 0,
  points: 11847,
  pointsOutOf: 8630831,
  /** Enrolled in LoyaltyLion AND subscribed in Klaviyo, worst first by points. */
  accounts: [
    { name: "Yousef Mazahreh", id: "5320661500057", email: "SUBSCRIBED", points: 4096, tier: null },
    { name: "Mousa Sweiss", id: "9208254726391", email: "SUBSCRIBED", points: 3162, tier: "Gold" },
    { name: "Tareq Shnoudi", id: "6398668505335", email: "UNSUBSCRIBED", points: 2203, tier: null },
    { name: "Essa Khair", id: "6792053620983", email: "SUBSCRIBED", points: 927, tier: null },
    { name: "Ahmad Ayman", id: "7348048232695", email: "NOT_SUBSCRIBED", points: 400, tier: "Blue" },
    { name: "Jad Hassan", id: "6392569561335", email: "SUBSCRIBED", points: 400, tier: null },
    { name: "Mahmoud Al Sammar", id: "7345461068023", email: "SUBSCRIBED", points: 213, tier: null },
    { name: "Hanna Jubran", id: "6389642756343", email: "SUBSCRIBED", points: 157, tier: null },
    { name: "Rakan Ammari", id: "6688378454263", email: "SUBSCRIBED", points: 134, tier: "Blue" },
    { name: "Saif Abu Sultan Sarhan", id: "6478413332727", email: "SUBSCRIBED", points: 75, tier: "Gold" },
    { name: "Shafiq Ghattas", id: "5028813242521", email: "SUBSCRIBED", points: 70, tier: null },
    { name: "Louies Safar", id: "6956165791991", email: "SUBSCRIBED", points: 10, tier: null },
    { name: "Fadel Sammour", id: "6391910072567", email: "SUBSCRIBED", points: 0, tier: "Blue" },
    { name: "Free of Charge Goods FOC", id: "4554713989273", email: "SUBSCRIBED", points: 0, tier: null },
    { name: "Essa Gacaman", id: "6371814768887", email: "NOT_SUBSCRIBED", points: 0, tier: null },
    { name: "Retail FOC", id: "6250535878903", email: "UNSUBSCRIBED", points: 0, tier: null },
    { name: "Communal Table", id: "7580976742647", email: "NOT_SUBSCRIBED", points: 0, tier: null },
    { name: "Table 3", id: "6368272220407", email: null, points: 0, tier: null },
    { name: "Table 8", id: "6368263799031", email: null, points: 0, tier: null },
    { name: "Terrace 1", id: "7000311103735", email: null, points: 0, tier: null },
  ],
} as const;

export const fetchExcludedAccounts = async (): Promise<ExcludedAccount[]> => {
  // A view's columns are all nullable to the type generator; narrow here, the
  // same way fetchDailySales and fetchAcquisition do.
  const rows = await fetchAllRows<{
    shopify_customer_id: string | null;
    display_name: string | null;
    category: string | null;
    classified_by: string | null;
  }>((from, to) =>
    supabase
      .from("excluded_accounts")
      .select("shopify_customer_id,display_name,category,classified_by")
      .order("display_name")
      .range(from, to),
  );
  return rows
    .filter((r) => r.shopify_customer_id !== null)
    .map((r) => ({
      shopify_customer_id: r.shopify_customer_id as string,
      display_name: r.display_name,
      category: r.category ?? "Uncategorised",
      classified_by: r.classified_by ?? "unknown",
    }));
};

/**
 * Orders belonging to excluded accounts, for a range.
 *
 * Read from `shopify_orders` directly rather than from any netted view — the
 * whole point is to show what the netted views leave out, so reading one of
 * them here would return nothing.
 */
export async function fetchExcludedOrders(r: DateRange, ids: Set<string>) {
  if (!ids.size) return new Map<string, ExcludedOrderAgg>();
  const rows = await fetchAllRows<{
    shopify_customer_id: string | null;
    revenue_jod: number | null;
    ordered_on: string | null;
    cancelled_at: string | null;
  }>((from, to) =>
    supabase
      .from("shopify_orders")
      .select("shopify_customer_id,revenue_jod,ordered_on,cancelled_at")
      .gte("ordered_on", r.from)
      .lte("ordered_on", r.to)
      .is("cancelled_at", null)
      .range(from, to),
  );
  const out = new Map<string, ExcludedOrderAgg>();
  for (const row of rows) {
    const id = row.shopify_customer_id;
    if (!id || !ids.has(id)) continue;
    const cur = out.get(id) ?? {
      shopify_customer_id: id,
      orders: 0,
      revenue: 0,
      lastOrder: null,
      firstOrder: null,
    };
    cur.orders += 1;
    cur.revenue += Number(row.revenue_jod ?? 0);
    const d = row.ordered_on;
    if (d) {
      if (!cur.lastOrder || d > cur.lastOrder) cur.lastOrder = d;
      if (!cur.firstOrder || d < cur.firstOrder) cur.firstOrder = d;
    }
    out.set(id, cur);
  }
  return out;
}

/** Lifetime totals per excluded account, independent of the selected range. */
export async function fetchExcludedLifetime(ids: Set<string>) {
  return fetchExcludedOrders({ from: "2019-01-01", to: "2099-12-31" }, ids);
}

/**
 * Included revenue for the same range, so the proportion is visible.
 *
 * Deliberately reads the SAME view the Overview reads, so the "included" number
 * on this page is the number on that page and not a second computation of it.
 */
export async function fetchIncludedTotal(r: DateRange) {
  const rows = await fetchAllRows<{ total_online_revenue_jod: number | null; orders: number | null }>(
    (from, to) =>
      supabase
        .from("shopify_daily_sales_net")
        .select("total_online_revenue_jod,orders")
        .gte("date", r.from)
        .lte("date", r.to)
        .range(from, to),
  );
  return {
    revenue: rows.reduce((a, x) => a + Number(x.total_online_revenue_jod ?? 0), 0),
    orders: rows.reduce((a, x) => a + Number(x.orders ?? 0), 0),
  };
}

/** Everything the panel needs, assembled once. */
export async function buildExclusionView(r: DateRange) {
  const accounts = await fetchExcludedAccounts();
  const ids = new Set(accounts.map((a) => a.shopify_customer_id));
  const [inRange, lifetime, included, includedAllTime] = await Promise.all([
    fetchExcludedOrders(r, ids),
    fetchExcludedLifetime(ids),
    fetchIncludedTotal(r),
    // Derived, never hardcoded. A literal all-time figure was already stale one
    // exemption later, which is the exact failure this page exists to prevent.
    fetchIncludedTotal({ from: "2019-01-01", to: "2099-12-31" }),
  ]);

  const rows = accounts
    .map((a) => {
      const life = lifetime.get(a.shopify_customer_id);
      const now = inRange.get(a.shopify_customer_id);
      return {
        ...a,
        name: a.display_name ?? "(no name)",
        lifetimeOrders: life?.orders ?? 0,
        lifetimeRevenue: life?.revenue ?? 0,
        rangeOrders: now?.orders ?? 0,
        rangeRevenue: now?.revenue ?? 0,
        lastOrder: life?.lastOrder ?? null,
        firstOrder: life?.firstOrder ?? null,
      };
    })
    .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const excludedRange = sum(rows.map((x) => x.rangeRevenue));
  const excludedLifetime = sum(rows.map((x) => x.lifetimeRevenue));

  const byCategory = [...new Set(rows.map((r2) => r2.category))]
    .map((category) => {
      const mine = rows.filter((x) => x.category === category);
      return {
        category,
        accounts: mine.length,
        lifetimeRevenue: sum(mine.map((x) => x.lifetimeRevenue)),
        rangeRevenue: sum(mine.map((x) => x.rangeRevenue)),
        lastOrder: mine.reduce<string | null>(
          (a, x) => (x.lastOrder && (!a || x.lastOrder > a) ? x.lastOrder : a),
          null,
        ),
      };
    })
    .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue);

  return {
    rows,
    byCategory,
    range: {
      excluded: excludedRange,
      included: included.revenue,
      total: excludedRange + included.revenue,
      pct: excludedRange + included.revenue > 0
        ? (excludedRange / (excludedRange + included.revenue)) * 100
        : null,
      excludedOrders: sum(rows.map((x) => x.rangeOrders)),
      includedOrders: included.orders,
    },
    lifetime: { excluded: excludedLifetime },
    allTime: { excluded: excludedLifetime, included: includedAllTime.revenue },
  };
}
