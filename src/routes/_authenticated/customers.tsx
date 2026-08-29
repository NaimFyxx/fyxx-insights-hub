import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel, StatTile, EmptyState, QueryFailed } from "@/components/fyxx/primitives";
import { Table, Th, Td } from "@/components/fyxx/data-table";
import { Input } from "@/components/ui/input";
import { fetchDailySales } from "@/lib/queries";
import {
  fetchCustomers,
  summarise,
  cohorts,
  byAcquisitionChannel,
  byEnrolment,
  posCapture,
  POS_CAPTURE_COMPARABLE_UNTIL,
  ENROLMENT_WITHIN_CUSTOMER,
  busyDays,
  BUSY_DAY_ORDERS,
  BUSY_DAY_IDENTIFICATION,
  mixVersusDecay,
  channelDecay,
  lapsed,
  LAPSED_SINCE,
} from "@/lib/customers";
import { ammanToday } from "@/lib/ranges";
import { useDateRange } from "@/context/date-range-context";
import { jod, num, pct } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Fyxx Marketing" },
      { name: "description", content: "Customer population, retention and reachability." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CustomersPage,
});

function CustomersPage() {
  const [windowDays, setWindowDays] = useState(90);
  const today = ammanToday();
  // This page is deliberately all-time, so it ignores the date range. It must
  // still honour Refresh: without refreshKey in the key the button was inert
  // here, which is indistinguishable from a page that simply never updates.
  const { refreshKey } = useDateRange();

  const q = useQuery({ queryKey: ["customers", refreshKey], queryFn: fetchCustomers });
  // POS capture needs order counts as the denominator, so the whole history.
  const sq = useQuery({
    queryKey: ["pos-capture-sales", refreshKey],
    queryFn: () => fetchDailySales({ from: "2019-01-01", to: POS_CAPTURE_COMPARABLE_UNTIL }),
  });
  const enrol = useMemo(() => (q.data ? byEnrolment(q.data, today, 90) : []), [q.data, today]);
  const busy = useMemo(() => (sq.data ? busyDays(sq.data) : []), [sq.data]);
  const capture = useMemo(
    () => (q.data && sq.data ? posCapture(sq.data, q.data) : []),
    [q.data, sq.data],
  );
  const s = useMemo(
    () => (q.data ? summarise(q.data, today, windowDays) : null),
    [q.data, today, windowDays],
  );
  const co = useMemo(() => (q.data ? cohorts(q.data, today, 90) : []), [q.data, today]);
  const acq = useMemo(
    () => (q.data ? byAcquisitionChannel(q.data, today, 90) : []),
    [q.data, today],
  );
  const mix = useMemo(() => (q.data ? mixVersusDecay(q.data, today, 90) : []), [q.data, today]);
  const decay = useMemo(() => (q.data ? channelDecay(q.data, today, 90) : []), [q.data, today]);
  const lap = useMemo(() => (q.data ? lapsed(q.data) : null), [q.data]);

  if (q.isError || sq.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Customers" />
        <QueryFailed error={q.error ?? sq.error} />
      </div>
    );
  }

  if (q.isLoading || !s) {
    return (
      <div className="space-y-6">
        <PageHeader title="Customers" />
        <EmptyState>Loading…</EmptyState>
      </div>
    );
  }

  // The stabilisation is the CURRENT state; the decline is history. Both are
  // shown, because a trend line alone reads as "still falling".
  const withRate = co.filter((c) => c.repeatPct !== null);
  const recent = withRate.slice(-3);
  const flat =
    recent.length === 3 &&
    Math.max(...recent.map((c) => c.repeatPct!)) - Math.min(...recent.map((c) => c.repeatPct!)) < 3;
  const peak = withRate.reduce((a, c) => (c.repeatPct! > a.repeatPct! ? c : a), withRate[0]!);
  const ranked = acq
    .filter((r) => r.repeatPct !== null)
    .sort((a, b) => b.repeatPct! - a.repeatPct!);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Customers"
        subtitle={`${num(s.totalCustomers)} customers, ${num(s.buyers)} of whom have ordered. ${num(s.houseExcluded.count)} house and staff accounts excluded, holding ${num(s.houseExcluded.orders)} lifetime orders.`}
      />

      {/* The date presets sit above this page and do nothing to it. Correct —
          every figure here is lifetime — but silence reads as a broken filter. */}
      <p className="border-l-2 border-border bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
        Every figure on this page is <b>lifetime, across all channels</b>. The date range
        and channel controls do not apply here and are not being ignored by mistake.
      </p>

      {/* The three that matter, before any chart. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <StatTile
          label="Bought once, never returned"
          value={pct(s.oneAndDone.pct)}
          note={`${num(s.oneAndDone.count)} of ${num(s.oneAndDone.of)} buyers whose first order was over 90 days ago`}
        />
        <StatTile
          label="Revenue from the top 1%"
          value={pct(s.concentration.top1)}
          note={`median customer ${jod(s.concentration.median)}, mean ${jod(s.concentration.mean)}`}
        />
        <StatTile
          label="Revenue we cannot reach"
          value={pct(s.reach.unreachableRevenuePct)}
          note={`${num(s.reach.unreachable)} buyers on neither email nor SMS, ${jod(s.reach.unreachableRevenue)}`}
        />
      </div>

      {/* Placed directly under the headline tiles because it is the only
          panel on this page that names a specific action for a specific list
          of people, rather than describing a trend. */}
      {lap ? (
        <Panel title="Lapsed customers who can be emailed today">
          <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
            Bought at least once, and nothing since {LAPSED_SINCE}. Separated from
            customers who have never ordered at all — a bigger group, but a different
            problem: these people already chose us once.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <StatTile
              label="Lapsed customers"
              value={num(lap.total.customers)}
              note={`${jod(lap.total.revenue)} lifetime revenue between them`}
            />
            <StatTile
              label="Contactable now"
              value={num(lap.contactable.customers)}
              note={`Subscribed to email. No opt-in step, ${jod(lap.contactable.revenue)} lifetime`}
            />
            <StatTile
              label="Start here"
              value={num(lap.priority.customers)}
              note={`Subscribed, 1,000+ JOD, last bought in ${lap.mostRecentYear ?? "—"} — ${jod(lap.priority.revenue)}`}
            />
          </div>

          {/* The three that CANNOT be mailed, stated next to the one that can.
              Without them the headline reads as though the whole lapsed group
              is addressable, and it is not. NOT_SUBSCRIBED and UNSUBSCRIBED
              are separated because only one of them has ever been asked. */}
          <p className="mt-4 text-xs text-muted-foreground">
            Not contactable by email: {num(lap.neverAsked.customers)} have an address but
            have never opted in, {num(lap.unsubscribed.customers)} have unsubscribed, and{" "}
            {num(lap.noEmail)} have no address at all. Only the subscribed group above can
            be emailed without asking first.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <p className="label-xs mb-2 text-muted-foreground">
                Contactable, by lifetime value
              </p>
              <Table>
                <thead>
                  <tr>
                    <Th>Lifetime value</Th>
                    <Th align="right">Customers</Th>
                    <Th align="right">Revenue</Th>
                    <Th align="right">Avg orders</Th>
                  </tr>
                </thead>
                <tbody>
                  {lap.byValue.map((b) => (
                    <tr key={b.band}>
                      <Td>{b.band}</Td>
                      <Td align="right">{num(b.customers)}</Td>
                      <Td align="right">{jod(b.revenue)}</Td>
                      <Td align="right">{b.avgOrders.toFixed(1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <div>
              <p className="label-xs mb-2 text-muted-foreground">
                Contactable, by the year they stopped
              </p>
              <Table>
                <thead>
                  <tr>
                    <Th>Last ordered</Th>
                    <Th align="right">Customers</Th>
                    <Th align="right">Revenue</Th>
                    <Th align="right">Avg orders</Th>
                  </tr>
                </thead>
                <tbody>
                  {lap.byYear.map((y) => (
                    <tr key={y.year}>
                      <Td>{y.year}</Td>
                      <Td align="right">{num(y.customers)}</Td>
                      <Td align="right">{jod(y.revenue)}</Td>
                      <Td align="right">{y.avgOrders.toFixed(1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>

          <p className="mt-4 border-l-2 border-foreground bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
            Both tables count the SAME {num(lap.contactable.customers)} people, split two
            ways — do not add them together. Value is lifetime, not recent, so a large
            figure can belong to someone who stopped years ago; that is why the year
            table sits beside it rather than below it.
          </p>
        </Panel>
      ) : null}

      <Panel title="Repeat rate by acquisition year">
        {/* Age-limited so cohorts are comparable. The raw "ever repeated"
            version runs 86.5% to 39.4% and reads as collapse; almost all of
            that is older cohorts simply having had more years. */}
        <div className="mb-4 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="label-xs text-muted-foreground">Then</p>
            <p className="display-num text-2xl">
              {peak?.repeatPct != null ? pct(peak.repeatPct) : "—"}{" "}
              <span className="text-sm text-muted-foreground">in {peak?.year}</span>
            </p>
          </div>
          <div>
            <p className="label-xs text-muted-foreground">Now</p>
            <p className="display-num text-2xl">
              {recent.at(-1)?.repeatPct != null ? pct(recent.at(-1)!.repeatPct!) : "—"}{" "}
              <span className="text-sm text-muted-foreground">
                {flat ? `flat across ${recent.map((c) => c.year).join(", ")}` : "latest cohort"}
              </span>
            </p>
          </div>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Acquired in</Th>
              <Th align="right">Customers</Th>
              <Th align="right">Had 90 days</Th>
              <Th align="right">Repeated within 90 days</Th>
            </tr>
          </thead>
          <tbody>
            {co.map((c) => (
              <tr key={c.year}>
                <Td>{c.year}</Td>
                <Td align="right">{num(c.acquired)}</Td>
                <Td align="right">{num(c.eligible)}</Td>
                <Td align="right">{c.repeatPct === null ? "—" : pct(c.repeatPct)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Only customers whose first order was at least 90 days ago are counted, so every year is
          measured over the same window. A cohort with fewer than 90 days of history shows a dash
          rather than a partial rate.
        </p>
        {flat ? (
          <p className="mt-2 border-l-2 border-destructive/40 pl-4 text-xs">
            <b>The flat section is not a recovery.</b> The last three cohorts sit within three
            points of each other, but that is two opposing forces cancelling. App share of new
            customers recovered to 48.4% in 2026, which alone predicts a repeat rate of 39.9% — the
            highest since 2020. The actual rate was 33.7%, a 6.2 point shortfall and the widest
            recorded. The line held level because a better acquisition mix offset channels that kept
            retaining worse. If mix recovery stalls, it resumes falling.
          </p>
        ) : null}
      </Panel>

      <Panel title="Which channel acquires the customers worth having">
        {/* First-class, not a footnote: this is the strongest available
            argument for where to put effort. */}
        <Table>
          <thead>
            <tr>
              <Th>Acquired via</Th>
              <Th align="right">Customers</Th>
              <Th align="right">Repeat within 90 days</Th>
              <Th align="right">Lifetime orders</Th>
              <Th align="right">Median revenue</Th>
            </tr>
          </thead>
          <tbody>
            {acq
              .slice()
              .sort((a, b) => (b.repeatPct ?? 0) - (a.repeatPct ?? 0))
              .map((r) => (
                <tr key={r.channel}>
                  <Td>{r.channel}</Td>
                  <Td align="right">{num(r.customers)}</Td>
                  <Td align="right">{r.repeatPct === null ? "—" : pct(r.repeatPct)}</Td>
                  <Td align="right">{r.avgOrders.toFixed(1)}</Td>
                  <Td align="right">{jod(r.medianRevenue)}</Td>
                </tr>
              ))}
          </tbody>
        </Table>
        {best && worst && best !== worst ? (
          <p className="mt-2 text-sm">
            A customer acquired through <b>{best.channel}</b> repeats{" "}
            <b>{(best.repeatPct! - worst.repeatPct!).toFixed(1)} points</b> more often than one from{" "}
            {worst.channel}, and places{" "}
            {(best.avgOrders / Math.max(0.1, worst.avgOrders)).toFixed(1)}× the lifetime orders.
          </p>
        ) : null}
      </Panel>

      <Panel title="Is it who we acquired, or how well we keep them?">
        {/* The harder finding, given its own panel so the app story cannot
            bury it. Where actual runs below predicted, every channel is
            retaining worse than its own history. */}
        <Table>
          <thead>
            <tr>
              <Th>Cohort</Th>
              <Th align="right">App share of new</Th>
              <Th align="right">Predicted by mix alone</Th>
              <Th align="right">Actual</Th>
              <Th align="right">Gap</Th>
            </tr>
          </thead>
          <tbody>
            {mix.map((m) => (
              <tr key={m.year}>
                <Td>{m.year}</Td>
                <Td align="right">{pct(m.appShare)}</Td>
                <Td align="right">{pct(m.predicted)}</Td>
                <Td align="right">{pct(m.actual)}</Td>
                <Td align="right">
                  <span className={m.gap < 0 ? "text-destructive" : ""}>
                    {m.gap >= 0 ? "+" : ""}
                    {m.gap.toFixed(1)}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Predicted holds every channel at its own all-time repeat rate and varies only the mix, so
          it is what the blended rate would be if channels performed as they always have. A negative
          gap means channels are retaining worse than their own history — that part cannot be fixed
          by changing where customers come from. Indicative rather than exact: the all-time rate for
          the app is dominated by its early years, which flatters the mix explanation in later
          cohorts.
        </p>

        <div className="mt-6">
          <p className="label-xs mb-2 text-muted-foreground">
            Repeat within 90 days, by acquisition channel and cohort
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Channel</Th>
                {(decay[0]?.perYear ?? []).map((p) => (
                  <Th key={p.year} align="right">
                    {p.year}
                  </Th>
                ))}
                <Th align="right">Change</Th>
              </tr>
            </thead>
            <tbody>
              {decay.map((d) => (
                <tr key={d.channel}>
                  <Td>{d.channel}</Td>
                  {d.perYear.map((p) => (
                    <Td key={p.year} align="right">
                      {p.pct === null ? "—" : pct(p.pct)}
                    </Td>
                  ))}
                  <Td align="right">
                    <span className={d.change !== null && d.change < -5 ? "text-destructive" : ""}>
                      {d.change === null
                        ? "—"
                        : `${d.change >= 0 ? "+" : ""}${d.change.toFixed(1)}`}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            A dash is a cohort with fewer than 40 customers in that channel, where one person moves
            the rate by more than a point. The decay is not even: read the Change column to see
            which channel is losing ground and which is holding.
          </p>
        </div>
      </Panel>

      <Panel title="Retention by loyalty enrolment">
        {/* The within-customer result sits ABOVE the cross-sectional table, not
            under it. Someone who reads only the tiles must come away knowing
            the gap is selection rather than effect. */}
        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Same customers, after enrolling"
            value={`${ENROLMENT_WITHIN_CUSTOMER.clean.changePct}%`}
            note={`${num(ENROLMENT_WITHIN_CUSTOMER.clean.customers)} customers, ${ENROLMENT_WITHIN_CUSTOMER.clean.before} orders before vs ${ENROLMENT_WITHIN_CUSTOMER.clean.after} after`}
          />
          <StatTile
            label="Same test, biased subset"
            value={`+${ENROLMENT_WITHIN_CUSTOMER.biased.changePct}%`}
            note={`${num(ENROLMENT_WITHIN_CUSTOMER.biased.customers)} who enrolled on a day they were already buying`}
          />
          <StatTile
            label="What the gap below is"
            value="Selection"
            note="engaged customers enrol; enrolment does not appear to engage customers"
          />
        </div>
        <p className="mb-4 text-sm">
          <b>The table below does not mean enrolment works.</b> Comparing customers against
          themselves either side of their own enrolment — {ENROLMENT_WITHIN_CUSTOMER.windowDays}{" "}
          days each way, the enrolment-day order excluded — orders <b>fell</b> by{" "}
          {Math.abs(ENROLMENT_WITHIN_CUSTOMER.clean.changePct)}%. The subset who enrolled on a day
          they were already buying rose {ENROLMENT_WITHIN_CUSTOMER.biased.changePct}%, which is the
          bias made visible rather than asserted: their &ldquo;after&rdquo; window opens on a
          purchase. Likely regression to the mean — people enrol during an active spell and revert.
        </p>
        <div className="mb-4">
          <p className="label-xs mb-2 text-muted-foreground">
            Tested at three window widths, {ENROLMENT_WITHIN_CUSTOMER.measuredOn}
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Window</Th>
                <Th align="right">Customers</Th>
                <Th align="right">Change, cleaner group</Th>
                <Th align="right">Change, biased subset</Th>
              </tr>
            </thead>
            <tbody>
              {ENROLMENT_WITHIN_CUSTOMER.windows.map((w) => (
                <tr key={w.days}>
                  <Td>{w.days} days each way</Td>
                  <Td align="right">{num(w.cleanN)}</Td>
                  <Td align="right">{w.cleanChange}%</Td>
                  <Td align="right">+{w.biasedChange}%</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            The direction holds at every width. The two columns also move in opposite ways as the
            window grows: the biased subset decays from +25.6% to +3.3%, because the single purchase
            its window opens on matters less over a longer span, while the cleaner result stays
            between -23.7% and -32.5%. A real effect would not dissolve on one side and persist on
            the other.
          </p>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Acquired via</Th>
              <Th align="right">Enrolled</Th>
              <Th align="right">Repeat</Th>
              <Th align="right">Not enrolled</Th>
              <Th align="right">Repeat</Th>
              <Th align="right">Gap</Th>
            </tr>
          </thead>
          <tbody>
            {enrol.map((e) => (
              <tr key={e.channel}>
                <Td>{e.channel}</Td>
                <Td align="right">{num(e.enrolled)}</Td>
                <Td align="right">{e.enrolledRate === null ? "—" : pct(e.enrolledRate)}</Td>
                <Td align="right">{num(e.notEnrolled)}</Td>
                <Td align="right">{e.notEnrolledRate === null ? "—" : pct(e.notEnrolledRate)}</Td>
                <Td align="right">
                  {e.enrolledRate !== null && e.notEnrolledRate !== null
                    ? `+${(e.enrolledRate - e.notEnrolledRate).toFixed(1)}`
                    : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="mt-4 border-l-2 border-border pl-4 text-xs text-muted-foreground">
          <p>
            <b>Tested within-customer, and the gap does not survive.</b> Comparing 4,115 customers
            against themselves either side of their own enrolment — same people, 180 days each way,
            the enrolment-day order excluded — orders fell from 1.92 to 1.42 per customer,{" "}
            <b>-25.9%</b>. The 416 who enrolled on a day they were already buying show +21.4%, which
            is the bias showing itself: their &ldquo;after&rdquo; window opens on a purchase.
          </p>
          <p className="mt-2 text-muted-foreground">
            So the gap in this table is almost certainly SELECTION, not effect: engaged customers
            enrol, rather than enrolment making customers engaged. The likely mechanism is
            regression to the mean — people enrol during an active spell and then return to their
            normal rate. Do not build a case for pushing enrolment on these numbers. Neither test is
            causal in either direction; enrolment is chosen, never assigned.
          </p>
        </div>
      </Panel>

      <Panel title="New customers captured per 100 POS orders">
        {/* Framed as a policy question with a price, not a compliance failure.
            Staff ARE asking — on 83.5% of orders over 250 JOD — and skipping
            small baskets, which is rational triage under time pressure. */}
        {capture.length ? (
          <>
            <div className="mb-4 grid grid-cols-1 gap-6 md:grid-cols-3">
              <StatTile
                label="Latest comparable month"
                value={capture.at(-1)!.per100.toFixed(1)}
                note={`${num(capture.at(-1)!.newCustomers)} new from ${num(capture.at(-1)!.posOrders)} POS orders`}
              />
              <StatTile
                label="Before the drop"
                value={Math.max(...capture.map((c) => c.per100)).toFixed(1)}
                note={`peak, ${capture.reduce((a, c) => (c.per100 > a.per100 ? c : a)).month}`}
              />
              <StatTile
                label="Anonymous POS revenue"
                value={jod(279461)}
                note="14 months to Feb 2026, 6,554 orders with nobody attached"
              />
            </div>

            <p className="mb-4 text-sm">
              <b>Capture tracks basket size.</b> 83.5% of POS orders over 250 JOD carry a customer,
              against 24.7% under 10 JOD, rising steadily through every band. Staff are asking on
              orders where it feels worth the time — so this is a question about where that
              threshold should sit, with a price attached, not a compliance problem.
            </p>

            <div className="mb-4 border-l-2 border-border pl-4 text-sm">
              <p>
                <b>What happened in July 2023 is not known.</b> The date is precise and the shape is
                specific: identification on ordinary trading days went from 79.3% (2023 Q2) to 55.8%
                (Q3), and customer, email and phone all fell together while tags stayed at 100%,
                retail location at 100%, and the app remained <code>pos | Point of Sale</code>. Only
                the identity fields changed.
              </p>
              <p className="mt-2">
                Two explanations are ruled out. Not the loyalty platform migration — Smile.io
                enrolments were flat through the same window, 826 in 2023 H2 against 774 in H1. And
                not one configuration change: identification oscillates afterwards (41.9%, 61.1%,
                41.7%, 35.2%, 52.3%), and a connector or till change does not recover to 61% and
                fall again.
              </p>
              <p className="mt-2 text-muted-foreground">
                The cause is most likely something in the shop — staffing, till procedure, how
                customers are asked — which none of these systems record. Left as an honest unknown
                with a precise date rather than resolved into a story the evidence does not carry.
              </p>
            </div>

            <Table>
              <thead>
                <tr>
                  <Th>Month</Th>
                  <Th align="right">POS orders</Th>
                  <Th align="right">New customers</Th>
                  <Th align="right">Per 100 orders</Th>
                </tr>
              </thead>
              <tbody>
                {capture.slice(-18).map((c) => (
                  <tr key={c.month}>
                    <Td>{c.month}</Td>
                    <Td align="right">{num(c.posOrders)}</Td>
                    <Td align="right">{num(c.newCustomers)}</Td>
                    <Td align="right">{c.per100.toFixed(1)}</Td>
                  </tr>
                ))}
                {/* The break is SHOWN, not silently truncated. Cutting the
                    series off without saying why invites the next person to
                    "fix" it by extending the range, which reinstates the
                    12.1 artefact. */}
                <tr>
                  <td colSpan={4} className="py-3">
                    <span className="text-xs text-muted-foreground">
                      ── series ends {POS_CAPTURE_COMPARABLE_UNTIL}: from this date only POS orders
                      with an identified customer sync at all, so the denominator becomes
                      &ldquo;identified POS orders&rdquo; and the ratio stops meaning the same
                      thing. Extending it reads 12.1, which is the definition change and not a
                      recovery. ──
                    </span>
                  </td>
                </tr>
              </tbody>
            </Table>
          </>
        ) : (
          <EmptyState>No POS orders in range.</EmptyState>
        )}
      </Panel>

      <Panel title="Busy days cost identification, and there are more of them">
        <p className="mb-4 text-sm">
          On days with {BUSY_DAY_ORDERS} or more POS orders, identification runs{" "}
          <b>{BUSY_DAY_IDENTIFICATION.busyDaysRange}</b> against{" "}
          <b>{BUSY_DAY_IDENTIFICATION.normalDaysRange}</b> on ordinary days. Those days have gone
          from none at all to a regular occurrence, so the blended rate falls even if nothing about
          how staff work changes. This is actionable without knowing what happened in July 2023.
        </p>
        <Table>
          <thead>
            <tr>
              <Th>Quarter</Th>
              <Th align="right">Busy days</Th>
              <Th align="right">Trading days</Th>
              <Th align="right">Share of POS orders on busy days</Th>
            </tr>
          </thead>
          <tbody>
            {busy.slice(-12).map((b) => (
              <tr key={b.quarter}>
                <Td>{b.quarter}</Td>
                <Td align="right">{num(b.busy)}</Td>
                <Td align="right">{num(b.days)}</Td>
                <Td align="right">{b.busy ? pct(b.busyShareOfOrders) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Frequency is computed from order counts and updates with the data. The identification
          rates either side are a fixed measurement from {BUSY_DAY_IDENTIFICATION.measuredOn},
          because per-order customer presence is not stored — only the daily total is. Re-measure
          before quoting them as current.
        </p>
      </Panel>

      <Panel title="Where customers are in their life cycle">
        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-muted-foreground">Active means ordered within</span>
          <Input
            type="number"
            min={7}
            max={730}
            value={windowDays}
            onChange={(e) => setWindowDays(Math.max(7, Number(e.target.value) || 90))}
            className="w-28"
          />
        </label>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Active"
            value={num(s.lifecycle.active)}
            note={`ordered in the last ${windowDays} days`}
          />
          <StatTile
            label="Lapsing"
            value={num(s.lifecycle.lapsing)}
            note={`last ordered ${windowDays} to ${windowDays * 2} days ago`}
          />
          <StatTile
            label="Lapsed"
            value={num(s.lifecycle.lapsed)}
            note={`nothing for over ${windowDays * 2} days`}
          />
        </div>
      </Panel>

      <Panel title="How concentrated the revenue is">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <StatTile label="Top 1%" value={pct(s.concentration.top1)} />
          <StatTile label="Top 5%" value={pct(s.concentration.top5)} />
          <StatTile label="Top 10%" value={pct(s.concentration.top10)} />
          <StatTile label="All buyers" value={jod(s.concentration.totalRevenue)} />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          <StatTile label="Median customer" value={jod(s.concentration.median)} />
          <StatTile label="Top decile starts at" value={jod(s.concentration.p90)} />
          <StatTile label="Bottom decile ends at" value={jod(s.concentration.p10)} />
          <StatTile
            label="Mean"
            value={jod(s.concentration.mean)}
            note="shown for comparison only"
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The mean is {(s.concentration.mean / Math.max(1, s.concentration.median)).toFixed(1)}× the
          median, so it describes almost nobody. Read the median and the deciles; the mean is here
          only to show how far the top pulls it.
        </p>
      </Panel>

      <Panel title="The ceiling on everything marketing can do">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Buyers we cannot reach"
            value={num(s.reach.unreachable)}
            note={`${pct(s.reach.unreachablePct)} of buyers, ${jod(s.reach.unreachableRevenue)}`}
          />
          <StatTile
            label="Never opted in"
            value={num(s.reach.neverOptedIn)}
            note="have an email address, never asked"
          />
          <StatTile label="Opted out" value={num(s.reach.optedOut)} note="must not be contacted" />
        </div>
        <p className="mt-4 text-sm">
          <b>{num(s.reach.smsOnly)} buyers hold a phone number and are subscribed to nothing</b>,
          worth {jod(s.reach.smsOnlyRevenue)}. SMS is the only route that exists to them.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Never-opted-in and opted-out are counted separately on purpose. Only the first group can
          be asked; contacting the second would be contacting people who chose to leave.
        </p>
      </Panel>
    </div>
  );
}
