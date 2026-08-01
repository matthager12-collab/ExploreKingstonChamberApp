# Privacy — operator data map & governance (E11)

The operator-facing companion to the public privacy notice (`/privacy`). The
public page renders its retention schedule from `src/lib/privacy/policy.ts`
(`RETENTION_POLICY`); this doc is the data map, the registration contract, and
the legal-hold / records reconciliation behind it.

**Funding:** MHMDA compliance is an **operations** cost, never LTAC-eligible.
Per `docs/adr/ADR-0004-membership-sor-scope-amendment.md`, all
membership-system-of-record work is likewise **Chamber ops money, never LTAC**.

## 1. Every store that holds personal data

Registered in `src/lib/privacy/pii-inventory.ts` (`PII_STORES`). Each entry
implements `findByIdentifier` / `exportRecords` / `deleteOrAnonymize`; the
`pii-inventory` coverage test is the tripwire.

| Store | Identifier | What | Retention | Backend |
|---|---|---|---|---|
| `users` | email | Account email, name, scrypt password hash | 25 months (event logs); account lives until anonymized | Postgres `users` |
| `invites` | email | Optional invitee email + note | until redeemed/expired | Postgres `invites` |
| `charities` | `contactEmail` | Optional public contact email on a listing | until scrubbed | `record` store `charities` |
| `worklist_item` | payload `contact` | Privacy/accuracy request contact (OPEN items only) | scrubbed at resolution | Postgres `worklist_item` |
| `hunt-submissions` | *(no identifier)* | Photo + optional precise check-in location | 12 months | `record` + fs/blob photos |
| `survey_response` | *(none — anonymous)* | LTAC survey answers | 36 months | Postgres `survey_response` |
| `analytics_event` | *(none — anonymous)* | Pageviews / outbound / geo-ping (area only) / consent / web vital (page timing) | 90 days (geo) / 25 months | Postgres `analytics_event` |
| `quarantine` | *(none)* | Importer-parked failed-validation docs (may carry legacy contact fields) | resolved via runbook | Postgres `quarantine` |

**Anonymous by construction:** survey and analytics hold no identifier tying a
row to a person (a per-browser session id that resets on close is not one). A
delete request against them is fulfilled by explanation, surfaced in the
fulfillment UI.

**Web vitals are page measurements, not people measurements.** A `webvital`
row carries a metric name (`LCP`/`CLS`/`INP`) and a number the browser
produced about the PAGE — how long the largest element took to paint, how much
the layout moved. Nothing is read from the device: no coordinate, no user
agent, no screen size, no fingerprint. It travels in the same anonymous
envelope every other analytics row uses and adds no field that could single
anyone out, which is why it is **not** gated behind the geo-consent card
(`src/lib/privacy/consent.ts` — that card governs *location*, purposes
`analytics` and `hunt`). Asking a visitor to consent to a number that is not
about them would misdescribe what they were agreeing to. Values are validated
and bounded at the ingest boundary, never trusted from the client; the closed
shape is pinned by the table-driven suite in
`src/app/api/__tests__/track-route.test.ts`.

**The side switcher (`vk-side` cookie) is a preference, not a location record.**
Its "use my location" button is user-initiated and one-shot: the coordinate is
classified on the device into kingston/edmonds and immediately discarded, only
that binary choice is written to the cookie, and nothing reaches the server —
no coordinate is ever transmitted or stored. (A first-visit geolocation
auto-ask that predated E11 was removed as the last MHMDA floor before launch.)
That is why the component sits in the reviewed-exemption list of
`tests/unit/geolocation-consent-guard.test.ts` rather than behind the consent
card; `tests/unit/side-switcher.test.tsx` pins the no-geolocation-on-mount
behavior positively.

## 2. The registration contract — no unregistered PII store

**No epic may add ANY store containing personal data without registering it in
`src/lib/privacy/pii-inventory.ts`.** In particular:

> **E16 may not merge the native member store unless its tables are registered
> in `src/lib/privacy/pii-inventory.ts` with working find/export/delete
> handlers, carry a retention rule in `RETENTION_POLICY`, honor per-member
> display/visibility preferences and membership-lifecycle (drop/lapse)
> semantics natively, and are covered by the access/delete workflow, the
> nightly JSON export, the admin backup bundle, and the vendor-exit export.**

