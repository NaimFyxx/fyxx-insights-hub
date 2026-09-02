import { useMemo, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, endOfMonth, startOfMonth } from "date-fns";
import { PageHeader } from "@/components/fyxx/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  buildReport,
  saveNarrative,
  MIN_CAMPAIGN_RECIPIENTS,
  type Availability,
  type ReportData,
} from "@/lib/report";
import { ammanNow, iso, type DateRange } from "@/lib/ranges";
import { useDateRange } from "@/context/date-range-context";
import { num, pct, jod } from "@/lib/format";
import { attributionLimitNote, SUB_CHANNELS } from "@/lib/channels";
import { ENGAGEMENT_SIGNAL } from "@/lib/engagement";
import "@/styles/report.css";

export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({
    meta: [
      { title: "Report — Fyxx Marketing" },
      { name: "description", content: "Printable monthly executive report built from live data." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportPage,
});

const day = (d: string) => format(parseISO(d), "d MMM");
const rateOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** Renders a section's figures, or the reason they cannot be shown. */
function Guard({
  availability,
  children,
}: {
  availability: Availability;
  children: React.ReactNode;
}) {
  if (availability.available) return <>{children}</>;
  return <p className="unavail">{availability.reason}</p>;
}

function ReportPage() {
  const [month, setMonth] = useState(() => format(ammanNow(), "yyyy-MM"));

  // Refresh must reach this page too; the month picker below is its own
  // control and deliberately ignores the global date range.
  const { refreshKey } = useDateRange();

  const range: DateRange = useMemo(() => {
    const base = parseISO(`${month}-01`);
    return { from: iso(startOfMonth(base)), to: iso(endOfMonth(base)) };
  }, [month]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["report", range.from, range.to, refreshKey],
    queryFn: () => buildReport(range),
  });

  return (
    <div className="space-y-6">
      <div className="no-print space-y-6">
        <PageHeader
          title="Report"
          subtitle="The monthly page sent to Zeid. Pick the month below — the date range above does not apply. Print to PDF at A4, no scaling, background graphics on."
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Month</span>
            <Input
              type="month"
              value={month}
              max={format(ammanNow(), "yyyy-MM")}
              onChange={(e) => setMonth(e.target.value)}
              className="w-44"
            />
          </label>
          <Button onClick={() => window.print()} disabled={!data}>
            Print / Save as PDF
          </Button>
        </div>
        {data ? <NarrativeEditor range={range} data={data} /> : null}
      </div>

      {isLoading ? (
        <p className="no-print text-sm text-muted-foreground">Building the report…</p>
      ) : null}
      {error ? (
        <p className="no-print text-sm text-destructive">
          The report could not be built: {(error as Error).message}
        </p>
      ) : null}
      {data ? <ReportPage1 data={data} /> : null}
    </div>
  );
}

function NarrativeEditor({ range, data }: { range: DateRange; data: ReportData }) {
  const qc = useQueryClient();
  const [highlight, setHighlight] = useState(data.narrative.monthHighlight);
  const [bullets, setBullets] = useState(data.narrative.nextMonthBullets.join("\n"));

  // Reload the written parts when the month changes.
  useEffect(() => {
    setHighlight(data.narrative.monthHighlight);
    setBullets(data.narrative.nextMonthBullets.join("\n"));
  }, [data.narrative]);

  const save = useMutation({
    mutationFn: () =>
      saveNarrative(range, {
        monthHighlight: highlight.trim(),
        nextMonthBullets: bullets
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report"] }),
  });

  return (
    <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block font-medium">Month highlight</span>
        <Textarea rows={4} value={highlight} onChange={(e) => setHighlight(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Next month</span>
        <span className="mb-1 block text-xs text-muted-foreground">
          One per line, as <code>Title — the rest of the sentence</code>.
        </span>
        <Textarea rows={4} value={bullets} onChange={(e) => setBullets(e.target.value)} />
      </label>
      <div className="md:col-span-2 flex items-center gap-3">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save wording"}
        </Button>
        {save.isError ? (
          <span className="text-xs text-destructive">{(save.error as Error).message}</span>
        ) : null}
        {save.isSuccess ? <span className="text-xs text-muted-foreground">Saved.</span> : null}
      </div>
    </div>
  );
}

export function ReportPage1({ data }: { data: ReportData }) {
  const {
    range,
    reach,
    campaigns,
    flows,
    push,
    loyalty,
    activations,
    revenue,
    acquisition,
    narrative,
    notices,
  } = data;

  const campaignTotals = campaigns.rows.reduce(
    (a, c) => ({
      sent: a.sent + c.sent,
      delivered: a.delivered + c.delivered,
      opened: a.opened + c.opened,
      clicked: a.clicked + c.clicked,
      orders: a.orders + c.orders,
      revenue: a.revenue + Number(c.revenue_jod),
    }),
    { sent: 0, delivered: 0, opened: 0, clicked: 0, orders: 0, revenue: 0 },
  );

  const tierDelta = (cur: number, prev: number | undefined) => {
    if (prev === undefined) return <span className="d">first measurement</span>;
    const d = cur - prev;
    if (d === 0) return <span className="d">no change</span>;
    return (
      <span className="d up">
        {d > 0 ? "+" : ""}
        {num(d)} since {day(loyalty.prior!.snapshot_date)}
      </span>
    );
  };

  return (
    <div className="rp">
      <header className="head">
        <div className="headtop">
          <div className="wordmark">
            Fyxx<span>.</span>
          </div>
          <div className="eyebrow">Marketing Department &nbsp;·&nbsp; Monthly Executive Report</div>
        </div>
        <div className="headgrid">
          <div className="month">{format(parseISO(range.from), "MMMM yyyy")}</div>
          <div className="meta">
            Period{" "}
            <b>
              {day(range.from)} to {format(parseISO(range.to), "d MMMM yyyy")}
            </b>
            &nbsp;·&nbsp; Prepared by <b>Naím Aljada</b>
            &nbsp;·&nbsp; Issued <b>{format(new Date(), "d MMMM yyyy")}</b>
          </div>
        </div>
      </header>

      {notices.length ? (
        <section className="notices">
          {notices.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </section>
      ) : null}

      {narrative.monthHighlight ? (
        <section>
          <div className="sec">
            <span className="eyebrow">Month highlight</span>
          </div>
          <p className="highlight">{narrative.monthHighlight}</p>
        </section>
      ) : null}

      <section>
        <div className="sec">
          <span className="eyebrow">Total reach</span>
        </div>
        {/* Attributed revenue and share come from separate, fully backfilled
            tables, so they stay on the page even when unique reach cannot be
            reported. Refusing the whole strip would discard two good figures. */}
        <div className="reach">
          {reach.availability.available ? (
            <>
              <div className="kpi">
                <div className="n">{num(reach.totalUnique)}</div>
                <div className="l">People reached across all channels</div>
              </div>
              <div className="kpi">
                <div className="n">
                  {num(reach.emailCampaigns)}{" "}
                  <small>
                    · {num(reach.push)} · {num(reach.flows)}
                  </small>
                </div>
                <div className="l">Email campaigns · Push · Flows</div>
              </div>
            </>
          ) : (
            <div className="kpi" style={{ gridColumn: "span 2" }}>
              <div className="l" style={{ marginTop: 0 }}>
                {reach.availability.reason}
              </div>
            </div>
          )}
          {revenue.availability.available ? (
            <>
              <div className="kpi">
                <div className="n">
                  {num(Math.round(revenue.klaviyoAttributed))} <small>JOD</small>
                </div>
                <div className="l">Revenue attributed to Klaviyo</div>
              </div>
              <div className="kpi">
                {revenue.sharePct === null ? (
                  <>
                    <div className="n">—</div>
                    <div className="l">
                      Share of all sales <b>(no sales recorded)</b>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="n">
                      {revenue.sharePct.toFixed(1)}
                      <small>%</small>
                    </div>
                    <div className="l">
                      Share of all sales <b>({num(Math.round(revenue.allChannels))} JOD total)</b>
                      {revenue.shareIsPartial ? " — to yesterday" : ""}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="kpi">
                <div className="n">
                  {num(Math.round(revenue.allChannels))} <small>JOD</small>
                </div>
                <div className="l">Total sales, all channels</div>
              </div>
              <div className="kpi">
                <div className="l" style={{ marginTop: 0 }}>
                  {revenue.availability.reason}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Revenue from customers marketing ACQUIRED. Deliberately its own
            block, below attributed revenue and never added to it: the two
            answer different questions and summing them would double-count
            every order that is both. */}
        {acquisition.availability.available ? (
          <>
            <h3 style={{ marginTop: "6mm" }}>Revenue from customers marketing brought in</h3>

            {/* Zeid's first question about a figure that appears to have risen
                17 points will be why. It leads the section rather than
                footnoting it, because a caveat read after the number has
                already been challenged is worth nothing. */}
            {acquisition.comparable.spansBasisChange &&
            acquisition.comparable.thisPeriodPct !== null &&
            acquisition.comparable.yearAgoPct !== null ? (
              <p className="caption" style={{ marginBottom: "3mm" }}>
                <b>Read the like-for-like comparison, not the raw one.</b> Against the same month
                last year this figure appears to rise from{" "}
                {pct(acquisition.comparable.yearAgoRawPct!)} to {pct(acquisition.sharePct!)}, but
                roughly a third of that is a change in measurement rather than in the business:
                after 27 February 2026 the till began recording a customer on every in-store
                order, so sales that previously could not be traced to anyone now can. Comparing
                only the traceable portion at both ends, the real movement is{" "}
                <b>
                  {pct(acquisition.comparable.yearAgoPct)} to{" "}
                  {pct(acquisition.comparable.thisPeriodPct)}
                </b>
                . That is the number to rely on.
              </p>
            ) : null}

            <div className="kpis">
              <div className="kpi">
                <div className="n">
                  {acquisition.sharePct === null ? "—" : pct(acquisition.sharePct)}
                </div>
                <div className="l">
                  Of all sales this month
                  {acquisition.comparable.thisPeriodPct !== null &&
                  acquisition.comparable.spansBasisChange
                    ? ` — like-for-like ${pct(acquisition.comparable.thisPeriodPct)}`
                    : ""}
                </div>
              </div>
              <div className="kpi">
                <div className="n">
                  {num(Math.round(acquisition.onlineAcquired))} <small>JOD</small>
                </div>
                <div className="l">
                  From customers first acquired through the app or the website
                </div>
              </div>
              <div className="kpi">
                <div className="n">
                  {acquisition.coveragePct === null ? "—" : pct(acquisition.coveragePct)}
                </div>
                <div className="l">Of sales could be traced to an acquisition channel</div>
              </div>
            </div>
            <p className="caption">
              This counts revenue from <b>customers marketing brought in</b>, wherever they now
              buy — including orders they later placed by phone or in store. It is not a claim
              that marketing caused those sales: a customer first acquired in store in 2020 who
              has bought online ever since counts as in-store here. It needs no attribution
              modelling, only the channel each customer first arrived through, which is why it is
              reported separately from the attributed-revenue figure above and must never be added
              to it. The total it divides by excludes staff and house accounts, so it is slightly
              below the all-channels sales figure shown earlier.{" "}
              {acquisition.coveragePct !== null && acquisition.coveragePct < 99.5 ? (
                <>
                  The remaining {pct(100 - acquisition.coveragePct)} is orders with no customer
                  attached, mostly in store, which can never carry an acquisition channel — so the
                  figure above is a floor rather than a total.
                </>
              ) : (
                <>
                  Nearly every order this month carried an identified customer, so little revenue
                  is left untraceable. Earlier periods have lower coverage and are not directly
                  comparable.
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <h3 style={{ marginTop: "6mm" }}>Revenue from customers marketing brought in</h3>
            <p className="caption">{acquisition.availability.reason}</p>
          </>
        )}

        <p className="caption">
          {reach.availability.available ? (
            <>
              Reach counts people, not messages. Someone who received both an email and a push is
              counted once in the total, so the total is smaller than the three channels added
              together — that is expected, not an error.{" "}
            </>
          ) : null}
          {revenue.availability.available ? (
            <>
              Attributed revenue is counted on the date the order was placed; the campaign and flow
              tables below are counted on the date each message was sent, so the two are not
              directly comparable.
            </>
          ) : (
            <>
              Total sales covers every channel, including POS and Draft Orders, and is counted on
              the date each order was placed. It is not an online-only figure.{" "}
              {attributionLimitNote(SUB_CHANNELS)}
            </>
          )}
        </p>
      </section>

      <section>
        <div className="sec">
          <span className="eyebrow">Email campaigns</span>
        </div>
        <Guard availability={campaigns.availability}>
          <table className="w30">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Sent</th>
                <th>Sent on</th>
                <th>Opened</th>
                <th>
                  Open
                  <br />
                  rate
                </th>
                <th>Clicked</th>
                <th>
                  Click
                  <br />
                  rate
                </th>
                <th>Orders</th>
                <th>
                  Revenue
                  <br />
                  JOD
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.rows.map((c) => (
                <tr key={c.id}>
                  <td className="name" title={c.name}>
                    {c.name}
                  </td>
                  <td>{num(c.sent)}</td>
                  <td>{day(c.sent_on)}</td>
                  <td>{num(c.opened)}</td>
                  <td>{pct(c.open_rate * 100)}</td>
                  <td>{num(c.clicked)}</td>
                  <td>{pct(c.click_rate * 100)}</td>
                  <td>{num(c.orders)}</td>
                  <td>{num(Math.round(Number(c.revenue_jod)))}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Total</td>
                <td>{num(campaignTotals.sent)}</td>
                <td />
                <td>{num(campaignTotals.opened)}</td>
                <td>{pct(rateOf(campaignTotals.opened, campaignTotals.delivered))}</td>
                <td>{num(campaignTotals.clicked)}</td>
                <td>{pct(rateOf(campaignTotals.clicked, campaignTotals.delivered))}</td>
                <td>{num(campaignTotals.orders)}</td>
                <td>{num(Math.round(campaignTotals.revenue))}</td>
              </tr>
            </tbody>
          </table>
          <p className="caption">
            <b>Open rate is the weakest column here and should not carry a decision.</b> Apple
            Mail pre-fetches images and marks a message opened whether or not anyone read it, so
            opens are inflated by an unknown amount and cannot be compared with earlier months —
            the inflation grows as Apple&rsquo;s share of the list grows. Across our own{" "}
            {ENGAGEMENT_SIGNAL.campaigns} campaigns, click rate predicts revenue roughly four
            times better than open rate ({ENGAGEMENT_SIGNAL.clickVsRevenue} against{" "}
            {ENGAGEMENT_SIGNAL.openVsRevenue}). Judge a campaign on clicks, orders and revenue.
            Open and click rates are otherwise Klaviyo&rsquo;s own, measured against messages
            delivered rather than sent.
            {campaigns.excludedTests.length ? (
              <>
                {" "}
                {campaigns.excludedTests.length === 1
                  ? "One send is"
                  : num(campaigns.excludedTests.length) + " sends are"}{" "}
                excluded as {campaigns.excludedTests.length === 1 ? "a test" : "tests"}, below{" "}
                {MIN_CAMPAIGN_RECIPIENTS} recipients:{" "}
                {campaigns.excludedTests
                  .map((c) => c.name + " (" + num(c.sent) + ")")
                  .join(", ")}
                . A rate measured over a handful of recipients is noise wearing the authority of a
                percentage, and beside real campaigns it reads as the best send of the month.
              </>
            ) : null}
          </p>
        </Guard>
      </section>

      <section>
        <div className="sec">
          <span className="eyebrow">Flows</span>
        </div>
        <Guard availability={flows.availability}>
          <table className="w40">
            <thead>
              <tr>
                <th>Flow</th>
                <th>Recipients</th>
                <th>Open rate</th>
                <th>Conv. rate</th>
                <th>Revenue JOD</th>
              </tr>
            </thead>
            <tbody>
              {flows.rollup.top.map((f) => (
                <tr key={f.name}>
                  <td className="name" title={f.name}>
                    {f.name}
                  </td>
                  <td>{num(f.recipients)}</td>
                  <td>{pct(rateOf(f.opened, f.delivered))}</td>
                  <td>{pct(rateOf(f.conversions, f.delivered))}</td>
                  <td>{num(Math.round(f.revenue))}</td>
                </tr>
              ))}
              {flows.rollup.other ? (
                <tr>
                  <td className="name sub">{flows.rollup.other.name}</td>
                  <td className="sub">{num(flows.rollup.other.recipients)}</td>
                  <td className="sub">
                    {pct(rateOf(flows.rollup.other.opened, flows.rollup.other.delivered))}
                  </td>
                  <td className="sub">
                    {pct(rateOf(flows.rollup.other.conversions, flows.rollup.other.delivered))}
                  </td>
                  <td className="sub">{num(Math.round(flows.rollup.other.revenue))}</td>
                </tr>
              ) : null}
              <tr className="total">
                <td>All live flows</td>
                <td>{num(flows.rollup.total.recipients)}</td>
                <td>{pct(rateOf(flows.rollup.total.opened, flows.rollup.total.delivered))}</td>
                <td>{pct(rateOf(flows.rollup.total.conversions, flows.rollup.total.delivered))}</td>
                <td>{num(Math.round(flows.rollup.total.revenue))}</td>
              </tr>
            </tbody>
          </table>
          <p className="caption">
            Only flows that sent at least one message in the period are listed. Flows that exist but
            did not send are left out entirely rather than shown as zero.
          </p>
        </Guard>
      </section>

      <div className="cols cols-32">
        <section>
          <div className="sec">
            <span className="eyebrow">Push notifications</span>
          </div>
          <Guard availability={push.availability}>
            <table className="w46">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Sent</th>
                  <th>Opened</th>
                  <th>
                    Open
                    <br />
                    rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {push.rollup.top.map((p) => (
                  <tr key={p.name}>
                    <td className="name" title={p.name}>
                      {p.name}
                    </td>
                    <td>{num(p.sent)}</td>
                    <td>{num(p.opened)}</td>
                    <td>{pct(rateOf(p.opened, p.delivered))}</td>
                  </tr>
                ))}
                {push.rollup.other ? (
                  <tr>
                    <td className="name sub">{push.rollup.other.name}</td>
                    <td className="sub">{num(push.rollup.other.sent)}</td>
                    <td className="sub">{num(push.rollup.other.opened)}</td>
                    <td className="sub">
                      {pct(rateOf(push.rollup.other.opened, push.rollup.other.delivered))}
                    </td>
                  </tr>
                ) : null}
                <tr className="total">
                  <td>Total</td>
                  <td>{num(push.rollup.total.sent)}</td>
                  <td>{num(push.rollup.total.opened)}</td>
                  <td>{pct(rateOf(push.rollup.total.opened, push.rollup.total.delivered))}</td>
                </tr>
              </tbody>
            </table>
            <p className="caption">
              Push clicks are not shown because Klaviyo does not measure them. It emits opens and
              bounces for push, and no click event of any kind, so opens are the only push signal
              available to anyone using Klaviyo. This is a closed question, not an outstanding one.
            </p>
          </Guard>
        </section>

        <section>
          <div className="sec">
            <span className="eyebrow">LoyaltyLion</span>
          </div>
          <Guard availability={loyalty.availability}>
            <div className="tiers">
              <div className="tier">
                <div className="t">Blue</div>
                <div className="n">{num(loyalty.latest!.blue_members)}</div>
                {tierDelta(loyalty.latest!.blue_members, loyalty.prior?.blue_members)}
              </div>
              <div className="tier">
                <div className="t">Silver</div>
                <div className="n">{num(loyalty.latest!.silver_members)}</div>
                {tierDelta(loyalty.latest!.silver_members, loyalty.prior?.silver_members)}
              </div>
              <div className="tier gold">
                <div className="t">Gold</div>
                <div className="n">{num(loyalty.latest!.gold_members)}</div>
                {tierDelta(loyalty.latest!.gold_members, loyalty.prior?.gold_members)}
              </div>
              <div className="tier">
                <div className="t">Platinum</div>
                <div className="n">{num(loyalty.latest!.platinum_members)}</div>
                {tierDelta(loyalty.latest!.platinum_members, loyalty.prior?.platinum_members)}
              </div>
            </div>
            <p className="caption">
              Tier counts are a snapshot taken on {day(loyalty.latest!.snapshot_date)}, not an
              average over the month. LoyaltyLion cannot report tier membership historically.
            </p>
          </Guard>

          <div className="facts" style={{ marginTop: "2mm" }}>
            <div className="fact">
              <div className="n">
                {loyalty.latest ? (
                  <>
                    {(Number(loyalty.latest.redemption_rate) * 100).toFixed(1)}
                    <small>%</small>
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div className="l">
                Redemption rate{" "}
                {loyalty.latest ? (
                  <span className="sub">(on {day(loyalty.latest.snapshot_date)})</span>
                ) : null}
              </div>
            </div>
            <div className="fact">
              <div className="n">
                {loyalty.pointsAvailability.available && loyalty.pointsRow ? (
                  <>
                    {(Number(loyalty.pointsRow.points_outstanding) / 1_000_000).toFixed(2)}
                    <small>M pts</small>
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div className="l">
                Points outstanding{" "}
                {loyalty.pointsAvailability.available && loyalty.pointsRow ? (
                  <span className="sub">
                    ({jod(Number(loyalty.pointsRow.points_outstanding) / 100)})
                  </span>
                ) : null}
              </div>
            </div>
            <div className="fact">
              <div className="n">
                {loyalty.birthdayAvailability.available ? num(loyalty.birthdayRewards) : "—"}
              </div>
              <div className="l">
                Birthday rewards{" "}
                {loyalty.birthdayAvailability.available ? (
                  "issued"
                ) : (
                  <span className="sub">not collected</span>
                )}
              </div>
            </div>
          </div>
          <p className="caption">
            Redemption rate and points outstanding are balances read on a single day, not totals for
            the month.
          </p>
        </section>
      </div>

      <div className="cols cols-32">
        <section>
          <div className="sec">
            <span className="eyebrow">Activations</span>
          </div>
          {activations.length ? (
            <ul className="acts">
              {activations.map((a) => {
                const done = a.status === "done";
                return (
                  <li key={a.id}>
                    <span className={done ? "mark done" : "mark"} />
                    <span>
                      {a.title} <span className="date">· {day(a.date)}</span>
                    </span>
                    <span className={done ? "status" : "status no"}>
                      {done ? "Done" : "Not done"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="unavail">No activations were recorded for this period.</p>
          )}
        </section>

        <section>
          <div className="sec">
            <span className="eyebrow">Next month</span>
          </div>
          {narrative.nextMonthBullets.length ? (
            <div className="next stack">
              {narrative.nextMonthBullets.map((b) => {
                const [title, ...rest] = b.split(/\s+[—–-]\s+/);
                return (
                  <div key={b}>
                    <b>{title}</b>
                    {rest.join(" — ")}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="unavail">Not yet written.</p>
          )}
        </section>
      </div>

      <footer className="foot">
        <span>Fyxx · Al-Kasra for Trade and Marketing · Prepared for Zeid Salfiti</span>
        <span>
          Sources: Klaviyo, LoyaltyLion, Shopify · Generated from the Fyxx Marketing dashboard
        </span>
      </footer>
    </div>
  );
}
