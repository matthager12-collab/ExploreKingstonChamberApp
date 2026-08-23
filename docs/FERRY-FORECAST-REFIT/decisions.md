# Decisions: ferry forecast refit

| # | Question | Status | Decision | Round |
|---|---|---|---|---|
| DEC-001 | What is a sailing's observed busyness? | Decided | C — `min(driveUp)` across every snapshot | R1 |
| DEC-002 | What happens to the stored accuracy history across the fix? | Decided | C — `method` discriminator, render the break | R1 |
| DEC-003 | Where is the empirical table computed? | Decided | C — daily cron writes `ferry-empirical/latest` | R1 |
| DEC-004 | How is season handled once the window is trailing? | Decided | C — `seasonFactor` on the heuristic term only | R1 |
| DEC-005 | Where do the busyness level thresholds cut? | Decided | C — operational meaning, **as a risk ladder** (cut points → DEC-009) | R1 |
| DEC-006 | What does the backtest grade? | Decided | D — walk-forward primary, cold path reported alongside | R1 |
| DEC-007 | What shape holds two accuracy numbers, and which one gates? | Decided | B — one entry, `{ walkForward, coldPath, method }`; gates on `walkForward` | R2 |
| DEC-008 | What is the p(full) contract and where does it render? | Decided | C — coarse frequency, gated on calibration | R2 |
| DEC-009 | The actual level cut points | Decided | A — 35 / 50 / 80 / 92 | R2 |
| DEC-010 | Level agreement is unreachable under those cuts — what gives? | Decided | A — keep the cuts, rebalance what gates | R3 |
| DEC-011 | How is the refit evaluated without grading on its own fit? | Decided | C — time-blocked hold-out, both numbers reported | R3 |

Two-way doors, decided in passing and recorded here so they are not re-litigated:

- `collapseToSailings` lives in `ferry-observations.ts` beside its callers and is exported for tests, following the existing `pacificParts` precedent — not a new pure module. Smaller diff, same testability.
- The refit fixture holds **per-sailing outcomes** (2,156 rows), not raw snapshots (25,454). Small enough to commit, contains no personal data, and is the exact input to the fit.
- `scripts/refit-ferry-curves.ts` **prints** the arrays for a human to paste, rather than rewriting `ferry-forecast.ts` in place. The constants land through a reviewed diff.
- Trailing window starts at **28 days** — the measured knee (MAE 10.6, 98% bucket coverage, vs 12.6 at 21 days). A tunable constant, not a contract.

---

## Round 1

### DEC-001: What is a sailing's observed busyness?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: Every downstream number — the refit constants, the empirical
table, the backtest, the go/no-go verdict — is defined against this. Change it
later and every stored metric becomes incomparable, so it is a one-way door.

WSF holds `DriveUpSpaceCount` at maximum until the boat is nearly loading, and
a sailing is snapshotted ~11.8 times across that trajectory. The spike found
`driveUp` is effectively monotone non-increasing (44 of 2,156 sailings ever
increase by >2, none resetting) and that **70% of sailings reach their fullest
reading after the scheduled departure**, a mean of **+15.7 points** above the
best pre-departure reading — boats load late and WSF keeps reporting.

| Option | Description | Trade-offs |
|---|---|---|
| A | Every snapshot graded independently (**today**) | No change. Grades a mostly-empty deck: mean observed 21.3 against a true 66.9. Reports +19 bias where the truth is −22. Indefensible. |
| B | Last snapshot before scheduled departure | The fix sketched in the code review. Simple and intuitive — but measured, it discards the fullest reading on 70% of sailings and leaves a **−11 bias baked into the definition**. Wrong for a defensible reason, which is the dangerous kind. |
| C | `min(driveUp)` across every snapshot of the sailing | Matches the physical question ("how full did this boat get"). Robust to the unexplained 60m+ tail, which is *emptier* than truth and therefore invisible to `min()`. Understates only when WSF stops reporting mid-load. Depends on monotonicity, which is measured at 98%. |
| D | `min(driveUp)` within a bounded window (−4h to +30m) | C plus a guard against a pathological far-out row. Costs a constant that has no measured justification yet — T-04 exists to find out whether it is needed. |

