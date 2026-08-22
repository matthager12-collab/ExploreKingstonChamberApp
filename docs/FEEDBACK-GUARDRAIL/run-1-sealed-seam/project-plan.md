# Run 1: The sealed moderation seam

Phase 1 of [../plan.md](../plan.md), tasks T-01 – T-04.

## Goal

Build `moderateComment` — a classifier call with no capability surface — and prove by
test that it cannot be weaponised and cannot throw. Nothing in the app calls it when
this run ends.

## Isolation

**Own git worktree.** `work/` is a shared checkout. Copy `.env.local` into the worktree;
without `ANTHROPIC_API_KEY` the module is a no-op and T-01 cannot run at all.

## Entry criteria

| Criterion | Check |
|---|---|
| Branch cut from a green `main` | `npm run test:all` exits 0 on `main` — **currently unmet, see below** |
| Worktree is clean | `git status --porcelain` is empty |
| `ANTHROPIC_API_KEY` available for T-01 | present in `.env.local`, absent from git |

> **`main` is not green.** As of 2026-08-21, `npm run test` fails on 3–5 files, and the
> set varies between identical runs — `analytics-k-floor`, `backup-restore-roundtrip`
> and `pii-inventory` are the recurring names. `npm run test:server` additionally needs
> `TEST_DATABASE_URL` and a throwaway Postgres.
>
> `pii-inventory.test.ts` is the tripwire run 2 depends on (DEC-002), so a flaky
> failure there is not cosmetic. Stabilise it, or at least record a known-flaky
> baseline, before starting. Details in [../split-assessment.md](../split-assessment.md)
> § Blocking finding.

## Tasks

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| T-01 | Smoke-test one `messages.create` against `claude-haiku-4-5` with `output_config.format` and the two-field schema, from a throwaway script | — | Returns a parsed `{rude, cleaned}`; **or** 400s and the fallback (`strict: true` tool + forced `tool_choice`) is confirmed instead. The winning mechanism is written into [../design.md](../design.md) § Contracts, replacing the implementation-order note. Script deleted, not committed. |
| T-02 | Add `@anthropic-ai/sdk`; add `ANTHROPIC_API_KEY` to `.env.production.example` with a comment saying an unset key disables moderation | T-01 | `npm run lint:boundaries` exits 0. No key value in any tracked file. |
| T-03 | Write `src/lib/feedback-moderation.ts` per [../design.md](../design.md) § Contracts, implementing containment controls C1–C9 | T-02 | Exports `ModerationResult` and `moderateComment`. No `tools` key, no retry beyond `maxRetries: 1`, no path that throws. Header comment names each control it implements. |
| T-04 | Write `tests/unit/feedback-moderation.test.ts` with the SDK mocked | T-03 | Six cases: unset key, timeout, 5xx, off-schema reply, over-length `cleaned`, and an injection-bearing comment producing a request body with no `tools` key and the text confined to the `user` turn. |

## Exit criteria

Checked by [`validate-exit.sh`](./validate-exit.sh). Run it from `work/`.

1. `npm run typecheck`, `npm run lint`, `npm run lint:boundaries` and `npm run test:all`
   each exit 0.
2. `src/lib/feedback-moderation.ts` and `tests/unit/feedback-moderation.test.ts` exist.
3. The module declares no tools, contains no `throw`, and never mentions `email` or
   `name` — contact data must not be reachable from it (control C6).
4. Files changed against `main` are confined to those two plus `package.json`,
   `package-lock.json` and `.env.production.example`.
5. No API key appears in the diff.

## Out of scope for this run

Anything a visitor can see. Do not touch the route, the widget, the copy registry, the
types, or any privacy file. If a change here appears to require one of those, the seam
is not sealed and the design is wrong — stop and say so.
