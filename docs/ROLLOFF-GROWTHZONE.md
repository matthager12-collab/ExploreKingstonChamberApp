# GrowthZone roll-off plan

**Status: PROPOSED** — for Mat + Chamber evaluation (2026-07-10). Nothing in the build plan changes until this is accepted; the "Requirements & build-plan deltas" section below is the worklist for that follow-up. Research provenance: vendor pages, Intuit docs, and WA DOR read 2026-07-10; tenant module states probed live the same day.

## 1. Goal

Retire the Chamber's GrowthZone subscription (base list historically **$3,900–3,985/yr**, annual auto-renew) by making the app the **membership system of record** and QuickBooks (the Chamber's new accounting home) the **money system of record**. Net effect: the Chamber saves roughly the cost of the entire app's infrastructure ten times over, staff stop maintaining a system they find cumbersome, and the app already planned to build most of the replacement surface anyway.

## 2. What GrowthZone does for Kingston today

Machine-verified module states (probed 2026-07-10) plus product inventory. "Replacement" names the owning epic/tool.

| Function | Kingston uses it? | Replacement | Notes |
|---|---|---|---|
| Member/contact database + membership levels, statuses, join/drop lifecycle | **Yes (core)** | **App — native member store** (E16 re-charter) | The SoR flip. One-time migration import from final CSV exports |
| Dues invoicing, renewals, payments | Yes → **already moving to QuickBooks** | **QuickBooks Online** | See §3. Audit: is GZ Pay in use anywhere (event door payments)? |
| Public member directory | **Yes** (`/directory` live) | App directory (E17 import/claiming + self-service) | Already planned P0 scope |
| Events calendar | **Yes** (`/events` live; staff-confirmed) | **App — already decided** (docs/adr/ADR-0002-app-first-events-and-manual-exports.md) | Transitional GrowthZone iCal ingest gets an end date |
| Event registration/ticketing | **Yes — including paid ticketing** (staff-confirmed 2026-07-10) | Free events: in-app RSVP (M-05-08). Paid events: **deep-link out to a ticketing provider** (FR-A15 floor — app never merchant-of-record) | Provider decision needed (§9): QB payment links (simplest, no attendee mgmt), Eventbrite (fees pass to buyers), Zeffy (free, but 501(c)(6) eligibility unverified — corpus's Zeffy-first pattern is for nonprofits), or Ticket Tailor. Audit which processor GZ ticketing uses today (GZ Pay?) |
| Job postings | Module on (`/jobs` live) but **NOT in staff's used-features list — confirm** | If used: app jobs board (E28, Tension-4 child-safety shape: vetted employers, no applicant intake — note E28 is Phase-4, so confirmed usage would add a timing dependency). If unused: drop, no replacement | |
| Member application (join form) | **Yes** (`/member-application` live) | **App — NEW capability** (coverage gap; no M-xx owns it today) | Form → moderation queue → creates org + QB customer handoff |
| **Constant Contact integration** (GZ syncs member lists to CC; CC is the Chamber's mail tool) | **Yes** (staff-confirmed 2026-07-10) | **Keep Constant Contact** — the app exports roster/segment lists to CC (manual CSV import first, CC v3 API later; agent-operable runbook, same posture as ADR-0002) | Simplifies the plan: no member-newsletter build needed. Renewal reminders move to QB; Resend stays tourist-side only. Member mailings = ops funding (§6) |
| Member portal (MIC/Info Hub) — **a stated member benefit** | **Yes** (staff-confirmed; `/MIC/login` live) | App business-owner portal (invite/claims, profile self-service) + QB emailed invoice links for payment | QBO's own portal is thin — the app is the member-facing surface. The "member benefit" framing carries over: portal access is a membership entitlement |
| **Automated member rolls on the website** (WP pages show auto-updating member lists from GZ) | **Yes** (staff-confirmed 2026-07-10) | **App-provided directory feed/embeddable widget** consumed by kingstonchamber.com | Small NEW capability: the app already plans public event feeds/widget (M-05-05/FR-EVT-09); a members/new-members equivalent is needed so the WP site never goes stale (§8) |
| Hot deals, store, forms, surveys, news modules | **No (all off/404)** | Nothing to replace | Confirmed by probe — meaningfully shrinks the job |
| Lists/Committees (rosters, mailing lists) | Not in staff's used-features list — **confirm unused** | App groups or a simple spreadsheet until demand proven | Cheap to confirm during the export sweep |
| Reports/dashboards | Yes (implicitly) | App admin reports + QB reports | GZ reports are also the **export vehicle** for migration |
| MemberPlus app / member forum / engagement scoring / sales funnel / chapters / certifications | Not in staff's used-features list — treat as unused | Consciously dropped | |
| Website module hosting | **Yes** — `business.kingstonchamber.com` is GrowthZone-hosted pages wrapped in the WordPress theme | Retire the subdomain: repoint WP nav/widgets to the app, 301 the subdomain | On cancellation those pages go dead; inventory every WP link first |

## 3. Target architecture

**Two systems of record, one boundary, zero payment code in the app (floor unchanged):**

- **App = membership SoR.** Native member store: org identity, membership status, level, renewal date, listing linkage, QB Customer ID. Entitlements derive from native fields (same four choke points — `can()`, `rankListings()`, `resolveMapView()`, feed keys — unchanged from E19). Member-facing surface = the app portal; admin surface = `/admin` (member administration stays off the tourist-facing app per the LTAC partition).
- **QuickBooks = money SoR.** Annual dues as recurring invoices (one Product/Service item per membership level, mapped to a dues income account), auto-send + automatic reminders + customer Autopay. **Simple Start ($38/mo) is sufficient** — recurring invoices, reminders, autopay, ~30 customer custom fields (level dropdown + renewal date), CSV exports, and the full API/webhooks all exist on that tier (verified against Intuit's live matrix 2026-07-10; Simple Start is also exempt from Intuit's Aug 2026 price increase). Avoid depending on Customer Types (Plus-only).
- **The boundary starts manual and agent-operable** (same posture as ADR-0002): app exports a renewal list → staff invoice in QB; staff run a QB paid/open-invoices report → update member status in the app (audited, admin-confirmed). **Later automation is effectively $0:** QBO webhooks fire on Invoice/Payment/Customer events and the free Builder API tier includes 500k reads/month — a ~200-member chamber uses well under 1% of that. "Payment received → member active" becomes an app webhook endpoint when manual gets old.
- **Constant Contact stays the mail tool** (staff-confirmed in use). The roster→CC boundary is the same shape: the app exports member/segment lists as CSV for CC import (a documented, agent-operable runbook); Constant Contact's v3 API can automate list sync later. The app never sends member mailings itself; Resend remains tourist-side.
- **Lapse semantics (proposal, needs sign-off):** unpaid dues past a grace period (recommend 60 days, Chamber confirms) → admin confirms lapse in the app → entitlements decay to community baseline; **listings never auto-unpublish** (E19's additive-only invariant carries over).

**WA money facts for the QB setup:** chamber dues are not a retail sale, so mark dues items **non-taxable** (no WA sales tax). Dues are B&O-deductible as bona fide dues under RCW 82.04.4282 **only to the extent they aren't payment for significant or graduated goods/services** — and membership levels that buy graduated app benefits (E19 tiers, enhanced placement) are exactly the pattern DOR's ETA 3230.2021 allocation method targets, so the Chamber's bookkeeper should apply the allocation caveat rather than assume full deductibility. Card fee 2.99% vs ACH 1% — steer members to ACH; if bank transfer is ever the *only* online payment method on an invoice, disable the "your customer pays the fee" setting or the member gets a surprise $25 convenience charge (invoices over $125). Autopay caps at invoices ≤$5,000 (check against the top dues level) and cancels — with a notification email to the member — whenever the recurring template's amount/terms change, so every dues increase forces re-enrollment; the app should track autopay-enrollment status.

## 4. Migration sequence (strangler — each phase ships value; each has an off-ramp)

- **R0 — Audit & safety net (now, before anything else).**
  1. **Find the GrowthZone renewal date and current contract price.** The contract auto-renews annually; non-renewal requires **written notice ≥30 days before term end**; fees are non-refundable; the ToS grants **no data-export rights after termination**. The renewal date is the project clock.
  2. Staff audit checklist (§7) — 30 minutes with someone who has back-office access.
  3. **Full export sweep while subscribed** (repeatable; do a first pass now): contacts, memberships + history, open/historical invoices & payments, event history, committee/list rosters, directory listing content incl. images/descriptions, email templates + automated-communication definitions. Store in the Chamber's drive + the app's encrypted backup bucket.
  4. Generate the whole-calendar iCal feed (already OPERATIONS §9 item 6b).
- **R1 — Events (already decided, ADR-0002).** In-app submission + moderation; GrowthZone iCal as transitional feed; WordPress events links repoint to the app. *Off-ramp: everything still works if we stop here; GZ keeps running.*
- **R2 — Directory + portal + join form.** App directory becomes the public directory (E17 claims/self-service); WordPress directory links repoint; the **member-application form** ships in-app (→ moderation → org record + "create QB customer + first invoice" runbook step). MIC's two member functions are replaced: profile updates (app portal), invoice payment (QB emailed links). *Off-ramp: GZ still holds the roster; nothing lost if paused here.*
- **R3 — Membership SoR flip.** Freeze GZ edits → final export sweep → migration import (dry-run first, agent-operable) → native member store live, entitlements read native fields → QB renewal loop live (recurring invoices set up per level) → eNews/communications replacement confirmed. From here GrowthZone is read-only legacy.
- **R4 — Retire and cancel.** Repoint/301 `business.kingstonchamber.com`; verify nothing links to GZ pages; **migration-completeness gate** (the checklist below must be green — this replaces the old E04 gate as the human go/no-go); send written non-renewal notice **no later than 30 days before term end** (i.e., BEFORE the final 30 days begin — notice sent inside the last 30 days is too late and auto-renews another non-refundable year); confirm cancellation in writing.
  - **Timeline anchor:** call the notice deadline **T−30** (term end = T). The gate's "live ≥30 days" requirement means R2/R3 must be complete by roughly **T−60**. Work backwards from the renewal date the moment audit item 1 lands.
  - Gate checklist: final exports archived + restorable; **roster reconciliation** — every member in the final GZ export is accounted for in the app, with post-freeze in-app joins itemized separately (strict count-equality is wrong once the R2 join form is live); QB customers reconciled to roster; renewal templates configured and invoices confirmed generating for members whose anniversaries have passed; website carries zero GZ links; events/directory/join-form live in app for ≥30 days (jobs only if the audit confirms the GZ jobs module is actually used — staff did not name it); staff sign-off that no daily task still needs GZ.

## 5. What this saves and costs

| Line | Today | After roll-off |
|---|---|---|
| GrowthZone base subscription | ~$3,900–3,985/yr | **$0** |
| GrowthZone API module (was under consideration) | $0 (never bought) | $0 — question permanently closed |
| QuickBooks Online | already being paid (audit tier) | same — Simple Start $38/mo suffices for dues |
| App infra | $15–35/mo | unchanged (member store adds ~nothing) |
| Payment processing | GZ Pay rates (audit) | QB Payments: 1% ACH / 2.99% card, no monthly fee |

The hidden cost is **operational, not monetary**: support and stewardship (password resets, onboarding, data hygiene, lapse chasing) move from GrowthZone's product to Chamber staff + the app's admin tools + Mat. The mitigations are already corpus floors: phone-first ~10-second admin tasks (NFR-A33), edit-on-behalf, audited actions, and the agent-operable runbooks (ADR-0002 posture) so an AI agent can absorb the routine work.

## 6. Funding compliance (hard floor)

A membership CRM is **member service, not tourism promotion**. This plan's rule — every dollar of SoR build and operation is **Chamber ops money, never LTAC** — is consistent with the corpus's never-mix partition floor (00-DECISIONS §5, NFR-14's tourism-only LTAC scope, E18's one-funding-source-per-ledger-entry rule, E17's precedent that business claiming/onboarding is member service) and deliberately **stricter than the corpus's one contrary precedent**: the old "AMS API enablement fee → LTAC paid-integration ask" route (E18 seed list, ADR-0001), which §8 revokes as moot under roll-off. Membership administration stays behind `/admin` and `/portal` so an LTAC reviewer auditing the deliverable sees a tourism app; the ~$3.9k/yr GrowthZone savings is ops money (not LTAC match); and the E18 cost-attribution ledger records the split. The tourist-facing calendar/directory surfaces remain LTAC-clean.

## 7. Staff audit — answered 2026-07-10 + remaining items

**Staff-confirmed used features (2026-07-10):** (1) membership signup and renewal; (2) calendar and events **including ticketing**; (3) Constant Contact integration; (4) InfoHub access as a member benefit; (5) automated member rolls on the website. Not mentioned — treat as unused pending the export sweep: lists/committees, MemberPlus, forums, store, forms, surveys, hot deals, sales funnel.

**Still needed:**

1. **Contract:** renewal date, current annual price, any multi-year term. *(This sets the whole timeline — the single most important unknown.)*
2. **Ticketing money path:** which processor GZ event ticketing uses (GZ Pay?) and roughly how many paid events/year + ticket volume (sizes the replacement).
3. **Member count + levels list** (exact level names — they become QB items and app levels).
4. **QuickBooks:** which QBO tier the Chamber is on, and whether QuickBooks Payments is enabled.
5. **Constant Contact:** which lists/segments GZ currently syncs to CC (they must be reproduced from the app's exports).
6. **Automated communications inventory:** renewal reminders / onboarding / invoice emails firing from GZ today (they stop silently at cancellation; QB reminders + CC replace them).
7. **Email templates/content worth keeping** (export before cancellation).

## 8. Requirements & build-plan deltas (the follow-up worklist — NOT yet applied)

- **Vision amendment (needs an explicit ADR):** the corpus's "never a bank, a CRM, or a chat app" boundary (00-VISION line 29) conflicts head-on with app-as-membership-SoR. Scope the amendment narrowly: *the Chamber's own roster* — still never a general CRM, never orgs' donor/member data (NFR-15 letter unchanged), still never a bank.
- **New ADR-0003 (QuickBooks boundary):** money SoR vs membership SoR; manual agent-operable CSV interface both directions first; QB webhooks as the later automation; zero payment code in the app ever.
- **New capability: member-application intake** (form → moderation → org + QB handoff) — currently a coverage gap in the 141-item backlog; must land in an epic per the no-silent-absence rule.
- **New capability: directory feed/widget for the Chamber website** — replaces GrowthZone's auto-updating "member rolls" on kingstonchamber.com (staff-confirmed in use). Sibling of the planned events feed/widget (M-05-05/FR-EVT-09); likely lands in E23 syndication scope.
- **New runbook: roster → Constant Contact list export** (manual CSV first, CC v3 API later) — replaces GrowthZone's CC sync; agent-operable per the ADR-0002 posture.
- **Paid-event ticketing replacement decision** (see §9) — the FR-A15 deep-link-out floor means choosing an external provider, not building ticketing.
- **Epic re-charters:** **E16 rewritten** (sync engine → one-time migration importer + native member store + native entitlements); **E24 cancelled** (close-out ADR); **E04 closed as walk-away**, replaced by the R4 migration-completeness gate; **E19 amended** (tier mapping reads native level / QB items instead of `ams_level_names`); **E18 amended** (ledger seeds: drop the "AMS API enablement fee — LTAC ask" line as moot; add QB subscription and, until cancellation, the GrowthZone subscription as chamber-ops lines); **E12 amended** (transitional feed end date; whole-subdomain retirement, not just the events page); **E17/E11/E23/E28 touch-ups** (verification against native store; PII inventory covers native member tables; delete AMS channel refs; jobs board is the GZ-jobs replacement).
- **Floors that get heavier:** MHMDA — the app becomes PII *custodian* for the roster (E16's exclude-email-by-default posture is incompatible with being the SoR; member contact fields now need inventory + retention + access/delete coverage per the E11 contract); backups — the rehearsed restore (M-20-01) and nightly JSON export must demonstrably cover the member tables, because post-cancellation they are the *only copy of the Chamber's roster*; records retention/legal hold (FR-A92) now covers membership applications and status changes.
- **ADR-0001/0002 updates:** ADR-0001 gate closes as walk-away once this plan is accepted (its questions become moot); ADR-0002's transitional GrowthZone ingest gets an explicit end date (R3).

## 9. Open decisions

1. **Proceed with the roll-off?** (Mat + Chamber board — this document is the evaluation input.)
2. **Timeline anchor:** GrowthZone renewal date (audit item 1) → work backwards; if renewal is close, decide whether to eat one more year or sprint R0–R4.
3. **Paid-event ticketing provider** (replaces GZ ticketing; app deep-links out per FR-A15): QB payment links (simplest, no attendee management), Eventbrite (per-ticket fees, passable to buyers), Zeffy (free — verify 501(c)(6) eligibility first), Ticket Tailor (flat low fee). Decide once audit item 2 sizes the volume.
4. **Lapse grace period** (recommend 60 days) and who confirms lapses.
5. **Member email/PII posture** as SoR (consent + retention wording — E11 amendment).
6. **Cutover date for the `business.kingstonchamber.com` subdomain** (already flagged in ADR-0002, now scoped to the whole subdomain).