**Recommendation**: **C**, with T-04 characterising the 60m+ tail and
converting to D only if that investigation finds a real corruption. Adopting D
pre-emptively would be tuning against a phenomenon we have not yet explained.

**Decision**: **C** — `observed = round(max(1 - driveUp/max) * 100)` across every snapshot of a `(dir, departs)` pair, with no lead-time bound. T-04 may convert this to D if the 60m+ tail turns out to corrupt `min()`; absent that finding, no bound is added.

**Consequences**:

**Easier**: The refit, the empirical table and the backtest all share one
definition that matches the physical question. The bias sign becomes a
falsifiable test of the fix (T-02).

**Harder**: The definition depends on WSF reporting continuously through
loading. If they ever stop, we understate and nothing announces it.

**Foreclosed**: Comparing any metric across the phase-1 cutover — hence
DEC-002.

**Applied to**:

- `design.md` § The spike that shaped DEC-001; § Contracts (`SailingOutcome.observed`)
- `plan.md` T-01, T-02, T-03, T-04
- `verification.md` Phase 1 exit, rows 1–3

---


### DEC-002: What happens to the stored accuracy history across the fix?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: `record` store `ferry-accuracy/latest` holds a rolling 60-entry
history, currently 50 days of per-snapshot numbers around MAE 32. After phase 1
new entries land near 28 with the opposite bias sign. `plateauDays()` walks that
array backwards and would read the regime change as a jump; `accuracy-trend.tsx`
would draw a cliff. Written records are permanent, so the shape is a one-way door.

| Option | Description | Trade-offs |
|---|---|---|
| A | Leave it | Free. The trend chart lies, and the verdict's "barely moved in N days" sentence — the one that tells the Chamber more data will not help — reads from a mixed series. |
| B | Reset the history at cutover | Honest chart immediately. Destroys the record of how the model behaved before the fix, which is exactly the evidence this project's story rests on. |
| C | Add `method: "per-snapshot" \| "per-sailing"` to `AccuracyMetrics`; `plateauDays()` stops at a boundary; the chart renders the break | Keeps the history, tells the truth, and makes the regime change legible to whoever reads the panel in six months. One extra field and a little chart work. |

**Recommendation**: **C**. The discontinuity is real and worth showing — a
visible step down is the most persuasive artifact this work produces.

**Decision**: **C** — `AccuracyMetrics` gains `method: "per-snapshot" | "per-sailing"`. `plateauDays()` stops at a boundary; `accuracy-trend.tsx` renders the break. Existing entries are backfilled as `per-snapshot` and never rewritten.

**Consequences**:

**Easier**: The step down at cutover stays visible — the most persuasive
artifact this project produces.

**Harder**: Every consumer of `history` must handle a mixed array, and the
admin chart needs a break marker.

**Foreclosed**: Treating the history as a single continuous series. That was
always false; now it is explicit.

**Applied to**:

- `design.md` § Contracts (`AccuracyMetrics`)
- `plan.md` T-06
- `verification.md` Phase 1 exit, "History discontinuity handled"

---


### DEC-003: Where is the empirical table computed?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: `getEmpiricalBusyness()` runs on the request path for `/ferry` and
`/ferry/plan`, full-scanning the observation log in JS — flagged high-severity
in the code review at ~52k rows, and the reason `line-lander.tsx` refuses to
call it at all. A trailing window makes that scan recur more often, not less.
Introducing a new stored record is a contract other code will depend on.

