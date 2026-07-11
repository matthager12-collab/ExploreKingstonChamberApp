# ADR-0002 — The app is the events front door; member data arrives by manual export

## Status

Accepted — decided by Mat 2026-07-10, in response to the GrowthZone ground truth (docs/adr/ADR-0001-ams-ground-truth.md) and the API-module research (paid add-on, quote-only pricing). Chamber operational buy-in (staff workflow changes, website pointer) is a follow-up, tracked in Consequences.

## Context

The Chamber's AMS is a single GrowthZone tenant (ADR-0001). GrowthZone's API is a paid add-on module the Chamber does not have; pricing is quote-only (historical list ~$49/mo). Free paths exist that cover the app's near-term needs: a staff-generated whole-calendar iCal feed, per-event iCal (verified live), and manual CSV/Excel report exports from the back office (GrowthZone has no scheduled-report automation). Meanwhile, the requirements corpus (M-05-03, FR-EVT-04, FR-A17) already demanded in-app event submission with a Chamber moderation queue, and Chamber staff find GrowthZone's event entry cumbersome.

## Decisions

1. **Events shift to the app as system of record and entry point.** Members and orgs submit events in the app (phone-first); GrowthZone event entry becomes legacy. This answers the events-canonical-source question E12 was chartered to record: **in-app is canonical**; the GrowthZone calendar is a transitional ingest source, not the front door. Aggregation is unchanged — the unified calendar still merges in-app + GrowthZone + Tribe feeds with dedupe — but precedence is in-app first.
2. **Event approval moves to the app too.** The hold-by-default moderation queue (CRITICAL floor, FR-A01/FR-A17) is implemented and operated in-app by Chamber staff. During the transition, GrowthZone-sourced events still land `pending` on first sight per the floor; staff-curated GrowthZone imports are expected to be quick approvals.
3. **Member data arrives by manual export — no API purchase now.** Chamber staff run a saved GrowthZone report export (CSV/Excel: business name, membership status, level, drop date, categories, address) on a cadence (recommended: weekly, plus on-demand before board meetings) and upload it to the app's CSV importer (integration-ladder rung 0). Manual is acceptable; the Chamber is adopting an AI agent plan, so the export→upload loop must be **agent-operable by design** — documented runbook, stable column mapping, idempotent re-import, dry-run preview — making later automation a process change, not an architecture change.

## Consequences

- **E12 (unified calendar):** precedence order is settled — in-app > GrowthZone > Tribe. The staff-generated whole-calendar iCal feed URL is still wanted for transitional ingest (action item in docs/OPERATIONS.md §9); per-event iCal remains the fallback.
- **E16 (AMS sync):** scope narrows to rung 0 (CSV import with preview/dedupe/quarantine) + rung 1 (iCal ingest) indefinitely. Rung 2 (paid API pull) is deferred; revisit triggers: the manual export burden becomes real for staff, or a 2027 LTAC award funds the module (ADR-0001 walk-away bands stand for that decision).
- **E24 (write-back):** deferred indefinitely — with the app as front door there is nothing to write back. E23 syndication lists the AMS channel as "unavailable by choice."
- **E19 (monetization seams):** unaffected in design. Membership levels arrive via CSV instead of API; the tier mapping reads the local mirror regardless of transport.
- **Entitlement freshness is as-of-last-export.** Staleness stamps (NFR-12/M-19-01) must show the export date, and the member mirror records provenance `source: csv-import`.
- **MHMDA floor applies to exports exactly as it would to API sync:** the saved-report template must contain only the allowlisted fields — no member emails or personal contacts by default (if the Chamber later wants email-based invite matching, that instruction gets recorded in ADR-0001's question set first).
- **The Chamber website events page will go stale.** business.kingstonchamber.com/events shows GrowthZone-entered events; as entry shifts to the app, that page stops reflecting reality. Options, Chamber to choose timing: point the website at the app's calendar (the app already emits public JSON + iCal at `/api/feeds/events`, and an embeddable widget is planned — M-05-05/FR-EVT-09), or dual-enter during a defined transition window. This is the one operational cost of decision 1 and needs an explicit Chamber cutover date.
- **ADR-0001's gate remains open but demoted:** it now guards only a *future* API purchase. The support email (docs/chamber/ams-support-email.md) is informational — worth sending for pricing intel ahead of the Oct 1–30, 2026 LTAC window and for the hot-deals/calendar-feed questions — but it no longer blocks any planned work.
