# Phase 1 implementation plan — measure honestly

Spec: [../plan.md](../plan.md) phase 1 (T-01…T-07), governed by DEC-001,
DEC-002, DEC-007. Exit criteria: [../verification.md](../verification.md).

## Verification commands (from `package.json`, not assumed)

| Purpose | Command |
|---|---|
| Unit | `npm test -- --maxWorkers=4` |
| Server | `npm run test:server` |
| Types | `npm run typecheck` |
| Lint | `npm run lint` |
| Boundaries | `npm run lint:boundaries` |
| Build | `npm run build` |

## Two things the code disagrees with the spec about

### D-1 · T-06 is mostly vacuous — nothing renders `history`

**Found by reading the consumers.** The stored `history` array is threaded
through `getAccuracy()` → `PredictionState.accuracy.history` → and then **never
read**. The trend chart takes `daily` (`DailyAccuracyPoint[]`, recomputed from
the log on every call), and `ops/page.tsx` touches only `latest.computedAt` for
a freshness badge.

So the phase-1 discontinuity work has no target:

| Consumer | Reads | Affected by a `method` change? |
|---|---|---|
| `accuracy-trend.tsx` | `daily` | No — recomputed with current code, single-method by construction |
| `plateauDays()` via `accuracyVerdict` | `daily` | No — same |
| `ops/page.tsx` | `latest.computedAt` | No |
| Anything | `history` contents | **Nothing reads it** |

This is F-3 going further than the review said: I named `accuracy-trend.tsx`
and `ops/page.tsx` as the `history` readers, and neither is.

**Recommendation**: keep writing `history` (the data is worth accumulating) and
still tag entries with `method` as provenance, but **drop the "render the break"
work** — there is no break to render. T-06 shrinks to the record shape plus a
test proving the daily series is single-method by construction. If the Chamber
later wants the before/after step visible, that is a new task against `history`,
and the `method` tag is what makes it possible.

### D-2 · T-05 needs a new export from the pure module

`holiday()` and `parseParts()` are module-private in `ferry-forecast.ts`, so the
"use the same helper on both sides so they cannot drift" requirement cannot be
met as written.

**Recommendation**: add one pure export —
`export function isHolidayDate(dateStr: string): boolean` — wrapping the two
private helpers. No new imports, purity preserved, and `scoreAt`'s own gate is
refactored to call it so there is exactly one holiday predicate in the codebase.

## Steps

Each step ends with the verification named, then a `wip:` checkpoint commit.

| # | Step | Files (P = pre-existing) | Verify |
|---|---|---|---|
| S-1 | Build the fixture (T-07) from the existing scratchpad pull — 2,156 per-sailing outcomes, header recording the query, window, and the ~2026-10-10 date after which regeneration is impossible | `tests/fixtures/ferry/sailings-2026-summer.json` (new) | file < 500 KB; field list exactly `dir`/`departs`/`observed`/`snapshots` |
| S-2 | `collapseToSailings()` + `isHolidayDate()` (T-01, D-2) | `src/lib/stores/ferry-observations.ts` **P**, `src/lib/ferry-forecast.ts` **P**, `tests/unit/ferry-sailing-collapse.test.ts` (new) | `npm test -- ferry-sailing-collapse ferry-model`, `typecheck`, `lint:boundaries` |
| S-3 | Rewrite both backtests over the collapse (T-02) | `src/lib/stores/ferry-observations.ts` **P**, `tests/unit/ferry-accuracy-fixture.test.ts` (new) | fixture asserts `n=2156`, MAE 28.1±0.2, **bias −21.8±0.2**; `ferry-daily-accuracy` passes unmodified |
| S-4 | Rewrite `getEmpiricalBusyness` over the collapse; `n` counts sailings (T-03) | `src/lib/stores/ferry-observations.ts` **P**, `tests/unit/ferry-busyness-agg.test.ts` **P** | peak `from-kingston` Sat 14:00 bucket `s ≥ 85` |
| S-5 | Holiday exclusion both sides (T-05) | `src/lib/stores/ferry-observations.ts` **P**, `tests/unit/ferry-holiday-gate.test.ts` (new) | July 4 sailing does not move its peak-Saturday bucket |
| S-6 | DEC-007 record shape + `method` (T-06, as reduced by D-1) | `src/lib/stores/ferry-observations.ts` **P**, `src/app/(admin)/admin/ferry-info/prediction-control.tsx` **P**, `src/app/(admin)/admin/ops/page.tsx` **P** | `typecheck`; test asserts the daily series is single-method |
| S-7 | Characterise the 60m+ post-departure tail (T-04) | `../design.md` **P**, guard only if warranted | written characterisation; guard has a test or a stated proof it is unnecessary |
| S-8 | Full sequence | — | `test:all`, `typecheck`, `lint`, `lint:boundaries`, `build` |

Ordering note: S-1 precedes S-3/S-4 because their acceptance criteria are
fixture assertions (the corrected T-07 → T-02/T-03 dependency edges).

## Pre-existing files this will modify

`src/lib/stores/ferry-observations.ts`, `src/lib/ferry-forecast.ts`,
`tests/unit/ferry-busyness-agg.test.ts`,
`src/app/(admin)/admin/ferry-info/prediction-control.tsx`,
`src/app/(admin)/admin/ops/page.tsx`, `../design.md`.

**`ferry-forecast.ts` gets one new pure export and a refactor of its own holiday
gate to use it — no behaviour change, and the boarding-pass parity sweep plus
the `empiricalBucketKey` golden strings must pass untouched.**

## Risks

- **`ferry-daily-accuracy.test.ts` builds fixtures expecting per-snapshot
  grading.** Its assertions about counts will shift to sailings. The two tests
  that must survive *unmodified in intent* are the fold-up and the
  bucket-by-departure-day ones.
- **`recordSailingSpaceSnapshot` throttling is module state** shared across
  tests; the existing suite already handles this, so follow its pattern rather
  than inventing one.
- Vitest workers capped at 4 (8 GB machine, one PGlite per core).