| Option | Description | Trade-offs |
|---|---|---|
| A | Keep it on the request path, add single-flight caching | Smallest change. Still scans on every cache miss, still blocks a visitor's render, still leaves `line-lander` unable to use it. |
| B | Aggregate in SQL rather than JS | The code review's first suggestion. Much faster, but keeps per-request work, moves the season/bucket logic into a query, and needs the season mapping to stay in JS anyway. |
| C | Daily cron writes `record` store `ferry-empirical/latest`; pages read one row | Removes the scan entirely; `line-lander` can use it; a natural place to hang the staleness alarm (T-17). Table is up to 24h stale — immaterial for a 28-day trailing mean. Adds a record that can be missing, so the fallback path must be real and tested. |

**Recommendation**: **C**. It is the only option that also fixes the
high-severity performance finding and gives the cron-death failure mode
somewhere to be noticed.

**Decision**: **C** — the daily cron computes the table and writes `record` store `ferry-empirical`, id `latest`. `/ferry` and `/ferry/plan` read that one record. A missing record falls back to the refit curves.

**Consequences**:

**Easier**: Removes the high-severity request-path scan; makes a trailing
window affordable; `line-lander.tsx` can finally use the table; the staleness
alarm has somewhere to live.

**Harder**: A new persisted contract, and a fallback path that must be real
and tested rather than theoretical. The table is up to 24h stale.

**Foreclosed**: Any feature needing sub-daily empirical freshness without a
second write path.

**Applied to**:

- `design.md` § Structure, § Key flows, § Contracts (`EmpiricalRecord`)
- `plan.md` T-15, T-17
- `verification.md` Phase 3 exit, rows 6–8

---


### DEC-004: How is season handled once the window is trailing?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: `empiricalBucketKey` is `direction|season|dow|hour`, and `scoreAt`
multiplies the curve by `seasonFactor` (peak 1.0 / shoulder 0.82 / off 0.58). A
trailing 28-day window **already is** a season adjustment: the table only
contains recent sailings. Keeping both means the season is applied twice for any
bucket that blends. But `empiricalBucketKey` is covered by a golden-string test
and its output has been persisted, so changing it is a one-way door. **All 50
days of evidence are peak season — none of the three factors has ever been
tested.**

| Option | Description | Trade-offs |
|---|---|---|
| A | Keep season in the key and the factor as-is | No change, golden strings safe. Double-counts season in the blended path: an October bucket learned from October sailings gets multiplied by 0.82 again. |
| B | Drop `season` from the bucket key; `seasonFactor` applies only to the cold-start curve | Removes the double-count and simplifies the key. Breaks the golden-string test deliberately, and loses the ability to hold a winter bucket separate from a summer one — which a 28-day window makes redundant anyway. |
| C | Keep the key; apply `seasonFactor` only to the heuristic term, never to the empirical term | No key change, no golden-string break, no double-count. `scoreAt` gets slightly more conditional — the factor applies before the blend, not after. |
| D | Refit `seasonFactor` from data | **Not available.** There is no non-peak data. Listed only to record that it was considered and rejected on evidence. |

**Recommendation**: **C**, plus the T-10 staleness guard. It buys the
correctness fix without touching a persisted key format, and it keeps the
untested season constants confined to the path where they are the only thing we
have. The guard is what stops a summer-fitted model quietly serving December.

**Decision**: **C** — `empiricalBucketKey` is unchanged (golden strings hold). `scoreAt` applies `seasonFactor` and the holiday factor to the **heuristic term only**, before the blend; the empirical term is used as observed. T-10 adds the staleness guard.

**Consequences**:

**Easier**: Kills the double-count without touching a persisted key format.
The trailing window becomes the season adjustment for any bucket with data,
and the untested constants are confined to the path where they are all we have.

**Harder**: `scoreAt` gains a conditional — factors apply pre-blend, not
post-blend. The parity sweep (T-12) has to confirm nothing drifted.

**Foreclosed**: Nothing. Refitting `seasonFactor` stays available the moment
non-peak data exists — which is what the T-10 guard is counting down to.

**Applied to**:

