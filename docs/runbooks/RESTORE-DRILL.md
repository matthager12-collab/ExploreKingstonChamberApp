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
   the service → Disk → Snapshots). Plus **Neon** point-in-time restore for the
   database.

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
> it at a **Neon scratch branch** (Mode B) or a throwaway local
> `docker run -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16`, then import the
> bundle's `db` section with `npm run restore:db`. See `docs/OPERATIONS.md` §1.

---

## Mode B — Neon / Postgres restore (database point-in-time)

The database is the system of record for accounts, listings, events, and survey
data. Restoring it is a Neon-console operation:

1. In the **Neon console** → the project → **Branches** → create a branch from a
   point in time (Neon keeps a restore window — confirm the retention on the
   plan). Name it e.g. `restore-drill-YYYY-MM-DD`.
2. Copy that branch's **pooled connection string**.
3. Point a local run at it: `DATABASE_URL="<branch url>" AUTH_SECRET=drill npm run dev`,
   open `/api/health` (expect `dbOk: true`), and spot-check an account/listing.
4. Where the nightly JSON export lands and how to re-import it is in
   `docs/OPERATIONS.md` §1 / §4; the bundle's `db` section restores with
   `scripts/restore-db.ts` (`npm run restore:db`).

### Documented gap (FR-A24)

The **full Neon point-in-time restore is NOT yet a copy-paste, non-programmer
procedure** — it requires Neon-console judgement (choosing the restore point,
promoting a branch) and a valid `DATABASE_URL`. **Compensating control:** Neon's
built-in point-in-time restore covers the database independently of this app, and
**Mat** performs or supervises a database restore. The **filesystem-mode drill
(Mode A) is the non-programmer-runnable half** and is what the quarterly log
below attests. This gap is recorded deliberately per FR-A24, which permits a
documented gap with a compensating control rather than silence.

---

## Drill log

Run Mode A every quarter and add a row. Keep the newest at the top.

| Date | Who | Mode | Result | Notes |
|------|-----|------|--------|-------|
| 2026-07-20 | E10 verification | A | PASS | Filesystem restore of a 266 MB bundle: `verify-backup.mjs` exit 0 (6 files, 209 MB decoded); `restore-backup.mjs` restored 6/6; `cmp` byte-identical on a 40 MB binary. DB-half restore is the documented gap above (Neon PITR + Mat). |
| _(next quarter)_ | | A | | |
