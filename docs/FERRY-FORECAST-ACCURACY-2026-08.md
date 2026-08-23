# Ferry busyness forecast — accuracy evaluation, 2026-08-23

**Verdict: the reported 32-point error is mostly a measurement artifact, not a
model failure — and the model underneath it is nevertheless weak. Both are
fixable with data already in hand. A cross-validated refit lands at ~11 points
MAE and ~60% exact level match, which clears every threshold in
`ferry-accuracy-verdict.ts`.**

Evidence: read-only pull of the production `ferry_observation` log —
**25,454 snapshots, 2,156 distinct sailings, 50 Pacific days, 2026-07-03 →
2026-08-23**. (Corrected 2026-08-23: an earlier revision of this document said
the window opened 2026-07-12. That was the `ferry_observation.ts` **column**,
which carries the import time for re-imported rows; the payload `ts` and
`departs` show collection actually began 2026-07-03. No measured figure changes
— every calculation keyed off `departs` — but the window includes July 4th, so
the holiday claim in §7 was wrong and is now corrected.) Every number below is computed from that pull against the shipped
`scoreAt()`. The live stored snapshot (`record` store `ferry-accuracy`,
computed 2026-08-23T08:00Z) reads `mae 32.4, bias +19, level 0.24, within1
0.58` — this analysis reproduces it at 32.5 / +19.1 / 0.24 / 0.58, so we are
grading the same thing the admin panel is.

The public prediction flag is still OFF (no `ferry-prediction` record in prod,
and the store defaults to off), so nothing here is currently misleading
visitors. This is a gate-clearing exercise, not an incident.

---

## 1. The plateau is arithmetic, not a ceiling

`computeAccuracy()` re-scans the entire retention window on every run, so each
nightly snapshot is a running average over every observation ever logged.
Past ~10k rows a new day can move that mean by tenths of a point. **The
cumulative MAE was always going to flatten** — `plateauDays()` is detecting a
property of the estimator, not evidence about the model.

Worse, the thing being averaged is graded against the wrong target, so the
number it converges to is meaningless in either direction.

## 2. Root cause: WSF doesn't decrement the deck until ~30 minutes out

`recordSailingSpaceSnapshot()` logs the next 2 sailings per direction every
~10 min, giving **11.8 snapshots per sailing**. But `DriveUpSpaceCount` sits at
its maximum until the boat is nearly loading:

| Lead time before departure | Snapshots | Mean observed fullness |
|---|---:|---:|
| 4h+ | 36 | 0.0 |
| 2–4h | 1,058 | 0.0 |
| 1–2h | 6,567 | 0.4 |
| 30–60m | 6,776 | 6.5 |
| 15–30m | 3,434 | 32.3 |
| 0–15m | 3,454 | 56.6 |
| after scheduled departure | 4,129 | 46.1 |

**57% of every graded row records a boat that reads empty.** Those rows are
compared against a prediction of 60–80 and charged a ~70-point error each.

The scale of the distortion:

- Mean observed fullness **per snapshot: 21.3**
- Mean observed fullness **per sailing** (fullest state ever seen): **66.9**

So the ground truth the backtest uses is roughly a third of the real thing.
This also confirms the sign error in the admin copy: the panel says the model
"runs 19 points high". Graded per sailing it runs **21.8 points LOW**. Every
instinct to shave the `CURVES` constants down would have made the product
worse.