The `pii-inventory` coverage test is what reviewers check. This is not vendor
hygiene: after the GrowthZone roll-off (ADR-0004), the app is the **primary
custodian** of member contact data — this registry is the safeguard on the
Chamber's own system of record.

## 3. Data ownership & vendor-exit export (FR-A95)

The Chamber owns all of its data. A full export = the admin backup bundle
(`src/app/api/admin/backup/route.ts`) + E05's nightly human-readable JSON
export (`npm run export:json`). **Both must cover every store registered in §1.**
Check: a new PII store is not "done" until it rides both exports (record-backed
stores ride automatically; a new append/dedicated table needs explicit
`serializeDb`/`restoreDb` coverage in `src/lib/db/export.ts`).

## 4. Legal hold & the MHMDA-delete reconciliation

Legal holds live in the generic `legal_hold (store, record_id, reason, set_by,
set_at)` table. A held record is excluded from **both** the retention purge and
consumer deletion; the refusal is **logged**, never silent (`retention-hold-skip`
/ `privacy-delete-refused-hold` audit rows). Enforcement is at the real record
granularity: `hardDeleteRecords` excludes held ids in SQL, and
`deleteOrAnonymize` for users/invites/charities checks `legal_hold` on the
person's actual record ids. E16 membership records and E30 applications inherit
this table rather than re-inventing it.

**Records in scope for retention, legal hold, and public-records intake
(`kind: "records"`)** include: analytics/survey/hunt data per §1; the audit
trail; and — added per the roll-off — **membership applications** (the E30
join-form intake) and **membership status/level changes** (the E16 native
store's append-only lifecycle events). Per ADR-0004 the audit trail is the
**only** membership history, so the never-purge-the-audit-table floor now also
carries the roster's history.

**Audit residuals (documented records-floor exceptions).** The append-only
`audit` table is never purged or edited. As a result:

- The **acting user's email** persists in `audit.actor` (and in pre-anonymize
  auth snapshots) as operational/records evidence; a consumer delete is
  fulfilled everywhere else, and `record.updated_by` references are re-keyed to
  the opaque user id (D-11).
- Hunt-submission audit snapshots are **coordinate-free by write-time redaction**
  (lat/lng/photoPath stripped), so the 12-month destruction promise holds — but
  audit rows written **before E11** (before 2026-07, notice version `2026-07`)
  may still contain submission coordinates under this same records floor.

## 5. Member-data posture (ADR-0004)

The app is the Chamber's **membership records system** — the system of record
for the Greater Kingston Community Chamber of Commerce's own member roster. It
deliberately holds the minimum contact fields the roster needs (org identity,
contact name/email/phone, membership status, level, renewal date, join history,
listing linkage, QB customer id). It honors per-member display preferences, is
retention-bound per the rendered schedule, is covered by the same access/delete
workflow as everything else, and is exportable (vendor-exit). **Money never
lives here:** dues invoicing and payment happen in QuickBooks (ADR-0003); the
app stores no payment data (FR-A15/NFR-06).

## 6. R4 precondition — member-table backup coverage before cancellation

After the R3 SoR flip the app holds the **only** copy of the roster. Therefore
the rehearsed non-programmer restore (M-20-01) and the nightly human-readable
JSON export must **demonstrably include every member table registered in the
PII inventory before the GrowthZone cancellation gate
(`docs/ROLLOFF-GROWTHZONE.md` §4, R4) can pass.** The rehearsal itself
(restore-drill log naming member tables + row counts; export manifest listing
them) is executed and evidenced under the R4 gate after E16 lands — not at
E11's merge.

## 7. Restore pairing (retention)

Backup bundles exported **before** the E11 privacy backfill ran still contain
data the public page says is gone (geo-ping coordinates, sensitive-destination
outbound events, survey zip/state fields). After restoring any pre-backfill
bundle, immediately re-run `npm run privacy:backfill -- --apply` and confirm the
`--dry-run` reports three zeros (also in `docs/OPERATIONS.md`).
