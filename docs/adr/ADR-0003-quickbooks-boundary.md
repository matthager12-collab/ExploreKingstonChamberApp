# ADR-0003 — QuickBooks is the money system of record; the app is the membership system of record

## Status

Accepted — decided by Mat 2026-07-10 as part of the GrowthZone roll-off (docs/ROLLOFF-GROWTHZONE.md, accepted with modifications; QuickBooks commitments confirmed in the same-day follow-up: the Chamber will get whatever QBO tier is needed and will enable QuickBooks Payments).

## Context

The Chamber is retiring GrowthZone (~$3.9–4k/yr; term ends ~April 2027, written non-renewal notice due by March 1, 2027 — docs/OPERATIONS.md §9 item 11) and has already moved its books to QuickBooks Online. Dues are currently invoiced and collected **through GrowthZone**, so the money function must land somewhere before cancellation. The app's non-negotiable floors forbid it from ever being that place: no in-app payments, no card capture, no merchant-of-record role (NFR-06 / FR-A15 / M-20-08). Research (2026-07-10, primary sources): QBO Simple Start ($38/mo) supports recurring annual invoices, automatic reminders, and customer Autopay (invoices ≤ $5,000); customer records carry ~30 custom fields on all tiers; the QBO API and webhooks (Invoice/Payment/Customer events) are effectively free at chamber scale under Intuit's Builder tier (500k reads/mo).

## Decision

1. **QuickBooks owns all money:** dues invoices, accounts receivable, payments, refunds. One recurring annual invoice per member on their anniversary (renewals are spread across all 12 months — see the roster analysis in docs/ROLLOFF-GROWTHZONE.md §2b). One QBO Product/Service item per published membership tier ($115 / $160 / $375 / $550, Patron add-on $350, Visionary $10,000+), mapped to a dues income account; dues items marked **non-taxable** (WA: dues are not a retail sale; B&O deductibility follows RCW 82.04.4282 with the ETA 3230.2021 graduated-benefits allocation caveat — bookkeeper applies it).
2. **The app owns the membership record:** org identity, membership status, level, renewal date, listing linkage — plus the member's **QB Customer ID** as the join key (`external_ids.qbCustomerId`, the same seam pattern as `external_ids.amsMemberId`).
3. **The boundary starts manual, agent-operable, and audited** (the ADR-0002 posture): the app exports an upcoming-renewals list for staff to invoice in QB; staff run a QB paid/open-invoices report and confirm status changes in the app's admin UI — every change audited, none automatic. Runbooks documented well enough for an AI agent to execute.
4. **Automation, when manual gets old, is QBO webhooks + API** ("invoice paid → member active" at an app webhook endpoint, HMAC-verified) — a process upgrade behind the same boundary, not an architecture change. Effectively $0 at chamber scale.
5. **Zero payment code in the app, forever.** Any in-app "renew now" affordance is an outbound deep-link to QB's own invoice/payment page. The app never sees card or bank data.

## Consequences

- **Lapse semantics:** dues unpaid past a grace period (recommended 60 days — Chamber confirms) → an admin **confirms** the lapse in the app → entitlements decay to community baseline. Listings are never auto-unpublished (E19's additive-only invariant). No automatic lapse on payment data alone.
- **Cutover is member-facing:** members currently pay through GrowthZone, so every member meets a new QB invoice and payment link at their first post-cutover anniversary, and Autopay enrollment starts from zero. The app tracks Autopay-enrollment status (QB cancels Autopay silently on template changes — every dues increase forces re-enrollment). The one $10,000+ Visionary membership exceeds Autopay's $5k cap and is invoiced manually.
- **Steer to ACH** (1% vs 2.99% card); if bank transfer is ever the only online method on an invoice, disable QB's "your customer pays the fee" setting to avoid a surprise $25 member charge.
- **Entitlement freshness is as-of-last-reconciliation**; staleness stamps show it (NFR-12/M-19-01).
- **Transition accounting:** dues collected in GrowthZone vs QuickBooks during the overlap must not double-count; the R0/R3 export sweeps include GZ payment/payout history for reconciliation.
- E19's tier mapping reads the app's native membership level (set by admins from QB reality), keyed to QB item names as data — turn-on remains a data-only change (see the E19 re-charter).
