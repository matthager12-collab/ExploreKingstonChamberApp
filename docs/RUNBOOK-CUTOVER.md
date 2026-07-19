# Cutover Runbook — Postgres substrate (E05)

For the operator (Mat or the Chamber's tech volunteer). This is the one-time
procedure that moves the live site's structured data from the Render disk
into Neon Postgres, plus the standing restore drill. Commands run from a
checkout of the repo with `npm ci` done. **You never need to write code.**

Roles: *operator* = the human running this. Every step that only the
operator can do is marked **[HUMAN]**.

---

## Preflight

All of these must be true before scheduling the freeze:

- [ ] Staging rehearsal completed (see **Rehearsal log** below) and restore
      drill completed (see **Restore drill**).
- [ ] CI green on `main`; the release you will deploy contains all four
      E05 PRs (#15, #16, #17, and this runbook's PR).
- [ ] **[HUMAN]** Production Neon `DATABASE_URL` (the **pooled** URL of the
      `production` branch of Neon project *explore kingston app*) is ready to
      paste into the Render dashboard — **NOT yet set**.
- [ ] `npm run import:data-dir -- --data-dir <anything> --dry-run` works
      locally against the staging Neon branch (sanity check of your checkout).

### Rehearsal log

| Date | Operator | Bundle | Import (dry→apply) | Health | Notes |
|---|---|---|---|---|---|
| 2026-07-11 | Claude (agent), staging Neon branch `br-tiny-shape-a655cio1` | `backup-2026-07-10.json`, 393,321 B, 9 files (pulled 2026-07-11T06:07Z) | dry-run exit 0, **0 quarantined**, 12 records / 7 stores; apply exit 0 in **1m19s** (12 records + 434 analytics + 2,086 ferry obs); re-run: 0 writes, appends SKIP | `{"ok":true,"dataWritable":true,"dbOk":true}`; `/` `/eat` `/ferry` `/stay` `/events` all 200; imported hero copy rendered after ISR revalidate | Admin edit round-trip: login with imported prod hash → copy edit 200 (audited `update` by the director's email, visible via `export:json`) → revert 200. Live telemetry appended during rehearsal (ferry obs 2086→2090). **Not rehearsed:** setting `DATABASE_URL` on a Render service (dashboard access is the operator's) — the boot-migrator path it triggers was verified by booting the standalone build locally against the same branch. |

---

## Content freeze

1. **[HUMAN]** Tell every admin/portal user (they are few and known) that
   edits are frozen until you give the all-clear. The freeze is procedural —
   there is no lockout switch this epic.
2. Pull **bundle A**: `/admin` → "⤓ Download backup" (or
   `curl -H "Authorization: Bearer $BACKUP_TOKEN" https://<prod-host>/api/admin/backup -o bundleA.json`).
3. Note the time. Keep the freeze window short — telemetry arriving during it
   is bounded by this window (see **Data-loss policy**).

## Cutover

1. Pull **bundle B** (same command, new file). Restore it to a scratch dir:
   `node scripts/restore-backup.mjs bundleB.json /tmp/cutover-data`.
2. **Verify A≡B on the structured stores**: run the importer dry-run twice —
   once against a dir restored from A, once from B — and compare the
   per-store tables; or simply `diff <(jq -S .files bundleA.json) <(jq -S .files bundleB.json)`
   limited to `stores/`, `auth/`, `hunts/*.json*`. **Any drift means someone
   edited during the freeze: re-announce the freeze and re-pull B.**
3. Import into **production Neon** (the only time you run this against prod):
   ```bash
   export DATABASE_URL="<production pooled URL>"   # [HUMAN] paste, do not commit
   npm run db:migrate                              # creates the schema
   npm run import:data-dir -- --data-dir /tmp/cutover-data --dry-run
   npm run import:data-dir -- --data-dir /tmp/cutover-data --apply
   ```
   The `--apply` step prints the target host and asks you to type it back.
   **The importer must exit 0** — or every QUARANTINE line must be
   individually acknowledged and noted here before you continue. (Exit 2 =
   quarantines exist; exit 1 = a source file didn't parse — stop entirely.)
4. **PRE-FLIGHT — validate the URL from your laptop BEFORE pasting it into
   Render.** Do not skip this. Paste the exact string you are about to enter,
   in quotes, and confirm all three lines answer:

   ```bash
   URL='<the exact production pooled URL you are about to paste>'
   psql "$URL" -c "select 1"                              # connects + authenticates
   psql "$URL" -c "select count(*) from record"           # right database, has your data
   psql "$URL" -c "select current_database(), inet_server_addr()"
   ```

   A typo, a truncated paste, a stale password, or the wrong Neon branch all
   surface here — while the site is still up and nothing has changed.

5. **[HUMAN]** Render dashboard → service `explore-kingston` → Environment →
   add `DATABASE_URL` = that same validated URL → save (triggers a deploy of
   the substrate release).

6. Watch `/api/health` go **200 with `"dbOk":true`**.

   > ⚠️ **A bad URL here takes the site DOWN — it does not fail closed.**
   > An earlier version of this runbook said Render keeps the old release
   > serving until the new one is healthy. **That is false for this service.**
   > `explore-kingston` mounts a persistent disk (`data`), and a disk can be
   > mounted by only ONE instance, so Render must stop the old instance before
   > starting the new one. There is no old release still serving to fall back
   > to: an unhealthy release means 502 on every path.
   >
   > Verified the hard way on 2026-07-19 — the E06 release was pushed to
   > `explore-kingston-staging`, whose `DATABASE_URL` had never been set, and
   > staging went 502 on every path rather than continuing to serve its
   > previous release.
   >
   > **If it does go down:** re-check the env var first (a typo is the usual
   > cause), and if you cannot fix it within your tolerance, use Render's
   > **Rollback** to the previous deploy — that restores the pre-substrate
   > release, which runs without `DATABASE_URL`. Keep the freeze on until you
   > retry; the importer is idempotent, so a second run is safe.

## Verification

- Spot-check listing pages (`/eat`, `/stay`, `/events`) and the ferry board.
- One **admin edit round-trip**: edit a copy block in `/admin/content`, run
  `npm run export:json -- check.json` against prod and confirm the audit row
  (`action:"update"`, your email), then revert the edit.
- A hunt photo loads (disk still serves images) and `/api/health` stays 200.
- Compare per-store record counts: the importer's report vs
  `npm run export:json` output.
- Unfreeze: tell the admins editing is open again.

## Rollback

One release window only (before new edits accumulate in Postgres):

- Render dashboard → redeploy the **previous** image **with `DATABASE_URL`
  unset** (**remove the env var — this is mandatory**: the old release with
  `DATABASE_URL` set would lazily create an empty legacy `overlay` table and
  render EMPTY content — fake data loss).
- The `DATA_DIR` structured files were never modified by any E05 code path
  (the importer is read-only; CI's `no-fs-store-writes` suite enforces that
  nothing writes them again) — the old release resumes serving them as-is.
- Optionally freeze the legacy files against accidental writes after a
  SUCCESSFUL cutover: `chmod -R a-w /data/stores /data/auth /data/analytics
  /data/ltac-responses.jsonl /data/ferry` — but `/data/hunts` and
  `/data/map/images` **MUST stay writable** (photos still land there).

## Data-loss policy

Plain language, agreed in advance:

1. **Rolling back discards every edit made in Postgres after cutover.** They
   are not gone silently — they are in the audit trail of your final
   `export:json` — but they must be re-entered by hand.
2. **Telemetry arriving between bundle B and the deploy going live is lost**
   (analytics events, survey responses, ferry observations). This is bounded
   by the freeze window and acceptable; if the window ran long, minimize it
   by re-running the importer's append pass from a post-deploy bundle with
   `--force-append` (accepting some duplicate rows) — decide, don't drift.
3. **Content edits during the freeze are a procedure violation** — the A≡B
   check exists to catch them; re-freeze and re-pull rather than guessing.

## Restore drill

Quarterly: prove the backup actually restores. Procedure:

1. `npm run export:json -- drill.json` against production (or use the
   latest nightly bundle's `db` section).
2. Create a scratch database (a new database on the staging Neon branch is
   fine: `CREATE DATABASE restoredrill;`), run `npm run db:migrate` against
   it, then `npm run restore:db -- drill.json` (type the host to confirm).
3. Verify the printed per-table counts match the export, and spot-check one
   record's content.
4. Log it below; delete the scratch database.

### Drill log

| Date | Operator | Bundle | Counts | Duration | Result |
|---|---|---|---|---|---|
| 2026-07-11 | Claude (agent) | staging export, 630,727 B | record=12, audit=14, quarantine=0, analytics=434, survey=0, ferry=2,090 — identical after restore | migrate ~4s + restore 1.3s | PASS |

## DATA_DIR retirement

After one full release cycle with no rollback: archive the legacy structured
files into a final bundle (`/api/admin/backup` still walks them), note the
archive location here, then delete `stores/`, `auth/`, `analytics/`,
`ltac-responses.jsonl`, and `ferry/observations.jsonl` from the disk.
**Images stay** (`hunts/`, `map/images/`) until E15 moves them to object
storage. The disk itself stays mounted.

Later (nice-to-have, not this epic): per-PR Neon preview branches in CI.
