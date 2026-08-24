# Choreography: Feedback rudeness guardrail

Two runs, strictly sequential. Assessment and the reasoning behind the boundary are in
[split-assessment.md](./split-assessment.md).

```mermaid
graph LR
  R1[run-1-sealed-seam<br/>T-01 – T-04] -->|moderateComment exists,<br/>suite green| R2[run-2-wiring-and-privacy<br/>T-05 – T-19]
  R2 --> REL[squash-merge to main]
```

## Run order

| # | Run | Tasks | Roles | Isolation |
|---|---|---|---|---|
| 1 | [run-1-sealed-seam](./run-1-sealed-seam/) | T-01 – T-04 | API integration, prompt hardening | Own git worktree — touches no file run 2 needs |
| 2 | [run-2-wiring-and-privacy](./run-2-wiring-and-privacy/) | T-05 – T-19 | Next.js route + client; privacy / data protection | Shared checkout, after run 1 has merged |

`work/` is a shared checkout across concurrent sessions. Run 1 must use a worktree, and
must copy `.env.local` into it.

## Artifact dependencies

| Artifact | Produced by | Consumed by |
|---|---|---|
| `src/lib/feedback-moderation.ts` — the `moderateComment` contract | Run 1, T-03 | Run 2, T-06 |
| The T-01 finding: which constrained-output mechanism `claude-haiku-4-5` accepts | Run 1, T-01 | design.md § Contracts — documentation only, run 2 does not branch on it |
| `ANTHROPIC_API_KEY` in `.env.production.example` | Run 1, T-02 | Run 2, T-16 (set the real value on Render) |

Run 2 depends on run 1 through **one function signature**. That narrowness is what
makes the boundary safe: if run 1's internals change, run 2 is unaffected.

## Handoff protocol

**Run 1 → run 2**

1. Run 1 executes `./run-1-sealed-seam/validate-exit.sh` from `work/`. It must print
   `ALL CHECKS PASSED`.
2. Run 1 commits and merges its branch into the feature branch. The suite is green at
   this point and must stay green until run 2's T-05.
3. Run 1 records the T-01 finding in design.md § Contracts, replacing the
   implementation-order note with the answer.
4. Run 2 begins by executing `./run-2-wiring-and-privacy/validate-exit.sh --entry`,
   which re-checks run 1's exit criteria rather than trusting the handoff.

**Run 2 → release**

Run 2 carries the release itself (T-16 – T-19). Two things in it are not code and
cannot be validated by script:

- **T-17 is already answered: the Chamber approved the notice bump on 2026-08-23**
  (DEC-007). It was their call to make — `policy.ts:18-21` records their team going the
  other way once before. What remains open is the T-14 notice *wording*, which they
  still review. Re-confirm the approval only if the deploy slips well past that date.
- **T-16 sets the key in the Render dashboard only.** It goes in no commit, no note,
  and no message.

## The red-suite window that never happened

Run 2's plan said `pii-inventory.test.ts` would fail by design from T-05 to T-15, and
that this red window was what forced the privacy work to ship with the feature.

**It did not go red.** The suite stayed green through the whole of Phase 2 with contact
fields live in the route and the store still registered as identifier-free. The old
coverage tests could not see it — see DEC-002 § Correction.

A real tripwire was added during run 2 and mutation-tested. The rule the window was
meant to enforce still stands and is now actually enforced:

- **Do not merge with contact fields live and the store registered identifier-free.**
  That combination now fails the suite. It previously did not.
- **Do not "fix" a failing tripwire by relaxing it.** It is the only thing keeping the
  published notice honest about what the store holds.

## Execution

Each run's tasks are executed with **implement-spec**, one task at a time, against that
run's `project-plan.md`. Sequencing between runs is the harness's job — do not hand-walk
this document by pasting prompts.
