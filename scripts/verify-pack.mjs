#!/usr/bin/env node
/**
 * The verification pack: every figure the dashboard shows for one month, in a
 * workbook that can be totalled in Excel and compared against Shopify admin,
 * Klaviyo and LoyaltyLion directly.
 *
 *   node scripts/verify-pack.mjs [--month 2026-08] [--out path.xlsx]
 *
 * This is NOT a bug hunt. It exists so the figures can be checked first-hand
 * rather than taken on trust, after several reported numbers turned out to be
 * wrong. Totals are real Excel formulas, not baked-in values, so re-sorting or
 * filtering recomputes them and a disagreement is visible immediately.
 *
 * Every sheet states its source table and how to check it. Where a figure
 * CANNOT be reconciled against a source, the sheet says so and why — that is
 * as useful as the ones that can, and hiding it would be the whole problem in
 * miniature.
 */
import ExcelJS from "exceljs";
import { loadEnv } from "./lib/env.mjs";
import { log } from "./lib/log.mjs";
import { selectAll } from "./lib/db.mjs";

loadEnv();
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MONTH = argOf("--month", "2026-08");
const FROM = `${MONTH}-01`;
const TO = new Date(Date.UTC(+MONTH.slice(0, 4), +MONTH.slice(5, 7), 0)).toISOString().slice(0, 10);
const OUT = argOf("--out", `verification-pack-${MONTH}.xlsx`);

const wb = new ExcelJS.Workbook();
wb.creator = "fyxx-insights-hub";

const HEAD = { bold: true };
const MONO = { name: "Menlo", size: 9 };

/** A sheet with a provenance block, a header row, data, and formula totals. */
function sheet(name, { source, check, cannot }, columns, rows, totalCols = [], groupBy = null) {
  const ws = wb.addWorksheet(name);
  ws.addRow([name]).font = { bold: true, size: 14 };
  ws.addRow([`Source: ${source}`]).font = MONO;
  ws.addRow([`How to check: ${check}`]).font = MONO;
  if (cannot) {
    const r = ws.addRow([`CANNOT be checked: ${cannot}`]);
    r.font = { ...MONO, bold: true };
  }
  ws.addRow([]);

  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.font = HEAD;
  const firstData = ws.rowCount + 1;
  for (const r of rows) ws.addRow(columns.map((c) => r[c.key] ?? null));
  const lastData = ws.rowCount;

  if (rows.length && totalCols.length) {
    ws.addRow([]);
    const totals = columns.map((c, i) => {
      if (i === 0) return "TOTAL — every row above";
      if (!totalCols.includes(c.key)) return null;
      const L = ws.getColumn(i + 1).letter;
      return { formula: `SUM(${L}${firstData}:${L}${lastData})` };
    });
    ws.addRow(totals).font = HEAD;

    // Per-group subtotals. A grand total alone forces the reader to write
    // their own SUMIF to check one channel, which is the opposite of the
    // point of this workbook.
    if (groupBy) {
      const gi = columns.findIndex((c) => c.key === groupBy);
      const GL = ws.getColumn(gi + 1).letter;
      const seen = [...new Set(rows.map((r) => r[groupBy]).filter(Boolean))].sort();
      ws.addRow([]);
      ws.addRow([`Subtotals by ${columns[gi].header.toLowerCase()}`]).font = HEAD;
      for (const g of seen) {
        const cells = columns.map((c, i) => {
          if (i === 0) return g;
          if (!totalCols.includes(c.key)) return null;
          const L = ws.getColumn(i + 1).letter;
          return {
            formula: `SUMIF(${GL}${firstData}:${GL}${lastData},"${g}",${L}${firstData}:${L}${lastData})`,
          };
        });
        ws.addRow(cells);
      }
    }
  }
  ws.columns.forEach((col, i) => {
    const header = columns[i]?.header ?? "";
    let w = header.length + 2;
    for (const r of rows) w = Math.max(w, String(r[columns[i].key] ?? "").length + 2);
    col.width = Math.min(Math.max(w, 10), 44);
  });
  return ws;
}

const num = (v) => Number(v ?? 0);
log.info(`building the pack for ${MONTH} (${FROM} to ${TO})`);