- `design.md` § Approach; § Contracts (`scoreAt` blend order)
- `plan.md` T-10, T-12
- `verification.md` Phase 2 exit, "Season guard exists and fires"

---


### DEC-005: Where do the busyness level thresholds cut?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: `scoreToLevel` cuts at 20 / 42 / 65 / 83 on a scale where the
heuristic's natural peak was ~80. Against real fullness the quartiles are
p25=43, p50=74, p75=95, and 20.5% of sailings finish ≥99. The five labels are
the public promise and `levelMatchRate` is what the verdict gates on, so the
cuts are a public contract.

| Option | Description | Trade-offs |
|---|---|---|
| A | Keep 20/42/65/83 | No copy change, no test churn. Against true fullness most summer sailings land "busy" or worse — which is arguably just true, but it flattens the scale exactly when visitors most need it to discriminate. |
| B | Re-cut on observed quantiles (roughly 25/45/70/92) | Even spread across the five labels by construction, so `levelMatchRate` is a fair test. The labels become relative — "busy for this route" — which is harder to explain and drifts as the route does. |
| C | Re-cut on operational meaning: `extreme` = ≥99 (the boat fills, you are bumped), the rest spaced to match the wait each blurb already claims | The labels mean something a visitor can act on, and `extreme` becomes a falsifiable claim rather than a vibe. Ties directly to phase 4's `pFull`. Needs `BOAT_WAIT` and `ARRIVE_EARLY_*` copy reviewed against the new cuts. |

**Recommendation**: **C**. The whole point of the feature is "will I get on this
boat", and C is the only option where the top label answers it. It also makes the
phase-4 work a continuation rather than a second vocabulary.

**Decision**: **C**, with a correction the evidence forced. Option C was written as
"`extreme` = ≥99". That is not implementable: the thresholds apply to the
*predicted score*, and predicted bucket means top out near 97, so a ≥99 cut
would never fire. The implementable form is a **risk ladder** — each cut sits
where the chance of actually being bumped changes materially:

| Predicted band | n | Mean outcome | P(boat fills, ≥99) |
|---|---:|---:|---:|
| 0–35 | 343 | 25 | **0%** |
| 35–50 | 197 | 42 | **0%** |
| 50–65 | 390 | 59 | 5% |
| 65–80 | 346 | 73 | 10% |
| 80–90 | 503 | 86 | 31% |
| 90–95 | 220 | 93 | 57% |
| 95+ | 157 | 97 | 70% |

