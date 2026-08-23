# Plan: ferry forecast refit

## Overview

Take the busyness forecast from a reported 32.5 MAE — most of it a grading
artifact — to the measured ~10.6 ceiling, so `accuracyVerdict()` returns
`ready` on evidence and the Chamber can flip the public prediction flag.
Architecture in [design.md](./design.md); the measurements every target below
is drawn from are in
[../FERRY-FORECAST-ACCURACY-2026-08.md](../FERRY-FORECAST-ACCURACY-2026-08.md).

Four phases, strictly sequenced: **measure honestly → refit the fallback →
make data primary → say what visitors actually asked.** Nothing in phases 1–3
changes what the public sees, because the feature ships dark.

## Scope

**In**: per-sailing grading and aggregation; refit `CURVES`; trailing-window
data-first blend; empirical table off the request path; re-derived level
thresholds; walk-forward backtest of the *shipped* model; probability-of-full.

**Out** (unchanged by this plan, and stated so no one assumes otherwise):

- Queue sensing — [../FERRY-QUEUE-SENSING.md](../FERRY-QUEUE-SENSING.md) is a
  separate plan. This work preserves the `scoreAt()` blend seam it depends on.
- `ARRIVE_EARLY_DRIVE` / `ARRIVE_EARLY_WALK` / `BOAT_WAIT` minute claims. They
  are research-derived and **this data cannot validate them** — deck fullness
  says nothing about how many boats you wait. They keep sitting on top of a now-
  measured busyness number, which is an improvement, not a validation.
- `seasonFactor` (0.82 / 0.58). All 50 days are peak season, so it cannot be
  validated at all. Phase 2 adds a guard instead of a refit — see DEC-004.
- **The holiday multipliers, for now.** July 4th *is* in the window and the
  1.5× multiplier over-predicts it by 34.6 points on 48 sailings — the model
  calls it the busiest day of the year and it was one of the quietest. That is
  one occurrence in one year, too thin to refit against but too strong to keep
  asserting. Recorded as **DEC-012, deferred to phase 2**.
- **Deferred: narrowing the observation window** (change #9 of the evaluation's
  nine). Dropping snapshots >45 min out would cut 57% of rows, but the spike
  showed the valuable window runs to roughly +15 min *after* scheduled
  departure, and rows not collected cannot be recovered. DEC-003 removes the
  scan from the request path, which was the actual cost. Revisit once the
  60m+ tail is characterised (T-04).

## Repositories

| Repository | Role | Branch |
|---|---|---|
| `clients/kingston-chamber/work` | single repo | `ferry-forecast-refit` (branch per phase off it) |

## Phases

### Phase 1: Measure honestly

Nothing here improves the forecast. It makes the number on the admin panel mean
what it says, and stops the live blend being fed a third of reality.