/* ---------------- 1. Read me first ---------------- */
{
  const ws = wb.addWorksheet("Read me first");
  ws.getColumn(1).width = 120;
  const lines = [
    [`Verification pack — ${MONTH}`, { bold: true, size: 16 }],
    [""],
    ["What this is: every figure the dashboard shows for this month, from the same tables the dashboard reads."],
    ["Totals are Excel formulas, not stored values, so filtering or re-sorting recomputes them."],
    [""],
    ["BEFORE ANYTHING ELSE: OPEN RATES", { bold: true }],
    ["Apple Mail pre-fetches images and marks a message opened whether or not anyone read it."],
    ["Every open figure in this workbook is inflated by an unknown amount, and open rates are NOT"],
    ["comparable across months, because the inflation grows as Apple's share of the list grows."],
    ["Across 64 of our own campaigns, click rate predicts revenue at 0.778 and open rate at 0.403."],
    ["Judge a campaign on revenue per delivered message, click rate, and orders — in that order."],
    [""],
    ["THE FOUR FIGURES THAT WILL NOT MATCH THEIR SOURCE, AND WHY", { bold: true }],
    [""],
    ["1. Klaviyo attributed revenue will be LOWER here than in Klaviyo's own reporting."],
    ["   Klaviyo never retracts a Placed Order event when an order is later cancelled, so its"],
    ["   figure only drifts upward. We subtract cancellations at read time. For August this was"],
    ["   the difference between 37,615 and 28,260 JOD. Ours is the correct one; the disagreement"],
    ["   is expected and is the point."],
    [""],
    ["2. 'Messages sent' cannot be reconciled to a single Klaviyo number."],
    ["   It counts SENDS, not people. A profile mailed on ten days counts ten times. Klaviyo"],
    ["   reports unique recipients per campaign, and uniqueness does not add up across campaigns."],
    ["   Compare per-campaign sends row by row; do not compare the total to anything."],
    [""],
    ["3. Push clicks do not exist anywhere. Klaviyo emits opens and bounces for push and no"],
    ["   click event of any kind. This is a closed question, not a gap in our data."],
    [""],
    ["4. Loyalty tier counts exist only for days we scanned LoyaltyLion. The imported year of"],
    ["   points history carries none, so most days are blank rather than zero. A blank means"],
    ["   not measured; it does not mean the programme was empty."],
    [""],
    ["ONE DEFINITION THAT CHANGED MID-HISTORY", { bold: true }],
    ["POS meant every retail order until 27 February 2026, and only orders with an identified"],
    ["customer after it, because the Odoo connector syncs no others. Periods either side are"],
    ["not comparable. This month sits entirely after the change."],
    [""],
    ["WHAT REVENUE MEANS HERE", { bold: true }],
    ["Revenue is computed from orders and excludes cancelled ones. It is NOT Shopify's"],
    ["'amount spent' field: of 808 customers tested, that field matched the non-cancelled sum"],
    ["572 times, the all-orders sum 175 times, and neither 61 times. It is fine for ranking"],
    ["and wrong for arithmetic."],
    [""],
    ["Orders here are counted on the Amman calendar day. Shopify admin reports in the store's"],
    ["timezone too, so day boundaries should agree; if a single day differs by one or two"],
    ["orders, check the ones placed near midnight before assuming a fault."],
  ];
  for (const [text, font] of lines) {
    const r = ws.addRow([text]);
    if (font) r.font = font;
  }
}

/* ---------------- 2. Sales by day and channel ---------------- */
{
  const rows = await selectAll(
    "shopify_daily_sales",
    `select=date,sub_channel,orders,total_online_revenue_jod&date=gte.${FROM}&date=lte.${TO}&order=date.asc,sub_channel.asc`,
  );
  // Deliberately the RAW stored table, not the net view the dashboard reads.
  // This sheet exists to be compared against Shopify admin, and Shopify admin
  // includes house and staff accounts. Matching the source is what makes it
  // checkable; the gap to the dashboard is stated instead of removed.
  const houseRows = await selectAll(
    "shopify_orders",
    `select=revenue_jod,shopify_customer_id&cancelled_at=is.null&ordered_on=gte.${FROM}&ordered_on=lte.${TO}`,
  );
  const houseIds = new Set(
    (await selectAll("shopify_customers", "select=shopify_customer_id&is_house_account=is.true"))
      .map((c) => c.shopify_customer_id),
  );
  const houseOrders = houseRows.filter((o) => houseIds.has(o.shopify_customer_id));
  const houseRev = houseOrders.reduce((a, o) => a + num(o.revenue_jod), 0);

  sheet("Sales by day", {
    source: "shopify_daily_sales — one row per day per channel, written by the nightly Shopify sweep",
    check: "Shopify admin > Analytics > Reports > Sales over time, grouped by channel. Set the date range to this month. This sheet should match Shopify admin exactly.",
    cannot: `The DASHBOARD total, which is lower. The dashboard excludes house and staff accounts (tagged CUSTOMER_INTERNAL or CUSTOMER TYPE_Employee) because every customer-level figure does; this sheet includes them so it still matches Shopify admin. For this month that is ${houseOrders.length} orders worth ${Math.round(houseRev * 1000) / 1000} JOD. Subtract that from the total below to reach the dashboard figure.`,
  }, [
    { header: "Date", key: "date" },
    { header: "Channel", key: "sub_channel" },
    { header: "Orders", key: "orders" },
    { header: "Revenue (JOD)", key: "rev" },
  ], rows.map((r) => ({ ...r, orders: num(r.orders), rev: num(r.total_online_revenue_jod) })),
    ["orders", "rev"], "sub_channel");
  log.ok(`sales: ${rows.length} rows`);
}

