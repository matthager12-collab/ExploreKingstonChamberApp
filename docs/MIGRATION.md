# Repo migration runbook (E03) — ON HOLD

Ordered steps to stand up the ops floor (Sentry, UptimeRobot, encrypted
off-site backups, staging) and — originally — move this repo to a new GitHub
account. Part A (code) lands via a normal PR against the **current** repo and
is safe to merge on its own — every new env var/route/script is a no-op until
it's actually wired up.

**Status (2026-07-07): the repo-transfer portion of this epic is ON HOLD —
this repo is staying at `mat-arda-cards/visit-kingston`.** Mat found that the
transfer target, `matthager12-collab/ExploreKingstonChamberApp`, already
existed as a same-named placeholder repo (one commit, a bare README) which
would have blocked a clean GitHub transfer, and decided it wasn't worth
resolving right now. The **ops-floor work below is independent of the
transfer and is still real progress** — Sentry, UptimeRobot, the age backup
keypair, and the production env vars are all done regardless of which account
hosts the repo (see the completion log). Only the GitHub-account-transfer
steps (human checklist 5–9, agent checklist) are not happening.

If the transfer is revisited later: resolve the placeholder-repo conflict
first (rename or delete `matthager12-collab/ExploreKingstonChamberApp` before
attempting a GitHub transfer into that slot), then this runbook's steps and
`scripts/verify-migration.sh` are otherwise ready to use as-is.

## Recorded slugs

- **Current repo:** `mat-arda-cards/visit-kingston`
  (`https://github.com/mat-arda-cards/visit-kingston.git`) — a personal
  GitHub account, despite the arda-ish name. Staying here for now.
- **Originally planned new repo (on hold):** `matthager12-collab/ExploreKingstonChamberApp`
  (`https://github.com/matthager12-collab/ExploreKingstonChamberApp.git`) —
  a different personal GitHub account, currently occupied by an unrelated
  placeholder repo (see Status above).

## Why a cross-account transfer, not a rename (background, not happening now)

The plan was to move the repo from `mat-arda-cards` — despite the name, one
of Mat's personal accounts, not the arda work account — to `matthager12-collab`,
a distinct personal account, renaming it to `ExploreKingstonChamberApp` at the
same time. GitHub's transfer preserves stars/issues and leaves a redirect at
the old URL. This is documented for reference only; it is **not currently
happening** (see Status above).

---

## HUMAN CHECKLIST (Mat)

Do these **in order**. UptimeRobot is first so the migration itself is
monitored while it happens.

### 1. UptimeRobot (before touching anything else)

1. Create a free account with your **personal email**.
2. Add two HTTP(S) monitors, 5-min interval, alert contact = personal email:
   - `https://explore-kingston.onrender.com/api/health`
   - `https://explore-kingston.onrender.com/api/ferry/status`
3. Create a **read-only** API key. Save it in 1Password — the verification
   step (AC 18) reads it via:
   ```bash
   curl -s -X POST https://api.uptimerobot.com/v2/getMonitors \
     -d "api_key=<read-only key>&format=json"
   ```

### 2. Sentry

1. Create a free account with your **personal email**. New org + project,
   platform **Next.js**. Copy the DSN.
2. Set `SENTRY_DSN` on the Render **production** service (Dashboard → the
   `explore-kingston` service → Environment → add `SENTRY_DSN`).
3. Create an org auth token scoped to **`project:read` only**. Save it in
   1Password — the verification step (AC 19) reads it via:
   ```bash
   curl -s -H "Authorization: Bearer <project:read token>" \
     https://sentry.io/api/0/projects/
   ```

### 3. Tokens

1. Generate two values:
   ```bash
   openssl rand -hex 32   # FERRY_OBSERVE_TOKEN
   openssl rand -hex 32   # BACKUP_TOKEN
   ```
