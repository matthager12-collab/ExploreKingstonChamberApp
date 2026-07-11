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
| Events calendar | **Yes** (`/events` live) | **App — already decided** (docs/adr/ADR-0002-app-first-events-and-manual-exports.md) | Transitional GrowthZone iCal ingest gets an end date |
| Event registration/ticketing | Audit | Free RSVP in-app; paid ticketing deep-links out (FR-A15 floor) | If GZ registration is used for paid events, replacement = QB invoice links or org's own processor |
| Job postings | **Yes** (`/jobs` live) | App jobs board (E28, Tension-4 child-safety shape: vetted employers, no applicant intake) | |
| Member application (join form) | **Yes** (`/member-application` live) | **App — NEW capability** (coverage gap; no M-xx owns it today) | Form → moderation queue → creates org + QB customer handoff |
| eNews / mass email / automated communications | **Yes** (`/enews` live) | Planned Resend newsletter (FR-ORG-04) for public; **audit** what automated member emails exist (renewal reminders move to QB) | Member-only mailings are NOT LTAC-eligible — funding note in §6 |
| Member portal (MIC/Info Hub: pay invoices, update profile) | **Yes** (`/MIC/login` live) | App business-owner portal (invite/claims) + QB emailed invoice links for payment | QBO's own portal is thin — the app is the member-facing surface |
| Hot deals, store, forms, surveys, news modules | **No (all off/404)** | Nothing to replace | Confirmed by probe — meaningfully shrinks the job |
| Lists/Committees (rosters, mailing lists) | **Audit** | App groups or a simple spreadsheet until demand proven | Chambers often live on this — check before cutover |
| Reports/dashboards | Yes (implicitly) | App admin reports + QB reports | GZ reports are also the **export vehicle** for migration |
| MemberPlus app / member forum / engagement scoring / sales funnel / chapters / certifications | Audit (likely unused) | Consciously dropped unless audit says otherwise | |
| Website module hosting | **Yes** — `business.kingstonchamber.com` is GrowthZone-hosted pages wrapped in the WordPress theme | Retire the subdomain: repoint WP nav/widgets to the app, 301 the subdomain | On cancellation those pages go dead; inventory every WP link first |

## 3. Target architecture

**Two systems of record, one boundary, zero payment code in the app (floor unchanged):**

- **App = membership SoR.** Native member store: org identity, membership status, level, renewal date, listing linkage, QB Customer ID. Entitlements derive from native fields (same four choke points — `can()`, `rankListings()`, `resolveMapView()`, feed keys — unchanged from E19). Member-facing surface = the app portal; admin surface = `/admin` (member administration stays off the tourist-facing app per the LTAC partition).
- **QuickBooks = money SoR.** Annual dues as recurring invoices (one Product/Service item per membership level, mapped to a dues income account), auto-send + automatic reminders + customer Autopay. **Simple Start ($38/mo) is sufficient** — recurring invoices, reminders, autopay, ~30 customer custom fields (level dropdown + renewal date), CSV exports, and the full API/webhooks all exist on that tier (verified against Intuit's live matrix 2026-07-10; Simple Start is also exempt from Intuit's Aug 2026 price increase). Avoid depending on Customer Types (Plus-only).
- **The boundary starts manual and agent-operable** (same posture as ADR-0002): app exports a renewal list → staff invoice in QB; staff run a QB paid/open-invoices report → update member status in the app (audited, admin-confirmed). **Later automation is effectively $0:** QBO webhooks fire on Invoice/Payment/Customer events and the free Builder API tier includes 500k reads/month — a ~200-member chamber uses well under 1% of that. "Payment received → member active" becomes an app webhook endpoint when manual gets old.
- **Lapse semantics (proposal, needs sign-off):** unpaid dues past a grace period (recommend 60 days, Chamber confirms) → admin confirms lapse in the app → entitlements decay to community baseline; **listings never auto-unpublish** (E19's additive-only invariant carries over).

**WA money facts for the QB setup:** plain chamber dues are bona fide dues — B&O-deductible under RCW 82.04.4282 and not a retail sale, so mark dues items **non-taxable**. Card fee 2.99% vs ACH 1% — steer members to ACH but never make ACH the *only* option (Intuit adds a $25 customer-paid fee on ACH-only invoices over $125). Autopay silently cancels whenever the recurring template's amount/terms change — every dues increase forces member re-enrollment, so the app should track autopay-enrollment status.

## 4. Migration sequence (strangler — each phase ships value; each has an off-ramp)

- **R0 — Audit & safety net (now, before anything else).**
  1. **Find the GrowthZone renewal date and current contract price.** The contract auto-renews annually; non-renewal requires **written notice ≥30 days before term end**; fees are non-refundable; the ToS grants **no data-export rights after termination**. The renewal date is the project clock.
  2. Staff audit checklist (§7) — 30 minutes with someone who has back-office access.
  3. **Full export sweep while subscribed** (repeatable; do a first pass now): contacts, memberships + history, open/historical invoices & payments, event history, committee/list rosters, directory listing content incl. images/descriptions, email templates + automated-communication definitions. Store in the Chamber's drive + the app's encrypted backup bucket.
  4. Generate the whole-calendar iCal feed (already OPERATIONS §9 item 6b).
- **R1 — Events (already decided, ADR-0002).** In-app submission + moderation; GrowthZone iCal as transitional feed; WordPress events links repoint to the app. *Off-ramp: everything still works if we stop here; GZ keeps running.*
- **R2 — Directory + portal + join form.** App directory becomes the public directory (E17 claims/self-service); WordPress directory links repoint; the **member-application form** ships in-app (→ moderation → org record + "create QB customer + first invoice" runbook step). MIC's two member functions are replaced: profile updates (app portal), invoice payment (QB emailed links). *Off-ramp: GZ still holds the roster; nothing lost if paused here.*
- **R3 — Membership SoR flip.** Freeze GZ edits → final export sweep → migration import (dry-run first, agent-operable) → native member store live, entitlements read native fields → QB renewal loop live (recurring invoices set up per level) → eNews/communications replacement confirmed. From here GrowthZone is read-only legacy.
- **R4 — Retire and cancel.** Repoint/301 `business.kingstonchamber.com`; verify nothing links to GZ pages; **migration-completeness gate** (the checklist below must be green — this replaces the old E04 gate as the human go/no-go); send written non-renewal notice inside the 30-day window; confirm cancellation.
  - Gate checklist: final exports archived + restorable; member count in app == final GZ export; QB customers reconciled to roster; renewal invoices generating; website carries zero GZ links; events/directory/jobs/join-form live in app for ≥30 days; staff sign-off that no daily task still needs GZ.

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

A membership CRM is **member service, not tourism promotion**. Per the corpus's unanimous ruling (00-DECISIONS §5, NFR-14, E18's ledger rules, Reconciliation Tension 5): every dollar of SoR build and operation is **Chamber ops money, never LTAC**; membership administration stays behind `/admin` and `/portal` so an LTAC reviewer auditing the deliverable sees a tourism app; the ~$3.9k/yr GrowthZone savings is ops money (not LTAC match); and the E18 cost-attribution ledger records the split. The tourist-facing calendar/directory surfaces remain LTAC-clean.