/* ---------------- 3. Klaviyo attributed revenue ---------------- */
{
  const gross = await selectAll("klaviyo_attributed_daily",
    `select=date,revenue_jod&date=gte.${FROM}&date=lte.${TO}&order=date.asc`);
  const net = await selectAll("klaviyo_attributed_daily_net",
    `select=date,revenue_jod&date=gte.${FROM}&date=lte.${TO}&order=date.asc`);
  const netBy = new Map(net.map((r) => [r.date, num(r.revenue_jod)]));
  const rows = gross.map((g) => ({
    date: g.date,
    gross: num(g.revenue_jod),
    net: netBy.get(g.date) ?? 0,
    diff: (netBy.get(g.date) ?? 0) - num(g.revenue_jod),
  }));
  sheet("Attribution", {
    source: "klaviyo_attributed_daily (as Klaviyo reported it) vs klaviyo_attributed_daily_net (cancellations removed)",
    check: "Klaviyo > Analytics > Attributed revenue for this month. It should match the GROSS column.",
    cannot: "The NET column, which is what the dashboard shows. Klaviyo has no equivalent — it never retracts a cancelled order. The gap is the cancellations.",
  }, [
    { header: "Date", key: "date" },
    { header: "Gross, as Klaviyo reports it", key: "gross" },
    { header: "Net of cancellations (dashboard)", key: "net" },
    { header: "Difference", key: "diff" },
  ], rows, ["gross", "net", "diff"]);
  log.ok(`attribution: ${rows.length} days`);
}

/* ---------------- 4. Campaigns ---------------- */
{
  const rows = await selectAll("klaviyo_campaigns",
    `select=name,sent_on,send_channel,sent,delivered,opened,clicked,orders,revenue_jod&sent_on=gte.${FROM}&sent_on=lte.${TO}&order=sent_on.asc`);
  // Mirrors MIN_CAMPAIGN_RECIPIENTS in src/lib/report.ts. Kept identical so
  // the pack and the report can never disagree about what counts as a send.
  const TEST_SEND_MAX = 50;
  const tests = rows.filter((r) => num(r.sent) < TEST_SEND_MAX);
  const real = rows.filter((r) => num(r.sent) >= TEST_SEND_MAX);
  const testNote = tests.length
    ? " EXCLUDED as test sends, below " + TEST_SEND_MAX + " recipients: " +
      tests.map((t) => t.name + " (" + t.sent + " recipients)").join(", ") +
      ". Klaviyo will still show these. A rate measured over a handful of recipients is noise with the authority of a percentage, and beside real campaigns it reads as the best send of the month."
    : "";
  if (tests.length) log.info("  excluding " + tests.length + " test send(s): " + tests.map((t) => t.name).join(", "));
  sheet("Campaigns", {
    source: "klaviyo_campaigns — one row per campaign, on its SEND date",
    check: "Klaviyo > Campaigns, filtered to this month. Compare row by row on name and send date.",
    cannot: "The Sent total. It counts sends, not unique people, so it cannot be compared to any single Klaviyo number. Revenue is Klaviyo's own attribution and is NOT netted of cancellations on this sheet. " + "Opens are NOT readers. Apple Mail pre-fetches images and marks a message opened whether or not anyone read it, so opens and open rates are inflated by an unknown amount and are not comparable across time — the inflation grows with Apple's share of the list. Across 64 of our own campaigns, click rate predicts revenue at 0.778 and open rate at 0.403, so judge a campaign on clicks, orders and revenue. This is not a fault in the data: Klaviyo reports what it can see, and what it can see is a pre-fetch." + testNote,
  }, [
    { header: "Campaign", key: "name" },
    { header: "Sent on", key: "sent_on" },
    { header: "Channel", key: "send_channel" },
    { header: "Sent", key: "sent" },
    { header: "Delivered", key: "delivered" },
    { header: "Opened", key: "opened" },
    { header: "Clicked", key: "clicked" },
    { header: "Orders", key: "orders" },
    { header: "Revenue (JOD)", key: "rev" },
  ], real.map((r) => ({ ...r, rev: num(r.revenue_jod) })),
    ["sent", "delivered", "opened", "clicked", "orders", "rev"]);
  log.ok(`campaigns: ${real.length} real, ${tests.length} test send(s) excluded`);
}

