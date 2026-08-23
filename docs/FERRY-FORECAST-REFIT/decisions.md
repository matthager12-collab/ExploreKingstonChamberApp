# Decisions: ferry forecast refit

| # | Question | Status | Decision | Round |
|---|---|---|---|---|
| DEC-001 | What is a sailing's observed busyness? | Open | | R1 |
| DEC-002 | What happens to the stored accuracy history across the fix? | Open | | R1 |
| DEC-003 | Where is the empirical table computed? | Open | | R1 |
| DEC-004 | How is season handled once the window is trailing? | Open | | R1 |
| DEC-005 | Where do the busyness level thresholds cut? | Open | | R1 |
| DEC-006 | What does the backtest grade? | Open | | R1 |

Two-way doors, decided in passing and recorded here so they are not re-litigated:

- `collapseToSailings` lives in `ferry-observations.ts` beside its callers and is exported for tests, following the existing `pacificParts` precedent — not a new pure module. Smaller diff, same testability.
- The refit fixture holds **per-sailing outcomes** (2,156 rows), not raw snapshots (25,454). Small enough to commit, contains no personal data, and is the exact input to the fit.
- `scripts/refit-ferry-curves.ts` **prints** the arrays for a human to paste, rather than rewriting `ferry-forecast.ts` in place. The constants land through a reviewed diff.
- Trailing window starts at **28 days** — the measured knee (MAE 10.6, 98% bucket coverage, vs 12.6 at 21 days). A tunable constant, not a contract.

---

## Round 1

### DEC-001: What is a sailing's observed busyness?

**Date**:
**Decided by**:
**Status**: Open

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

**Decision**:

**Consequences**:

**Applied to**:

---

### DEC-002: What happens to the stored accuracy history across the fix?

**Date**:
**Decided by**:
**Status**: Open

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

**Decision**:

**Consequences**:

**Applied to**:

---

### DEC-003: Where is the empirical table computed?

**Date**:
**Decided by**:
**Status**: Open

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

**Decision**:

**Consequences**:

**Applied to**:

---

### DEC-004: How is season handled once the window is trailing?

**Date**:
**Decided by**:
**Status**: Open

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

**Decision**:

**Consequences**:

**Applied to**:

---

### DEC-005: Where do the busyness level thresholds cut?

**Date**:
**Decided by**:
**Status**: Open

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

**Decision**:

**Consequences**:

**Applied to**:

---

### DEC-006: What does the backtest grade?

**Date**:
**Decided by**:
**Status**: Open

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

**Decision**:

**Consequences**:

**Applied to**:
