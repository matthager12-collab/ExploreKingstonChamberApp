# Split assessment: Feedback rudeness guardrail

**Plan assessed**: [plan.md](./plan.md) — 19 tasks, 4 phases, single repo
**Date**: 2026-08-21
**Recommendation**: **Split into two runs.** Not four, and not one.

---

## Factor values

| Factor | Comfortable | Split at | This plan | Verdict |
|---|---|---|---|---|
| Total tasks | 1–25 | 25+ | **19** | Under |
| Phases with sequential dependencies | 1–3 | 4+ | **4** | **At threshold** |
| Distinct roles needed | 1–4 | 5+ | **3** | Under |
| Working directories / worktrees | 1 | 2+ | **1** | Under |
| Cross-cutting handoffs or gates | 0–2 | 3+ | **3** | **At threshold** |
| Tasks needing external validation | 1–8 | 8+ | **4** | Under |

The three roles are: API integration and prompt hardening; Next.js route and client
component; privacy and data protection.

The three gates are: the T-01 smoke-test result, which feeds back into design.md and
could change the output mechanism; the Phase 2→3 atomic-release constraint from
DEC-002; and T-17, an external communication to the Chamber that must happen before
deploy.

The four externally-validated tasks are T-01 (live API call), T-16 (Render dashboard),
T-17 (Chamber comms) and T-19 (production observation).

> These numbers are a calibration, not a law. Re-tune when they stop matching what you
> observe, and re-date this line when you do. *Calibrated 2026-08-21.*

## Workload — by unique file, not task count

Eleven unique source files, none template-replicable, spread across three unrelated
domains:

| Domain | Files | Setup weight |
|---|---|---|
| LLM integration | `feedback-moderation.ts` + its test | **Heavy** — its own mock strategy for an SDK the repo has never used |
| Intake and UI | `route.ts`, `outbox.ts`, `feedback-tab.tsx`, `types.ts`, `site-copy-registry.ts`, `comment-list.tsx` + 3 test files | Moderate — familiar patterns, existing tests to extend |
| Privacy | `pii-inventory.ts`, `db/append.ts`, `privacy/policy.ts`, `privacy/page.tsx`, `docs/PRIVACY.md` | **Heavy** — `pii-inventory.ts` is long and dense, and the notice copy has to be read carefully rather than pattern-matched |

Nothing here is seven components from one template. Every file is its own problem.

## Qualitative judgement

**Context pressure — the real constraint.** One session can hold Phase 1. One session
can hold Phases 2 through 4. One session holding *all* of it would still be carrying
the SDK mock strategy and the moderation prompt while reading `pii-inventory.ts` and
rewriting public privacy copy — three heavy, unrelated context loads with no overlap.
That is the argument for splitting, and it is the only one that carries weight here.

**Blast radius.** T-01 is a genuine unknown: if `claude-haiku-4-5` rejects
`output_config.format`, the output mechanism changes. Isolating that behind a run
boundary means the failure costs nothing downstream, because nothing downstream has
been written yet.

**Natural checkpoints — there is exactly one.** The end of Phase 1: everything
committed, suite fully green, nothing user-visible changed, blast radius provably
limited to five files.

**Phase 2→3 is deliberately not a checkpoint.** DEC-002 makes the PII coverage test go
red at T-05 and stay red until T-15. A run boundary there could not have a
mechanically-checkable green exit criterion — it would have to assert "red in exactly
one expected way", which is a hope dressed as a check. Phases 2, 3 and 4 therefore stay
in one run.

## Recommendation

Two runs, split on the only clean checkpoint in the plan:

| Run | Covers | Tasks | Why it ends here |
|---|---|---|---|
| [run-1-sealed-seam](./run-1-sealed-seam/) | Phase 1 | T-01 – T-04 | Fully green, nothing user-visible, blast radius provable. Resolves the T-01 unknown before anything depends on it. |
| [run-2-wiring-and-privacy](./run-2-wiring-and-privacy/) | Phases 2–4 | T-05 – T-19 | Cannot be cut further: the suite is knowingly red from T-05 to T-15, so no interior boundary has a checkable exit. |

