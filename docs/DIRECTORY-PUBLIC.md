# The public directory (map business profiles)

**Status: IN BUILD** — decisions taken with Mat 2026-08-12; this document is
the slice's decision record and build plan. It delivers the R2 milestone in
docs/ROLLOFF-GROWTHZONE.md §4 ("app directory becomes the public directory")
plus the map linkage MAPS.md names as the intended path.

## What it is

Every imported chamber-member business gets a public, clickable profile —
reachable from the map pins the way visitors already use /eat — and a ranked
public directory page. Ranking (Mat, 2026-08-12): **active members first,
bigger dues higher, alphabetical tiebreak.** No distance layout.

## Decisions of record (Mat, 2026-08-12)

1. **Dues amounts enter the app database** in a private `member_meta` table
   (status / level name / dues per listing) — the second deliberate exception
   to the importer's PII-stays-in-the-CSV posture (the first: claim_contact
   emails). Containment: amounts are ranking INPUT only, never rendered on
   any surface, public or admin; rows never serialize to a browser.
2. **All active members publish.** The bulk-publish action flips draft
   listings to live for every active roster member. Dropped members stay
   unpublished by this action (already-live listings never auto-unpublish —
   E19's additive-only invariant); courtesy and pending-approval members are
   per-listing admin decisions in the workbench.
3. **Coordinates via adopt + geocode.** scripts/geocode-directory.ts adopts
   positions from name-matched hand-placed map pins first (human-placed beats
   automated), then Nominatim (1.1 s spacing, results only accepted inside
   the greater-Kingston bounding box), and flags the rest for hand placement.
   Adoptions double as the phase-3 hand-pin retirement list.

## The B&O caveat, restated

Dues-ranked placement is precisely the "graduated benefits" pattern the
roll-off plan flags (RCW 82.04.4282 / DOR ETA 3230.2021 — see
ROLLOFF-GROWTHZONE §3): the Chamber's bookkeeper should apply the allocation
caveat before this ships as a paid benefit. The ranking comparator is
config-flippable (member/alpha only) so a bookkeeper walk-back is a one-line
change, not a redesign.

## Phases

- **Phase 1 — data (this branch).** `member_meta` table + `--member-meta`
  importer flag (vanished roster rows mark listings `dropped`);
  DirectoryListing gains optional lat/lng (admin-writable only — member
  edits preserve them, the restaurant rule); the geocode script; directory
  joins MODERATED_STORES (before this, owner edits to live directory
  listings produced worklist items approveModerationItem could not land);
  the bulk-publish admin action (preview counts, then audited
  draft→live flips).
- **Phase 2 — profiles.** Public /directory page (ranked cards, search,
  category chips) and /directory/[id] profile pages: description, address,
  phone, website, member badge, claim CTA on unclaimed listings (feeds the
  claim-signup flow). The ranking module is the real birth of the
  rankListings() choke point the E19 comments reserve.
- **Phase 3 — maps.** A `directory` BuiltInSource (the seam map-views.ts
  names): per-category pins from live directory records, popups linking to
  the profile page, member badge on; retire superseded hand pins using the
  geocode script's adoption report.

## Interim vs plan-of-record

member_meta is LISTING-keyed because most listings have no org yet
(unclaimed). The E16 member store will hold membership status/level/renewal
as native ORG fields; when it lands, member_meta is its migration source and
retires. Nothing here widens permissions: publishing is an explicit admin
act, entitlements stay narrow-only, and the moderation floor (E08) covers
directory edits exactly like every other public domain.

## Operator runbook (phase 1)

```
npm run import:growthzone -- --file roster.csv --apply --claim-contacts --member-meta [--map ...]
npm run geocode:directory                      # dry-run first, review the plan
npm run geocode:directory -- --apply
```

Then /admin/listings → "Publish active members' draft listings" (previews
counts before writing). Unplaced listings from the geocode report get lat/lng
by hand in the workbench (the directory editor now has both fields).