/* ---------------- 5. Flows ---------------- */
{
  const raw = await selectAll("klaviyo_flows",
    `select=flow_name,date,send_channel,recipients,delivered,opened,clicked,conversions,revenue_jod&date=gte.${FROM}&date=lte.${TO}&order=date.asc`);
  const by = new Map();
  for (const r of raw) {
    const k = `${r.flow_name}::${r.send_channel}`;
    const c = by.get(k) ?? { flow_name: r.flow_name, send_channel: r.send_channel,
      recipients: 0, delivered: 0, opened: 0, clicked: 0, conversions: 0, rev: 0 };
    c.recipients += num(r.recipients); c.delivered += num(r.delivered);
    c.opened += num(r.opened); c.clicked += num(r.clicked);
    c.conversions += num(r.conversions); c.rev += num(r.revenue_jod);
    by.set(k, c);
  }
  sheet("Flows", {
    source: "klaviyo_flows — stored per flow per DAY, aggregated here across the month",
    check: "Klaviyo > Flows > Analytics, date range set to this month. Compare per flow.",
    cannot: "Recipients is sends, not unique people, for the same reason as campaigns. " + "Opens are NOT readers. Apple Mail pre-fetches images and marks a message opened whether or not anyone read it, so opens and open rates are inflated by an unknown amount and are not comparable across time — the inflation grows with Apple's share of the list. Across 64 of our own campaigns, click rate predicts revenue at 0.778 and open rate at 0.403, so judge a campaign on clicks, orders and revenue. This is not a fault in the data: Klaviyo reports what it can see, and what it can see is a pre-fetch.",
  }, [
    { header: "Flow", key: "flow_name" },
    { header: "Channel", key: "send_channel" },
    { header: "Recipients", key: "recipients" },
    { header: "Delivered", key: "delivered" },
    { header: "Opened", key: "opened" },
    { header: "Clicked", key: "clicked" },
    { header: "Conversions", key: "conversions" },
    { header: "Revenue (JOD)", key: "rev" },
  ], [...by.values()].sort((a, b) => b.recipients - a.recipients),
    ["recipients", "delivered", "opened", "clicked", "conversions", "rev"]);
  log.ok(`flows: ${by.size}`);
}

/* ---------------- 6. Push ---------------- */
{
  const raw = await selectAll("klaviyo_push",
    `select=source_name,source_type,sent_on,sent,delivered,opened,conversions,revenue_jod&sent_on=gte.${FROM}&sent_on=lte.${TO}&order=sent_on.asc`);
  const by = new Map();
  for (const r of raw) {
    const k = `${r.source_type}::${r.source_name}`;
    const c = by.get(k) ?? { source_name: r.source_name, source_type: r.source_type,
      sent: 0, delivered: 0, opened: 0, conversions: 0, rev: 0 };
    c.sent += num(r.sent); c.delivered += num(r.delivered); c.opened += num(r.opened);
    c.conversions += num(r.conversions); c.rev += num(r.revenue_jod);
    by.set(k, c);
  }
  sheet("Push", {
    source: "klaviyo_push — grouped by the flow or campaign that sent the notification",
    check: "Klaviyo > Analytics, push channel, this month. Opens and deliveries should match.",
    cannot: "Clicks. Klaviyo emits no push click event of any kind, so no click column exists here or anywhere else. Opens are the only push engagement signal available — and unlike email opens there is nothing to fall back to. Push opens are a different measurement from email opens and are NOT affected by Apple Mail pre-fetching.",
  }, [
    { header: "Source", key: "source_name" },
    { header: "Type", key: "source_type" },
    { header: "Sent", key: "sent" },
    { header: "Delivered", key: "delivered" },
    { header: "Opened", key: "opened" },
    { header: "Conversions", key: "conversions" },
    { header: "Revenue (JOD)", key: "rev" },
  ], [...by.values()].sort((a, b) => b.sent - a.sent),
    ["sent", "delivered", "opened", "conversions", "rev"]);
  log.ok(`push: ${by.size}`);
}

