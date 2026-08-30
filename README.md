# Fyxx Insights Hub

Build an internal marketing dashboard for Fyxx, a premium wine, spirits and cigars retailer in Amman. Only two marketing users will use it. Everything is in JOD. No public pages.

Stack: React + Vite + TypeScript, Tailwind CSS, shadcn/ui, Recharts. Use Supabase for auth and database. Do not make any external API calls from the frontend; all data comes from Supabase tables that a separate backend job will fill later. For now seed every table with realistic placeholder data so every screen renders.

Auth: Supabase email/password login only. No sign-up page. Every route except /login requires a session.

Brand: white background, black text, accent pink #f0b09e, soft pink #F5D5CF for fills. Fonts from Google Fonts: Baskervville for headings and large numbers, Syne Bold (uppercase, letter-spaced) for section labels and buttons, Inter for everything else. Flat, quiet, editorial look. Thin 1px dividers, no drop shadows, no card radius larger than 6px, no gradients. Charts use black lines and pink fills only.

Global top bar: date range picker with presets (This month, Last month, Last 3 months, Custom), a Refresh button, and a “last updated” timestamp read from a sync_log table.

Left sidebar pages:

Overview: four large KPIs for the selected range — People reached, Klaviyo-attributed revenue JOD, Share of online revenue %, Loyalty members total — each with a small “vs previous period” delta. Below: a line chart of daily Klaviyo-attributed revenue vs total online revenue, and a bar chart of reach by channel (Email campaigns, Push, Flows).

Email campaigns: table with Campaign, Sent on, Sent, Opened, Open rate, Clicked, Click rate, Orders, Revenue JOD, plus a totals row. Above it, a bar chart of revenue per campaign.

Flows: table of every live flow with sends in the range — Flow, Recipients, Open rate, Conversion rate, Revenue JOD — with totals row and sortable columns. Display flow names exactly as stored, never reformat them.

Push: table of push notifications grouped by source flow or campaign: Type, Sent, Opened, Open rate. No click column.

Loyalty: four tier tiles — Blue, Silver, Gold, Platinum — showing member count and change vs previous period. Three facts: Redemption rate, Points outstanding (with JOD equivalent at 100 points = 1 JOD), Birthday rewards issued. Line chart of members per tier over time from a daily snapshot table.

Activations: a simple calendar list. Fields: title, date, status (Planned, Done, Not done), notes. Add, edit, delete. Filterable by month.

Export report: form with date range, a required “Month highlight” textarea (two sentences), and exactly three required “Next month” bullets. A Preview button navigates to /report, and a Download PDF button triggers print. Save reports to a reports table. Leave /report as an empty placeholder page.

Create these Supabase tables with RLS allowing only authenticated users: klaviyo_campaigns, klaviyo_flows, klaviyo_push, ll_snapshots (one row per day), shopify_daily_sales, activations, reports, sync_log. Seed each with placeholder rows for June to August 2026.

Do not build API integrations, scheduled jobs, or edge functions. Keep components small and files well named so the code can be extended outside Lovable.

This project was built with [Lovable](https://lovable.dev).

## Why revenue here is ~6% below Shopify's own total

Every revenue figure on this dashboard **excludes internal accounts**: venue
tables, terraces, "By The Glass", write-offs and freebies, event accounts, and
named staff. 71 accounts, 628,005 JOD across six years. Nothing about them is
attributable to a customer and none of it is useful for marketing.

The full list is at **/excluded** in the app — every account by name and tag,
its order count, its revenue, and when it last ordered. Do not re-derive it
from this file; the app reads the `excluded_accounts` view, which is the single
definition all the netted views share.

**Two accounts are deliberately NOT excluded despite carrying
`CUSTOMER_INTERNAL`:** Talabat and Careem. They are third-party delivery —
real sales to real customers. The tag is a Shopify-side error being corrected;
once it is, they will fall out of the exemption on their own.

### The venue series stops in February 2026, and nothing is broken

**B2B and venue orders have moved to Odoo and no longer sync to Shopify.** That
is why every table and terrace account tails off in February 2026 and why the
excluded total drops to almost nothing after it. Someone looking at that series
will reasonably think a sync failed. It did not — the orders stopped arriving
because they are placed in a different system now.

This makes the exclusion **historical cleanup, not an ongoing rule**. Only a
handful of named staff accounts still place orders through Shopify. If the
excluded total for a recent month is near zero, that is correct.

### Nine days disappear from the daily series

2020-01-26, 2020-02-09, 2020-02-17, 2020-02-27, 2020-03-07, 2021-05-04,
2021-05-07, 2022-04-12 and 2022-04-22 have no row in `shopify_daily_sales_net`.
On each of those days every order was either cancelled or belonged to an
internal account — 679.75 JOD in total across six years, and **zero
non-internal orders lost**. A gap on those dates is correct, not missing data.

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/95ce5edc-4b08-4c0b-9419-beeeb0fc0b55).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
