# Restore drill

**Purpose.** Prove — on a schedule, by a non-programmer — that a backup can
actually be restored. A backup you have never restored is a hope, not a backup.
This drill is required quarterly (see also `docs/OPERATIONS.md` §6) and is logged
at the bottom of this file.

**What a backup contains.** Two independent layers:

1. **Off-site JSON bundle** — `GET /api/admin/backup` (the "⤓ Download backup"
   button on the [Ops & status](/admin/ops) page, or the nightly encrypted pull
   in `.github/workflows/backup-offsite.yml`). It holds the disk files (photos,
   maps) **and** a dump of the Postgres database (accounts, listings, events,
   survey & analytics) in one file. It contains **account password hashes** —
   treat the file as sensitive.
2. **Render disk snapshots** — automatic, daily, 7-day window (Render dashboard →
   the service → Disk → Snapshots). Plus **Render Postgres**'s own daily logical
   backups and point-in-time recovery, from the database's Recovery page in the
   dashboard.

You do **not** need to be a programmer to run the filesystem-mode drill below.
It uses only copy-paste terminal commands.

---

## Mode A — Filesystem drill (do this one every quarter)

This restores a downloaded bundle into a scratch folder and runs the app against
it, without touching production. ~15 minutes.

1. **Sign in as an owner-admin** and download a fresh bundle:
   open <https://explore-kingston.onrender.com/admin/ops> → **⤓ Download backup**.
   Save it, e.g. `~/Downloads/explore-kingston-backup-YYYY-MM-DD.json`.

2. **Check the file is complete and well-formed** (catches a truncated download):

   ```bash
   node scripts/verify-backup.mjs ~/Downloads/explore-kingston-backup-YYYY-MM-DD.json --expect-auth
   ```

   Expect `OK: <N> files, <bytes> decoded bytes …` and exit code 0. If it says
   `INVALID: …`, the download is bad — download again; do **not** trust it.

3. **Restore the disk files into a scratch folder:**

   ```bash
   node scripts/restore-backup.mjs ~/Downloads/explore-kingston-backup-YYYY-MM-DD.json /tmp/drill-data
   ```

4. **Run the app against the restored folder** (needs a database — see the note):

   ```bash
   AUTH_SECRET=drill DATABASE_URL="<a scratch Postgres URL>" DATA_DIR=/tmp/drill-data npm run dev
   ```

5. **Confirm it's healthy:** open <http://localhost:3000/api/health> and expect
   `"ok": true`. Then sign in at <http://localhost:3000/portal> with a known
   production account and **spot-check that one listing edit you remember making
   is present**. If it is, the restore worked.

6. **Record the result** in the Drill log below, then delete the scratch folder
   (`rm -rf /tmp/drill-data`) and the downloaded bundle.

> **Note (the database half).** Since the E05 cutover, structured data lives in
> Postgres, so step 4 needs a `DATABASE_URL`. For a self-contained drill, point
> it at a throwaway local
> `docker run -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16`, then import the
> bundle's `db` section with `npm run restore:db`. See `docs/OPERATIONS.md` §1.

---

## Mode B — Render Postgres restore (database point-in-time)

The database is the system of record for accounts, listings, events, and survey
data. Restoring it is a Render-dashboard operation, from the database's
**Recovery page** (`explore-kingston-db` → Recovery):

1. The Recovery page (`explore-kingston-db` → Recovery in the Render dashboard)
   holds daily logical backups and point-in-time recovery; retention depends on
   the workspace plan (3 days on Hobby) — confirm before assuming a date is
   covered.
2. An ad-hoc `pg_dump` runs as a one-off Render job against the internal URL —
   `ops/db-copy/` is the worked example.
3. Rehearse against a throwaway local Postgres (the same `docker run` as Mode A)
   plus `npm run restore:db`; the production database is internal-only
   (`ipAllowList: []`) and unreachable from a laptop without an entry added first
   (and removed after).

### Documented gap (FR-A24)

A restore from the Recovery page has been read, not rehearsed (as of 2026-09-02);
the compensating control is still Mode A, which has been drilled.
**Compensating control:** the off-site bundle restore (Mode A) covers the same
data and **HAS** been drilled — see the log below. **Mat** performs or supervises
a database restore. The **filesystem-mode drill (Mode A) is the
non-programmer-runnable half** and is what the quarterly log below attests. This
gap is recorded deliberately per FR-A24, which permits a documented gap with a
compensating control rather than silence.

---

## Drill log

Run Mode A every quarter and add a row. Keep the newest at the top.

| Date | Who | Mode | Result | Notes |
|------|-----|------|--------|-------|
| 2026-07-20 | E10 verification | A | PASS | Filesystem restore of a 266 MB bundle: `verify-backup.mjs` exit 0 (6 files, 209 MB decoded); `restore-backup.mjs` restored 6/6; `cmp` byte-identical on a 40 MB binary. DB-half restore is the documented gap above (Neon PITR + Mat). |
| _(next quarter)_ | | A | | |
