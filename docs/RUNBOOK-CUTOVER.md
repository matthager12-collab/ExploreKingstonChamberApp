# Cutover Runbook — Postgres substrate (E05)

> ## ✅ STATUS: THIS CUTOVER IS COMPLETE
>
> The E05 move from the Render disk to Neon Postgres **has already happened**.
> Production runs on Postgres today: `explore-kingston` has `DATABASE_URL` set,
> `/api/health` reports `db:true`, and the database holds the live record,
> audit, analytics, survey, and ferry-observation data.
>
> **Do not run the Cutover section below as if it were pending.** It is kept as
> (a) the historical record of what was done and (b) the template for the next
> time structured data has to be moved.
>
> If you are here because you are shipping an epic that carries a data
> migration, the section you actually need is
> **[Migrations under auto-deploy](#migrations-under-auto-deploy)** — read it
> first. It is the part this runbook originally got wrong.

For the operator (Mat or the Chamber's tech volunteer). Commands run from a
checkout of the repo with `npm ci` done. **You never need to write code.**

Roles: *operator* = the human running this. Every step that only the
operator can do is marked **[HUMAN]**.

---

## Migrations under auto-deploy

**This section is the standing rule. The rest of this document is history.**

### The mechanism nobody wrote down

`main` **auto-deploys to production.** Merging a pull request puts that code in
front of the public within a few minutes. There is no separate "deploy" step,
no approval gate, and no window between merging and going live.

The original runbook below assumed the operator triggered the deploy by pasting
`DATABASE_URL` into the Render dashboard. That was true exactly once. Every
release since has shipped because somebody clicked **Merge**.

### The rule that follows

> **A pull request that starts READING a new table must not merge until the
> production migration that FILLS that table has already run.**

Merging first means production runs new code against an empty table. For an
auth table, that is a total lockout: the site keeps serving visitors while
nobody can sign in.

Correct order for any migration-bearing epic:

1. Land the schema and the migration script as an **additive** PR — new tables
   created, nothing reading them yet. Safe to merge and deploy.
2. **Run the migration against production** (dry-run, read the diff, then
   `--apply`).
3. Verify the data landed.
4. *Then* merge the PR that switches the code over to the new tables.

If steps 2–4 cannot be sequenced that way, the alternative is a dual-read
release that tolerates both the old and new state, and a follow-up PR that
removes the old path once the migration has run.

### Deploys are zero-downtime (since E15 slice 3)

**This section previously read "Every deploy is a brief outage."** That was
true only because both Render services mounted a **persistent disk**, and a
disk can be mounted by exactly one instance — so Render had to stop the old
container before starting the new one. E15 removed the disk (structured state
is in Neon Postgres, images are in private R2), and with no volume to hand over
the instances can overlap. Consequences now:

- A merge to `main` no longer takes production down. The old container keeps
  serving until the new one passes `/api/health`.
- A release that never becomes healthy is **held back** — the previous release
  keeps serving — instead of leaving the site 502 on every path.
- Therefore a sustained 502 after a merge is **no longer "just a deploy"** and
  should be treated as an incident. Check `gh run list --branch main --limit 3`
  and the Render deploy log.
- **Do not reintroduce a disk.** Attaching one anywhere in `render.yaml`
  silently restores the stop-start window for the whole service.

### Incident: E06 auth lockout, 2026-07-19

**What happened.** E06 moved accounts out of the `record` table into dedicated
`users` / `orgs` / `invites` tables. The cutover PR merged at ~20:04 UTC and
auto-deployed. The production auth migration had **not** been run, so
production served E06 code against an empty `users` table.

**Impact.** No one could sign in to `/portal` or `/admin` for about three
hours. `/portal` redirected to `/portal/setup` because `hasAnyUsers()` was
false, which also re-armed the first-admin bootstrap (still `SETUP_TOKEN`-gated,
so not exploitable). The **public site was unaffected throughout** — visitors
saw normal pages, because public content is seed + overlay and does not need an
account.

**Resolution.** `node scripts/migrate-auth-v2.mjs --data-dir "$(mktemp -d)" --apply`
against production, which read the two legacy `auth-users` rows still sitting in
`record` and wrote them into `users` with password hashes carried verbatim.
Existing passwords kept working; no resets were needed. ~40 minutes of
diagnosis, seconds to fix.

**Why it was not caught.** The epic was verified on staging, and staging was
correct. The gap was that merging to `main` deploys to *production*, and only
staging had been migrated. Nobody was watching the surface that actually
changed.

**What prevents a repeat.** The rule above. Also worth knowing: the accounts
were never in danger — the migration is idempotent, reads a source it never
deletes, and the legacy rows remain as a rollback window.

---

## Preflight *(historical — this cutover is complete)*

All of these were true before the freeze:

- [x] Staging rehearsal completed (see **Rehearsal log** below) and restore
      drill completed (see **Restore drill**).
- [x] CI green on `main`; the release contained all four E05 PRs.
- [x] **[HUMAN]** Production Neon `DATABASE_URL` (the **pooled** URL of the
      `production` branch of Neon project *explore kingston app*) pasted into
      the Render dashboard. **This is now set** — confirm in the dashboard
      before assuming otherwise.
- [x] `npm run import:data-dir -- --data-dir <anything> --dry-run` works
      locally against the staging Neon branch.

### Rehearsal log

| Date | Operator | Bundle | Import (dry→apply) | Health | Notes |
|---|---|---|---|---|---|
| 2026-07-11 | Claude (agent), staging Neon branch `br-tiny-shape-a655cio1` | `backup-2026-07-10.json`, 393,321 B, 9 files (pulled 2026-07-11T06:07Z) | dry-run exit 0, **0 quarantined**, 12 records / 7 stores; apply exit 0 in **1m19s** (12 records + 434 analytics + 2,086 ferry obs); re-run: 0 writes, appends SKIP | `{"ok":true,"dataWritable":true,"dbOk":true}`; `/` `/eat` `/ferry` `/stay` `/events` all 200; imported hero copy rendered after ISR revalidate | Admin edit round-trip: login with imported prod hash → copy edit 200 (audited `update` by the director's email, visible via `export:json`) → revert 200. Live telemetry appended during rehearsal (ferry obs 2086→2090). **Not rehearsed:** setting `DATABASE_URL` on a Render service (dashboard access is the operator's) — the boot-migrator path it triggers was verified by booting the standalone build locally against the same branch. |

### Production migration log

Every migration actually executed against the **production** database. Append a
row here when you run one — this is the record that tells the next person what
state production is in.

| Date (UTC) | Migration | Result | Notes |
|---|---|---|---|
| 2026-07-11 | E05 `db:migrate` + `import:data-dir --apply` | success | The Postgres cutover. Moved the Render disk's structured data into Neon. |
| 2026-07-19 ~23:05 | E06 `db:migrate` (0002, via boot migrator) | success | `users` / `orgs` / `invites` created automatically when the E06 release booted. Tables were created EMPTY — see the incident above. |
| 2026-07-19 23:14 | E06 `scripts/migrate-auth-v2.mjs --apply` | success | 2 users, 0 orgs, 0 backfills. Read the 2 legacy `auth-users` rows from `record`; password hashes carried verbatim (verified equal), so existing passwords kept working. Legacy rows retained as the rollback window. 1 pending legacy invite NOT migrated (reported for re-mint). |

**Note on that third row:** a third admin (`matt.hager12@…`) exists in production
because the operator bootstrapped one via `/portal/setup` during the lockout, at
23:00 UTC. That is a legitimate account, not a migration artifact.

---

## Content freeze *(historical — part of the completed E05 cutover)*

1. **[HUMAN]** Tell every admin/portal user (they are few and known) that
   edits are frozen until you give the all-clear. The freeze is procedural —
   there is no lockout switch this epic.
2. Pull **bundle A**: `/admin` → "⤓ Download backup" (or
   `curl -H "Authorization: Bearer $BACKUP_TOKEN" https://<prod-host>/api/admin/backup -o bundleA.json`).
3. Note the time. Keep the freeze window short — telemetry arriving during it
   is bounded by this window (see **Data-loss policy**).

## Cutover *(historical — already executed)*

> These are the steps that were run to move production onto Postgres. Kept as
> the template for a future data move. **Do not execute them against the
> current production database** — it is already on Postgres and re-importing a
> stale bundle over live data would be destructive.


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

   **If you have `psql`:**

   ```bash
   URL='<the exact production pooled URL you are about to paste>'
   psql "$URL" -c "select 1"                              # connects + authenticates
   psql "$URL" -c "select count(*) from record"           # right database, has your data
   psql "$URL" -c "select current_database(), inet_server_addr()"
   ```

   **If you do not** (psql is NOT installed on the operator Mac as of
   2026-07-19) — this uses the repo's own `pg` driver and needs nothing extra.
   Put the URL on the clipboard first, then run it from the repo root, so the
   thing being tested is the exact bytes you are about to paste:

   ```bash
   node -e 'const {Client}=require("pg");
   const u=require("child_process").execSync("pbpaste").toString().trim();
   if(u.length===0){console.log("❌ clipboard is EMPTY");process.exit(1)}
   new Client({connectionString:u}).connect().then(async function(){
     const r=await this.query("select current_database() db, inet_server_addr() host, (select count(*) from record) records");
     console.log("✅",r.rows[0]); await this.end();
   }).catch(e=>console.log("❌ FAILS:",e.message));' 2>&1 | grep -v Warning
   ```

   A typo, a truncated paste, a stale password, an empty clipboard, or the
   wrong Neon branch all surface here — while the site is still up and nothing
   has changed.

   > This is not hypothetical. On 2026-07-19 the staging paste went in as the
   > BARE HOSTNAME (55 of 147 characters), and separate `db` / `user` env vars
   > appeared alongside it — fragments of the same connection string split
   > across fields. The clipboard check caught it before it reached the
   > dashboard.

5. **[HUMAN]** Render dashboard → service `explore-kingston` → Environment →
   add `DATABASE_URL` = that same validated URL → save (triggers a deploy of
   the substrate release).

6. Watch `/api/health` go **200 with `"dbOk":true`**.

   > ⚠️ **Validate this URL before setting it.** Since E15 removed the disk,
   > a bad URL is now held back rather than taking the site down: with no
   > volume to hand over, the old instance keeps serving until the new one
   > passes `/api/health`. That is a safety net, not a licence to guess — the
   > release still fails, and while a disk WAS attached (before E15) the same
   > mistake meant 502 on every path.
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
