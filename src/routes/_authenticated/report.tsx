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
  exVat,
  VAT_FOOTER_NOTE,
  MIN_CAMPAIGN_RECIPIENTS,
  type Availability,
  type Narrative,
  type ReportData,
} from "@/lib/report";
import { ammanNow, iso, type DateRange } from "@/lib/ranges";
import { useDateRange } from "@/context/date-range-context";
import { num, pct, jod } from "@/lib/format";
import { ENGAGEMENT_SIGNAL } from "@/lib/engagement";
import "@/styles/report.css";

export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({
    meta: [
      { title: "Report · Fyxx Marketing" },
      { name: "description", content: "Printable monthly executive report built from live data." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportPage,
});

const day = (d: string) => format(parseISO(d), "d MMM");
const rateOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
/** Empty cell. Not a dash, which reads as a minus sign in a column of numbers. */
const NONE = "n/a";

/**
 * Whether an activation counts as done.
 *
 * The Activations form offers "Planned", "Done" and "Not done", and the column
 * default is "Planned" — all capitalised. This comparison was against the
 * lowercase "done", so an activation marked Done on the Activations page would
 * have printed as "Not done" on the report, with the tick unfilled. Nothing
 * caught it because the table was empty, so the wrong branch had never run.
 *
 * Compared case-insensitively rather than against the exact string, because the
 * two spellings live in different files and will drift apart again.
 */
const isDone = (status: string) => status.trim().toLowerCase() === "done";

/**
 * "1 to 30 September 2026", not "1 Sep to 30 September 2026".
 *
 * The month and year are printed once, on whichever end carries them. Inside
 * one month only the two day numbers differ, and repeating the month there
 * made the line read like two separate dates.
 */
function periodLine(from: string, to: string): string {
  const a = parseISO(from);
  const b = parseISO(to);
  const sameMonth = format(a, "yyyy-MM") === format(b, "yyyy-MM");
  if (sameMonth) return `${format(a, "d")} to ${format(b, "d MMMM yyyy")}`;
  const sameYear = format(a, "yyyy") === format(b, "yyyy");
  return `${format(a, sameYear ? "d MMMM" : "d MMMM yyyy")} to ${format(b, "d MMMM yyyy")}`;
}

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

  /**
   * The wording being edited, held here rather than inside the editor.
   *
   * The preview below renders from THIS, not from what is stored, so typing
   * shows up on the page immediately and nothing is written until Save report
   * is pressed. Previously the preview rendered the saved value, so the only
   * way to see a change was to save it, which made Save the preview button and
   * left no way to look at a sentence before committing it.
   */
  const [draft, setDraft] = useState<Omit<Narrative, "id"> | null>(null);
  useEffect(() => {
    if (data) {
      setDraft({
        monthHighlight: data.narrative.monthHighlight,
        nextMonthBullets: data.narrative.nextMonthBullets,
      });
    }
  }, [data?.narrative]);

  return (
    <div className="space-y-6">
      <div className="no-print space-y-6">
        <PageHeader
          title="Report"
          subtitle="The monthly page sent to Zeid. Pick the month below; the date range above does not apply. Print to PDF at A4, no scaling, background graphics on."
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
        {data && draft ? (
          <NarrativeEditor range={range} draft={draft} onChange={setDraft} />
        ) : null}
      </div>

      {isLoading ? (
        <p className="no-print text-sm text-muted-foreground">Building the report…</p>
      ) : null}
      {error ? (
        <p className="no-print text-sm text-destructive">
          The report could not be built: {(error as Error).message}
        </p>
      ) : null}
      {data ? <ReportPage1 data={data} narrative={draft ?? data.narrative} /> : null}
    </div>
  );
}

function NarrativeEditor({
  range,
  draft,
  onChange,
}: {
  range: DateRange;
  draft: Omit<Narrative, "id">;
  onChange: (n: Omit<Narrative, "id">) => void;
}) {
  const qc = useQueryClient();
  const bulletText = draft.nextMonthBullets.join("\n");

  const save = useMutation({
    mutationFn: () =>
      saveNarrative(range, {
        monthHighlight: draft.monthHighlight.trim(),
        nextMonthBullets: draft.nextMonthBullets.map((b) => b.trim()).filter(Boolean),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report"] }),
  });

  return (
    <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block font-medium">Month highlight</span>
        <Textarea
          rows={4}
          value={draft.monthHighlight}
          onChange={(e) => onChange({ ...draft, monthHighlight: e.target.value })}
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Next month</span>
        <span className="mb-1 block text-xs text-muted-foreground">
          One per line. The first few words become the bold lead-in.
        </span>
        <Textarea
          rows={4}
          value={bulletText}
          onChange={(e) => onChange({ ...draft, nextMonthBullets: e.target.value.split("\n") })}
        />
      </label>
      <div className="md:col-span-2 flex items-center gap-3">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save report"}
        </Button>
        <span className="text-xs text-muted-foreground">
          The page below updates as you type and is not saved until you press Save report.
        </span>
        {save.isError ? (
          <span className="text-xs text-destructive">{(save.error as Error).message}</span>
        ) : null}
        {save.isSuccess ? <span className="text-xs text-muted-foreground">Saved.</span> : null}
      </div>
    </div>
  );
}

export function ReportPage1({
  data,
  narrative,
}: {
  data: ReportData;
  /** The wording to render, which may be an unsaved draft. */
  narrative?: Omit<Narrative, "id">;
}) {
  const { range, reach, campaigns, flows, push, loyalty, activations, revenue, sends, notices } =
    data;
  const words = narrative ?? data.narrative;
  const bullets = words.nextMonthBullets.map((b) => b.trim()).filter(Boolean);

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
            Period <b>{periodLine(range.from, range.to)}</b>
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

      {words.monthHighlight ? (
        <section>
          <div className="sec">
            <span className="eyebrow">Month highlight</span>
          </div>
          <p className="highlight">{words.monthHighlight}</p>
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
            <div className="kpi">
              <div className="n">{num(reach.totalUnique)}</div>
              <div className="l">People reached, each counted once</div>
            </div>
          ) : (
            <div className="kpi">
              <div className="l" style={{ marginTop: 0 }}>
                {reach.availability.reason}
              </div>
            </div>
          )}
          {/* Summed from the table rows below, not from the reach table, so
              this tile and the tables cannot disagree. */}
          <div className="kpi">
            <div className="n">
              {num(sends.total)}{" "}
              <small>
                · {num(sends.campaigns)} · {num(sends.flows)} · {num(sends.push)}
              </small>
            </div>
            <div className="l">Messages sent · Campaigns · Flows · Push</div>
          </div>
          {revenue.availability.available ? (
            <>
              <div className="kpi">
                <div className="n">
                  {num(Math.round(exVat(revenue.klaviyoAttributed)))} <small>JOD</small>
                </div>
                <div className="l">Revenue attributed to Klaviyo</div>
              </div>
              <div className="kpi">
                {revenue.sharePct === null ? (
                  <>
                    <div className="n">0</div>
                    <div className="l">
                      Share of online revenue <b>(no online sales recorded)</b>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="n">
                      {revenue.sharePct.toFixed(1)}
                      <small>%</small>
                    </div>
                    {/* Online means Mobile App plus Website. Dividing by every
                        channel understated this badly, because draft orders and
                        POS are most of turnover and Klaviyo cannot influence a
                        till sale. */}
                    <div className="l">
                      Share of online revenue{" "}
                      <b>({num(Math.round(exVat(revenue.onlineChannels)))} JOD total)</b>
                      {revenue.shareIsPartial ? ", to yesterday" : ""}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="kpi">
                <div className="n">
                  {num(Math.round(exVat(revenue.allChannels)))} <small>JOD</small>
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

        <p className="caption">
          People are counted once however many messages they received, so the first figure is
          smaller than the second; attributed revenue is counted on the date the order was placed,
          the tables below on the date each message was sent.
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
              {campaigns.rollup.top.map((c) => (
                <tr key={c.name + c.sentOn}>
                  <td className="name" title={c.name}>
                    {c.name}
                  </td>
                  <td>{num(c.sent)}</td>
                  <td>{c.sentOn ? day(c.sentOn) : ""}</td>
                  <td>{num(c.opened)}</td>
                  <td>{pct(rateOf(c.opened, c.delivered))}</td>
                  <td>{num(c.clicked)}</td>
                  <td>{pct(rateOf(c.clicked, c.delivered))}</td>
                  <td>{num(c.orders)}</td>
                  <td>{num(Math.round(exVat(c.revenue)))}</td>
                </tr>
              ))}
              {campaigns.rollup.other ? (
                <tr>
                  <td className="name sub">{campaigns.rollup.other.name}</td>
                  <td className="sub">{num(campaigns.rollup.other.sent)}</td>
                  <td className="sub" />
                  <td className="sub">{num(campaigns.rollup.other.opened)}</td>
                  <td className="sub">
                    {pct(rateOf(campaigns.rollup.other.opened, campaigns.rollup.other.delivered))}
                  </td>
                  <td className="sub">{num(campaigns.rollup.other.clicked)}</td>
                  <td className="sub">
                    {pct(rateOf(campaigns.rollup.other.clicked, campaigns.rollup.other.delivered))}
                  </td>
                  <td className="sub">{num(campaigns.rollup.other.orders)}</td>
                  <td className="sub">{num(Math.round(exVat(campaigns.rollup.other.revenue)))}</td>
                </tr>
              ) : null}
              <tr className="total">
                <td>{campaigns.rollup.total.name}</td>
                <td>{num(campaignTotals.sent)}</td>
                <td />
                <td>{num(campaignTotals.opened)}</td>
                <td>{pct(rateOf(campaignTotals.opened, campaignTotals.delivered))}</td>
                <td>{num(campaignTotals.clicked)}</td>
                <td>{pct(rateOf(campaignTotals.clicked, campaignTotals.delivered))}</td>
                <td>{num(campaignTotals.orders)}</td>
                <td>{num(Math.round(exVat(campaignTotals.revenue)))}</td>
              </tr>
            </tbody>
          </table>
          <p className="caption">
            Judge a campaign on clicks, orders and revenue: Apple Mail marks a message opened
            without anyone reading it, and across our own {ENGAGEMENT_SIGNAL.campaigns} campaigns
            click rate predicts revenue about four times better than open rate (
            {ENGAGEMENT_SIGNAL.clickVsRevenue} against {ENGAGEMENT_SIGNAL.openVsRevenue}).
            {campaigns.excludedTests.length ? (
              <>
                {" "}
                {campaigns.excludedTests.length === 1
                  ? "One send is"
                  : num(campaigns.excludedTests.length) + " sends are"}{" "}
                excluded as {campaigns.excludedTests.length === 1 ? "a test" : "tests"}, below{" "}
                {MIN_CAMPAIGN_RECIPIENTS} recipients:{" "}
                {campaigns.excludedTests.map((c) => c.name + " (" + num(c.sent) + ")").join(", ")}.
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
                  <td>{num(Math.round(exVat(f.revenue)))}</td>
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
                  <td className="sub">{num(Math.round(exVat(flows.rollup.other.revenue)))}</td>
                </tr>
              ) : null}
              <tr className="total">
                <td>{flows.rollup.total.name}</td>
                <td>{num(flows.rollup.total.recipients)}</td>
                <td>{pct(rateOf(flows.rollup.total.opened, flows.rollup.total.delivered))}</td>
                <td>{pct(rateOf(flows.rollup.total.conversions, flows.rollup.total.delivered))}</td>
                <td>{num(Math.round(exVat(flows.rollup.total.revenue)))}</td>
              </tr>
            </tbody>
          </table>
          <p className="caption">
            Email flow messages only, and only flows that sent: push sent by a flow is counted in
            the push table below, not here.
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
                {push.rollup.types.map((p) => (
                  <tr key={p.name}>
                    <td className="name">{p.name}</td>
                    <td>{num(p.sent)}</td>
                    <td>{num(p.opened)}</td>
                    <td>{pct(rateOf(p.opened, p.delivered))}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>{push.rollup.total.name}</td>
                  <td>{num(push.rollup.total.sent)}</td>
                  <td>{num(push.rollup.total.opened)}</td>
                  <td>{pct(rateOf(push.rollup.total.opened, push.rollup.total.delivered))}</td>
                </tr>
              </tbody>
            </table>
            <p className="caption">
              Opens are the only push signal Klaviyo measures; it emits no click event for push at
              all.
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
          </Guard>

          <div className="facts" style={{ marginTop: "2mm" }}>
            <div className="fact">
              <div className="n">
                {loyalty.latest ? (
                  <>
                    {/* redemption_rate is stored as a PERCENTAGE, not a
                        fraction. Proved from the same row: 20 Oct 2026 stored
                        0.15, with 18 redemptions against 12,081 members, which
                        is 0.149 per cent. Multiplying by 100 here turned 0.10
                        into "10.0%" on the report while the Loyalty page
                        correctly showed 0.1%, and the two pages contradicted
                        each other for weeks. */}
                    {Number(loyalty.latest.redemption_rate).toFixed(2)}
                    <small>%</small>
                  </>
                ) : (
                  NONE
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
                  NONE
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
                {loyalty.birthdayAvailability.available ? num(loyalty.birthdayRewards) : NONE}
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
            Tiers, redemption rate and points outstanding are balances read on one day, not totals
            for the month; LoyaltyLion keeps no history for them.
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
                const done = isDone(a.status);
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
          {bullets.length ? (
            <div className="next stack">
              {bullets.map((b) => {
                // The lead-in is whatever comes before the first colon, and
                // failing that the first three words. The old version split on
                // a dash, which is why every line had to be written with one.
                const colon = b.indexOf(":");
                const [title, rest] =
                  colon > 0
                    ? [b.slice(0, colon + 1), b.slice(colon + 1)]
                    : [b.split(/\s+/).slice(0, 3).join(" "), " " + b.split(/\s+/).slice(3).join(" ")];
                return (
                  <div key={b}>
                    <b>{title}</b>
                    {rest}
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
        <span>
          Fyxx · Al-Kasra for Trade and Marketing · Prepared for Zeid Salfiti · {VAT_FOOTER_NOTE}
        </span>
        <span>
          Sources: Klaviyo, LoyaltyLion, Shopify · Generated from the Fyxx Marketing dashboard
        </span>
      </footer>
    </div>
  );
}
