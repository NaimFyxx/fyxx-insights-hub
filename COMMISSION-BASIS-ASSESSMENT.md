# Is any figure here solid enough to attach money to?

An honest assessment, written 3 September 2026, before a conversation about
commission on marketing-influenced sales.

**Written to be shared, including with the person who would be paying.** It
argues against the most flattering number, because a figure that collapses
under scrutiny is worse than a smaller one that holds.

---

## Context for anyone reading cold

Fyxx is a spirits and cigars retailer in Amman. This is a marketing dashboard
built on Supabase, pulling from Shopify, Klaviyo and LoyaltyLion. It reports
revenue by sales channel, by acquisition channel, customer retention, loyalty
and email performance.

The proposal on the table is commission on sales or revenue influenced by
marketing. That is a different standard from internal decision-making. A figure
used for a payment has to be defensible against someone with reason to
challenge it, reproducible in six months, and stable once agreed.

Every number below was verified against the database at the time of writing.

---

## 1. The figure I would NOT use, and why

The obvious candidate is **61.1% of August revenue came from customers
acquired online** (112,755 JOD of 184,609 JOD). It is attractive because it is
a fact about origin rather than a claim about causation: it needs no
attribution model, only the channel each customer first arrived through.

I do not think it should carry money, for two reasons.

### It is a stock, not a flow

It measures revenue from every customer ever acquired online, including people
acquired in 2020. It barely moves with anything done in a given month, because
it is dominated by an inherited base. If marketing stopped entirely for a year,
the figure would stay high.

The same month, measured as a flow:

| Basis | August 2026 |
|---|---|
| Revenue from customers **ever** acquired online (the 61%) | **112,755 JOD** |
| Revenue from the 139 customers acquired online **in August** | **11,982 JOD** |

A 9.4x difference. Anyone paying will find that gap, and finding it themselves
turns a discussion about the rate into a discussion about good faith.

### The framing smuggles in a causal claim

The measure is **channel of first order**. It is not evidence that marketing
caused the acquisition. Someone who found the app in the App Store, or typed
the shop name into a search engine, counts identically to someone who arrived
from a campaign.

For strategy that framing is fine and the figure is genuinely useful. For a
payment formula, "revenue from customers marketing brought in" is a causal
claim wearing an origin measure's clothes, and it will not survive a determined
reading.

---

## 2. What I would propose instead

**New customers acquired through marketing channels in the period, and their
revenue.**

It is a flow, so it moves with effort. It is a fact about origin, with no
causal claim attached. It is computed from a hard key. And it is smaller, which
is the correct trade when someone is signing a cheque.

August 2026, new customers by first-order channel:

| Channel | New customers |
|---|---|
| Mobile App | 90 |
| Draft Orders | 52 |
| Website | 49 |
| POS | 23 |
| **Total** | **214** |

Of which 139 arrived through Website or Mobile App.

If lifetime value should be reflected, the defensible version is new customers
in the period measured over a **fixed forward window** — first 90 days, say —
and paid in arrears. Slower, but it credits what marketing actually creates
without paying for 2020.

**Keep the 61% for the annual argument about what marketing is worth. Do not
attach money to it.**

---

## 3. The argument against, written adversarially

Everything a sceptical payer would raise, strongest first.

### "Your closed month changed after it closed"

August ended on the 31st. On 2 September the August figure was
**177,193.521 JOD**. On 3 September the same query returned
**184,609.461 JOD**.

**The month moved 7,415.940 JOD, or 4.19%, after it had closed.**

This is the most serious objection and it is entirely fair. The dashboard nets
cancellations and refunds at read time by design, so old figures self-correct
as new information arrives. That is correct behaviour for a dashboard and
unacceptable for a payment basis. There is currently no such thing as a final
number.

### "Your number jumped 17 points the month the till started recording customers"

The Odoo connector began requiring a customer on every POS order after
27 February 2026. Coverage of the acquisition measure went from roughly 84% to
99.8%.

| Basis | Dec 2025 | Aug 2026 | Change |
|---|---|---|---|
| Share of all revenue (raw) | 44.1% | 61.0% | +16.9 pts |
| Like-for-like share | 49.6% | 61.1% | **+11.5 pts** |

Roughly a third of the apparent rise is a denominator change, not performance.
On a trailing year the like-for-like series averages 50.9% before the break and
60.2% after, a real rise of about **9 points, not 17**.

### "You are computing a percentage on a denominator you admit is incomplete"