So `light`/`moderate` become claims we can stand behind ("this boat has never
filled in 50 days of data"), and `extreme` becomes "being bumped is more likely
than not". The exact cut points are DEC-009.

**Consequences**:

**Easier**: Every label answers the question visitors actually ask, and the
top label is falsifiable. Phase 4's `pFull` becomes a continuation of the same
idea rather than a second vocabulary.

**Harder**: `BOAT_WAIT`, `ARRIVE_EARLY_*` and the `LEVELS` blurbs all have to
be re-read against the new meanings. The risk figures are peak-season only.

**Foreclosed**: Comparing `levelMatchRate` across the cutover.

**Applied to**:

- `plan.md` T-11, T-12
- `verification.md` Phase 2 exit, "Level cuts and copy agree"
- Cut points pending DEC-009

---


### DEC-006: What does the backtest grade?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: Both backtests deliberately score the heuristic **with no
empirical blend** — the comment calls it an "honest out-of-sample test". The
effect is that the model actually shipped to visitors is never graded, and after
phase 3 the shipped model is mostly the empirical table. Whatever this becomes
is what the Chamber's go/no-go decision means, and it is persisted, so it is a
one-way door.

| Option | Description | Trade-offs |
|---|---|---|
| A | Keep heuristic-only | Unimpeachably out-of-sample and cheap. Grades a model no visitor sees. After phase 3 it measures the fallback path only — useful, but it must stop being called *the* accuracy. |
| B | Grade the blended model as-is | Grades what ships. Trains and tests on the same data, so it reports a flattering number that would not survive contact with tomorrow. |
| C | Walk-forward: for each day, build the table from the 28 days before it, predict that day, grade | Grades what ships, strictly out-of-sample, and mirrors production exactly — the table a visitor sees on day D really was built from the days before D. Costs a table rebuild per day in the backtest (trivial at this scale). |
| D | C, and keep A alongside as a separately reported "cold path" number | Everything C gives, plus a standing measurement of the fallback — the path a data outage exposes visitors to. Two numbers on the panel to explain. |

**Recommendation**: **D**. C is the right primary metric; keeping A as an
explicitly-labelled second number is what makes phase 3's "cold path still ≤ 13"
exit criterion continuously verified rather than checked once.

**Decision**: **D** — walk-forward blended backtest is the primary metric and the one `accuracyVerdict()` gates on. The heuristic-only number is retained and reported alongside, explicitly labelled as the cold/fallback path.

**Consequences**:

**Easier**: The Chamber's go/no-go grades the model visitors actually see,
strictly out-of-sample. The fallback path stops being checked once and starts
being monitored continuously.

**Harder**: Two numbers on the admin panel that must be distinguishable in
plain English, and a backtest that rebuilds a table per day.

**Foreclosed**: Nothing — but it opens DEC-007, since the stored record now
has to hold both.

**Applied to**:

- `design.md` § Key flows; § Contracts (`AccuracyMetrics`)
- `plan.md` T-16
- `verification.md` Phase 3 exit, rows 2–5

---

## Round 2

Opened by applying round 1. DEC-007 falls out of DEC-006's two numbers meeting
DEC-002's `method` field; DEC-009 out of DEC-005's correction; DEC-008 was
deferred here deliberately because it depends on DEC-005.

### DEC-007: What shape holds two accuracy numbers, and which one gates?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: DEC-006 says report a walk-forward number *and* a cold-path
number. DEC-002 says tag each stored entry with a `method`. Those two collide:
`method` was designed to separate old measurements from new, not to hold two
concurrent measurements of different things. `accuracyVerdict()` takes a single
`VerdictInput`, and `ops/page.tsx` reads `getAccuracy()` too. Persisted shape,
so one-way.

| Option | Description | Trade-offs |
|---|---|---|
| A | Two history entries per run, distinguished by `method` | No shape change beyond DEC-002. `plateauDays()` and the chart must filter by method or they interleave two series — easy to get wrong silently, and `plateauDays()` already walks the array backwards. |
| B | One entry per run holding both: `{ walkForward: AccuracyMetrics, coldPath: AccuracyMetrics, method }` | Unambiguous, one entry per day, chart and plateau read one series. Changes the record shape, so the backfill must wrap existing entries. |
| C | Two separate records (`ferry-accuracy`, `ferry-accuracy-cold`) | Total isolation, no migration of the existing record. Two stores, two crons' worth of failure modes, and the panel has to join them. |

**Recommendation**: **B** — the two numbers are produced by one run over one
dataset and are only meaningful side by side. `accuracyVerdict()` gates on
`walkForward`; `coldPath` is displayed and alarmed on, never gating.

**Decision**: **B** — one history entry per run:
`{ walkForward?: AccuracyMetrics, coldPath: AccuracyMetrics, method }`.
`accuracyVerdict()` gates on `walkForward`; `coldPath` is displayed and alarmed
on, never gating.

**Two-way door settled in passing:** the shape lands **once, in phase 1**, with
`coldPath` populated and `walkForward` absent — phase 3 fills it in rather than
reshaping the record a second time. Readers treat `walkForward` as optional,
which they must anyway for pre-cutover entries.

**Consequences**:

**Easier**: One entry per day, so `plateauDays()` and the trend chart read a
single series with no filtering — the silent-interleave failure mode of option A
cannot occur. The cold path becomes continuously monitored rather than
spot-checked.

**Harder**: Existing history entries must be wrapped at cutover, and every
reader (`accuracy-trend.tsx`, `ops/page.tsx`, `prediction-control.tsx`) updated
in one pass. `walkForward` is optional, so every consumer needs the absent case.

**Foreclosed**: Reporting more than two grading regimes without another reshape.

**Applied to**:

- `design.md` § Contracts (`AccuracyMetrics`)
- `plan.md` T-06 (shape + backfill), T-16 (populates `walkForward`)
- `verification.md` Phase 3 exit, "Both numbers are stored and only one gates"

---


### DEC-008: What is the p(full) contract and where does it render?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: Phase 4. 20.5% of summer sailings finish ≥99% full, and for those
the 0–100 score is censored. `pFull` is a public-facing probability claim on a
Chamber surface, which makes both the number and its wording a contract.

| Option | Description | Trade-offs |
|---|---|---|
| A | Admin-only for one season, public later | Lets calibration prove itself before anyone acts on it. Delays the only part of this work visitors would actually notice. |
| B | Public as a percentage — "about a 60% chance this boat fills" | Precise and honest. A percentage invites false confidence, and the underlying rate is peak-season only. |
| C | Public as a coarse frequency — "roughly 3 in 5 of these boats fill" | Same information, harder to over-read, matches the app's existing plain-English voice. Coarsening loses resolution at the top of the range where it matters most. |
| D | Public only at the top two levels, where it changes behaviour | Minimal surface, maximum relevance. Silence at lower levels reads as "no data" rather than "very unlikely" — which is the opposite of the reassurance a light sailing should give. |

**Recommendation**: **C**, gated on the T-20 calibration check passing first —
so the claim ships only once it is measured, and A becomes the fallback if it
is not.

**Decision**: **C** — a coarse frequency in the app's plain-English voice ("roughly 3 in 5 of
these boats fill"), shown at every level rather than only the top ones, so a
light sailing reads as reassurance rather than missing data. **Gated on T-20:**
the claim ships only once calibration is measured within 0.1 across populated
deciles. If it does not calibrate, it falls back to option A — admin-only for a
season.

**Consequences**:

**Easier**: Answers the question the fullness score structurally cannot for the
20.5% of sailings that saturate. Coarse wording resists over-reading, and the
calibration gate means we never publish a probability we have not checked.

**Harder**: Coarsening loses resolution at the top of the range, exactly where
the difference between "most fill" and "all fill" matters most. The underlying
rate is peak-season only, so the copy must not imply a year-round base rate.

**Foreclosed**: Nothing — a percentage remains available if the coarse form
proves too blunt in use.

**Applied to**:

- `plan.md` T-18, T-19, T-20
- `verification.md` Phase 4 exit; Manual checks, "Public copy honesty"

---


### DEC-009: The actual level cut points

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: DEC-005 settled the *principle* (a risk ladder) and produced the
evidence table above. This pins the numbers, which are a public contract.
Current cuts are 20 / 42 / 65 / 83.

| Option | Description | Trade-offs |
|---|---|---|
| A | 35 / 50 / 80 / 92 | Cuts land on the risk breaks in the data: 0% / 0% / 5–10% / 31–50% / ≥57%. `light` and `moderate` become "this boat has never filled in 50 days". Gives roughly 18/20/19/15/29% of sailings per label. |
| B | 25 / 45 / 70 / 92 | The quantile fit — most even spread across labels, which flatters `levelMatchRate`. But `moderate` then covers sailings up to 45% full with a non-trivial fill risk at the top edge. |
| C | Keep 20 / 42 / 65 / 83 | No copy churn. Puts 40% of summer sailings in `extreme`, which drains the word of meaning exactly when it matters. |

**Recommendation**: **A**. The two cuts that carry weight are 35 (below it,
nothing has ever filled) and 92 (above it, more than half do). B optimises the
metric we are graded on rather than the claim we are making, which is the wrong
way round.

**Decision**: **A — 35 / 50 / 80 / 92.** The two load-bearing cuts are 35 (no sailing below
it reached a full boat in the fit window) and 92 (above it, being bumped is more
likely than not, at 57–70%).

**Consequences**:

**Easier**: `light` and `moderate` become defensible claims rather than
adjectives, and `extreme` becomes falsifiable. The ladder maps directly onto
phase 4's `pFull`, so the two features tell one story.

**Harder**: `levelMatchRate` is not comparable across the cutover — it is
measured against different cuts on both the prediction and the outcome side.
The risk figures behind each cut are peak-season only and inherit DEC-004's
staleness guard.

**Foreclosed**: Comparing any stored `levelMatchRate` to a pre-cutover one.

**Applied to**:

- `design.md` § Contracts (level thresholds)
- `plan.md` T-11, T-12
- `verification.md` Phase 2 exit, "Level cuts and copy agree"

---

## Round 3

Opened by the adversarial review ([review.md](./review.md)). Both entries come
from findings confirmed by measurement rather than argument.

### DEC-010: Level agreement is unreachable under the DEC-009 cuts — what gives?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: Review finding F-1. Walk-forward on a trailing 28-day window, 969
graded sailings, MAE already at the 10.6-point noise floor:

| Cut set | Level match | Within-1 | Fill risk per band |
|---|---:|---:|---|
| Current 20/42/65/83 | 0.635 | 0.945 | 0/0/3/11/45% |
| **DEC-009 35/50/80/92** | **0.551** | 0.920 | 0/0/6/30/54% |
| Quantile 25/45/70/92 | 0.583 | 0.961 | 0/0/5/24/54% |

`GOOD_LEVEL_MATCH` is 0.6 and the phase-3 exit demands ≥0.60, so the plan
cannot clear its own gate — and no modelling improvement closes the gap,
because the error is already at the floor.

A grid search over 566 cut sets that *do* clear 0.60 shows why the metric is the
wrong gate: the best, **15/25/35/91 at 0.715**, wins by making one band 56
points wide, labelling everything from 35% to 91% full "very busy". It scores
higher and says less. With a 10.6-point noise floor inside bands 15–30 points
wide, exact 5-band agreement measures band width as much as skill.

| Option | Description | Trade-offs |
|---|---|---|
| A | Keep 35/50/80/92; gate on within-1, MAE, bias and calibration; demote exact level match to a reported diagnostic | Keeps the labels visitors can act on and stops gating on a gameable metric. Requires changing `ferry-accuracy-verdict.ts` thresholds — which must happen *before* phase 2 and be recorded here, never after seeing a result. |
| B | Revert to 20/42/65/83 | Clears the existing gate untouched at 0.635. Abandons the risk ladder: the top band carries only a 45% fill risk, so `extreme` still does not mean "you will be bumped". |
| C | Adopt 25/45/70/92 | A middle position at 0.583 — still under 0.60, so it needs the same threshold change as A but with a weaker rationale for the cuts. |
| D | Search for cuts that clear 0.60 | **Rejected on evidence.** The sets that clear it are degenerate; optimising the label vocabulary against the metric is precisely backwards. |

**Recommendation**: **A**. Within-1 at 0.92 already bounds the damage, MAE is at
the floor, and phase 4 adds a calibration measure that is not gameable by band
width. The verification guard is reworded rather than removed: thresholds may
change before phase 2 as a recorded decision, never after a phase-3 result.

**Decision**: **A** — keep 35 / 50 / 80 / 92 and rebalance `ferry-accuracy-verdict.ts` so the
gate reads the metrics that are neither at the noise floor nor gameable by band
width. Grounded in the walk-forward measurement (MAE 10.2, within-1 0.92,
bias ~0, level match 0.551):

| Tone | Gate |
|---|---|
| `ready` | MAE <= 12 **and** abs(bias) <= 8 **and** within-1 >= 0.90 |
| `borderline` | MAE <= 18 **and** abs(bias) <= 15 **and** within-1 >= 0.80 |
| `not-ready` | anything else |

`levelMatchRate` is still computed, still shown, and no longer gates. MAE
becomes a gate for the first time — it is already on `VerdictInput` and was
simply unused.

**The guard that makes this legitimate:** the change lands in phase 2, before
any phase-3 number exists. A test asserts the thresholds are unchanged since the
phase-2 commit, so they cannot be moved once a result is in view.

**Consequences**:

**Easier**: The gate stops being unreachable by construction, and stops
rewarding a label vocabulary that says less. Within-1 bounds the damage when the
exact band misses, which is the property that actually matters to a visitor.

**Harder**: Several tests in `ferry-accuracy-verdict.test.ts` change, including
the one pinning the real 2026-07-31 production numbers. The verdict prose leads
with level match today and must be rewritten to lead with within-1.
`MIN_SAMPLE`'s rationale comment ("200 readings is roughly a day of snapshots")
becomes wrong once `n` counts sailings — 200 sailings is about four days.

**Foreclosed**: Using `levelMatchRate` as evidence across the cutover. It is
measured against different cuts on both sides.

**Applied to**:

- `plan.md` T-11 (extended to cover the verdict rebalance)
- `verification.md` Phase 3 exit, "Verdict returns `ready` without post-hoc goalpost-moving"
- `review.md` F-1

---


### DEC-011: How is the refit evaluated without grading on its own fit?

**Date**: 2026-08-23
**Decided by**: Mat
**Status**: Decided

**Context**: Review finding F-2. T-08 fits `CURVES` from the fixture and the
phase-2 exit grades the result "against the fixture" — in-sample by
construction, so the ≤13 MAE target is optimistic by an unknown margin. It leaks
into phase 3 as well: sub-floor buckets fall back to curves that have seen every
test day. The fixture was introduced for reproducibility and quietly became an
evaluation set too.

| Option | Description | Trade-offs |
|---|---|---|
| A | Accept it, note the optimism | Free. Leaves a number in front of the Chamber that we know is flattering, in a project whose entire premise is that the previous number was not trustworthy. |
| B | Time-blocked hold-out: fit on the first 40 days, evaluate on the last 10; ship curves refit on all 50 | Honest cold-path number for ~15 lines of script. The 10 hold-out days are a thin, seasonally-narrow sample, and the shipped curves are not the ones measured. |
| C | B, and report the in-fit number alongside the held-out one | Same honesty, and the gap between the two is itself the diagnostic — a large gap means the fit is memorising. Two numbers to explain. |
| D | Nest the refit inside the walk-forward loop | Exact, and destroys the point: `CURVES` would no longer be a committed constant, which is the cold path's whole reason to exist. |

**Recommendation**: **C**. The refit script grows a `--holdout` flag, the
phase-2 exit gates on the held-out days, and both numbers are reported so the
in-fit/held-out gap stays visible.

**Decision**: **C** — `scripts/refit-ferry-curves.ts` grows a `--holdout` flag doing a
time-blocked split: fit on the first 40 days, evaluate on the last 10. The
phase-2 exit gates on the held-out days only. The shipped constants are refit on
all 50 days, and **both numbers are reported** so the in-fit/held-out gap stays
visible — a large gap means the fit is memorising rather than generalising.

**Consequences**:

**Easier**: The cold-path target stops being self-graded, and the gap between
the two numbers becomes a standing diagnostic rather than a thing nobody
measured.

**Harder**: The 10 hold-out days are a thin and seasonally narrow sample, so the
held-out number carries real variance — read it as a floor, not a point
estimate. The constants actually shipped are not the ones measured, which has to
be said plainly wherever the number is quoted.

**Foreclosed**: Quoting a single cold-path accuracy figure without saying which
split produced it.

**Applied to**:

- `plan.md` T-08, Phase 2 exit criteria
- `verification.md` Phase 2 exit, "Cold path hits its target out of sample"
- `review.md` F-2

