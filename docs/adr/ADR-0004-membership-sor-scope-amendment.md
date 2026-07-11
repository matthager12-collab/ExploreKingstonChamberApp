# ADR-0004 — Scope amendment: the app becomes the Chamber's membership system of record

## Status

Accepted — decided by Mat 2026-07-10 via the GrowthZone roll-off plan (docs/ROLLOFF-GROWTHZONE.md, accepted with modifications). This ADR is the explicit amendment the requirements corpus demands: the vision layer forbids the app "ever becoming a bank, a CRM, or a chat app" (chamber-app-requirements 00-VISION-AND-PERSONAS), and admin story A3-US8 assumed "the CRM is our record of truth and the app should follow it." Those boundaries are amended here by decision, not silently outgrown.

## Context

The Chamber is cancelling GrowthZone (term ends ~April 2027). After the R3 migration (roll-off plan §4), no upstream AMS exists: the app's member store is not a mirror of anything — it IS the Chamber's roster. The "never a CRM" boundary existed to protect a volunteer-built tourism app from enterprise-CRM scope creep; replacing a cumbersome vendor system the Chamber already pays ~10% of its dues revenue for is a different, deliberate trade the Chamber has chosen.

## Decision

The app becomes the **system of record for exactly one thing it previously mirrored: the Greater Kingston Community Chamber of Commerce's own membership roster** — org identity, membership status, level, renewal date, join history, listing linkage, QB customer linkage.

**The rest of the boundary stands, restated so the fence is visible:**

- Still **never a general CRM**: no sales pipelines, no prospect tracking, no engagement scoring, no communication-history logging beyond the audit trail.
- Still **never a home for member orgs' own data**: nonprofits' donor/member/chat data stays in their chosen external tools with export guarantees (NFR-15's letter is untouched).
- Still **never a bank**: ADR-0003 puts all money in QuickBooks; zero payment code (NFR-06/FR-A15).
- Still **never a chat app**.
- Member administration lives behind `/admin` and `/portal` only — the tourist-facing app is unchanged, and an LTAC reviewer auditing the tourism deliverable sees a tourism app (funding partition below).

## Consequences

- **MHMDA/PII custodianship (heavier floor):** the app is now the primary custodian of member contact data. E16's old "exclude member email by default" mirror posture is replaced by a deliberate minimal-field policy: the member store holds the minimum contact fields the roster function needs (per the E11 PII-inventory contract: registered store, retention rule, access/delete coverage, consent wording in the privacy notice). 166 of 174 active members have emails in the migration source; storing them is now a chartered decision, not an accident.
- **Backups become existential (heavier floor):** after R3 the app holds the only copy of the roster. The rehearsed non-programmer restore (M-20-01) and the nightly human-readable JSON export must demonstrably include the member tables **before** the GrowthZone cancellation gate (roll-off plan §4 R4) can pass. The vendor-exit export (FR-A95) now covers the roster.
- **The audit trail is the only membership history** — every status/level change, lapse confirmation, and edit-on-behalf writes append-only audit rows (FR-A05/M-15-08); records retention and legal-hold (FR-A92) cover membership applications and status changes.
- **Funding partition:** all membership-SoR build and operation is **Chamber ops money, never LTAC** (stricter than the corpus's revoked AMS-fee-via-LTAC precedent; recorded in E18's ledger). The ~$3.9k/yr GrowthZone savings is ops money.
- **Inverted requirements recorded, not rewritten:** A3-US8's import machinery survives as the one-time migration importer; M-19-05's member-record precedence question disappears (single native source); the AmsProvider seam's job ends at migration — see the E16 re-charter and the E04 close-out.
