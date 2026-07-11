# ADR-0001 — AMS ground truth: one GrowthZone tenant, two hostnames, gated API access

## Status

BLOCKED-ON-HUMAN — awaiting written GrowthZone support answers via the Chamber (draft email: docs/chamber/ams-support-email.md). Accepted only when the Questions section below is filled from a written vendor reply and Mat signs the walk-away decision.

## Correction (2026-07-10)

The original E04 run of this ADR concluded the Chamber's tenant was **ChamberMaster/MemberZone, not GrowthZone AMS**, inferring the platform from two signals: the `business.kingstonchamber.com` CNAME pointing at `public.west.us.memberzone.org`, and the event iCal `PRODID:-//ChamberMaster//Event Calendar 2.0//EN`. **That conclusion was wrong.** Same-day evidence:

- Chamber staff log into the **GrowthZone staff application** at `greaterkingstoncommunitychamberofcommerce.growthzoneapp.com/a#/…` (human-attested 2026-07-10 by Chamber staff, via the "GrowthZone Login" — not "ChamberMaster Login" — on the vendor's site).
- Both `business.kingstonchamber.com` and that growthzoneapp.com host embed **`TenantId: 3508`** in their page source, serve **identical event records (same slugs and numeric IDs)**, and render through the same GrowthZone public-modules app (`gz-*` markup). One tenant, two hostnames.
- The growthzoneapp.com host **itself** serves iCal stamped `PRODID:-//ChamberMaster//Event Calendar 2.0//EN`.

**Lesson recorded:** the memberzone.org CNAME and the ChamberMaster PRODID are legacy naming on GrowthZone's shared public-modules infrastructure — neither discriminates the product. The org's current name is "Greater Kingston **Community** Chamber of Commerce". The load-bearing machine-checkable invariant is now **tenant parity** (both hostnames serve TenantId 3508), which the harness checks as REQUIRED. What remains genuinely unknown — and is now Question 3 — is which API family serves tenant 3508: the publicly documented v1 API at `api.micronetonline.com` (X-ApiKey, OData), the GrowthZone REST API (OAuth/OIDC), or both.

## Context

GrowthZone (the vendor) markets two product lines with two documented API families: GrowthZone (staff app and tenants at `{subdomain}.growthzoneapp.com`, REST + OAuth/OIDC, support-configured webhooks) and ChamberMaster/MemberZone (v1 API at `api.micronetonline.com`, OData queries, `X-ApiKey` auth, no webhooks, access quote-gated through GrowthZone's Engagement team). The Chamber's tenant (3508) empirically straddles the naming: staff use the GrowthZone app while the public modules ride legacy-named infrastructure — so only a written vendor answer can establish which API family, auth model, and change-notification options apply. The v2 plan syncs the Chamber's member directory and events from its AMS (E16 inbound, E24 write-back) and reads membership level for entitlements, so designing against the wrong API — or an unquoted vendor fee — would sink those epics. This ADR records the machine-verifiable ground truth and holds the open questions only GrowthZone can answer in writing. Re-verify the machine-checkable half anytime with `npm run ams:checks`; the harness (`scripts/ams-ground-truth-checks.mjs`) writes its timestamped snapshot to `docs/adr/ams-ground-truth-checks.json` and doubles as the tenant-drift alarm. No AMS sync code may be written while this ADR reads BLOCKED-ON-HUMAN.

## Verified facts

Rows 1–8 are transcribed from the harness snapshot generated **2026-07-11T03:15:36Z** (`docs/adr/ams-ground-truth-checks.json`); each fact was first verified 2026-07-05 or 2026-07-10 and re-verified on the probe date shown. Every feed probe uses the truth triple — HTTP status + `Content-Type` + body prefix — because of the soft-404 row below.

| # | Fact | Evidence | Probed |
|---|---|---|---|
| 1 | **Tenant parity: one GrowthZone tenant (3508), two hostnames** — the custom-domain public site and the staff tenant serve the same data | `business.kingstonchamber.com/events` and `greaterkingstoncommunitychamberofcommerce.growthzoneapp.com/events` both embed `TenantId: 3508` (harness-checked); identical event slugs and IDs on both hosts observed 2026-07-10 (human check, not harness-probed) | 2026-07-10 |
| 2 | The custom domain rides GrowthZone's shared public-modules hosting under legacy MemberZone naming — **not platform proof** (see Correction) | `dig CNAME business.kingstonchamber.com` → `public.west.us.memberzone.org` | 2026-07-10 |
| 3 | Public events index is live and yields per-event Details links | `GET /events` → HTTP 200; ≥ 3 `/events/Details/{slug}-{id}` links found | 2026-07-10 |
| 4 | **Per-event iCal is live and free** | `GET /events/ICal/{slug}-{id}.ics` → HTTP 200, `text/calendar; charset=utf-8`, body starts `BEGIN:VCALENDAR`; `PRODID:-//ChamberMaster//Event Calendar 2.0//EN` (legacy string; also observed on the growthzoneapp.com host 2026-07-10 — human check, not harness-probed); `TZID:America/Los_Angeles` present; `X-PUBLISHED-TTL:P1H` (3/3 probed events valid) | 2026-07-10 |
| 5 | **Soft-404 trap:** `/events/ical` (no slug) returns HTTP **200** with `text/html` and body "Event is not found." — status codes alone prove nothing on this host | `GET /events/ical` → 200, `text/html; charset=utf-8`, soft-404 body confirmed | 2026-07-10 |
| 6 | **No calendar-wide feed exists** | `/events/rss`, `/events/icalfeed`, `/events/calendar.ics`, `/rss` all 404; `/events/ical` is the soft-404 above; nothing served `text/calendar` or XML | 2026-07-10 |
| 7 | Module state: jobs on, hot deals off | `GET /jobs` → 200; `GET /hotdeals` → 404 | 2026-07-10 |
| 8 | The v1 (ChamberMaster/MemberZone) API endpoint reference is public, no login — whether it applies to tenant 3508 is Question 3 | `GET https://api.micronetonline.com/v1/documentation` → 200 (https worked; no http fallback needed) | 2026-07-10 |

### Survey-recorded facts (not harness-checkable)

The rows below come from a human read of the public vendor documentation on 2026-07-05, not from the harness — they cannot be machine-verified, so re-check them by re-reading the cited source. They describe the **v1 API's documentation**; whether that API serves tenant 3508 at all is Question 3.

| # | Fact | Source | Read |
|---|---|---|---|
| 9 | The v1 API's Members objects expose enough for listings + entitlements (`Status`, `Level`, `WebParticipationLevel`, `DoNotDisplayOnWeb`, `DropDate`, `Slug`, `Latitude/Longitude`, `LogoUrl`); write endpoints exist but key scope is unknown (Question 4) | Public v1 documentation at `api.micronetonline.com/v1/documentation` | 2026-07-05 |
| 10 | API access is enablement-gated with unpublished pricing; access is per-developer and granted only with the account holder's (the Chamber's) express permission | GrowthZone support docs — hence the Chamber sends the email, not Mat | 2026-07-05 |
| 11 | Rate limits are not documented anywhere public for the v1 API; `events/feeds` and `RecentActivity` appear in its docs with no description | Public v1 documentation (Questions 5–6) | 2026-07-05 |

## Questions awaiting written answers (the gate)

The eight questions below are the gate. They match `docs/chamber/ams-support-email.md` exactly; the gate closes only when each **Answer** is filled from GrowthZone's written reply.

1. Which GrowthZone product/edition/package is our account on, and does that edition include API access? (Context: our staff log in via the GrowthZone staff app, but our public modules still carry ChamberMaster/MemberZone naming — the business.kingstonchamber.com DNS points at memberzone.org hosting and our event iCal feeds say "ChamberMaster Event Calendar 2.0" — so we want written confirmation of which product we are actually on.)

   **Answer:** TBD-HUMAN

2. If API access is not included in our edition: what does enablement cost for an account of our size, and which editions include it?

   **Answer:** TBD-HUMAN

3. Which API should a chamber-built app use against our tenant: the GrowthZone REST API (OAuth/OIDC), the publicly documented v1 API at api.micronetonline.com (X-ApiKey), or both? Please point us at the documentation for whichever applies to our account.

   **Answer:** TBD-HUMAN

4. Is granted API access read-only or read-write? Can write scopes (updating member records, creating/updating events, posting hot-deals/Marketplace content) be granted to a chamber-built app, and is there an approval workflow for API-written content?

   **Answer:** TBD-HUMAN

5. What are the rate limits / throttling / burst rules for the API(s) that apply to our tenant?

   **Answer:** TBD-HUMAN

6. What webhook or change-notification options exist for our tenant — which webhook action types are available, and how are they configured (do we request them through support)? If webhooks are not available to us, what is the recommended way to detect changed records for a periodic sync?

   **Answer:** TBD-HUMAN

7. Does an all-events iCal or RSS feed exist for our public event calendar (per-event iCal works today; we could not find a calendar-wide feed)? Relatedly, our hot-deals module appears to be disabled (/hotdeals returns 404) — what does enabling it involve, and are hot deals ("Marketplace" objects) accessible via the API?

   **Answer:** TBD-HUMAN

8. Are API keys / OAuth clients issued per developer, does client issuance cost extra, and what authorization do you need from us (the account holder) to issue credentials to our developer?

   **Answer:** TBD-HUMAN

## Walk-away price

Recommended defaults — TBD-HUMAN (Mat) to confirm or amend before the gate closes.

Decision rule for whatever GrowthZone quotes for API enablement (whichever API family it turns out to be):

- **(a) Quoted fee ≤ $500/yr** — proceed on the Chamber ops budget. This fits the ~$65/mo headroom under the $100/mo infra ceiling (current band ~$7–20/mo; projected steady state after Phase 2 is $15–35/mo).
- **(b) $500–$2,000/yr** — proceed ONLY contingent on a 2027 Kitsap County LTAC award (RFP window Oct 1–30, 2026). Until awarded, stay on integration-ladder rungs 0–1 (CSV import/export + per-event iCal), which are free.
- **(c) > $2,000/yr** — walk away. Rungs 0–1 permanently; revisit only if pricing changes.

Decision: TBD-HUMAN (Mat) — date: ____

## LTAC funding route

Kingston is unincorporated Kitsap County, so the Kitsap County Lodging Tax Advisory Committee (LTAC) is the funding authority. The Chamber, a 501(c)(6), applies in the Oct 1–30, 2026 RFP window for 2027 funds, framing the AMS API enablement fee as tourism promotion under RCW 67.28.080 — a paid feature integration for the community tourism app. LTAC and ops money are never mixed: this fee's funding source is declared explicitly here (ops budget for band (a), LTAC award for band (b), per the walk-away rule above) and later recorded in the Phase 3 cost-attribution ledger (E18).

## Decision

TBD-HUMAN. No AMS sync code (E16/E24) may merge while this reads TBD-HUMAN.

## Consequences

- All AMS calls in later epics go through the `AmsProvider` interface (`ChamberMaster | GrowthZoneAMS | CSV | Null`) — built in E16, not before. Which concrete provider E16 implements first is decided by the written answer to Question 3.
- Sync design defaults to **pull-based idempotent reconciliation** (nightly members, hourly events). Webhooks may exist for this tenant (Question 6) — a written vendor answer may upgrade the design, but E16 must not assume webhooks before that answer.
- Entitlements are derived locally from polled member fields with "as-of last sync" semantics.
- AMS-synced member PII falls inside the MHMDA data-minimization floor (E11).
- The drift alarm is **tenant parity**: if either hostname stops serving TenantId 3508, this ADR is stale and must be redone — `npm run ams:checks` fails loudly on exactly that drift. DNS/PRODID naming changes alone are informational, not proof of anything (see Correction).
