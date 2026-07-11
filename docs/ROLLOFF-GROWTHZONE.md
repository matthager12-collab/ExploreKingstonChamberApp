# GrowthZone roll-off plan

**Status: ACCEPTED with modifications** — Mat evaluated and approved 2026-07-10 ("plan looks good with my modifications"); his modifications are recorded in §0 below and folded through the document. The §8 "Requirements & build-plan deltas" worklist is now active. Research provenance: vendor pages, Intuit docs, and WA DOR read 2026-07-10; tenant module states probed live the same day; member roster from the Chamber's 2026-07-10 GrowthZone export.

## 0. Decision readout (2026-07-10 — read this first at handover)

Mat's decisions on evaluation, in plain terms:

1. **Jobs board is IN.** Even though staff didn't list the GrowthZone jobs module among used features, Mat wants a jobs board in the app. It ships via E28 in its child-safety shape (Chamber-vetted employers only, moderated, no applicant intake in the app) and stays in the R4 gate checklist. E28 is a Phase-4 epic — with the relaxed timeline below, that sequencing works.
2. **Every other module staff didn't name is DROPPED, no replacement:** lists/committees, MemberPlus, member forum, hot deals, store, forms, surveys, engagement scoring, sales funnel. If a need re-emerges later, it's a new feature request, not a migration obligation.
3. **Ticketing is NOT currently used** (corrects the earlier read of the staff feature list — "events including ticketing" meant the calendar's capability, not active use). Paid ticketing is a **future feature request**: nothing to migrate, nothing gate-blocking. When wanted, the FR-A15 floor applies (deep-link out to an external provider — QB payment links / Eventbrite / Ticket Tailor / Zeffy-if-eligible); decide then.
4. **Timeline: no huge rush.** The Chamber **just renewed** GrowthZone, so there's roughly a year of runway. The exact term-end date should still be pinned (one line in the contract or invoice) so the T−30 non-renewal deadline goes on a calendar now — a year passes fast and missing it costs ~$4k.
5. **Member roster received** — 2026-07-10 GrowthZone export analyzed in §2b below. Published dues tiers: [kingstonchamber.com/membership](https://kingstonchamber.com/membership/) (new structure effective June 1, 2026).

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
| Event registration/ticketing | **Not currently used** (Mat, 2026-07-10) — requested as a **future feature** | Free events: in-app RSVP (M-05-08). Paid events (future): deep-link out to a provider per the FR-A15 floor | Nothing to migrate; not gate-blocking. Provider options when wanted: QB payment links (simplest, no attendee mgmt), Eventbrite (fees pass to buyers), Ticket Tailor (flat low fee), Zeffy (free — verify 501(c)(6) eligibility) |
| Job postings | Module on (`/jobs` live); not in staff's used list, but **Mat wants a jobs board in the app** (2026-07-10, §0) | **App jobs board — E28**, Tension-4 child-safety shape: Chamber-vetted employers only, moderated, no applicant intake in the app | E28 is Phase-4; fits the relaxed timeline. Stays in the R4 gate |
| Member application (join form) | **Yes** (`/member-application` live) | **App — NEW capability** (coverage gap; no M-xx owns it today) | Form → moderation queue → creates org + QB customer handoff |
| **Constant Contact integration** (GZ syncs member lists to CC; CC is the Chamber's mail tool) | **Yes** (staff-confirmed 2026-07-10) | **Keep Constant Contact** — the app exports roster/segment lists to CC (manual CSV import first, CC v3 API later; agent-operable runbook, same posture as ADR-0002) | Simplifies the plan: no member-newsletter build needed. Renewal reminders move to QB; Resend stays tourist-side only. Member mailings = ops funding (§6) |
| Member portal (MIC/Info Hub) — **a stated member benefit** | **Yes** (staff-confirmed; `/MIC/login` live) | App business-owner portal (invite/claims, profile self-service) + QB emailed invoice links for payment | QBO's own portal is thin — the app is the member-facing surface. The "member benefit" framing carries over: portal access is a membership entitlement |
| **Automated member rolls on the website** (WP pages show auto-updating member lists from GZ) | **Yes** (staff-confirmed 2026-07-10) | **App-provided directory feed/embeddable widget** consumed by kingstonchamber.com | Small NEW capability: the app already plans public event feeds/widget (M-05-05/FR-EVT-09); a members/new-members equivalent is needed so the WP site never goes stale (§8) |
| Hot deals, store, forms, surveys, news modules | **No (all off/404)** | Nothing to replace | Confirmed by probe — meaningfully shrinks the job |
| Lists/Committees (rosters, mailing lists) | **Dropped** (Mat, 2026-07-10, §0) | None — spreadsheet if a need re-emerges | Export any committee rosters during the R0 sweep anyway (they're one click and irreplaceable after cancellation) |
| Reports/dashboards | Yes (implicitly) | App admin reports + QB reports | GZ reports are also the **export vehicle** for migration |
| MemberPlus app / member forum / engagement scoring / sales funnel / chapters / certifications | **Dropped** (Mat, 2026-07-10, §0) | None | |
| Website module hosting | **Yes** — `business.kingstonchamber.com` is GrowthZone-hosted pages wrapped in the WordPress theme | Retire the subdomain: repoint WP nav/widgets to the app, 301 the subdomain | On cancellation those pages go dead; inventory every WP link first |

## 2b. Member roster snapshot (from the Chamber's 2026-07-10 GrowthZone export)

Source: "Membership Report.xlsx", generated 2026-07-10 from the GrowthZone back office (83 columns — the export is rich enough to seed the migration importer as-is). **The file itself contains member PII (emails, phones, addresses) and must NOT be committed to this repo** — store it in the Chamber's drive and the R0 encrypted-backup archive; only the aggregates below live here. Headline numbers:

- **174 Active memberships** (+4 Courtesy, 3 Pending Approval; 37 Dropped records in the report). 166 of 174 active have an email on file.
- **Active dues total ≈ $38.8k/yr** — the GrowthZone subscription (~$4k) consumes roughly **10% of dues revenue**, which is the board-pitch number for this plan.
- **Renewals are anniversary-based and spread across all 12 months** (Jan 26, Mar 23, Nov 21, Feb 15, …). Consequence: QB gets **one recurring annual invoice per member on their anniversary**, not a batch renewal date — and the R4 gate's "renewal invoices generating" check can only be verified for anniversaries that have passed.
- **The type/level data is messy and mid-transition.** 15 distinct legacy membership-type names (e.g. "Business Membership Annual", "Annual Business Membership (based on full time employees)", "5-10 employees & patron"…), 85 of 174 active records have **no Level value**, and legacy prices ($90/$100/$125/$155/$195…) don't match the published tiers. The Chamber simplified to a new structure **effective June 1, 2026** ([kingstonchamber.com/membership](https://kingstonchamber.com/membership/)): **Nonprofit/Community $115 · Small Business (≤5 FTE + food service) $160 · Medium Business (6–20 FTE) $375 · Large Business (>20 FTE) $550 · Patron add-on $350 · Visionary Sponsor $10,000+ · one-time lunch sponsorship $150.** Members presumably migrate to new rates at renewal. Consequences: (a) the migration importer needs an explicit **old-type → new-tier mapping table** (human-reviewed, not guessed); (b) QB items should be the **new** tiers, with the legacy price honored per member until their first post-migration renewal; (c) the one **$10,000+ Visionary** membership exceeds QB Autopay's $5k cap — it gets a manually-sent invoice.
- The membership page's "To Join" link points at business.kingstonchamber.com (the GrowthZone application) — add it to the R4 website-link inventory; it repoints to the app's join form in R2.

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
  - Gate checklist: final exports archived + restorable; **roster reconciliation** — every member in the final GZ export is accounted for in the app, with post-freeze in-app joins itemized separately (strict count-equality is wrong once the R2 join form is live); QB customers reconciled to roster; renewal templates configured and invoices confirmed generating for members whose anniversaries have passed; website carries zero GZ links; events/directory/join-form/jobs-board live in app for ≥30 days (jobs board per Mat's §0 decision, shipped via E28); staff sign-off that no daily task still needs GZ.

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

## 7. Staff audit — status

**Answered (2026-07-10, Mat + staff):**
- Used features: membership signup/renewal; events calendar; Constant Contact integration; InfoHub as member benefit; automated member rolls on the website. Ticketing: **not used** (future request). Jobs board: wanted in the app regardless of GZ usage (§0).
- Contract timing: **just renewed — no rush**; roughly a year of runway.
- Member roster: received and analyzed (§2b).
- Everything unnamed: dropped (§0).

**Still needed (small list now):**

1. **Exact GrowthZone term-end date** (one line on the renewal invoice/contract) — even with no rush, the **T−30 written-notice deadline goes on the calendar today**; missing it costs ~$4k.
2. **QuickBooks:** which QBO tier the Chamber is on, and whether QuickBooks Payments is enabled.
3. **Constant Contact lists** — concretely: in Constant Contact, open **Contacts → Lists** and note (a) which lists exist, and (b) which ones GrowthZone fills automatically (typically something like "Active Members" — the integration syncs GZ groups/segments into CC lists). Those auto-filled lists are what the app's export runbook must keep populated after GrowthZone is gone; if nobody knows, a screenshot of the Lists page is enough for Mat to work it out.
4. **Dues payment path today:** do members pay GZ invoices online (GZ Pay / card) or by check? (Determines how much payment-behavior change the QB cutover asks of members.)
5. **Email templates/automated communications worth keeping** — export during the R0 sweep.

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

1. ~~Proceed with the roll-off?~~ **Decided: yes, with modifications** (Mat, 2026-07-10 — §0). Chamber board briefing still worthwhile before R3 (the SoR flip) using §2b's 10%-of-dues number.
2. **Timeline anchor:** just renewed → ~a year of runway; pin the exact term-end date and calendar the T−30 notice deadline now (audit item 1).
3. ~~Paid-event ticketing provider~~ **Deferred: ticketing is a future feature** (not used today — §0). Provider options recorded in §2 for when it's wanted.
4. **Lapse grace period** (recommend 60 days) and who confirms lapses.
5. **Member email/PII posture** as SoR (consent + retention wording — E11 amendment). Note §2b: 166/174 active members have emails in the export, so this decision is now concrete.
6. **Cutover date for the `business.kingstonchamber.com` subdomain** (already flagged in ADR-0002, now scoped to the whole subdomain — including the kingstonchamber.com membership page's "To Join" link).
7. **Old-type → new-tier mapping** (§2b): a human-reviewed table mapping the 15 legacy membership-type names onto the four published tiers + add-ons, before the migration import.