## 7. Staff audit checklist (30 minutes, back-office access required)

1. **Contract:** renewal date, current annual price, any multi-year term. *(This sets the whole timeline.)*
2. **GZ Pay:** is integrated payment processing enabled — for dues? event tickets? (Statements will show payouts.)
3. **Automated communications:** which renewal reminders / onboarding emails / invoice emails fire automatically today? (They stop silently at cancellation.)
4. **Lists/Committees:** which committees, mailing lists, and rosters live in GZ?
5. **Info Hub usage:** do members actually log in — pay invoices online? update their own profiles? (Adoption is typically low; confirm.)
6. **MemberPlus app adoption:** anyone using it?
7. **Event registration:** were any paid/ticketed events run through GZ in the last year?
8. **Member count + levels list** (exact level names — they become QB items and app levels).
9. **QuickBooks:** which QBO tier is the Chamber on, and is QuickBooks Payments enabled?
10. **Email templates/content worth keeping** (export before cancellation).

## 8. Requirements & build-plan deltas (the follow-up worklist — NOT yet applied)

- **Vision amendment (needs an explicit ADR):** the corpus's "never a bank, a CRM, or a chat app" boundary (00-VISION line 29) conflicts head-on with app-as-membership-SoR. Scope the amendment narrowly: *the Chamber's own roster* — still never a general CRM, never orgs' donor/member data (NFR-15 letter unchanged), still never a bank.
- **New ADR-0003 (QuickBooks boundary):** money SoR vs membership SoR; manual agent-operable CSV interface both directions first; QB webhooks as the later automation; zero payment code in the app ever.
- **New capability: member-application intake** (form → moderation → org + QB handoff) — currently a coverage gap in the 141-item backlog; must land in an epic per the no-silent-absence rule.
- **Epic re-charters:** **E16 rewritten** (sync engine → one-time migration importer + native member store + native entitlements); **E24 cancelled** (close-out ADR); **E04 closed as walk-away**, replaced by the R4 migration-completeness gate; **E19 amended** (tier mapping reads native level / QB items instead of `ams_level_names`); **E18 amended** (ledger seeds: drop AMS-fee LTAC ask, drop GZ subscription, add QB as ops); **E12 amended** (transitional feed end date; whole-subdomain retirement, not just the events page); **E17/E11/E23/E28 touch-ups** (verification against native store; PII inventory covers native member tables; delete AMS channel refs; jobs board is the GZ-jobs replacement).
- **Floors that get heavier:** MHMDA — the app becomes PII *custodian* for the roster (E16's exclude-email-by-default posture is incompatible with being the SoR; member contact fields now need inventory + retention + access/delete coverage per the E11 contract); backups — the rehearsed restore (M-20-01) and nightly JSON export must demonstrably cover the member tables, because post-cancellation they are the *only copy of the Chamber's roster*; records retention/legal hold (FR-A92) now covers membership applications and status changes.
- **ADR-0001/0002 updates:** ADR-0001 gate closes as walk-away once this plan is accepted (its questions become moot); ADR-0002's transitional GrowthZone ingest gets an explicit end date (R3).

## 9. Open decisions

1. **Proceed with the roll-off?** (Mat + Chamber board — this document is the evaluation input.)
2. **Timeline anchor:** GrowthZone renewal date (audit item 1) → work backwards; if renewal is close, decide whether to eat one more year or sprint R0–R4.
3. **eNews/communications tool:** Resend-based newsletter (planned) vs the Chamber adopting a dedicated mail tool for member communications (funding: member mailings are ops, not LTAC).
4. **Lapse grace period** (recommend 60 days) and who confirms lapses.
5. **Member email/PII posture** as SoR (consent + retention wording — E11 amendment).
6. **Cutover date for the `business.kingstonchamber.com` subdomain** (already flagged in ADR-0002, now scoped to the whole subdomain).
