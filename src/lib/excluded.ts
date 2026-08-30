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
  { id: "9310102290679", name: "Talabat" },
  { id: "9421262094583", name: "Careem" },
] as const;

/**
 * Person-named accounts carrying CUSTOMER_INTERNAL but NOT an employee tag.
 *
 * Every account that is clearly staff carries `CUSTOMER TYPE_Employee` or
 * `INTERNAL_EMPLOYEE`. `CUSTOMER_INTERNAL` alone is otherwise used for venue
 * tables, write-offs and events — never for a person. These two are the only
 * exceptions, which is why they are worth a second look rather than a silent
 * exclusion. Flagged, NOT exempted: they stay excluded until someone confirms.
 */
export const POSSIBLE_MISTAGS = [
  { id: "6368239517943", name: "Hashim El akabi", revenue: 11614, lastOrder: "2026-04-25" },
  { id: "7348048232695", name: "Ahmad Ayman", revenue: 11636, lastOrder: "2024-07-26" },
] as const;

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
  const [inRange, lifetime, included] = await Promise.all([
    fetchExcludedOrders(r, ids),
    fetchExcludedLifetime(ids),
    fetchIncludedTotal(r),
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
  };
}
