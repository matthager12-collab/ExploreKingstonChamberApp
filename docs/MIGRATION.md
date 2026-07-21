# Repo migration runbook (E03) — COMPLETE 2026-07-11

Ordered steps to stand up the ops floor (Sentry, UptimeRobot, encrypted
off-site backups, staging) and move this repo to a new GitHub account. The
ops floor is **done** (see the completion log).

**Status: COMPLETE.** The transfer of `mat-arda-cards/visit-kingston` →
`matthager12-collab/ExploreKingstonChamberApp` was initiated via the GitHub
API on 2026-07-10 and **accepted on 2026-07-11**. The repo now lives at
`matthager12-collab/ExploreKingstonChamberApp` and is **public**. The local
`origin`, the GitHub Actions secrets/variables, and Render (service +
Blueprint) were all re-pointed at the new repo the same day, and `main`
auto-deploys to production again. The old `mat-arda-cards/visit-kingston` URL
still resolves via GitHub's transfer redirect — that redirect is a trap, not a
fallback (see Traps below); never target it. Everything below this line is
retained as the procedural record of how the move was done.

**Sequence as executed (2026-07-10 → 2026-07-11):**

1. **Done — don't accept while an agent session is mid-push.** No session was
   mid-push. The moment the transfer was accepted, pushes authenticated as
   `mat-arda-cards` stopped working (the repo became `matthager12-collab`'s;
   public reads and the old-URL redirect keep working).
2. **Done (2026-07-11) — transfer accepted** via the email link on the
   `matthager12-collab` account. The repo landed already named
   `ExploreKingstonChamberApp`, and is public.
3. **Done — new PAT minted** (step 6 below: `repo` + `workflow` scopes on
   `matthager12-collab`) and written to `.env.git` per step 6.3, restoring
   push access for local/agent work.
4. **Done (2026-07-11) — Render re-linked** (step 7 below): the Render GitHub
   App is installed on `matthager12-collab`, and the service + Blueprint point
   at the new repo, branch `main`, auto-deploy **on**. Every merge to `main`
   now deploys to production with no human trigger — and each deploy is a
   ~15s full outage, because both services mount a persistent disk, so Render
   must stop the old instance before starting the new one. See "Migrations
   under auto-deploy" and "Deploys are zero-downtime" in
   `docs/RUNBOOK-CUTOVER.md`.
5. **Done — Claude ran `scripts/verify-migration.sh`**, updated the local
   remote, and swept docs/memory for the old slug.

Historical note (2026-07-07): the transfer was briefly ON HOLD because the
target name was occupied by a same-named placeholder repo; that conflict was
cleared before the transfer ran. Steps **8** (GitHub Actions secrets/variables)
and **9** (Cloudflare R2) were completed before the transfer and moved with it.

## Recorded slugs

- **Current repo:** `matthager12-collab/ExploreKingstonChamberApp`
  (`https://github.com/matthager12-collab/ExploreKingstonChamberApp.git`) — a
  personal GitHub account, **public**. This is the canonical slug; use it
  everywhere, including every `gh ... -R` flag.
- **Former slug (redirect only — do not use):** `mat-arda-cards/visit-kingston`
  (`https://github.com/mat-arda-cards/visit-kingston.git`) — a different
  personal GitHub account, despite the arda-ish name. GitHub still redirects
  it, which is exactly what makes a stale `origin` or a stale `-R` look like
  it worked.

## Why a cross-account transfer, not a rename (rationale, executed 2026-07-11)

The repo moved from `mat-arda-cards` — despite the name, one of Mat's personal
accounts, not the arda work account — to `matthager12-collab`, a distinct
personal account, renaming it to `ExploreKingstonChamberApp` at the same time.
GitHub's transfer preserves stars/issues and leaves a redirect at the old URL.

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

### 5. GitHub account + transfer — DONE 2026-07-11

Outcome: transferred to `matthager12-collab`, renamed to
`ExploreKingstonChamberApp`, confirmed **public**. Nothing to do here; the
steps are kept as the record of what was performed.

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

### 7. Render re-link — DONE 2026-07-11

Outcome: the `explore-kingston` service **and** the Blueprint are linked to
`matthager12-collab/ExploreKingstonChamberApp`, branch `main`, auto-deploy
**on**. Production has deployed from the new repo many times since. Steps kept
as the record of what was performed.

1. Install/authorize the Render GitHub App on `matthager12-collab` for the
   new repo.
2. In the Render dashboard, point the `explore-kingston` service **and** the
   Blueprint at `matthager12-collab/ExploreKingstonChamberApp`, branch
   `main`, auto-deploy **on**. (The old link was kept until a real deploy from
   the new repo had been proven — it since has been, repeatedly.)
3. Approve the Blueprint sync that creates `explore-kingston-staging` (+ its
   `data-staging` disk) — this is the new-spend sign-off for staging
   (~$7.25/mo + ~$0.25/mo disk, pre-approved in the v2 budget; you're
   clicking the actual Render approval).
4. Set staging's `sync: false` env vars in the dashboard: `WSDOT_API_KEY`,
   `NEXT_PUBLIC_SITE_URL` (the staging service's own `onrender.com` URL, once
   Render assigns it), `SENTRY_DSN`, `BACKUP_TOKEN`, `FERRY_OBSERVE_TOKEN`.

### 8. GitHub Actions secrets/variables — DONE

`backup-offsite.yml` and the ferry crons need these to run. They were set
before the transfer and moved with it, so they now live on
`matthager12-collab/ExploreKingstonChamberApp` (see the completion log).
Verify — always against the new slug, never the redirect:

```bash
gh secret   list -R matthager12-collab/ExploreKingstonChamberApp
gh variable list -R matthager12-collab/ExploreKingstonChamberApp
```

What was set:

1. Create Actions **secrets** (Settings → Secrets and variables → Actions →
   Secrets):
   - `FERRY_OBSERVE_TOKEN` — value from step 3
   - `BACKUP_TOKEN` — value from step 3
2. Create Actions **variables** (same page, Variables tab):
   - `FERRY_OBSERVE_URL` = `https://explore-kingston.onrender.com`
   - `BACKUP_AGE_RECIPIENT` = the `age1...` public key from step 4
3. Confirm branch protection on `main` is still active (it already is — E02
   set it up on this repo and nothing has touched it).

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

- [x] Staging cost approved — service is live (~$7.25/mo + ~$0.25/mo disk); the Blueprint sync auto-created it on merge with no separate approval prompt, but Mat directed the merge that triggered it and confirmed the live service
- [x] Sentry free tier confirmed — 14-day trial, no credit card required, reverts to free-plan limits automatically
- [x] UptimeRobot free tier confirmed — no credit card required
- [x] R2 confirmed — free tier limits (10GB storage, 1M Class A + 10M Class B ops/month), but note R2 subscription **does** require a payment method on file (unlike Sentry/UptimeRobot); current usage is $0.00

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
4. **Done — proven many times over.** Production auto-deploys `main` from the
   new repo on every merge, and `/api/health` returns 200 with `dbOk: true`.
   Do **not** re-run this as a casual probe. A merge to `main` is a real
   production deploy, and because both Render services mount a persistent disk
   only one instance can hold it — so Render stops the old instance before
   starting the new one. Every deploy is therefore a ~15s **full outage**, and
   a release that never goes healthy leaves production 502ing: it does not
   fail closed, and the old release does not keep serving. See "Migrations
   under auto-deploy" and "Deploys are zero-downtime" in
   `docs/RUNBOOK-CUTOVER.md`.
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
| Migration date | 2026-07-11 — transfer accepted on `matthager12-collab`; repo is now `matthager12-collab/ExploreKingstonChamberApp`, public. Render re-linked the same day |
| Part A PR | [#2](https://github.com/mat-arda-cards/visit-kingston/pull/2) merged 2026-07-10; follow-up [#3](https://github.com/mat-arda-cards/visit-kingston/pull/3) (this file's step-8 clarification) merged same day |
| Production | Live on the merged E03 code — `/api/health` 200, `/robots.txt` disallows only `/admin` `/portal` `/api`, `/api/ferry/observe` correctly 401s without a token |
| Staging | Live at `https://explore-kingston-staging.onrender.com` — auto-created by the Blueprint sync (no separate spend-approval prompt appeared), `staging` branch pushed to match `main`, `/robots.txt` correctly returns a bare `Disallow: /` (`NOINDEX=1`) |
| GitHub Actions secrets/variables | `BACKUP_TOKEN` + `FERRY_OBSERVE_TOKEN` secrets and `FERRY_OBSERVE_URL` + `BACKUP_AGE_RECIPIENT` variables were set pre-transfer on `mat-arda-cards/visit-kingston` and moved with the repo; they now live on `matthager12-collab/ExploreKingstonChamberApp`. `ferry-observe`/`ferry-accuracy` cron runs confirmed succeeding |
| New 1Password item — GitHub PAT | _(item name)_ — new PAT minted on `matthager12-collab` (`repo` + `workflow`) after the 2026-07-11 transfer and written to `.env.git`; record the 1Password item name here |
| New 1Password item — age backup key | _(item name)_ — saved by Mat; local keypair file generated in agent scratchpad and deleted after confirmation |
| age public key (`BACKUP_AGE_RECIPIENT`) | `age18u4k3yx4qt3pdtqmx8x6as47uzu4vevdecnx5dkkeljy7fd9ha9s5zr5uh` (not secret — becomes the repo variable in human step 8) |
| UptimeRobot monitors created | Yes — "Explore Kingston — /api/health" + "Explore Kingston — /api/ferry/status", 5-min interval, email alerts on |
| UptimeRobot read-only API key | Saved in 1Password by Mat (path not recorded here — see his 1Password vault) |
| Sentry org / project | Org `greater-kingston-chamber-of-co`, project platform `javascript-nextjs`. Note: signup started a 14-day trial (no credit card required — reverts to free-plan limits automatically, not an auto-bill risk) |
| Sentry DSN + tokens on Render production | `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `BACKUP_TOKEN`, and `FERRY_OBSERVE_TOKEN` are all set on the `explore-kingston` Render service (confirmed via a redeploy + `/api/health` still 200). Values not recorded in any file, per the project's 1Password-is-source-of-truth pattern |
| Sentry verification token (`project:read` only) | 1Password: `op://Private/fswei6tqnabxtkcyutykupwt3q/credential` — used for AC 19's `curl .../api/0/projects/` check |
| Sentry test-event id | _(id, or "none yet — wiring verified by config")_ |
| R2 bucket created | Yes — `explore-kingston-backups`, Standard storage class, public access disabled, 90-day object-expiry lifecycle rule. Account-scoped API token (Object Read & Write, restricted to this bucket). GitHub secrets `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` + variables `R2_ENDPOINT`/`R2_BUCKET` set on `mat-arda-cards/visit-kingston`. Manually triggered `backup-offsite.yml` run succeeded end-to-end — `explore-kingston-backup-2026-07-10.json.age` (352 KB, `application/vnd.age`) confirmed in the bucket, no plaintext artifact |
| `scripts/verify-migration.sh` result | _(all PASS, date run)_ |
| First production deploy from new repo — commit SHA | _(sha)_ |