**Entry criteria**: DEC-001 and DEC-002 decided. Baseline captured — the
current stored `ferry-accuracy/latest` (`mae 32.4, bias +19, level 0.24`) is
recorded in this plan so the change is attributable.

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| T-01 | Add `collapseToSailings(observations)` to `ferry-observations.ts`, exported for tests: group by `(dir, departs)`, `observed = round(max(1 - driveUp/max) * 100)` across all snapshots of that sailing | — | Unit test: 5 snapshots of one sailing collapse to 1 outcome; the outcome's `observed` comes from the fullest row **even when that row's `ts` is after `departs`**; a sailing with no usable `max`/`driveUp` row is dropped entirely |
| T-02 | Rewrite `computeAccuracy` and `computeDailyAccuracy` over `collapseToSailings` | T-01, T-07 | Against the committed fixture the backtest reports `n=2156`, MAE `28.1 ±0.2`, bias `−21.8 ±0.2`, level `0.19`. `computeDailyAccuracy` still folds up to exactly `computeAccuracy` (existing test in `ferry-daily-accuracy.test.ts` passes unmodified in intent) |
| T-03 | Rewrite `getEmpiricalBusyness` over `collapseToSailings`; `EmpiricalBucket.n` counts distinct sailings | T-01, T-07 | Fixture assertion: the peak-summer `from-kingston` Saturday 14:00 bucket reports `s ≥ 85` (today it reports ~21). `EMP_MIN_SAMPLES = 3` can no longer be satisfied by one sailing |
| T-04 | Characterise the 1,673 post-departure rows aged 60m+ (mean fullness 26.8, well below the 66.9 sailing mean). Write the finding into design.md § Context; add a lead-time guard **only if** it changes `min(driveUp)` for any sailing | T-01 | A written characterisation with counts, plus either a guard with a test or a one-line statement that `min()` is provably unaffected |
| T-05 | Exclude holiday-dated sailings from `getEmpiricalBusyness` and both backtests, mirroring `scoreAt`'s existing gate via the exported `holiday`/`parseParts` helpers | T-02, T-03 | Unit test: a July 4 sailing keyed into a peak-Saturday bucket does not move that bucket's `s`. Both sides of the gate use the same helper, so they cannot drift |
| T-06 | Land the DEC-007 record shape once — `{ method, coldPath, walkForward? }` — wrapping existing history entries as `method: "per-snapshot"`, and handle the discontinuity in the **`history` readers**: `accuracy-trend.tsx` and `ops/page.tsx`. Per F-3, `plateauDays()` is **not** in scope: it reads the daily series from `computeDailyAccuracy()`, which is recomputed from the log with current code and so is never mixed-method | DEC-002, DEC-007 | The trend chart renders the break rather than a cliff; every `history` reader handles `walkForward` absent; no existing entry is rewritten; a test asserts the daily series is single-method by construction |
| T-07 | Build the refit/regression fixture: 2,156 per-sailing outcomes as `tests/fixtures/ferry/sailings-2026-summer.json`. It is an **archive, not a cache** — `RETENTION_DAYS = 90` prunes its source rows from ~2026-10-10, after which it cannot be regenerated (F-5) | T-01 | Fixture is < 500 KB, holds no field beyond `dir`/`departs`/`observed`/`snapshots`, and its header records the generating query, the window, and the date after which regeneration is impossible |

**Exit criteria**: backtest reports ~28.1 MAE and **−21.8 bias** against
unchanged curves — the sign flip is the proof the artifact is gone. Full test
suite, types, lint and boundaries green.

### Phase 2: Refit the fallback

**Entry criteria**: phase 1 exit met. DEC-004, DEC-005 and DEC-009 decided.

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| T-08 | `scripts/refit-ferry-curves.ts` (tsx, matching the existing `scripts/*.ts` convention): reads the fixture, emits `CURVES` arrays per day-category × direction × hour, smoothing buckets under the sample floor from their neighbours rather than emitting noise. Per DEC-011 it takes `--holdout`, splitting time-blocked into the first 40 days for the fit and the last 10 for evaluation | T-07, DEC-011 | Running it prints 8 arrays of 24 integers in `[0,100]`; no hour is left at a raw mean with `n < 5`; output is deterministic across runs; `--holdout` reports the in-fit **and** held-out metrics side by side |
| T-09 | Commit the refit `CURVES` with a provenance header naming the fixture, the window, the row count and the date | T-08 | The diff is constants and comments only. `ferry-forecast.ts` still imports nothing but `./types` — purity preserved |
| T-10 | Add the season-staleness guard per DEC-004, following the `FEED_VALID_THRU` pattern the code review recommends for `kitsap.ts`. Per F-4 it must not introduce a clock: `ferry-forecast.ts` exports the fit-window constant and a **pure `isFitStale(dateStr)`**, and the caller supplies the date | DEC-004 | A named constant carries the fit window; `isFitStale` takes a date and reads no clock; `npm run lint:boundaries` still passes and `ferry-forecast.ts` still imports only `./types`; `ops-health` surfaces the warning; a date past the window warns rather than silently serving summer constants in December |
| T-11 | Two halves of one change, both landing **before** any phase-3 number exists. (a) Re-derive `scoreToLevel` to **35 / 50 / 80 / 92** (DEC-009) and update `LEVELS` blurbs, `BOAT_WAIT` and admin copy to the risk ladder. (b) Rebalance `ferry-accuracy-verdict.ts` per DEC-010: gate on MAE <= 12, abs(bias) <= 8, within-1 >= 0.90; demote `levelMatchRate` to a reported diagnostic; rewrite the verdict prose to lead with within-1; correct `MIN_SAMPLE`'s rationale comment now that `n` counts sailings | DEC-005, DEC-009, DEC-010 | Threshold edge test carries the new cuts and the measured fill risk behind each; `light`/`moderate` copy states no sailing in the fit window reached a full boat; no blurb names a wait inconsistent with its level; `ferry-accuracy-verdict.test.ts` updated including the pinned 2026-07-31 production case; a test asserts the verdict thresholds are unchanged since this commit |
| T-12 | Run the boarding-pass parity sweep and the `empiricalBucketKey` golden-string test as an unconditional regression check. Per F-8, DEC-004 chose the option that does **not** change the key, so both should pass untouched — a failure means something drifted that nobody intended | T-11 | Parity across every day of 2026 at hours {7,8,13,19,20} passes; golden strings are byte-identical; neither test file is modified |