Handoff protocol in [choreography.md](./choreography.md).

## Resolved: `main` was not green — fixed on 2026-08-21

Found while executing `run-1-sealed-seam/validate-exit.sh`, fixed the same day in
commit `ddff311` on branch `tests-raise-testtimeout`. Recorded here because the
diagnosis is worth keeping, and because it was briefly a blocker on run 1's entry
criterion.

**Symptom.** Three runs of `npm run test` produced three different failure sets — 3 to
5 files each time, never the same ones, every one green when run alone. The branch
under test contained documentation only, so nothing about this project caused it.

**Cause.** Every failure carried the same message: `Test timed out in 5000ms`. Not
logic — vitest's default per-test budget. `vitest.config.ts` had already raised
`hookTimeout` to 30s for exactly this reason, with a comment describing the same flake,
but `testTimeout` was left at the 5s default. The tests that boot a database do it
inside the `it()` body (`createTestDb()`), not in a hook, so the fix never reached them
and the flake simply moved from the hooks to the bodies.

Raising `testTimeout` alone made it **worse** — 12 files failing instead of 6, and the
run taking 377s instead of 116s. A starved worker simply held its slot six times
longer. The underlying cause was parallelism: vitest defaults to one worker per core,
and every worker touching the data layer boots its own in-memory Postgres. This is an
8-core / 8GB machine also running Cursor, Claude and a Spotlight index pass — measured
load average 30, ~200k pageouts, i.e. swapping.

**Fix.** `testTimeout: 30_000` alongside the existing `hookTimeout`, plus
`maxWorkers: 4`. The cap binds only above 4 cores, so it is a no-op on the 4-core
GitHub runner and a real limit on a laptop.

**Verified.** Three consecutive full runs, under the same load that had been breaking
it: 182/182 files, 2276 tests, 0 failures, 154–200s. Typecheck clean, 0 lint errors,
no boundary violations.

**Why it mattered here specifically.** `tests/unit/pii-inventory.test.ts` is the
tripwire DEC-002 relies on — it forces the privacy work to ship with the feature. A
tripwire that fails at random cannot distinguish "the privacy work is missing" from
"PGlite was slow again", which is the one signal run 2 depends on.

`npm run test:server` remains a separate matter: it needs `TEST_DATABASE_URL` and a
throwaway Postgres, which is an environment prerequisite rather than a defect.

```
docker run -e POSTGRES_PASSWORD=ci -p 5432:5432 postgres:16
TEST_DATABASE_URL=postgres://postgres:ci@127.0.0.1:5432/postgres npm run test:server
```

## Open questions

One thing the executor of run 1 must write down rather than carry in its head: **which
constrained-output mechanism T-01 settled on.** Run 2 does not need to know, but a
future reader of design.md § Contracts does.

The flaky-suite finding above is the only blocker.

## Validation scripts — executed, not just written

Both `validate-exit.sh` scripts were run on 2026-08-21, each in both directions.

`run-1` caught a defect in its own first draft: four containment checks reported **PASS
against a file that did not exist**, because `grep` on a missing file exits 2 and the
`!` inversion turned that into success. Fixed with an `absent_from` helper that
`test -f`s first. Re-verified: the four checks now fail on a missing file, pass on a
clean stub, and fail again when a `tools:` key and a `throw` are added to that stub.

A second defect: the blast-radius check counted this project's own planning documents
as unexpected changes. `docs/FEEDBACK-GUARDRAIL/**` is now excluded, since run 1 is
expected to edit design.md with the T-01 finding.

`run-2 --entry` correctly fails all three entry checks against the current tree.

## Note on tooling

`plan-project`'s Step 7 instructs running `scripts/lint-plan.sh <project-directory>`.
**That script is not present in the installed skill** — `~/.claude/skills/plan-project/`
contains only `SKILL.md` and `reference/`. The four checks it describes (placeholder
markers, decision entries still `Open`, `DEC-NNN` references without matching entries,
broken relative links) were run by hand against this project directory on 2026-08-21
and all passed. Worth fixing in the skill.