**16.4% of orders carry no customer at all** and can never be assigned an
acquisition channel. That is 9.5% of revenue. The dashboard states this and
calls the figure a floor. The counter-argument is that the missing part is
disproportionately POS, which is the part of the business the payer runs, so
the exclusion systematically favours marketing.

### "You reconstructed six years of history with a rule you wrote last month"

Acquisition channel was never recorded at the time of sale. It was derived on
29 August 2026 by sweeping every order and mapping its source name. The mapping
table had been corrected earlier the same day, roughly an hour before the sweep
ran, because it had been found wrong.

Two things support the derivation, and both should be offered voluntarily:

- No channel is claimed before it existed. The earliest acquisition date
  matches the earliest actual order on that channel exactly, for all four
  channels.
- LoyaltyLion, which ingests orders through its own separate Shopify
  integration, agrees with the channel mapping on **all 2,381 orders** in a
  30-day comparison.

The limit of that second check is that it covers 30 days, not six years.

### "You decided which sales do not count, and changed your mind three times"

628,005 JOD across 71 accounts was excluded as internal: venue tables, staff,
write-offs, event accounts. Then three accounts were exempted after the fact
(two delivery platforms and one real customer found to be mistagged).

Every one of those judgements made the denominator smaller and the percentage
larger. The exclusions are documented and individually defensible; the pattern
is still uncomfortable.

### "Why first touch?"

Over a six-year window, first-touch attribution is the single most generous
model available. Last-touch, time-decay and position-based all pay less. The
model that pays most was the one chosen.

### "Is the app marketing's?"

Mobile App accounts for 90 of the 139 new online customers in August. If the
app is treated as a product asset rather than a marketing channel, most of the
figure disappears.

This is the objection with no data answer. It is a definitional argument and it
has to be settled by agreement, not by evidence.

### "Your figures have been wrong before, and you found it yourself"

All true, all self-reported, all corrected:

- August revenue overstated by 1,339 JOD until a repair ran
- Klaviyo attributed revenue 37,615 → 28,260 JOD once cancellations were netted
- Mobile App growth reported at +831.8%, actually +23.8%
- One-and-never-returned 42.7% → 37.9%

Each correction is evidence of diligence. Each is also evidence that the system
produces confident wrong numbers, and that the next one has not necessarily
been found.

### "Two population figures do not reconcile"

19,163 customers in the dashboard against 20,019 in a Shopify export. A 4% gap,
investigated, unexplained, parked. Separately, 813 LoyaltyLion members have no
matching Shopify customer record.

### "The system computing your commission was built by you, for you"

There is no independent audit. Every definitional choice was made by the party
who would be paid. This is a real conflict and should be named first rather
than discovered.

---

## 4. What would have to be true for the number to be settled

Five conditions. The first is not optional.

**1. A close.** A frozen snapshot written to an immutable table at an agreed
cut-off, for example the 5th of the following month. Cancellations and refunds
arriving after the cut-off correct future periods, never reopen settled ones.
Without this there is no final number, as the 4.19% overnight movement shows.

**2. A written definition, agreed and version-controlled.** Which channels
count, which exclusions apply, which attribution model, how refunds after the
cut-off are treated. Signed by both parties. Changes take effect forward only.

**3. A frozen exclusions list.** The 71 internal accounts as at an agreed date.
Additions reduce the denominator and raise the percentage, so they cannot be
unilateral.

**4. A recorded baseline.** If the measure is a share, agree what it was at the
start. If it is a flow, agree what normal looks like. Without a baseline, every
movement becomes a renegotiation.

**5. An independent reproduction path.** Someone other than the person being
paid, following a written procedure, arriving at the same number. Two
foundations already exist: a monthly verification workbook that reconciles to
the database, and the LoyaltyLion cross-check that reads Shopify independently.

---

## 5. Verdict

**Partly solid, and only if narrowed.**

**Solid enough to attach money to:**

- Order-level revenue by channel by day. Reconciles to Shopify, independently
  confirmed against LoyaltyLion.
- Counts of new customers by first-order channel in a period. A flow, computed
  from a hard key, verifiable.

**Not solid enough:**

- The 61% as stated. The arithmetic is right. It is a stock presented as a
  performance measure, framed causally, spanning a definitional break, on a
  denominator that moves after the period closes.

**The recommendation:** raise the February break, the missing 16.4%, and the
stock-versus-flow problem yourself, before they are raised for you. It costs
the high number and buys one that survives the second conversation, and the
third.
