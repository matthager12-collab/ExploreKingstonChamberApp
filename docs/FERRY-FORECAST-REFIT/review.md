# Adversarial review: ferry forecast refit

**Independence caveat, stated up front:** this pass was run by the same session
that authored the plan, not an independent reviewer. That is a real weakness of
the review, not a formality — a self-review cannot find the things it did not
think of the first time. Two of the eight findings below were confirmed by
running code or measurement rather than by argument, and those are marked; the
rest are reasoning and should be read with the caveat in mind.

**Lenses**: statistical validity (the failure this project most fears — shipping
a model that looks good in the backtest and is wrong in front of visitors);
operational failure modes; public-claim honesty. A short security/privacy pass
is at the end.

## What the plan already gets right

- Ground truth is measured, not assumed, and the spike overturned the prior
  code review rather than inheriting it.
- The bias **sign flip** as a phase-1 exit criterion is a genuine falsifier — it
  cannot be satisfied by a fix that merely reduces error.
- Phases 1–3 are invisible to visitors, so nothing ships on an unproven number.
- Season and holiday factors are explicitly excluded from the refit rather than
  quietly fitted on data that cannot support them.
- Every target is a number measured **before** the work started.

---

## F-1 · High · The gate is unreachable under the cuts the plan chose

**Confirmed by measurement.** Walk-forward on a trailing 28-day window,
969 graded sailings:

| Cut set | Level match | Within-1 | Fill risk per band |
|---|---:|---:|---|
| Current 20/42/65/83 | **0.635** | 0.945 | 0/0/3/11/45% |
| **DEC-009 35/50/80/92** | **0.551** | 0.920 | 0/0/6/30/54% |
| Quantile 25/45/70/92 | 0.583 | 0.961 | 0/0/5/24/54% |

`GOOD_LEVEL_MATCH` is 0.6 and the phase-3 exit criterion demands ≥0.60. **The
plan cannot clear its own gate using the cuts it decided on**, and MAE is
already at the 10.6-point noise floor — so no modelling improvement closes it.

Worse, a grid search over 566 qualifying cut sets shows the metric is trivially
gamed: the best scorer, **15/25/35/91, reaches 0.715 by making one band 56
points wide** — a "very busy" label spanning boats from 35% to 91% full. It
scores better and tells visitors less. Exact 5-band agreement is not a
meaningful gate when a 10.6-point noise floor sits inside bands 15–30 points
wide.

**Why the documents miss it**: DEC-005 and DEC-009 were argued on operational
meaning and never checked against the metric the verdict gates on. I measured
level match under the *old* cuts and carried the number forward.

**Lands as**: DEC-010 (round 3). Also forces a rewording of the verification
guard, which currently forbids threshold changes outright — the right rule is
that thresholds may change *before* phase 2 as a recorded decision, never after
seeing a phase-3 result.

## F-2 · High · Phase 2 fits and grades on the same data

T-08 fits `CURVES` from `sailings-2026-summer.json`; the phase-2 exit criterion
grades the result "against the fixture". That is in-sample by construction, and
the ≤13 MAE target is therefore optimistic by an unknown margin. It leaks into
phase 3 too: sub-floor buckets fall back to curves that have seen every test day.

**Why the documents miss it**: the fixture was introduced for reproducibility
and then reused as an evaluation set without anyone noticing it had become both.

**Lands as**: DEC-011 (round 3).

## F-3 · Medium-high · T-06 fixes `plateauDays` in the wrong place

**Confirmed by reading the code.** `prediction-control.tsx:136` calls
`accuracyVerdict(a, daily)`, and `daily` comes from `computeDailyAccuracy()`,
which recomputes the whole series from the observation log on every call using
current code. It never contains mixed-method data, so `plateauDays()` has no
discontinuity to guard against.

The `method` field matters for `history` — read by `accuracy-trend.tsx` and
`ops/page.tsx` — not for the daily series. T-06's acceptance criterion asserts a
property of the wrong function.

**Lands as**: corrected T-06 acceptance criteria.

## F-4 · Medium · T-10 would put a clock inside the pure module

`ferry-forecast.ts` reads no clock — every entry point takes `dateStr`. A
staleness guard comparing "today" against the fit window would introduce one,
breaking the purity constraint and reintroducing exactly the SSR/hydration
date-drift bug the code review already found in `ferry-busy-today.tsx`.

**Lands as**: T-10 rewritten — `ferry-forecast.ts` exports the fit-window
constant and a pure `isFitStale(dateStr)`; the caller supplies the date.

## F-5 · Medium · The fixture's reproducibility criterion expires

T-07 requires that regenerating the fixture from the documented query reproduces
it byte-for-byte. `RETENTION_DAYS = 90`, and the data spans 2026-07-12 →
2026-08-23 — so the source rows are pruned from roughly **2026-10-10**, after
which the criterion is permanently false.

**Lands as**: T-07 reframed — the fixture is an **archive**, not a cache. It is
reproducible only until the retention window rolls past it, and that date is
recorded in its header.

## F-6 · Medium · Walk-forward silently shortens the reported span

The backtest needs 28 days of history before its first gradeable day, so
`spanDays` drops by 28 — from 50 to 22 on today's data. `MIN_SPAN_DAYS` is 7, so
the verdict still renders, but the Chamber sees the span roughly halve at
cutover with nothing explaining it.

**Lands as**: a note in plan.md phase 3 and an admin-copy line.

## F-7 · Medium · Cold start is invisible until someone reads it as a regression

`ferry-empirical/latest` is written daily, so a fresh environment serves the
cold path for up to 24h. Staging is suspended between rehearsals, so a rehearsal
would reliably show cold-path numbers — easy to misread as the model having got
worse.

**Lands as**: T-15/T-17 acceptance — the surface must say *why* it is on the
fallback, not merely fall back silently.

## F-8 · Low · T-12's trigger can no longer fire

T-12 is conditional on "DEC-004 changing the key". DEC-004 chose option C, which
explicitly does not change the key. The task as written is a no-op, but the
parity sweep it names still needs running because T-11 changes thresholds.

**Lands as**: T-12 rewritten as an unconditional regression check.

---

## Security and privacy pass

Short, because the surface is small — and that is the finding.

- **The committed fixture holds no personal data.** WSF deck-space counts,
  departure times, direction. Nothing about any person. Confirmed against the
  field list in T-07.
- **No new untrusted-input path.** The only external text is the WSF feed, which
  is parsed into numbers and never rendered or persisted as text. No prompt
  path, no upload, no user-supplied string reaches storage.
- **`ferry-empirical/latest` is world-readable via the public pages** and
  should be — it is an aggregate over public sailing data with no k-anonymity
  concern.
- **Unchanged, and out of scope here**: `/api/ferry/{observe,accuracy}` still
  use a non-constant-time token compare and still accept `?token=`, both already
  filed in the code review. This plan touches those routes' *bodies*, not their
  auth, so it neither fixes nor worsens them — noted so the omission is
  deliberate rather than overlooked.

**No security finding rises to blocking.**
