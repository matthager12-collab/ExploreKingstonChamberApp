# Decisions: ferry forecast refit

| # | Question | Status | Decision | Round |
|---|---|---|---|---|
| DEC-001 | What is a sailing's observed busyness? | Decided | C — `min(driveUp)` across every snapshot | R1 |
| DEC-002 | What happens to the stored accuracy history across the fix? | Decided | C — `method` discriminator, render the break | R1 |
| DEC-003 | Where is the empirical table computed? | Decided | C — daily cron writes `ferry-empirical/latest` | R1 |
| DEC-004 | How is season handled once the window is trailing? | Decided | C — `seasonFactor` on the heuristic term only | R1 |
| DEC-005 | Where do the busyness level thresholds cut? | Decided | C — operational meaning, **as a risk ladder** (cut points → DEC-009) | R1 |
| DEC-006 | What does the backtest grade? | Decided | D — walk-forward primary, cold path reported alongside | R1 |
| DEC-007 | What shape holds two accuracy numbers, and which one gates? | Open | | R2 |
| DEC-008 | What is the p(full) contract and where does it render? | Open | | R2 |
| DEC-009 | The actual level cut points | Open | | R2 |

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

**Date**:
**Decided by**:
**Status**: Open

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

**Decision**:

**Consequences**:

**Applied to**:

---

### DEC-008: What is the p(full) contract and where does it render?

**Date**:
**Decided by**:
**Status**: Open

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

**Decision**:

**Consequences**:

**Applied to**:

---

### DEC-009: The actual level cut points

**Date**:
**Decided by**:
**Status**: Open

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

**Decision**:

**Consequences**:

**Applied to**:
