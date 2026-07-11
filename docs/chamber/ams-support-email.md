# AMS API support email — SUPERSEDED, DO NOT SEND

> **2026-07-10:** the Chamber decided to roll off GrowthZone entirely (docs/ROLLOFF-GROWTHZONE.md; docs/adr/ADR-0001 closed as walk-away). The API will never be purchased, so this inquiry is moot. Kept for the record only. The two still-useful asks moved elsewhere: the whole-calendar iCal feed is staff-generated (docs/OPERATIONS.md §9 item 6b), and cancellation/data-export mechanics are covered by the roll-off plan's R0/R4 phases.

---

**For the Chamber office — please read this preamble, then send the draft below.**

- **Send it FROM a Chamber account** (e.g. info@kingstonchamber.com). GrowthZone issues API access per developer and only with the **account holder's** express permission — the Chamber is the account holder, so this inquiry carries weight only coming from you. Mat cannot send it.
- **To:** websupport@growthzone.com
- **Cc:** engagement@growthzone.com
- **Phone fallback** if no reply in ~a week: 800-825-9171 (ask for WebSupport, then the Engagement team for API-access quotes).
- **When the written reply arrives, forward it to Mat** so the answers can be recorded in docs/adr/ADR-0001-ams-ground-truth.md. The reply is informational — pricing intel for a possible 2027 LTAC-funded API purchase (see docs/adr/ADR-0002-app-first-events-and-manual-exports.md); app work proceeds meanwhile. Written answers still matter — a phone summary can't be recorded.

---

**Subject:** API access inquiry — Greater Kingston Community Chamber of Commerce (GrowthZone tenant, business.kingstonchamber.com)

Hello,

The Greater Kingston Community Chamber of Commerce (Kingston, WA) is building a chamber-owned community tourism app and would like machine access to our own tenant's data — member directory, events, and related modules — via your API. Our staff use the GrowthZone staff application at greaterkingstoncommunitychamberofcommerce.growthzoneapp.com and our public modules are served at business.kingstonchamber.com; we'd appreciate written answers to the following questions so we can plan the integration and budget correctly:

1. Which GrowthZone product/edition/package is our account on, and does that edition include API access? (Context: our staff log in via the GrowthZone staff app, but our public modules still carry ChamberMaster/MemberZone naming — the business.kingstonchamber.com DNS points at memberzone.org hosting and our event iCal feeds say "ChamberMaster Event Calendar 2.0" — so we want written confirmation of which product we are actually on.)

2. If API access is not included in our edition: what does enablement cost for an account of our size, and which editions include it?

3. Which API should a chamber-built app use against our tenant: the GrowthZone REST API (OAuth/OIDC), the publicly documented v1 API at api.micronetonline.com (X-ApiKey), or both? Please point us at the documentation for whichever applies to our account.

4. Is granted API access read-only or read-write? Can write scopes (updating member records, creating/updating events, posting hot-deals/Marketplace content) be granted to a chamber-built app, and is there an approval workflow for API-written content?

5. What are the rate limits / throttling / burst rules for the API(s) that apply to our tenant?

6. What webhook or change-notification options exist for our tenant — which webhook action types are available, and how are they configured (do we request them through support)? If webhooks are not available to us, what is the recommended way to detect changed records for a periodic sync?

7. Does an all-events iCal or RSS feed exist for our public event calendar (per-event iCal works today; we could not find a calendar-wide feed)? Relatedly, our hot-deals module appears to be disabled (/hotdeals returns 404) — what does enabling it involve, and are hot deals ("Marketplace" objects) accessible via the API?

8. Are API keys / OAuth clients issued per developer, does client issuance cost extra, and what authorization do you need from us (the account holder) to issue credentials to our developer?

Written answers are preferred so we can share them accurately with our developer. Thank you!

Greater Kingston Community Chamber of Commerce
Kingston, WA
business.kingstonchamber.com
