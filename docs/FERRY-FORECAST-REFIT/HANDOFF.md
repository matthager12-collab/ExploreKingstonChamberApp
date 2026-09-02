# HANDOFF — ferry forecast refit

**Written 2026-09-01, mid-build.** Read this first, then `plan.md`.

Everything needed to resume is in this repository. Nothing lives in a Claude
session, a chat log, or a temp directory — that was checked, and one thing had
already been lost to it (see *Recovered*, below).

## Resuming on another machine / another account

The Claude account is changing (→ `matt.hager12@gmail.com`). **The GitHub
account is not** — this repo is `matthager12-collab/ExploreKingstonChamberApp`
and access is unaffected.

```bash
git clone https://github.com/matthager12-collab/ExploreKingstonChamberApp.git
cd ExploreKingstonChamberApp
git checkout ferry-forecast-accuracy-eval
npm install
```

Then read, in this order: `HANDOFF.md` (this file) → `plan.md` →
`decisions.md` → `phase-1-measure-honestly/implementation-plan.md`.

An offline copy of the full branch history also exists as a `git bundle` in the
engagement folder (`clients/kingston-chamber/engagement/`), for a machine with
no GitHub access. Restore with `git clone <bundle-file> repo`.

### Secrets you must re-supply (none are in this repo)

| What | Where it lives | Needed for |
|---|---|---|
| `DATABASE_URL` (local dev Postgres, port 5433) | `.env.local`, gitignored | running the app |
| `DATABASE_URL` (prod Neon, read-only use only) | `.env.prod-import`, gitignored | re-pulling observations |
| WSDOT API key | `.env.local` | live ferry data; app falls back to bundled schedules without it |
| `AUTH_SECRET`, `SETUP_TOKEN` | `.env.local` | auth |

All are in 1Password. **You do not need any of them for phase 1** — every
target is asserted against the committed fixtures.

## Where the work stands

| Phase | State |
|---|---|
| Planning | **Complete.** 5 documents, 12 decisions, lint-clean, adversarial review done. |
| Phase 1 — measure honestly | **In progress.** S-1 of 8 done (the fixture). |
| Phases 2–4 | Not started. |

**Next action: step S-2** in
[phase-1-measure-honestly/implementation-plan.md](phase-1-measure-honestly/implementation-plan.md)
— add `collapseToSailings()` to `src/lib/stores/ferry-observations.ts` and
`isHolidayDate()` to `src/lib/ferry-forecast.ts`.

Both divergences in that plan (D-1: `history` is written but never rendered, so
the discontinuity work has no target; D-2: `holiday()`/`parseParts()` are
private and need one pure export) were **approved by Mat on 2026-09-01** before
the build started. Build to the plan as written.

## Recovered: the raw observation archive

`ferry_observation` has 90-day retention. The rows behind every number in this
plan begin **2026-07-03** and would have been pruned from prod around
**2026-10-01**. The original analysis pull lived only in a session temp
directory, which was cleared. It has been re-pulled and committed:

| File | Holds | Note |
|---|---|---|
| `tests/fixtures/ferry/observations-2026-summer.json.gz` | 34,800 raw snapshots, 2026-07-04 → 2026-09-02 | **The only copy.** Irreplaceable after ~2026-10-01. No personal data. |
| `tests/fixtures/ferry/sailings-2026-summer.json` | 2,156 per-sailing outcomes, 50 days | The evaluation window. **Do not regenerate.** |

**Do not rebuild the fixture from the archive.** The archive is a superset — 60
days now, against the 50 the evaluation measured. Every acceptance number in
`plan.md` and `verification.md` (MAE 28.1, bias −21.8, n=2156) is pinned to the
2,156-sailing fixture. Regenerating it silently invalidates all of them.

The archive is for work the fixture cannot support — notably **T-04**, which
needs per-snapshot lead times the collapsed fixture does not carry.

## Two traps that already caught me

**1. `ferry_observation.ts` is not the observation time.** The *column* carries
the import time for re-imported rows and reads 9 days late at the start of the
window. The payload `ts` and `departs` are authoritative. Reading the column is
what produced the wrong window in the first draft of the evaluation, and with it
the false claim that no holiday was in the data.

**2. July 4th is in the window, and the model gets it backwards.** `holiday()`
applies 1.5× calling it "the ferry's worst day of the year"; it was among the
quietest observed (predicted 67, observed 33, n=48). This is **DEC-012, status
Deferred, opens at phase 2.** Phase 1 changes no prediction behaviour, so it
blocks nothing now. Do not act on it without reading the confound noted there.

## The one-paragraph version

The forecast's reported 32-point error is mostly a grading artifact: WSF holds
deck space at maximum until ~30 minutes before departure, so 57% of graded rows
measure an empty boat. Graded per sailing the model runs 22 points *low*, not 19
high, and barely beats guessing a constant. A cross-validated average of the
same log reaches ~11 points — near the 10.6-point noise floor. The plan fixes
the measurement first (phase 1), then the model.