2. Set both as env vars on the Render **production** service (dashboard —
   `render.yaml` already declares them `sync: false`, so Render will prompt
   for values on the next Blueprint sync if you haven't set them yet).
3. Save both values in 1Password. You'll set them again as GitHub Actions
   secrets in step 8.

### 4. age keypair (for encrypted off-site backups)

1. ```bash
   age-keygen -o key.txt
   ```
2. Store the **whole file** in 1Password as a new item, e.g. "ExploreKingston
   backup age key" — record the exact item name you use here in the
   completion log at the bottom of this file.
3. Keep the printed `age1...` **public** key handy for step 8 below (it
   becomes the `BACKUP_AGE_RECIPIENT` repo variable).
4. Delete the local file: `rm key.txt`. The private key only ever lives in
   1Password from this point on.

### 5. GitHub account + transfer

1. Confirm `matthager12-collab` exists and has 2FA enabled.
2. On the **old** account (`mat-arda-cards`): repo Settings → Danger Zone →
   **Transfer ownership** → target `matthager12-collab`. This preserves
   stars/issues and leaves a redirect at the old URL.
3. Accept the transfer on the new account.
4. **Rename** the repo to `ExploreKingstonChamberApp`.
5. Keep it **public** (no secrets are in git; see `docs/GIT_SETUP.md`
   guardrails).

### 6. New Personal Access Token

1. On `matthager12-collab`, mint a PAT with **`repo` + `workflow`** scopes
   (`workflow` is required — this epic pushes/updates
   `.github/workflows/backup-offsite.yml`, and a `repo`-only token is
   rejected with a clear error).
2. Save it in 1Password as a **new item** (don't overwrite the old one yet —
   keep it until you've confirmed the new one works, then you may retire it).
   Record the item name in the completion log below.
3. Update the local credential file:
   ```bash
   cd "/Users/matatarda/chamber app/visit-kingston"
   printf 'GITHUB_TOKEN=<new PAT>\n' > .env.git
   chmod 600 .env.git
   ```

### 7. Render re-link

1. Install/authorize the Render GitHub App on `matthager12-collab` for the
   new repo.
2. In the Render dashboard, point the `explore-kingston` service **and** the
   Blueprint at `matthager12-collab/ExploreKingstonChamberApp`, branch
   `main`, auto-deploy **on**. **Do not disconnect the old link** until the
   agent step below (agent step 4) has proven a real deploy from the new
   repo.
3. Approve the Blueprint sync that creates `explore-kingston-staging` (+ its
   `data-staging` disk) — this is the new-spend sign-off for staging
   (~$7.25/mo + ~$0.25/mo disk, pre-approved in the v2 budget; you're
   clicking the actual Render approval).
4. Set staging's `sync: false` env vars in the dashboard: `WSDOT_API_KEY`,
   `NEXT_PUBLIC_SITE_URL` (the staging service's own `onrender.com` URL, once
   Render assigns it), `SENTRY_DSN`, `BACKUP_TOKEN`, `FERRY_OBSERVE_TOKEN`.

### 8. GitHub repo settings on the new repo

1. Re-create (or verify, if the transfer carried them over) Actions
   **secrets**:
   - `FERRY_OBSERVE_TOKEN` — value from step 3
   - `BACKUP_TOKEN` — value from step 3
2. Re-create (or verify) Actions **variables**:
   - `FERRY_OBSERVE_URL` = `https://explore-kingston.onrender.com`
   - `BACKUP_AGE_RECIPIENT` = the `age1...` public key from step 4
3. Re-enable any scheduled workflows GitHub disabled during the transfer
   (Actions tab → each workflow → re-enable if greyed out).
4. Verify branch protection on `main` survived the transfer — the agent's
   `scripts/verify-migration.sh` (and its re-apply step) checks/fixes this.

### 9. Cloudflare R2 (recommended — ask-first item; skip if you'd rather use
a different vendor or stay on the artifact fallback for now)

1. Create a Cloudflare account (or use an existing one) → R2 → new bucket
   `explore-kingston-backups`.
2. Create a scoped API token: **Object Read & Write**, restricted to just
   that bucket.
3. Add a lifecycle rule deleting objects older than 90 days.
4. Add repo secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and repo
   variables `R2_ENDPOINT`, `R2_BUCKET`.
5. Until this step is done, `backup-offsite.yml`'s 14-day encrypted-artifact
   fallback carries the backups — nothing breaks by skipping this for now.

### 10. Sign-offs

Record here once done:

- [ ] Staging cost approved (Render Blueprint sync click, step 7.3)
- [ ] Sentry free tier confirmed
- [ ] UptimeRobot free tier confirmed
- [ ] R2 free tier confirmed (or explicitly deferred to the artifact fallback)

---

## AGENT CHECKLIST (scriptable, after human steps 5–8)

1. Point the local remote at the new repo and confirm auth works:
   ```bash
   git remote set-url origin https://github.com/matthager12-collab/ExploreKingstonChamberApp.git
   git fetch
   git push --dry-run
   ```
2. Re-apply branch protection if the transfer dropped it, using the same
   required checks E02 configured:
   ```bash
   GH_TOKEN=$(grep -m1 GITHUB_TOKEN .env.git | cut -d= -f2) \
     gh api -X PUT repos/matthager12-collab/ExploreKingstonChamberApp/branches/main/protection \
     --input <protection-config>   # mirror the current rule set from repos/.../branches/main/protection
   ```
3. Trigger each workflow once manually and confirm success:
   ```bash
   GH_TOKEN=$(grep -m1 GITHUB_TOKEN .env.git | cut -d= -f2) \
     gh workflow run ci.yml -R matthager12-collab/ExploreKingstonChamberApp
   GH_TOKEN=$(grep -m1 GITHUB_TOKEN .env.git | cut -d= -f2) \
     gh workflow run ferry-observe.yml -R matthager12-collab/ExploreKingstonChamberApp
   GH_TOKEN=$(grep -m1 GITHUB_TOKEN .env.git | cut -d= -f2) \
     gh workflow run ferry-accuracy.yml -R matthager12-collab/ExploreKingstonChamberApp
   GH_TOKEN=$(grep -m1 GITHUB_TOKEN .env.git | cut -d= -f2) \
     gh workflow run backup-offsite.yml -R matthager12-collab/ExploreKingstonChamberApp
   ```
4. Push an empty commit to `main` (via PR if branch protection requires) and
   watch Render auto-deploy fire from the **new** repo; confirm
   `/api/health` returns 200 after the deploy. This is the single most
   important check in this whole runbook — Render auto-deploy dying silently
   after a repo re-link is the worst failure mode here.
5. Fill in the completion log below, including a Sentry test-event id if one
   is available (a deliberate staging-only error, or "none yet — wiring
   verified by config" if you didn't force one).
6. Run the full assertion suite:
   ```bash
   STAGING_URL=<staging onrender.com URL from the Render dashboard> \
     sh scripts/verify-migration.sh
   ```
   All checks must PASS.

---

## Traps (from the audits — don't rediscover these)

- The backup route buffers the whole bundle in RAM (512 MB instance). Don't
  point `backup-offsite.yml` at it more than daily; the 200 MB size guard in
  `scripts/fetch-encrypt-backup.sh` is deliberate, not decoration.
- Cross-account transfers can silently drop Actions secrets/variables and
  disable schedules — always verify with `scripts/verify-migration.sh`,
  never assume.
- GitHub's old-URL redirect makes a stale `origin` look functional even after
  the transfer — set it explicitly (agent step 1) and grep tracked files for
  the old slug (verify-migration.sh check 9).
- A `repo`-only PAT is silently insufficient once a new workflow file needs
  pushing — it fails with a specific "refusing to allow a Personal Access
  Token to create or update workflow" error, not a generic auth failure.
  Human step 6 mints a `repo` + `workflow` token from the start.
- `NEXT_PUBLIC_*` vars are build-time; `SENTRY_DSN` / `NOINDEX` / the tokens
  are deliberately runtime — both Render services build the identical image,
  so this split is what lets one Dockerfile serve both.
- Never restore a production backup onto staging — it contains real password
  hashes and real LTAC/survey PII. Staging runs from an empty disk + its own
  `SETUP_TOKEN` bootstrap by design.

---

## Completion log

Fill in as Part B executes:

| Item | Value |
|---|---|
| Migration date | _(YYYY-MM-DD)_ |
| New 1Password item — GitHub PAT | _(item name)_ |
| New 1Password item — age backup key | _(item name)_ — saved by Mat; local keypair file generated in agent scratchpad and deleted after confirmation |
| age public key (`BACKUP_AGE_RECIPIENT`) | `age18u4k3yx4qt3pdtqmx8x6as47uzu4vevdecnx5dkkeljy7fd9ha9s5zr5uh` (not secret — becomes the repo variable in human step 8) |
| UptimeRobot monitors created | Yes — "Explore Kingston — /api/health" + "Explore Kingston — /api/ferry/status", 5-min interval, email alerts on |
| UptimeRobot read-only API key | Saved in 1Password by Mat (path not recorded here — see his 1Password vault) |
| Sentry org / project | Org `greater-kingston-chamber-of-co`, project platform `javascript-nextjs`. Note: signup started a 14-day trial (no credit card required — reverts to free-plan limits automatically, not an auto-bill risk) |
| Sentry DSN + tokens on Render production | `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `BACKUP_TOKEN`, and `FERRY_OBSERVE_TOKEN` are all set on the `explore-kingston` Render service (confirmed via a redeploy + `/api/health` still 200). Values not recorded in any file, per the project's 1Password-is-source-of-truth pattern |
| Sentry verification token (`project:read` only) | 1Password: `op://Private/fswei6tqnabxtkcyutykupwt3q/credential` — used for AC 19's `curl .../api/0/projects/` check |
| Sentry test-event id | _(id, or "none yet — wiring verified by config")_ |
| R2 bucket created | _(yes/no/deferred)_ |
| `scripts/verify-migration.sh` result | _(all PASS, date run)_ |
| First production deploy from new repo — commit SHA | _(sha)_ |