**Exit criteria**: cold path alone (empirical blend disabled) reaches MAE ≤ 13
and |bias| ≤ 3 **on the DEC-011 hold-out days, which the refit never saw** —
not on the fixture it was fitted from (F-2). The in-fit number is reported
alongside for comparison, never as the gate.

### Phase 3: Make the data primary

**Entry criteria**: phase 2 exit met. DEC-003 and DEC-006 decided, DEC-007
decided (T-16 depends on the record shape).

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| T-13 | Trailing `EMP_WINDOW_DAYS = 28` window in `getEmpiricalBusyness`, replacing the 90-day retention scan. Retention stays 90 days for the backtest | T-03 | Fixture test: the table built for a given day uses only sailings in the preceding 28 days |
| T-14 | Raise the blend to full weight for well-populated buckets: `EMP_MAX_WEIGHT → 1.0`, `EMP_MIN_SAMPLES` and `EMP_FULL_CONFIDENCE_N` re-expressed in sailings | T-13 | Blend-gate tests updated; a bucket below the floor still returns the pure heuristic, unchanged |
| T-15 | Precompute the table in the daily cron into `record` store `ferry-empirical/latest`; `/ferry` and `/ferry/plan` read one record instead of scanning | DEC-003 | No page render calls `readFerryObservations`. Missing record falls back to the refit curves without erroring, and the admin surface states *why* it is on the fallback (F-7) rather than degrading silently |
| T-16 | Per DEC-006, make the walk-forward blended backtest primary — for each day, build the table from the 28 days before it, predict that day, grade — and keep the heuristic-only run alongside as the labelled cold-path number, in the DEC-007 record shape | DEC-006, DEC-007, T-13, T-14 | Strictly out-of-sample by construction: a test asserts no day appears in its own training window. Fixture assertion: walk-forward MAE `10.6 ±0.5`, level ≥ 0.60; cold-path MAE ≤ 13 reported in the same run. `accuracyVerdict()` reads the walk-forward number only |
| T-17 | Cron-death alarm: `ops-health` warns when `ferry-empirical/latest` is older than 48h or its `sailings` count drops below the bucket-coverage floor | T-15 | Simulating a 3-day cron gap produces a visible ops warning. This is the failure mode `render.yaml` records as having happened silently before |

**Two consequences of walk-forward the Chamber will see** (F-6, F-7):

- **`spanDays` roughly halves at cutover** — 28 days are consumed warming the
  first training window, so today's 50 days grade as 22. `MIN_SPAN_DAYS` is 7,
  so the verdict still renders, but the admin copy must explain the drop or it
  reads as data loss.