The prior code review flagged this qualitatively
([CODE-REVIEW-2026-08.md](CODE-REVIEW-2026-08.md), "Accuracy backtest grades
the model against mid-fill snapshots" and the sibling aggregation finding);
this is the measured size of it.

### The same bug is in the live learning path

`getEmpiricalBusyness()` averages the identical per-snapshot values, so the
empirical table currently teaches the forecast that a peak-summer Saturday
2 PM boat is **~21% full when it is really ~95% full** — and `scoreAt()`
blends that in at up to `EMP_MAX_WEIGHT = 0.75`. The backtest never catches it
because the backtest deliberately scores heuristic-only. **The shipped model is
worse than the number on the panel, not better.** `EmpiricalBucket.n` also
counts snapshots, so `EMP_MIN_SAMPLES = 3` is satisfied by a single sailing
seen three times.

## 3. What the model is actually worth once graded honestly

One row per sailing, truth = fullest state observed (min `driveUp`), heuristic
only:

| Model | MAE | RMSE | Bias | Level match | Within 1 |
|---|---:|---:|---:|---:|---:|
| **Live metric** (per snapshot) | 32.5 | 39.1 | +19.1 | 0.24 | 0.58 |
| Per sailing, current curves | 28.1 | 33.0 | −21.8 | 0.19 | 0.63 |
| **Always guess the mean (67)** | **25.4** | 29.4 | 0.0 | 0.18 | 0.76 |
| Best affine rescale of current curves | 22.0 | 27.9 | −0.1 | 0.28 | — |

**The current curves beat a constant by 2.7 points.** That is the real finding
underneath the artifact. Pearson r between prediction and outcome is 0.45
overall — and only **0.30 for `from-kingston`** (vs 0.61 westbound), so the
eastbound shape is close to uninformative. Rescaling alone recovers ~6 points;
the rest is genuinely wrong shape.

### Where the shape is wrong

Observed mean fullness by hour, with the current prediction in brackets:

```
from-kingston  04:28(45) 05:37(59) 06:43(52) 07:55(55) 08:58(59) 09:82(56) 10:74(53)
               11:81(52) 12:80(56) 13:77(68) 14:95(77) 15:84(72) 16:85(57) 17:90(50)
               18:63(45) 19:73(34) 20:47(26) 21:50(19) 22:28(13) 23:33(8)

to-kingston    05:46(21) 06:39(24) 07:64(40) 08:76(56) 09:78(61) 10:79(63) 11:91(63)
               12:92(63) 13:92(64) 14:94(65) 15:90(64) 16:93(54) 17:84(44) 18:82(34)
               19:63(25) 20:49(19) 21:28(16) 22:26(9)  23:17(7)
```

Three systematic errors, all large:

- **Evenings are badly under-predicted.** 16:00–19:00 bias runs −20 to −28
  points. The curves treat the westbound evening as "the lightest period of the
  day" (comment at `ferry-forecast.ts:133`); it is observed at 63–93% full.
- **Early morning is over-predicted.** 04:00 bias +26, 05:00 +13, 06:00 +14.
  The 4:45 and 5:30 boats are much emptier than the AM-commute story assumes.
- **Midday westbound is flat and too low.** A modelled plateau of ~63 against
  an observed 90–94 from 11:00 to 16:00.

This is what you would expect from constants calibrated off WSF's four-tier
"Best Times to Travel" grid: the tiers encode *rank*, and the mapping onto a
0–100 fullness scale was a guess. The affine fit confirms it —
`observed ≈ 26.5 + 0.65 × predicted`: the model's floor is far too low and its
dynamic range too wide.

## 4. The ceiling, measured

Leave-one-day-out cross-validation, so every number is out-of-sample. A
"model" here is just the mean observed fullness of a bucket, learned from the
other 49 days:

| Model | MAE | RMSE | Level match | Within 1 |
|---|---:|---:|---:|---:|
| Current heuristic | 28.1 | 33.0 | 0.19 | 0.63 |
| direction × hour | 13.7 | 19.2 | 0.53 | 0.90 |
| **direction × day-category × hour** | **12.2** | 18.1 | **0.60** | 0.91 |
| direction × weekday × hour | 12.0 | 17.9 | 0.61 | 0.93 |
| direction × weekday × exact departure time | 11.5 | 17.5 | 0.61 | 0.94 |
| *within-bucket noise floor* | *10.6* | — | — | — |

**A plain per-bucket average of our own log is 16 points better than the
hand-tuned heuristic, and lands within 1.6 points of the irreducible
sailing-to-sailing noise floor.** There is no clever modelling left to do — the
data simply has to be used correctly.

Blending the two, as `scoreAt()` does today, only hurts:

| Empirical weight | 0.25 | 0.50 | **0.75 (current cap)** | 1.00 |
|---|---:|---:|---:|---:|
| MAE | 22.8 | 18.1 | **14.4** | **12.2** |

`EMP_MAX_WEIGHT = 0.75` is costing 2.2 points. The heuristic's job should be to
cover buckets that have no data, not to hold a permanent 25% veto over buckets
that do.

### How much history it needs

Training on a trailing window instead of the whole log is better still, because
it tracks the season:

| Trailing window | MAE | Bucket coverage |
|---|---:|---:|
| 7 days | 18.2 | 53% |
| 14 days | 15.7 | 68% |
| 21 days | 12.6 | 85% |
| **28 days** | **10.6** | **98%** |
| 42 days | 10.4 | 100% |

**28 days is the knee.** We already have 50. This can ship now.

## 5. What the target can't tell us

**20.5% of sailings finish ≥99% full.** For those, fullness is censored: a boat
that fills with 10 cars left behind and one that fills with 200 left behind both
read 100. Those are precisely the sailings where "how long will I wait" matters,
and the fullness target is structurally blind to them.

Implications:

- Don't chase MAE below ~10 — beyond that the metric stops tracking the thing
  visitors care about.
- `ARRIVE_EARLY_DRIVE` and `BOAT_WAIT` (a 1–2 hour claim at `very-busy`) are
  **not validated by any of this** and cannot be, from this data. They are still
  research-derived guesses sitting on top of a now-measured busyness number.
- The overflow question needs a second signal: WSF `WaitTimeNotes`, the logged
  `delayMin` (already captured, currently used only as a ≤12-point nudge),
  boarding-pass activation, or the probe-based line length in
  [FERRY-QUEUE-SENSING.md](FERRY-QUEUE-SENSING.md).

## 6. Recommended changes, in order

Expected MAE after each step is cumulative, measured on the pull above.

| # | Change | File | Effect |
|---|---|---|---|
| 1 | Grade **one row per `(dir, departs)`**, truth = `min(driveUp)` across that sailing's snapshots | `ferry-observations.ts` `computeAccuracy` / `computeDailyAccuracy` | 32.5 → **28.1**, bias flips +19 → −22 (metric only — reveals the real error) |
| 2 | Aggregate the empirical table **per sailing** too, and make `n` count sailings | `getEmpiricalBusyness` | Removes the 21-vs-67 poisoning of the live blend; makes `EMP_MIN_SAMPLES`/`EMP_FULL_CONFIDENCE_N` mean what they say |
| 3 | Refit `CURVES` to observed per-sailing means (`dir × day-category × hour`), and re-derive the `seasonFactor` floor | `ferry-forecast.ts` | 28.1 → **~12** |
| 4 | Raise `EMP_MAX_WEIGHT` to 1.0 for well-populated buckets; keep the heuristic as the **fallback for empty buckets only** | `ferry-forecast.ts` | −2.2 |
| 5 | Train the empirical table on a **trailing 28-day window** rather than the full 90 | `getEmpiricalBusyness` | −1.6, and it tracks the season instead of averaging across it |
| 6 | Re-derive `scoreToLevel` thresholds (20/42/65/83) against the real fullness distribution — observed quartiles are p25=43, p50=74, p75=95 | `ferry-forecast.ts` | Level match is the metric the verdict gates on; current cuts were drawn for a different scale |
| 7 | Backtest the **blended** model with leave-one-day-out CV, not heuristic-only | `computeAccuracy` | Today the shipped model is never graded. LODO keeps it honest and out-of-sample |
| 8 | Skip holiday sailings in aggregation, mirroring `scoreAt`'s gate | `getEmpiricalBusyness` | Already filed in the code review. **Now known to matter**: July 4th is in the window and is a genuine outlier (§7) that would otherwise pollute peak-summer buckets |
| 9 | Stop logging snapshots >45 min out, or keep them and mark them non-gradeable | `recordSailingSpaceSnapshot` | 57% of rows carry no information; this is also the row-count/scan-cost fix |

Steps 1–2 are the load-bearing ones — everything else is tuning that cannot be
measured correctly until they land. Steps 1, 2, 8 and part of 9 are already on
the plan as Track 0b item 3 in [COMPLETION-PLAN.md](COMPLETION-PLAN.md); steps
3–7 are new.

## 7. What this evaluation does not cover

Stated plainly, because the window is narrow:

- **All 50 days are peak season** (Jul 12 – Aug 23, `seasonTag` = `peak`
  throughout). `seasonFactor` 0.82 / 0.58 for shoulder and off-season is
  **completely unvalidated**. A refit on this data will be a summer model —
  it needs a shoulder-season guard, and re-checking in October.
- **One holiday falls in the window, and the model gets it backwards.** July
  4th 2026 is present (48 sailings). `holiday()` applies a **1.5× multiplier**
  on the stated grounds that it is "the ferry's worst day of the year":

  | Day | n | Mean predicted | Mean observed | Bias |
  |---|---:|---:|---:|---:|
  | July 3 (partial — collection began mid-evening) | 12 | 20 | 32 | −11.8 |
  | **July 4** | **48** | **67** | **33** | **+34.6** |
  | July 5 | 44 | 62 | 50 | +11.9 |
  | Ordinary days | 2,052 | 44 | 68 | −23.9 |

  July 4th was one of the **quietest** days in the window — mean observed
  fullness 33 against 68 on an ordinary day — while the model predicted the
  busiest. The multiplier is not merely unvalidated; the only evidence we have
  points the opposite way.

  **Weigh this carefully before acting on it.** It is a single occurrence,
  n=48, one year, and a plausible confound exists: if WSF stopped reporting
  during a chaotic day, `min(driveUp)` would understate. It is enough to stop
  trusting the 1.5×, not enough to replace it with a number. The remaining
  multipliers (Memorial Day, Labor Day, Thanksgiving, Christmas) stay entirely
  untested.
- Ground truth is `min(driveUp)`, which is itself a lower bound on demand
  (see §5) and depends on WSF reporting continuously through loading.
- Two vessel capacities appear in the log (186 and 197 spaces). Substitute
  small vessels — called out in `ferry-forecast.ts` as the case the model
  can't see — are not separable here.
- `delayMin` as a predictive input was not evaluated beyond its current use.

## 8. Reproducing this

The analysis scripts are throwaway (scratchpad, not committed). The pull is a
single read-only query against prod:

```sql
SET default_transaction_read_only = on;
SELECT obs->>'dir' AS dir, obs->>'departs' AS departs, obs->>'ts' AS ts,
       (obs->>'driveUp')::int AS drive_up, (obs->>'max')::int AS max_space
FROM ferry_observation
WHERE obs->>'max' IS NOT NULL AND (obs->>'max')::int > 0
  AND obs->>'driveUp' IS NOT NULL AND (obs->>'driveUp')::int >= 0;
```

Per sailing, take `max(1 - drive_up/max_space)`; compare against
`scoreAt(pacificDate, pacificMinutes, dir)` with no empirical table.
