# Git & GitHub setup for this repo

*July 2026. This repo is live and public. See also
[DEPLOY.md](DEPLOY.md) (Render auto-deploys from GitHub on push) and
[README.md](README.md) (doc index).*

## Current reality (as configured)

- **Remote:** `origin` → `https://github.com/mat-arda-cards/visit-kingston.git`
- **Visibility:** **PUBLIC** on GitHub. (Made public to bypass a
  Render↔GitHub sync issue during Phase-1 launch. No secrets are in git —
  every `.env*` is gitignored; the one committed sample is
  `.env.production.example`, which contains placeholders only.)
- **Branch:** `main` (production), `staging` (E03 staging target — see
  [DEPLOY.md §2d](DEPLOY.md)).
- **Repo-local identity** (already set — beats the global arda identity):

  ```
  user.name  = Mat
  user.email = matt.hager12@gmail.com
  ```

  Note the name is `Mat`, not `Matt Hager`; the personal **email** is what
  keeps commits off the arda identity. Reset it if you want the full name:
  `git config user.name "Matt Hager"`.
- **GitHub account:** `mat-arda-cards` (personal, despite the arda-ish name —
  confirmed intentional). A migration to a different account
  (`matthager12-collab`) was drafted under E03 but is **on hold** — the
  target account already had a same-named placeholder repo blocking a clean
  transfer, and Mat decided to stay put rather than resolve that conflict.
  This repo is not moving for now.
- **Deploy:** Render **auto-deploys on push to `main`** from this GitHub repo
  (Blueprint / `render.yaml`, Docker build). A push is a production deploy —
  see [DEPLOY.md](DEPLOY.md). Push to `staging` deploys the staging service
  instead ([DEPLOY.md §2d](DEPLOY.md)).

## Why the separation exists

The owner's **work** identity is `Mat <mat@arda.cards>` (global git config +
the arda-authenticated `gh` CLI). This community project must stay off that
identity. The rule: **keep everything repo-local; never set the personal
email or credentials on the global git config, and never sign personal-project
work with `mat@arda.cards`.**

Repo-local config always wins over global, so the values above are sufficient
— no per-directory `includeIf` is currently configured (nor needed for this
single repo).

## How pushes authenticate (the credential helper)

This repo does **not** use the arda `gh` CLI and does **not** prompt 1Password
on every push. It has a **repo-local credential helper** (in `.git/config`)
that reads a Personal Access Token from a gitignored env file:

```
[credential]
    helper = "!f() { echo username=x-access-token; \
      echo \"password=$(grep -m1 GITHUB_TOKEN \
      '/Users/matatarda/chamber app/visit-kingston/.env.git' \
      | cut -d= -f2)\"; }; f"
```

- The token lives in `visit-kingston/.env.git` as `GITHUB_TOKEN=...`.
- `.env.git` is **gitignored** (both the broad `.env*` rule and an explicit
  `.env.git` line in `.gitignore`) and is `chmod 600`. It is never committed.
- Result: `git push` is instant and silent — no interactive prompt.

**Source of truth for the token remains 1Password:**
`op://Private/Github MattHager/credential`. The `.env.git` file was **seeded
from that item** on 2026-07-03 after repeated `op read` auth-timeouts made
pushing painful. If you prefer reading straight from 1Password instead of the
cached file, swap the helper's `grep` for
`op read "op://Private/Github MattHager/credential"` (slower, prompts on op
session expiry).

**The PAT needs both `repo` AND `workflow` scopes** (not just `repo`) — the
repo has GitHub Actions workflow files (`ci.yml`, the two ferry crons,
`backup-offsite.yml`), and pushing a new/changed workflow file is rejected by
a `repo`-only token with a clear "refusing to allow a Personal Access Token
to create or update workflow" error. The current token already has both
scopes (confirmed: the E03 PR pushed `backup-offsite.yml` successfully).

**Never print the token.** If it rotates, refresh `.env.git` from 1Password:

```bash
op read "op://Private/Github MattHager/credential" | \
  sed 's/^/GITHUB_TOKEN=/' > "/Users/matatarda/chamber app/visit-kingston/.env.git"
chmod 600 "/Users/matatarda/chamber app/visit-kingston/.env.git"
```

(Or just edit `.env.git` by hand.) The PAT needs **`repo` + `workflow`**
scopes — see the note above.

## Everyday workflow

```bash
cd "/Users/matatarda/chamber app/visit-kingston"
git add -A
git commit -m "…"        # authored as matt.hager12@gmail.com automatically
git push                 # helper supplies the PAT; Render then auto-deploys
```

Because a push to `main` triggers a Render production deploy, treat `main` as
release-worthy: build/lint locally first (`npm run build`, `npm run lint`),
and watch the Render deploy + `/api/health` after pushing (see
[DEPLOY.md](DEPLOY.md)).

## If you ever need to reset / re-clone

1. Clone: `git clone https://github.com/mat-arda-cards/visit-kingston.git`.
2. Set repo-local identity:
   ```bash
   git config user.email "matt.hager12@gmail.com"
   git config user.name  "Matt Hager"   # or "Mat" to match current
   ```
3. Recreate `.env.git` from 1Password (see the refresh snippet above) and
   re-add the credential helper block to `.git/config` — helper config lives
   in `.git/config`, so it does **not** travel with a fresh clone.
4. Confirm the arda identity did not leak in: `git config user.email` must
   print `matt.hager12@gmail.com`, and `git log -1 --format='%ae'` on your
   commits must not be `mat@arda.cards`.

## Guardrails

- **Never** commit `.env.git` (or any `.env*` except `.env.production.example`).
- **Never** set `matt.hager12@gmail.com` or the PAT on global git config.
- **Never** paste the token into a commit, doc, issue, or PR — the repo is
  **public**.
- Since the repo is public, double-check any new file for secrets before
  `git add` (WSDOT key, AUTH_SECRET, DB URLs, Blob/Upstash tokens all belong
  only in the host's dashboard env, never in git).