- **A fresh or restored environment serves the cold path for up to 24h**, and
  staging is suspended between rehearsals — so a rehearsal reliably shows
  cold-path numbers. The surface must say *why* it is on the fallback rather
  than falling back silently.

**Exit criteria**: walk-forward backtest MAE ≤ 12, |bias| ≤ 8, within-1 ≥ 0.85,
and the level-agreement bar set by DEC-010 — every threshold in
`ferry-accuracy-verdict.ts` for tone `ready`, none of them moved after seeing a
phase-3 result. Cold path independently still ≤ 13 with the table removed,
measured on the DEC-011 hold-out.

### Phase 4: Say what visitors actually asked

20.5% of summer sailings finish ≥99% full. For those the 0–100 score is
censored: "95" and "you are the fortieth car left behind" are the same number.
A point estimate also hides a 10.6-point noise floor.

**Entry criteria**: phase 3 exit met. DEC-008 decided.

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| T-18 | Add `pFull` to `EmpiricalBucket` — share of that bucket's sailings reaching ≥99 — computed in the same pass | T-16 | Fixture: `from-kingston` peak Saturday 14:00 reports `pFull ≥ 0.5`; buckets under the sample floor report `undefined`, never `0` |
| T-19 | Surface it on `/ferry` and `/ferry/plan` as a coarse frequency per DEC-008 ("roughly 3 in 5 of these boats fill"), at every level, alongside the level rather than replacing it | DEC-008, T-20 | Copy uses the coarse frequency form, states the rate is drawn from summer sailings, and never implies certainty. Renders correctly when `pFull` is `undefined`. Ships only after T-20's calibration check passes |
| T-20 | Add a calibration metric (Brier score + a reliability table) to the accuracy panel, and extend `accuracyVerdict` to read it | T-18 | Predicted-vs-actual full rate agrees within 0.1 across deciles with ≥20 sailings |

**Exit criteria**: p(full) calibrated within 0.1 across populated deciles; the
admin panel reports it; copy reviewed against the Chamber's plain-English bar.

### Phase 5: Enable

Not a task list. When phase 3 exits, `accuracyVerdict()` should return `ready`
on its own thresholds without any of them being moved. **Flipping the public
flag is the Chamber's decision, made in `/admin/ferry-info`, on that evidence.**
If a threshold has to be relaxed to reach `ready`, the gate has failed and the
model goes back to phase 2.

## Dependencies

```mermaid
graph LR
  T01[T-01 collapse] --> T07[T-07 fixture]
  T07 --> T02[T-02 backtest]
  T07 --> T03[T-03 aggregate]
  T01 --> T02
  T01 --> T03
  T01 --> T04[T-04 60m tail]
  T02 --> T05[T-05 holiday gate]
  T03 --> T05
  T06[T-06 record shape]
  T07 --> T08[T-08 refit script] --> T09[T-09 commit curves]
  T09 --> T11[T-11 thresholds] --> T12[T-12 parity]
  T10[T-10 season guard]
  T03 --> T13[T-13 28d window] --> T14[T-14 full weight] --> T16[T-16 walk-forward]
  T13 --> T16
  T15[T-15 precompute] --> T17[T-17 cron alarm]
  T16 --> T18[T-18 pFull] --> T20[T-20 calibration] --> T19[T-19 surface]
  T18 --> T19
```

## Roles

| Role | Works in | Isolation |
|---|---|---|
| Data/model — statistics literacy, reads a backtest critically | `src/lib/ferry-forecast.ts`, `src/lib/stores/ferry-observations.ts`, `scripts/` | own worktree (shared checkout — see the repo's concurrent-session note) |
| App — Next.js server/client boundary, record stores, ops health | `src/app/(site)/ferry/**`, `src/app/(admin)/admin/ferry-info/**`, `src/lib/ops-health.ts` | own worktree |
| Copy — Chamber-facing plain English | `LEVELS` blurbs, `BOAT_WAIT`, admin panel copy, phase-4 surface | shared |

## Decisions

See [decisions.md](./decisions.md).
