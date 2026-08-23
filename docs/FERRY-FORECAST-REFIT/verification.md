# Verification: ferry forecast refit

Every exit criterion in [plan.md](./plan.md) maps to a command here. Targets
come from the measured baseline in
[../FERRY-FORECAST-ACCURACY-2026-08.md](../FERRY-FORECAST-ACCURACY-2026-08.md),
so a phase is done when the repo reproduces a number that was measured before
the work started — not when it reproduces a number the work chose.

## Commands

Taken from `package.json`, not assumed from the stack.

| Purpose | Command |
|---|---|
| Build | `npm run build` |
| Unit tests | `npm test` |
| Server tests (needs Docker Postgres + standalone build) | `npm run test:server` |
| Both | `npm run test:all` |
| Lint | `npm run lint` |
| Module boundaries | `npm run lint:boundaries` |
| Types | `npm run typecheck` |
| Refit (phase 2+) | `NODE_OPTIONS=--conditions=react-server tsx scripts/refit-ferry-curves.ts` |

`npm test` runs `TZ=UTC vitest run` — the timezone pin is load-bearing for every
Pacific-conversion assertion here; do not drop it. Cap workers on an 8 GB
machine (`--maxWorkers=4`) — the suite is one PGlite per core.

New backtest assertions run against the committed fixture
(`tests/fixtures/ferry/sailings-2026-summer.json`, T-07), so none of this needs
prod access or a network call.

## Phase 1 exit — measure honestly

| Criterion | How it is proven | Passing when |
|---|---|---|
| Collapse is correct, including post-departure rows | `npm test -- ferry-sailing-collapse` | exit 0; the fullest-row case with `ts > departs` asserts explicitly |
| Backtest reports the per-sailing baseline | `npm test -- ferry-accuracy-fixture` | `n === 2156`, `mae` in `[27.9, 28.3]`, `bias` in `[-22.0, -21.6]` |
| **Bias sign has flipped** | same test | `bias < 0` — the single assertion that proves the artifact is gone rather than merely reduced |
| Daily series still folds up to the overall backtest | `npm test -- ferry-daily-accuracy` | exit 0, existing test unmodified in intent |
| Empirical table no longer reports a third of reality | `npm test -- ferry-busyness-agg` | peak `from-kingston` Saturday 14:00 bucket `s >= 85`; `n` equals distinct sailings |
| Holiday sailings excluded on both sides | `npm test -- ferry-holiday-gate` | a July 4 sailing does not move its peak-Saturday bucket |
| History discontinuity handled | `npm test -- ferry-accuracy-verdict` | `plateauDays()` returns 0 across a `method` boundary |
| Nothing else regressed | `npm run test:all && npm run typecheck && npm run lint && npm run lint:boundaries` | all exit 0 |

## Phase 2 exit — refit the fallback

| Criterion | How it is proven | Passing when |
|---|---|---|
| Refit is deterministic | `tsx scripts/refit-ferry-curves.ts \| sha256sum` run twice | identical digests |
| Refit output is well-formed | `npm test -- ferry-curves-shape` | 8 arrays × 24 entries, every value an integer in `[0,100]`, no hour emitted from a bucket with `n < 5` |
| `ferry-forecast.ts` is still pure | `npm run lint:boundaries` | exit 0; the module still imports only `./types` |
| Cold path hits its target | `npm test -- ferry-accuracy-fixture` with the empirical table omitted | `mae <= 13`, `abs(bias) <= 3`, `levelMatchRate >= 0.55` |
| Boarding-pass parity survives the refit | `npm test -- ferry-model` | the every-day-of-2026 sweep at hours {7,8,13,19,20} passes |
| Season guard exists and fires | `npm test -- ferry-season-guard` | a date past the fit window produces the warning; `ops-health` reports it |
| Level cuts and copy agree | `npm test -- ferry-model` | threshold edge test matches **35 / 50 / 80 / 92** exactly; no blurb names a wait inconsistent with its level; `light`/`moderate` copy is consistent with a measured 0% fill rate |

## Phase 3 exit — make the data primary

| Criterion | How it is proven | Passing when |
|---|---|---|
| Trailing window is honoured | `npm test -- ferry-window` | the table for day D contains no sailing older than 28 days before D |
| Walk-forward is genuinely out-of-sample | `npm test -- ferry-walk-forward` | asserts no graded day appears in its own training window |
| **Warm path hits the measured ceiling** | same test | `mae` in `[10.1, 11.1]`, `levelMatchRate >= 0.60` |
| Verdict returns `ready` on unmoved thresholds | `npm test -- ferry-accuracy-verdict` | `accuracyVerdict(phase3Metrics).tone === "ready"` with `GOOD_LEVEL_MATCH`, `GOOD_BIAS`, `GOOD_WITHIN1` **unchanged from `git show HEAD~1`** |
| Cold path still stands alone | `npm test -- ferry-accuracy-fixture` with the table removed | `mae <= 13` — a data outage degrades, it does not collapse |
| Both numbers are stored and only one gates | `npm test -- ferry-accuracy-record` | one history entry per run carries walk-forward **and** cold-path metrics; `accuracyVerdict()` is called with the walk-forward metrics only |
| Request path no longer scans the log | `npm test -- ferry-page-no-scan` | rendering `/ferry` and `/ferry/plan` issues zero `readFerryObservations` calls |
| Missing record degrades gracefully | `npm test -- ferry-empirical-record` | with no `ferry-empirical/latest`, pages render on the refit curves and do not throw |
| Cron death is visible | `npm test -- ops-health-ferry` | a simulated 3-day gap produces a warning |

## Phase 4 exit — probability of full

| Criterion | How it is proven | Passing when |
|---|---|---|
| `pFull` computed and gated | `npm test -- ferry-pfull` | peak Saturday 14:00 `pFull >= 0.5`; sub-floor buckets are `undefined`, never `0` |
| Calibrated | `npm test -- ferry-calibration` | predicted vs actual full-rate within 0.1 across every decile holding ≥20 sailings |
| Renders without the field | `npm test -- ferry-busy-today` | `pFull: undefined` renders the level alone, no empty chrome |
| Claim ships only if calibrated | `npm test -- ferry-pfull-gate` | with calibration outside 0.1, the public surface is suppressed and the admin view still renders — DEC-008's fallback to A |
| Build is clean | `npm run build` | exit 0 |

## Manual checks

Short by design; length here is a smell.

| Check | Who | Steps |
|---|---|---|
| Plain-English readout | Chamber-facing reviewer | Open `/admin/ferry-info`, read the verdict aloud. Someone who has never seen an MAE must be able to say whether the forecast is trustworthy. |
| Public copy honesty | Copy role | Every surface still labels the forecast an estimate and defers to the live board (`ferry-forecast.ts` header requirement). Phase 4's chance-of-full states a base rate, never a promise. |
| The go/no-go itself | Chamber | Phase 5. Flipping the flag is theirs, on the phase-3 evidence. |

## What this cannot verify

Stated so a green suite is not mistaken for a validated model:

- **Off-peak accuracy.** Every fixture sailing is peak season. Nothing here
  proves the forecast in October, and DEC-004's guard exists precisely because
  it cannot.
- **Holiday multipliers.** No holiday in the window.
- **Wait-time claims.** `BOAT_WAIT` and `ARRIVE_EARLY_*` are unfalsifiable from
  deck fullness.
- **WSF feed semantics.** The 60m+ post-departure tail (T-04) is characterised,
  not controlled.