/* ---------------- 7. Loyalty ---------------- */
{
  const rows = await selectAll("ll_snapshots",
    `select=*&snapshot_date=gte.${FROM}&snapshot_date=lte.${TO}&order=snapshot_date.asc`);
  const cols = [
    { header: "Date", key: "snapshot_date" },
    { header: "Blue", key: "blue_members" },
    { header: "Silver", key: "silver_members" },
    { header: "Gold", key: "gold_members" },
    { header: "Platinum", key: "platinum_members" },
    { header: "Points earned", key: "points_earned" },
    { header: "Points redeemed", key: "points_redeemed" },
    { header: "Points outstanding", key: "points_outstanding" },
    { header: "Redemptions", key: "redemptions" },
    { header: "Birthday rewards", key: "birthday_rewards_issued" },
  ];
  const mapped = rows.map((r) => ({
    snapshot_date: r.snapshot_date,
    blue_members: r.blue_members || null,
    silver_members: r.silver_members || null,
    gold_members: r.gold_members || null,
    platinum_members: r.platinum_members || null,
    points_earned: num(r.points_earned),
    points_redeemed: num(r.points_redeemed),
    points_outstanding: num(r.points_outstanding),
    redemptions: num(r.redemptions),
    birthday_rewards_issued: num(r.birthday_rewards_issued),
  }));
  sheet("Loyalty", {
    source: "ll_snapshots — nightly LoyaltyLion scan, plus an imported year of points history",
    check: "LoyaltyLion > Analytics. The points liability reconciled to LoyaltyLion's own figure at +0.00% when last tested.",
    cannot: "Tier counts on days with blanks. Those days come from the imported points history, which carries no tier data. Blank means not measured, not zero members.",
  }, cols, mapped, ["points_earned", "points_redeemed", "redemptions", "birthday_rewards_issued"]);
  log.ok(`loyalty: ${rows.length} days`);
}

/* ---------------- 8. Customers ---------------- */
{
  const all = await selectAll("shopify_customers",
    "select=orders_lifetime,revenue_jod,first_order_date,last_order_date,has_email,email_consent,is_house_account");
  const real = all.filter((c) => !c.is_house_account);
  const buyers = real.filter((c) => c.first_order_date);
  const lapsedRows = buyers.filter((c) => c.last_order_date && c.last_order_date < "2025-01-01");
  const sub = lapsedRows.filter((c) => c.email_consent === "SUBSCRIBED");
  const sumRev = (rs) => Math.round(rs.reduce((a, c) => a + num(c.revenue_jod), 0));
  const facts = [
    { metric: "Customers on file (house and staff excluded)", value: real.length, note: "" },
    { metric: "House and staff accounts excluded", value: all.length - real.length, note: "Excluded by TAG, never by order volume" },
    { metric: "Of those, have ever ordered", value: buyers.length, note: "" },
    { metric: "Never ordered", value: real.length - buyers.length, note: "On file, no order ever" },
    { metric: "Lapsed — bought, nothing since 2025-01-01", value: lapsedRows.length, note: `${sumRev(lapsedRows)} JOD lifetime` },
    { metric: "  of which contactable (SUBSCRIBED)", value: sub.length, note: `${sumRev(sub)} JOD lifetime, no opt-in needed` },
    { metric: "  of which unsubscribed", value: lapsedRows.filter((c) => c.email_consent === "UNSUBSCRIBED").length, note: "Cannot be emailed" },
    { metric: "  of which never asked", value: lapsedRows.filter((c) => c.has_email && c.email_consent !== "SUBSCRIBED" && c.email_consent !== "UNSUBSCRIBED").length, note: "Has an address, never opted in" },
    { metric: "  of which no email address", value: lapsedRows.filter((c) => !c.has_email).length, note: "" },
    { metric: "Bought since 2025-01-01", value: buyers.filter((c) => c.last_order_date >= "2025-01-01").length, note: "" },
  ];
  sheet("Customers", {
    source: "shopify_customers — one row per customer, lifetime figures, rebuilt by the 2019 sweep",
    check: "Shopify admin > Customers. Segment counts should match; totals will differ slightly, see below.",
    cannot: "The exact population. Shopify reports 20,019 against our 19,163, a 4% gap with no orphans found and no cause established. It is an open question, not a resolved one. Revenue is computed from orders, not Shopify's 'amount spent' field.",
  }, [
    { header: "Metric", key: "metric" },
    { header: "Value", key: "value" },
    { header: "Note", key: "note" },
  ], facts, []);
  log.ok(`customers: ${facts.length} metrics`);
}

await wb.xlsx.writeFile(OUT);
log.ok(`wrote ${OUT} — ${wb.worksheets.length} sheets`);
