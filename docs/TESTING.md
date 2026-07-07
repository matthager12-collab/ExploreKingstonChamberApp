# Testing & CI

This repo's automated quality floor (stood up in v2 epic E02). After this landed,
no change reaches `main` — and therefore the live site (Render auto-deploys `main`
on push) — without passing the `ci` check.

## Suites

| Suite | Config | What it covers |
| --- | --- | --- |
| Unit | `vitest.config.ts` | Pure/characterization tests. Two first-class homes: the central `tests/unit/**/*.test.ts` and the colocated `src/**/*.test.ts` (both run). No server, no network, no `DATABASE_URL`. |
| Server | `vitest.server.config.ts` | Boots the **standalone production build** once (`node .next/standalone/server.js`) and runs the route-gating walk + axe smoke against it. |

Unit homes cover: json-store overlay/tombstone semantics, auth/session mechanics,
the hours engine, the pure ferry model (incl. the `empiricalBucketKey` golden and
the `wsf.ts` ↔ `ferry-forecast.ts` boarding-pass parity alarm), the ferry-reminder
ICS builder + wait-time parser, and copy-registry consistency. Server covers: the
generated unauthenticated admin/portal route-gating walk, and the axe a11y smoke.

## Local commands

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint (green via the LINT-BASELINE block, see below)
npm run lint:boundaries  # dependency-cruiser layering rules
npm run test             # unit suites (tests/unit/** + colocated src/**)
npm run build            # required before the server suite (standalone output)
npx playwright install chromium   # one-time, for the axe smoke
npm run test:server      # route-gating walk + axe smoke (needs a prior build)
npm run test:all         # unit + server
node scripts/check-frozen.mjs     # frozen-manifest guard (see below)
```

The server suite fails fast with "run `npm run build` first" if `.next/standalone`
is missing. It seeds a scratch admin user and a temp `DATA_DIR`, and strips
`DATABASE_URL`/`UPSTASH_*` from the spawned server's env so it can never hit real
Neon/Redis.

## The route-gating walk (`tests/server/admin-walk.test.ts`)

Enumerates every `src/app/api/admin/**/route.ts` and `src/app/api/portal/**/route.ts`
from disk, derives the URL + exported methods, and asserts each returns 401/403
without a session. **Adding a route needs no test change — it is auto-covered.**

A route that is *public by design* needs an entry in the walk's override table with
a justification (e.g. the two portal calendar-deconfliction GETs return 400 for a
bare request, not 401). If the walk ever reports a genuinely ungated admin/portal
route, that is a live security hole — fix the route, do not weaken the test.

## The axe smoke + baseline

`tests/server/axe-smoke.test.ts` runs axe on `/ /ferry /eat /events /stay /about`,
keeps only serious/critical violations, and fails on any rule id **not** already in
`tests/server/axe-baseline.json`. It is a regression gate, not a full audit (E14
hardens it and owns remediation).

Regenerate the baseline (only ever *downward* — a **new** violation must be fixed,
not baselined):

```bash
npm run build
AXE_UPDATE_BASELINE=1 npm run test:server   # rewrites tests/server/axe-baseline.json
```

## The `LINT-BASELINE` block (`eslint.config.mjs`)

`main` had 33 pre-existing eslint errors in ten frozen client components under five
rules. Fixing them would change runtime behavior, so the appended `LINT-BASELINE
(E02)` block downgrades **only** those five rules to `"warn"` for **only** those ten
files. The occurrences still print as warnings. **Shrink-only policy:** an entry is
removed when a later epic that owns a file actually fixes it — never add a file or
rule without an ask-first. No repo-wide disables, no `eslint-disable` comments in
`src/`.

## Frozen manifest (`.agent-frozen`)

Lists files agents must not modify without explicit human approval — the pure
domain modules, the two ferry cron workflows, and the audit-flagged monoliths.
Enforced two ways:

1. **CI + local:** `scripts/check-frozen.mjs` fails if any changed file (committed
   vs the PR base, or uncommitted vs HEAD) matches a manifest entry.
2. **Agent tool-use:** a `PreToolUse` hook in `.claude/settings.json` blocks
   Edit/Write on manifest-matched paths.

**Escape hatch:** apply the `frozen-change-approved` label to a PR to authorize a
deliberate change to a frozen file. **Manifest-edit policy:** entries are
removed/changed only by an epic explicitly chartered to modify that file, in the
same PR, ask-first.

## Dependency-cruiser boundaries (`.dependency-cruiser.cjs`)

Run by `npm run lint:boundaries`. Codifies: no circular deps in `src/**`;
`src/lib` must not import `src/app` or `src/components`; `src/components` must not
import `src/app`. Two pre-existing violations are carved out with commented
`pathNot` baselines (copy-context → rich-text; ferry-webcams-box → webcam-grid) —
**shrink-only**, same policy as the lint baseline. Later epics extend these rules
rather than re-creating the file.

## Copy-registry contract + orphan allowlist

`tests/unit/copy-registry.test.ts` statically scans `copyText(...)` / `useCopy(...)`
/ `<EditableText copyKey=... fallback=... />` call sites and asserts each key exists
in `COPY_BLOCKS` and each fallback string-equals the registry `fallback`. The
registry documents the code, never the reverse: when a fallback drifts, fix the
**registry** to match the rendering call site. Registry keys with no call site must
be listed in `tests/unit/copy-orphans.json` (they are kept explicitly, not deleted);
verify each is genuinely unrendered before adding it.

## Branch protection (`branches/main/protection`)

The `ci` check is required on `main` — this is what actually gates the live site,
since Render deploys on push and does not wait for GitHub checks. Recipe (repo is
resolved dynamically because the remote is migrating in E03 — **never hardcode the
owner/repo**):

```bash
gh api -X PUT "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["ci"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

`enforce_admins:false` and no required reviews are the solo-operator defaults.
**E03 must re-apply this recipe on the migrated repo** after the remote moves.
