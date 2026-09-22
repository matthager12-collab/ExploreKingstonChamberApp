# ADR-0008 — Paid race registration on Zeffy under the FR-A15 floor

**Status:** Accepted (Mat, 2026-09-16)
**Applies to:** the "Not Afraid of the Dark 5K" (7 Nov 2026) and any later paid Chamber event

## Context

The Chamber's first paid event needed online registration and a race-day roster. ROLLOFF-GROWTHZONE.md §0.3 had already ruled that paid ticketing, when wanted, deep-links out to an external provider under the FR-A15 floor ("zero payment code in the app"), naming Zeffy as a candidate pending its 501(c)(6) eligibility. GrowthZone is being cancelled (April 2027) and the Chamber's PayPal POS is card-present hardware, so neither carries new online registration.

## Decision

1. **Zeffy is the registration and payment system.** Eligible (any registered US nonprofit with an EIN and a bank account, 501(c)(6) named explicitly), free, per-ticket custom questions, e-tickets, a documented read API and HMAC-signed webhooks. The Chamber built the campaign itself; the app links out to it from `/race` with a plain link. No iframe — the CSP has no `frame-src`, and an embedded checkout would put payment UI on the Chamber's domain.
2. **The roster is synced, not uploaded.** `src/lib/race/sync.ts` pulls succeeded payments for one campaign and upserts one row per ticket on `(payment_id, item_id)`. Every run is a full idempotent resync; the signed webhook only nudges it. "Sync now" in `/admin/race` is the authoritative path — the ADR-0002/ADR-0003 posture, manual-first with automation as an accelerator.
3. **Runner data kept is the minimum plus email:** name, email, ticket type, the mapped t-shirt answer, the mapped waiver answer (when the form asks), status, check-in time. Every other custom answer is dropped in code before storage. Bibs and timing belong to the timing company; the app assigns no bibs.
4. **A dedicated table, not the `record` store.** `writeRecord` snapshots whole documents into the immortal audit table; with email on the row that would copy a runner's email on every check-in tap. `race_registrant` mirrors `volunteer_signup`: ids-only audit rows, nullable PII columns, anonymized 45 days after race day.
5. **Check-in is admins plus one race-day link.** Volunteers use a signed, expiring link bound to `race_checkin_link.version`; minting or revoking bumps the version so every earlier link dies. The volunteer surface never carries email.

## Consequences

- The Zeffy API key is write-capable (no read-only key exists); it is `server-only`, never logged, and rotated from Zeffy's dashboard if it leaks.
- The webhook is per organisation and fires for every campaign; the receiver filters on `campaign_id`.
- Walk-ups on race day are recorded as offline payments in the Zeffy dashboard, never in the app — one source of truth.
- `race_registrant` is not yet in the backup bundle or the JSON export (the same gap `volunteer_signup` carries). Zeffy remains the source of truth and a resync rebuilds the roster; check-in state and the link version are the only app-only facts.
- A second edition of the race means a new campaign id, a new `race.id`, and either a truncate or a campaign column — deliberately not built now.

## Rejected

- **GrowthZone's ticketing module** — unused, on a subscription ending April 2027; new registrant data there would only enlarge the export sweep.
- **CSV upload instead of the API** — the owner chose the API sync; the CSV path remains the manual fallback via Zeffy's own exports.
- **Storing every answer** — an emergency-contact or medical field would turn the app into a second custodian of data Zeffy already holds.
