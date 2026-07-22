# Ferry queue sensing

> **Status: PLAN — not built.** This is a standalone implementation design for a solo dev. Nothing here ships yet. It reuses machinery already live in the Visit Kingston app (ferry-forecast, ferry-observations, the map CMS, the analytics privacy posture, the admin gate) and adds a new *occupancy signal source*: a crowd-sourced, probe-GPS estimate of how long the Kingston→Edmonds car-ferry line actually is right now. It is designed to be **precise-in → aggregate-out → raw-discarded** to honor the app's existing privacy posture and Washington's MHMDA (RCW 19.373). It is also the **sensing layer** the later line-side delivery concept needs (`docs/VISION-LINESIDE-DELIVERY.md` §7 seam #5 "occupancy-signal abstraction" feeds seam #1's board-time API), but this doc plans *only* the standalone queue-sensing feature.
>
> **House-style note:** every "reuse X" below carries the exact file path + symbol so the build is copy-the-pattern, not invent-from-scratch, and WHY is stated beside WHAT. Where a seam is reused as a *pattern* but NOT its data (the forecast blend, the accuracy backtest), that is called out explicitly — those two are the traps a naive reuse falls into (§5.2, §7). Indexed under `docs/README.md` alongside the ferry planner and `MAPS.md`.

---

## 1. What it produces & why

**Primary value (standalone ferry product):** a *measured-where-covered, modeled-elsewhere* answer to the single question every ferry rider asks — **"how long is the line right now?"** — expressed three ways:

| Output | Meaning | Source |
|---|---|---|
| **Car count (with a band)** | Estimated cars in the Kingston→Edmonds queue right now, always shown as a range or coarse label, never a bare integer | Probe gaps × per-segment lane count ÷ stopped-car spacing, **+ tail model** |
| **Queue reach** | How far back the line stretches on the route (tollbooth → east-of-Lindvog holding → SR-104 west) | Furthest trusted anchor's arc-position (a **lower bound** on true reach) |
| **Per-position estimate** | "You're ~N cars back → likely sailing / ~M min to board" — coarsened to a band when vessel assignment is uncertain | Position on route + **live** WSF sailing capacity/cadence |

Today the app *forecasts* busyness (`src/lib/ferry-forecast.ts`) and shows *live drive-up space at the tollbooth* (`getSailingSpace` in `src/lib/wsf.ts`). Neither measures the **line itself** — the cars queued on the road, west of the tollbooth, out onto SR-104. WSF's `terminalsailingspace` only reports remaining deck space per sailing; it is blind to how many cars are physically waiting on the highway. Queue sensing fills that gap.

**Where the number is trustworthy — and where it is still a guess.** The estimate is a blend of two very different terms, and honesty about which is which is a hard requirement:

- **Covered span (measured):** between two in-queue probes, the count of cars is *penetration-independent* (§2) — real measurement.
- **Tail + leading gap (modeled):** cars beyond the furthest probe and between the frontmost probe and the tollbooth are **not** measured; they come from a heuristic tail model (§5.1). **At launch, with few probes, the tail dominates**, so the early number is mostly modeled. We therefore never claim "measured, not guessed" as a blanket — we claim "measured over the covered fraction, modeled beyond it, with confidence that shrinks as the covered fraction shrinks."

The whole estimate is fed into the forecast as its own confidence-weighted signal — **not** by averaging into the existing sailing-observation bucket (that would be physically invalid; see §5.2), but as a *parallel* source with its own weight, following the *same weighting idea* `scoreAt()` already uses. When coverage is thin the queue signal earns little weight and the researched heuristic dominates; as adoption grows the measured fraction rises and the queue signal earns more.

**Secondary value (delivery, later):** the same anchors become the occupancy signal for line-side/pickup delivery (`docs/VISION-LINESIDE-DELIVERY.md` §7 seam #5; feeds seam #1's board-time prediction API). **Sensing ≠ delivering:** we *sense* the whole line including east of Lindvog (inside terminal holding), but delivery would only ever happen *west* of Lindvog / at hubs. This doc plans only sensing.

---

## 2. How it works (the probe/gap method, in plain terms)

**Floating-car / probe estimation.** App users in the line contribute their location. We snap each contributor to a position on a Chamber-drawn **queue path** (a 1-D "arc" from 0 = back of line to 1 = tollbooth). Then:

> **Covered cars = Σ over consecutive in-queue probes of `(gap_metres / stopped-car spacing) × lane_count(segment)`.** Spacing ≈ 6–8 m; lane count is a per-segment field on the queue-path feature (§3), because the east-of-Lindvog holding is multi-lane and a 1-D arc alone would collapse N lanes into one and under-count the densest stretch by up to ~4×.

The key insight (verified earlier): **we do NOT need the app's penetration rate to count the *covered* span.** If probe A is at metre 100 and probe B at metre 180 in a 2-lane segment, that 80 m × 2 lanes holds ~22–26 cars regardless of how many run the app. Penetration only affects the two **unmeasured ends**:

1. **The tail** — cars *beyond the furthest probe* (the line may extend well past the last reporter), and
2. **The leading gap** — cars between the frontmost probe and the tollbooth.

Both come from the **tail model** (§5.1), which *does* depend on penetration and *is a modeled guess*. It self-improves as adoption rises (more probes → shorter unmeasured ends → the measured fraction grows and the modeled fraction shrinks). This is why QR signs matter (§4.3): a scan at a far-back sign anchors the *tail* even with zero GPS, converting modeled length into measured reach exactly where it is worst.

**Confidence** rides on: **probe count** covering a span (more = tighter), **gap width** (wider = less certain), **spacing/lane variance** (§4 widens the band ±~30% for spacing and for lane-assignment uncertainty), **tier mix** (self-mark/QR > behavioral), **recency**, and — decisively — the **covered fraction** (a mostly-tail estimate is heavily down-weighted). That confidence scalar becomes the sample-weight fed into the queue blend.

```
covered cars      = Σ over consecutive anchors: (gap_m / SPACING_M) * laneCount(seg)
tail cars         = tailModel(bucket-expected reach − covered reach)     // modeled; see §5.1
central estimate  = covered cars + tail cars                             // shown AS A BAND
coveredFraction   = coveredReach / max(coveredReach, bucketExpectedReach)
confidence        = f(probeCount, gapWidths, spacing/laneVariance, tierMix, recency, coveredFraction)
```

---

## 3. Queue geometry & zones

**Mat's consideration #1 — the full-line geometry — is the foundation.** A car in the line can be:

| Segment | Where | Sensed? | Delivered to? | Lanes (for count) |
|---|---|---|---|---|
| **Tollbooth → east-of-Lindvog holding** | Inside terminal / east of Lindvog Rd, parallel to SR-104 inland | **Yes** | No (inside terminal) | Multi-lane (2–4) |
| **West-of-Lindvog SR-104 overflow** | The SR-104 highway queue west of Lindvog | **Yes** | Yes (future) | 1 (single shoulder/lane) |
| **Boarding-pass alternate staging** | Barber Cutoff Rd / Miller Bay when the SR-104 pass system is active | **Yes**, but as a **separate gated pool** (§3.5), *not* a continuation of the main arc | At hubs (future) | 1 |

The queue-path model must span **all** of it. **Sensing spans the whole line; delivery (later) only west of Lindvog / at hubs.** Because the count depends on lane count, each segment of the queue-path feature carries its own `lanes` (and its own corridor width — §10 Q7).

### 3.1 Storage — reuse the map CMS overlay (no new infra)

The queue path is **one `MapFeature`** (`src/lib/map/types.ts`) of `kind:"line"` with `path:[[lat,lng], …]`. `FeatureKind` is `"marker" | "line" | "trail" | "area"` — **use `"line"`, do not invent a `"queue-path"` kind.** Anchor coordinates (verified in memory + `wsf.ts`):

| Waypoint | Approx lat/lng | Note |
|---|---|---|
| Tollbooth (arc = 1) | `47.7963, -122.4965` | Front of line |
| East-of-Lindvog holding | parallel to SR-104 inland toward Lindvog Rd | Terminal holding lanes (multi-lane) |
| West-of-Lindvog SR-104 overflow | west along SR-104 | Highway queue (single) |
| SR-104 far west (arc ≈ 0) | `≈ 47.803, -122.516` | Back of the *main* line |

The Barber Cutoff / Miller Bay alternate staging is **not** on this polyline — it is a second `kind:"line"` feature (§3.5).

Per-segment metadata (`lanes`, `corridorM`) rides in the feature's jsonb `doc` (no schema change — see §3.2/§6.2), keyed by segment index along the path.

- **Seed** it in `src/lib/data/map-features.ts` (append to the `mapFeatures` array), on a new view `"queue-sensing"` seeded in `src/lib/data/map-views.ts` (`published:false` — admin-draft, matching the existing `parking-cash` draft view, `MAPS.md` §"draft views").
- **Edit** it live in the **Map CMS builder `/admin/maps`** (`MapBuilder`, `src/app/(site)/admin/maps/{page,editor}.tsx`) — the plural editor, which persists `MapFeature` overlay via `saveMapFeature()` in `src/lib/stores/map-store.ts` → `.data/stores/map-features.json`. **Not** `/admin/map` (singular, `MapZoneEditor`), which edits the *parking-store* `MapZone` dataset — a different backend (`MAPS.md` §"two systems"). This distinction is load-bearing for exclusions (§3.4).
- **Query** via `getMapFeatures()` filtered to `views.includes("queue-sensing")`.

### 3.2 Arc projection — one new pure module

New pure module `src/lib/queue-geometry.ts`:

```ts
snapToArc(lat, lng, path): { arc: number /*0..1*/, offsetMeters: number, segment: number }
pointInPolygon(lat, lng, polygon): boolean
```

`snapToArc` projects any point onto the polyline (per-segment closest-point projection, cumulative length normalized to 0..1), returning the arc, the off-route offset, **and which segment** it landed on (so the counter can look up that segment's `lanes`/`corridorM`). **The arc (plus coarse segment/section) is the ONLY position ever persisted** — a scalar on a fixed Chamber-drawn line, never the car's real lat/lng. Snapping first is what makes aggregate-out possible. Unit-tested (`queue-geometry.test.ts`), no integration.

### 3.3 Zones / area buckets

Per the analytics posture (§6), aggregates bucket by **queue section**, not fine position. Define coarse sections along the arc (e.g. `lindvog-east`, `sr104-west-lower`, `sr104-west-upper`, `alt-staging`) so a stored aggregate reads like the existing area buckets in `AREAS`/`classifyArea` (`src/lib/analytics-store.ts` lines 144–157), never a car position. **These sections double as the degraded-GPS fallback grain** (§4.4, §10): when accuracy is poor, we count by *section occupancy*, not metre-gaps.

### 3.4 Exclusion polygons (false-positive killer) — one store, not two

Parked-in-a-lot is the single biggest false positive. Exclusions are drawn as **new `MapFeature` `kind:"area"` on the `queue-sensing` view** — the same overlay store as the queue path, editable in the same `/admin/maps` builder. A candidate whose snapped position sits *inside* any exclusion (`pointInPolygon()`) is rejected before scoring — the "on the road, not in a lot" rule.

**Why redraw rather than reuse `getParkingZones()`:** the 11 georeferenced Port lot polygons live in the *parking-store* (`MapZone`, edited in `/admin/map` singular), a **different backend** from `MapFeature`. Routing queue exclusions through `getParkingZones()` would force an admin editing the queue map to touch two stores in two editors. To keep one store / one editor, the Phase-0 seed **copies the current Port-lot polygon geometry into `queue-sensing` `kind:"area"` features** (a one-time snapshot in `map-features.ts`) and adds resident/side-street exclusions there too. (Decision to confirm — §11 Q9: snapshot-copy vs. read both stores at runtime. Lean snapshot: the lot geometry is stable and one-store editing is worth the copy.)

### 3.5 Alternate staging is a separate gated pool, not more arc

**Mat's #1, precisely.** When the SR-104 vehicle boarding-pass system is **active**, cars at Barber Cutoff / Miller Bay are **not** contiguously behind the SR-104-west queue — they are a **separate pool released by pass number**. Snapping them onto the single `0..1` main arc would double-count them and make the per-position estimate wrong for pass-holders (a single monotonic arc cannot represent a branching, gated queue).

So the alternate staging is modeled as its **own `MapFeature` `kind:"line"`** with its **own `0..1` arc and its own occupancy count**. Whether it's live is detected via `getEffectiveBoardingPass()` (`src/lib/stores/boarding-pass-store.ts`, already used by `getFerryStatusSnapshot()` in `ferry-status.ts` line 40):
- **Pass system OFF:** the alternate branch is treated as inactive; probes there are rare and counted on their own segment, contributing little.
- **Pass system ON:** alternate-staging cars are counted **separately** and the per-position estimate for anyone snapped there switches to **pass-based** logic (your pass number vs. the number being called), never "cars ahead ÷ deck capacity."

---

## 4. Signal capture & fusion

This is the CLASSIFY step: for each contributing device, decide *is this a real in-queue car, how sure are we, and where on the line is it?* Output is an ordered list of **in-queue anchors** `{ arc, segment, inQueueConfidence, tier, ts }` handed to the counter (§5). **Core invariant: a raw device coordinate never survives classification** — the classifier runs on the precise fix transiently, snaps it to an arc + segment, and only the arc + segment/section + tier + confidence leaves the request.

### 4.1 Trust tiers

One enum in new pure module `src/lib/queue-signal.ts` drives every downstream weight:

| Tier | Base confidence | Why this rank |
|---|---|---|
| **`self-mark`** | 0.95 | A human explicitly asserts the exact fact we measure. Also the ground-truth LABEL for calibrating behavioral thresholds and the reach lower-bound (§7). |
| **`qr-scan`** | 0.90 | Near-certain intent AND the highest *position* certainty (surveyed sign lat/lng, GPS-independent). Ranked just under self-mark because a scan is a point-in-time event vs. a sustained state — **and its durable weight is gated on corroboration** (§4.3, anti-replay). |
| **`behavioral`** | 0.45 | Inferred; the only tier that can be a false positive. Supplement only, gated hard, its **own** consent (§4.4), a stretch phase (§8). |

This ordering directly implements Mat's ask: **self-mark / QR > behavioral.** The tiers *unify* by producing the same `InQueueAnchor` shape, so the counter never branches on tier — only on confidence.

### 4.2 Mat's consideration #2 — SELF-MARK ("I'm in the ferry line")

The highest-trust signal and ground-truth label.

- **UX:** new client component `src/components/queue-self-mark.tsx`, mirroring `src/components/near-me.tsx` conventions (`"use client"`, `vk-sid` session id via the `getSessionId()` pattern, one-tap, `getCurrentPosition` **once** — never `watchPosition` for the first fix). Renders on a new `/queue` page and as a `/ferry` panel, gated by `getFerryQueueSensingAccess()` (§9).
- **Flow:** tap → RCW 19.373 affirmative-consent sheet (**purpose-specific** copy via `EditableText`/`useCopy` so the Chamber can tune it; distinct from near-me's block-sort copy, which is NOT consent to infer queue membership) → `getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })` (**highAccuracy true**, unlike near-me's `false`, because queue position needs lane-level precision transiently) → POST to `/api/ferry/queue/probe`. Server snaps to arc + segment, discards the coordinate.
- **Heartbeat:** enters an **active-marked** state and refreshes its fix on a slow cadence (~90 s while foregrounded, via the `document.addEventListener("visibilitychange", …)` pattern already used in `src/components/next-ferries.tsx` and `src/app/(site)/ferry/ferry-board.tsx` — NB `src/lib/page-visibility.tsx` is the unrelated admin page show/hide module, not a foreground hook), re-POSTing an updated arc so the anchor tracks the car creeping forward. This is the ONE place we sample repeatedly, and only for a fully-consented self-marker. **The probe endpoint is UNTHROTTLED per session** (§6.2) — every heartbeat updates the live active set.
- **Auto-clear** (a stale self-mark inflates the count): first to fire wins — explicit "I've boarded / left"; boarded-by-geometry (arc reaches ~1.0 then leaves the corridor toward the terminal); stale-heartbeat (>12 min, server-side TTL); hard cap (>3 h).
- **Captured transiently, dropped after anchor:** precise lat/lng, accuracy, heading, speed, anonymous `vk-sid`, optional user-typed `vehicleDescription` ("silver Subaru", kept only for the *future* delivery handshake, never persisted in any aggregate). **Persisted (aggregate-only):** arc, segment/section, tier, confidence, ts bucket. Never a track.

### 4.3 Mat's consideration #3 — QR SIGNS (known-position anchor + adoption CTA)

Physical QR signs along the queue route. Each scan does **three** jobs.

**Sign identity + geometry — reuse the map overlay.** Each sign is a `MapFeature` `kind:"marker"`, `category:"info"`, `views:["queue-sensing"]`, with `point:[lat,lng]` (surveyed) plus two free-form jsonb fields on the overlay doc (no schema change — `doc` is jsonb): `signId:string` and precomputed `arc:number`. Optional `images[]` via `saveFeatureImage()` in `src/lib/stores/map-store.ts`. Admins place/drag signs in `/admin/maps` like any feature; `arc = snapToArc(sign.point, queuePath).arc` recomputes on save.

**QR URL / deeplink — redirect FIRST, record only AFTER consent (MHMDA fix).** Each sign encodes `https://<domain>/q/<signId>?s=<shortSig>`. New route `src/app/q/[signId]/route.ts`:
1. Verifies `shortSig`, then **302-redirects immediately** into `/queue?anchor=<signId>&via=qr` — the landing page shows the full purpose-specific consent sheet. **No queue anchor is recorded at the redirect.** A position-derived datum (the sign's arc) is only committed **after** the user accepts consent on `/queue`, which POSTs a `qr-scan` probe carrying `signId` (arc looked up server-side from the sign — no GPS needed). This removes the "record-then-redirect" pre-consent capture the earlier draft had.
2. `shortSig` = truncated HMAC of `signId` under a server secret (`QUEUE_SIGN_SECRET`, same env family as `FERRY_OBSERVE_TOKEN`). **What HMAC does and does NOT do:** it stops an attacker *guessing* an unknown `signId`. It does **not** stop *replay* — the signature is static and printed on a public sign, so anyone who photographs it has a forever-valid signed URL. Replay/mass-scan abuse is handled separately below.

**Anti-abuse (replay + mass-scan) — corroboration-gated durable weight.** Because a static signed URL can be replayed from anywhere and `vk-sid` is a client-controlled `sessionStorage` value an attacker can rotate:
- **Rate-limit `/q/[signId]`** per `signId` per IP (and per session) via `src/lib/rate-limit.ts` (`checkRateLimit`). On Upstash this is a shared window across instances; without Upstash it is per-instance only (§6.2 makes Upstash a hard prod requirement).
- **A bare QR scan drives the adoption/UX funnel but contributes LOW-TO-ZERO weight to the *durable* aggregate.** A `qr-scan` anchor only earns durable weight when **corroborated in-session** — the same `vk-sid` also produces an on-path GPS fix (self-mark or on-corridor behavioral) near that arc within a short window. Uncorroborated scans still light up the live ephemeral estimate faintly but are excluded from `queue_observation` writes, so a scripted spray of `/q/q9` cannot poison the ≥90-day buckets feeding the forecast.
- **Plausibility gates:** reject a scan whose arc implies an impossibly long line given other live anchors; cap the per-section contribution any single session/sign can make in a window. Same gates apply to self-marks.

**Three jobs of a scan** (all of Mat's #3):
1. **Adoption:** the scan is the CTA — opens the app, offers self-mark opt-in, converts a passerby into a live probe. Each sign is a physical acquisition funnel on the exact stretch we most need coverage.
2. **Anchor:** a *corroborated* scan at `q7` asserts *a car exists at arc(q7)* with position certainty above any GPS fix — especially valuable for fixing the **far tail** (worst GPS, most-uncertain back edge). Records `{ tier:"qr-scan", arc:sign.arc, segment, signId, ts, sessionId }` — **no lat/lng at all.**
3. **Calibration ground truth:** scan arcs + self-mark arcs are the labels used to tune behavioral thresholds and sanity-check GPS snapping (if self-marked GPS consistently snaps ~30 m off a co-located sign, we learn the corridor width for that segment).

**Admin sign management:** new `/admin/queue-sensing` page lists all signs, each deep link + a rendered QR (client-side **inline-SVG** QR encoder — CSP blocks external QR CDNs, so vendor a pure-JS library) for printing. Gated by `getSessionUser()` role `admin`, same pattern as `src/app/api/admin/boarding-pass/route.ts`. Retiring a sign = `deleteMapFeature()` (tombstone); scans of a retired/unknown `signId` still redirect (fail-open UX) but record no anchor (fail-closed data).

### 4.4 Mat's consideration #4 — BEHAVIORAL INFERENCE (auto-detect likely in-queue cars)

Turns ordinary opt-in location activity **on ferry-context surfaces** into supplemental probes without a fresh explicit mark. Lowest tier, gated hard, a **stretch goal** (§8, §11).

**Consent — its OWN specific-purpose grant, NOT inherited from near-me.** Near-me's consent copy (`near-me.tsx` line 165: "Uses your location once, rounded to about a block, to sort this list…") is a general block-sort opt-in — under RCW 19.373 that is *not* purpose-specific consent to infer you are in the ferry line (bundled/repurposed consent is exactly what the statute targets). Behavioral therefore requires **either** (a) its own affirmative, specific-purpose consent sheet ("let the app notice when you're likely in the ferry line and count you toward the estimate"), **or** (b) an in-session prior self-mark (the user already asserted queue membership this session). We never mine `/eat` "near me" pings. (Legal read — §11 Q10.)

Pure `scoreBehavioral(sample, history, geometry): number` in `queue-signal.ts`. Gated + additive:

| Signal | Test | Contribution |
|---|---|---|
| On-path | `snapToArc().offsetMeters ≤ corridorM(segment)` (~25 m default, per-segment) | **GATE** (fail → 0) |
| Not-in-exclusion | not inside any `queue-sensing` exclusion area | **GATE** (fail → 0) |
| Low / stop-and-go speed | rolling speed < 8 km/h, or creep-stop variance | +0.35 |
| Sustained dwell | on-path & slow ≥ `DWELL_MIN` (~4 min) | +0.30 |
| Heading toward terminal | heading aligns with local path tangent toward arc=1 (dot > 0.5), or arc increasing over time | +0.25 |
| Arc in active-line region | arc within the currently-estimated occupied span (bootstrapped by self-marks/scans) | +0.10 |

In-queue iff score ≥ `BEHAVIORAL_MIN` (default 0.55). Constants live in `queue-signal.ts` beside the tier bases (matching the codebase's "tunable knobs in one file" convention, as `EMP_*` sit together in `ferry-forecast.ts`).

**History without persisting a track — disclosed as a sub-15-min derived scalar.** Dwell / heading / arc-trend need *sequence*, but we store no track. Keep a **short-TTL per-`vk-sid` behavioral state** (Upstash Redis in cloud / in-memory locally, TTL ~15 min) holding only derived scalars — `{ lastArc, arcTrend, slowSampleCount, firstSlowTs }`, never a coordinate list. **We acknowledge in the privacy record (§6, Appendix) that `arcTrend` + `lastArc` across samples is a coarse trajectory — a thin but real temporal derivative** — hence it is TTL-bounded to <15 min, arc-only (never lat/lng), and never persisted to the durable aggregate. Each sample updates the scalars then is discarded — precise-in/aggregate-out applied to the temporal dimension.

**False-positive handling:** through-traffic / westbound leavers fail the low-speed or heading gate; residents / side streets fail the exclusion + off-corridor offset; parked-in-a-lot fails the exclusion. **False negatives are acceptable** — a missed car just widens a gap the tail model absorbs, and self-marks/scans backfill the highest-value positions.

### 4.5 Fusion — per-probe confidence + reconciled anchors

Unified shape in `queue-signal.ts`:

```ts
interface InQueueAnchor {
  arc: number;               // 0..1 — the ONLY fine position stored (ephemerally)
  segment: number;           // which path segment → lane count + corridor width
  inQueueConfidence: number; // 0..1, per-probe
  tier: QueueTier;
  ts: string;
  probeKey?: string;         // vk-sid, in-memory only; refreshes replace, not duplicate
}
```

**Per-probe confidence = base × recency × geometry × behavioralScore:**
```
inQueueConfidence = TIER_BASE_CONFIDENCE[tier]
                  * recencyFactor(ageSeconds)  // 1.0 fresh → 0 at tier TTL
                  * geometryFactor             // qr: 1.0 (surveyed); gps: f(accuracy_m, offsetMeters)
                  * behavioralScoreFactor      // behavioral: (score-MIN)/(1-MIN); others 1
```
- `recencyFactor` decays to 0 at the tier TTL (self-mark 12 min, qr-scan 20 min, behavioral 10 min) — a stale anchor's confidence → 0 and it silently drops, no special-casing.
- `geometryFactor` (GPS tiers only) penalizes poor accuracy + large off-route offset; QR scans skip it — why a *corroborated* scan out-anchors degraded GPS in the tollbooth structures.

**Degraded-GPS defense (fabricated-gap fix).** When `accuracy_m` is large (dense-metal-cluster multipath, ~20–50 m random error), snapping to a precise arc *scatters clustered cars across the arc and fabricates gaps* — two cars 3 m apart can snap 40 m apart, inflating `gap_metres / spacing`. `geometryFactor` down-weights *confidence*, but the *central* estimate is built from snapped positions, so a low-confidence-but-still-too-long span survives. So:
- **Coarse-snap on poor accuracy:** if `accuracy_m` exceeds a threshold, do not trust arc precision — snap to the **section** (§3.3) and let that probe contribute to **section occupancy**, not a metre-gap.
- **Merge near-duplicates:** anchors from different sessions within `< SPACING_M` collapse to one (can't be two cars closer than a car length).
- **Cap per-gap density:** a gap can never imply more cars than `laneCount × gap_m / SPACING_M` — reject spans that imply impossible density.
- **Test (`queue-signal.test.ts`):** a cluster of cars carrying 40 m GPS error must NOT report a ~200 m span.

**Dedup + trust-priority reconciliation:** anchors collect into the live set keyed by `probeKey`; a device's newest replaces its older (self-mark heartbeats, re-scans). When two anchors from *different* devices land within `GAP_M` (~7 m, one car length): keep both if both high-tier (two real adjacent cars, subject to the lane cap); if one is behavioral and one is self-mark/QR at the same arc, **suppress the behavioral** — enforcing self-mark/QR > behavioral at the fusion layer with no downstream change.

---

## 5. Estimation, confidence & blend into ferry-forecast

### 5.1 Gap → car count, and the tail model (specified, not asserted)

The reconciled, confidence-carrying anchor set feeds the counter (`queue-signal.ts` + a small counting helper):
- **self-mark + corroborated qr-scan** form the *trusted skeleton* — the line's max-arc reach and high-confidence interior anchors between which gaps are counted. QR scans especially fix the far tail.
- **behavioral** densifies interior gaps on mark/scan-free stretches, weighted down and suppressible.
- Covered cars per gap = `(gap_m / SPACING_M) × laneCount(segment)`; sum over the covered span.

**Tail model (the dominant term at launch — so it gets a real formula):**
```
expectedReach   = reachForBucket(direction, dateStr, minutes)   // heuristic line length for this bucket, in arc units
coveredReach    = maxArc(trusted anchors)                        // measured lower bound on reach
unmeasuredArc   = max(0, expectedReach − coveredReach)           // tail (+ symmetric leading-gap term)
tailCars        = clamp( arcToMetres(unmeasuredArc) / SPACING_M * laneCount(tailSegments),
                         0, TAIL_CAP )
coveredFraction = coveredReach / max(coveredReach, expectedReach)
```
- `reachForBucket` is derived from the same seasonal heuristic the forecast already encodes (a busier bucket ⇒ a longer expected line); it is the *modeled* backstop for the part no probe has reached.
- **Confidence decays as `coveredFraction` falls.** A mostly-tail estimate (launch state) is heavily down-weighted, so it earns little forecast weight and is displayed as a coarse band (§5.4), not a confident integer. As adoption grows, `coveredReach → expectedReach`, the tail shrinks, `coveredFraction → 1`, and the number becomes genuinely measured.
- `SPACING_M` and `TAIL_CAP` are field-calibrated (§7, §11 Q2).

### 5.2 The blend — reuse the *weighting idea*, NOT the ferry bucket (blocker fix)

**Do NOT put queue data into the ferry `EmpiricalBucket` and merge into the same key.** Verified against `ferry-observations.ts`:
- `EmpiricalBucket.s` is **mean deck-fullness** of *sailings*: `clamp01(1 − driveUp/max) × 100` (`getEmpiricalBusyness`, line ~185).
- `EmpiricalBucket.n` is a **count of sailing snapshots** — an integer that `scoreAt()` (`ferry-forecast.ts` lines 348–366) feeds into `Math.min(n / EMP_FULL_CONFIDENCE_N, EMP_MAX_WEIGHT)` and `n < EMP_MIN_SAMPLES`.

Merging a queue quantity in would be **physically invalid**: (a) *highway car-count* and *deck-fullness fraction* are different physical quantities — averaging them into one bucket is meaningless; (b) a **confidence-scaled float `n`** is no longer a count, so `Math.min(n/40, …)` and `n < 3` misbehave — one high-confidence probe could near-max-weight the blend, or a dozen low ones fall below threshold. (This is the trap the seam map avoided by hedging a separate key-space; the earlier draft's MVP walked into it.)

**Correct design — a separate table + a calibrated transform + dual-weight (the earlier "option 2", now the MVP):**
1. Queue observations live in their **own `queue_observation` table** (§6.2) with **explicit `car_count` and an integer `probeCount`**, never inside a ferry bucket.
2. To influence the forecast, first map queue **car-count → a busyness score in the SAME 0–100 units as deck-fullness**, via a *calibrated transform* `queueBusyness(carCount, direction, minutes)` (learned/tuned in §7). `n` stays an **integer probe count**; per-probe *confidence* enters as a separate weight multiplier, not by inflating `n`.
3. Feed `scoreAt()` through a **dual-source overload** so the two signals never average in one bucket:
   ```
   score = heuristic·(1 − w_q − w_f)
         + queueBusyness·w_q          // w_q from queue probeCount (integer) × rolled confidence × coveredFraction
         + ferryContribution·w_f      // w_f exactly as today, from sailing-snapshot n
   ```
   `w_q` and `w_f` are independent and clamped so `w_q + w_f ≤ EMP_MAX_WEIGHT`-style cap; a thin, mostly-tail, mostly-behavioral queue signal earns a tiny `w_q` automatically — the trust hierarchy reaches the final weight for free.

New constants sit **beside the existing `EMP_*`** in `ferry-forecast.ts` (own names, own semantics):

| Constant | Default | Note |
|---|---|---|
| `QUEUE_MIN_PROBES` | 3 | integer probe floor (NOT reusing `EMP_MIN_SAMPLES`, different unit) |
| `QUEUE_FULL_CONFIDENCE_N` | 40 | probes for max queue weight |
| `QUEUE_MAX_WEIGHT` | 0.5 | cap on `w_q`; conservative until calibrated |

**Hook point:** in `getEmpiricalBusyness()` (`ferry-observations.ts` lines 169–213) — or a sibling `getQueueBusyness()` in the new store — build a **separate `QueueTable` keyed by the same `empiricalBucketKey(direction, dateStr, minutes)`** (`ferry-forecast.ts` line 261) but carrying `{ carCount, probeCount }`, and thread it as the new `scoreAt()` argument. Same key space, **separate table, separate weight** — never one merged bucket. Holidays skip the queue blend for the same reason they skip the empirical one.

### 5.3 Per-position "which sailing / minutes-to-board" — LIVE capacity, not a hardcode

Derived downstream from arc + **live** WSF sailing data (`getSailingSpace` / `getSailingsForDate` / `pacificDayString` in `src/lib/wsf.ts`). **Do NOT hardcode ~188/boat or ~376/sailing** (that number is only a header comment). `getSailingSpace()` returns per-sailing `maxSpaces` **and** `vessel` (`SailingSpace`, `wsf.ts` lines 245–277) — use them:
- cars-ahead-of-you (arc → arc=1, lane-adjusted) ÷ **that sailing's live `maxSpaces`** → sailings-ahead → likely sailing + minutes-to-board from cadence.
- **Vessel swap / single-boat:** the Kingston–Edmonds run routinely drops to one boat (maintenance, tides, crewing) or swaps in a smaller vessel — halving or changing capacity. When live `maxSpaces` for upcoming sailings is missing or the vessel assignment looks uncertain, **degrade the per-position answer to a coarse band** ("likely the next 1–2 sailings") rather than a false-precise "you'll make the 2:30." Added to the edge-case table (§10).
- **Pass system ON:** for anyone snapped to alternate staging (§3.5), the answer is **pass-number-based**, not capacity-division.
- Labeled an ESTIMATE everywhere, same as the planner.

### 5.4 Public display — hysteresis + bands for the sparse regime (flicker fix)

At launch the normal state is **1–3 active probes** (above zero, below `QUEUE_MIN_PROBES`), where adding/dropping ONE anchor can swing the raw count by tens of cars between 90 s polls — a visibly flickering public number. Handling:
- **Never show a bare integer.** Below a confidence floor (which the sparse/mostly-tail regime sits under), show a **coarse band**: `short / moderate / long` (mapping to `scoreToLevel`-style buckets), not "47 cars."
- **EWMA smoothing:** the public number (or band) is an exponentially-weighted moving average over a few minutes, so a single anchor blinking in/out nudges rather than jumps it.
- **Explicit regimes:** `0 probes` → heuristic-only (no "line exists" claim); `1..QUEUE_MIN_PROBES−1` → coarse band from EWMA, labeled low-confidence; `≥ QUEUE_MIN_PROBES` and `coveredFraction` above floor → a car-count **range** (band width from spacing ±30% + lane + tail uncertainty). The exact car integer is reserved for high-coverage conditions we may never hit at Kingston scale — and that's fine.

---

## 6. Privacy, consent & data model (precise-in → aggregate-out → raw-discarded)

A **hard constraint**, not a nicety. The app's opt-in GPS "near me" pings are block-rounded (3 decimals ≈ 100 m via `roundCoord`, `analytics-store.ts` line 145) and never persisted raw — validated against a competitor teardown (`docs/COMPETITOR-BAINBRIDGE.md`: geolocation client-side only, never persisted; no raw-GPS heatmaps). Queue sensing needs *precise* location transiently, so the discipline is stricter: precise-in → **snap to arc** → aggregate-out → raw discarded — and it discards even the rounded pair, keeping only the 1-D arc/section on a fixed Chamber geometry.

### 6.1 MHMDA / RCW 19.373 compliance

| Requirement | How it's met |
|---|---|
| Precise geolocation is "sensitive" → **affirmative, specific-purpose consent** | A **purpose-specific** sheet before the first location read (self-mark) or first behavioral opt-in — **distinct from near-me's block-sort consent, which does not transfer** (§4.4). Copy states the single purpose: queue estimation. |
| **Consent BEFORE any position-derived capture** | `/q/[signId]` **redirects first, records only after** the user accepts consent on `/queue` (§4.3) — no pre-consent anchor. |
| **No raw-coordinate persistence** | Snap → arc/section; drop lat/lng, accuracy, heading, speed, `vehicleDescription` at request end. Only arc/section + tier + confidence survive (ephemerally), and only the **section-level aggregate** persists durably. |
| **Aggregate-of-one is not aggregate** | **k-anonymity gate (§6.2):** no durable datapoint is derived from fewer than `K≈5` distinct sessions in the window; below K a probe feeds only the live ephemeral estimate. Blocks re-identifying a lone self-marker at a quiet hour. |
| **Order/purpose-scoped, self-deleting** | See §6.2 for the single reconciled retention rule. |
| **Behavioral temporal derivative disclosed** | `arcTrend`/`lastArc` are named as a sub-15-min, arc-only derived scalar, TTL-bounded, never durable (§4.4). |
| **No geofence near health-care** | Documented that no queue-path, alternate-staging line, or exclusion polygon overlaps a clinic. |

### 6.2 Data model — one new SQL table, reconciled retention, no lat/lng in the durable row

**Ephemeral (never durably stored raw)** — the `POST /api/ferry/queue/probe` payload, consumed then discarded:
```ts
interface QueueProbeInput {
  tier: "self-mark" | "qr-scan" | "behavioral";
  gps_lat?: number; gps_lng?: number; accuracy_m?: number; // absent for qr-scan
  heading?: number; speed?: number;
  signId?: string;             // qr-scan only
  sessionId: string;           // vk-sid, anonymous
  vehicleDescription?: string; // self-mark only; dropped after anchor built
}
```

**Probe ingest is UNTHROTTLED and per-key (blocker fix).** The probe endpoint must **not** reuse `recordSailingSpaceSnapshot`'s throttle: that is a single **module-global** `lastRecordAt` with `THROTTLE_MS = 10 min` (`ferry-observations.ts` lines ~66, ~96–98) — one write per 10 min **process-wide**. On a probe endpoint the first probe in a window would win and every other self-mark/heartbeat/scan would return early and be **discarded**, silently killing the entire real-time signal. Instead:
- **Every probe updates the short-TTL active set immediately, unthrottled.** That is the live count.
- Any per-probe rate-limiting for *abuse* is **per-key via `src/lib/rate-limit.ts`** (`checkRateLimit`, keyed by `vk-sid`/IP), never a module global.
- **Only the AGGREGATE roll-up** to `queue_observation` is throttled/batched (a periodic or per-trip flush), which is where a 10-min-style cadence is appropriate.

**Short-TTL active set (Upstash Redis — a HARD prod requirement, NOT an open question):**
```ts
// key: queue:anchor:{vk-sid}   TTL 12–20 min by tier
interface InQueueAnchor { arc; segment; inQueueConfidence; tier; ts; probeKey }
// key: queue:behav:{vk-sid}    TTL ~15 min — derived scalars only, no coordinates
interface BehavioralState { lastArc; arcTrend; slowSampleCount; firstSlowTs }
```
`rate-limit.ts` proves Redis is *optional* with a per-instance `Map` fallback — correct for a single-instance server, **wrong for the live queue count on multi-instance** (Render can run multiple instances; anchors would split per instance and counts fragment). So: **if `UPSTASH_REDIS_REST_URL` is absent in production, queue sensing fails closed / stays admin-preview only.** The in-memory fallback is acceptable for local dev and single-instance, never for the public count on a fleet.

**Overlay records** (existing `record` table — since E05 — via `readMerged`/`writeOverlayRecord` in `src/lib/stores/json-store.ts`; **no DDL**):
- Queue-path line + alternate-staging line + exclusion areas + QR-sign markers → `MapFeature` docs in the existing `map-features` store (`doc` is jsonb, so `signId`/`arc`/`lanes`/`corridorM` are free-form, no column change).
- One new `MapView` `{ id:"queue-sensing", published:false }` in the `map-views` store.
- Gate record → `record(store="ferry-queue-sensing", id="settings")`, doc `{ enabled, setAt, setBy }` — identical shape to the existing `ferry-prediction` record.

**Aggregate (durable) — the ONE new table, section-level only, k-anonymous.**
Since E05, there is a single schema source of truth: add the table to
`src/lib/db/schema.ts` and generate a checked-in migration (`npm run
db:generate`) — the old hand-synced `db/schema.sql` / `SCHEMA_STATEMENTS` pair
(and its drift trap) is gone:
```sql
CREATE TABLE IF NOT EXISTS queue_observation (
  ts  timestamptz NOT NULL DEFAULT now(),
  obs jsonb NOT NULL
);
```
**Write-failure visibility (minor fix):** because the write is fire-and-forget (`.catch(()=>{})` like `ferry-status.ts` line 47), a missing table fails **silently** — no table, no error, feature looks built. Migrations retire the schema-drift half of this risk, but for the first weeks **log queue-write failures to the existing error channel** instead of swallowing them, so any write problem is visible.

Local dev mirrors `.data/ferry-queue/observations.jsonl` (one JSON per line), like `.data/ferry/observations.jsonl`. New store `src/lib/stores/queue-observations.ts` mirrors `ferry-observations.ts`: `recordQueueObservation()`, `readObservations()`, `prune()`.

**The single durable `obs` shape — one schema, NO lat/lng, k-anonymity enforced:**
```ts
// Section-level ONLY. No gap endpoints, no coordinates of any kind.
interface QueueObservation {
  ts: string;          // ts bucket
  dir: Direction;
  bucketKey: string;   // empiricalBucketKey(direction, dateStr, minutes)
  section: string;     // coarse queue section id (§3.3) — NEVER a lat/lng
  carCount: number;    // section car-count estimate (band midpoint)
  probeCount: number;  // INTEGER distinct sessions behind it
  tierCounts: { selfMark: number; qrScan: number; behavioral: number };
}
```
This resolves the earlier contradiction: there is **one** aggregate schema, it carries **`section` not lat/lng**, and it is written **only when `probeCount ≥ K` (≈5 distinct sessions in the window)** — a lone self-marker at a quiet hour never produces a durable row (they still count in the live ephemeral estimate). `tierCounts` are per-section totals, not per-car, so they cannot fingerprint an individual once K is enforced.

**Retention — reconciled in ONE place (major fix):**
- **Raw probe GPS:** accepted transiently, **never persisted** — snapped and dropped within the request.
- **Ephemeral active set / behavioral scalars:** Redis TTL 12–20 min (arc-only, no coordinates).
- **Durable `queue_observation` rows:** these are already section-level, k-anonymous, and coordinate-free — so they follow the **same ≥90-day retention as `ferry_observation`** (they are the *aggregate*, not raw data). There is **no separate 24-h class** — the earlier "raw 24 h vs. derived 90 d" split was the source of the contradiction; the only thing that could have needed 24-h purging was raw/near-raw data, and we never persist any. Prune mirrors `ferry-observations.prune()` at 90 days.

**Write hook:** fire-and-forget from `getFerryStatusSnapshot()` in `src/lib/ferry-status.ts` (line 47 already does this for ferry observations), or per-trip rather than per-poll — but only the *roll-up* flush is hooked here; live probe ingest is the separate unthrottled endpoint above.

---

## 7. Calibration & accuracy — reuse the machinery PATTERN, not its ground truth

**The ferry `computeAccuracy` is NOT directly reusable for queue length (blocker fix).** Verified: `computeAccuracy` (`ferry-observations.ts` line ~283) scores the heuristic prediction against `observed = 1 − driveUp/max` (line ~298) — i.e. against **WSF deck fullness**. There is **no observed highway-car-count** anywhere in the data. Feeding a car-count prediction into that function and comparing it to deck fullness would produce nonsense MAE/RMSE/bias (two different physical quantities).

**Queue accuracy has no cheap ground truth. State it plainly and use real labels:**
- **Manual / WSDOT-camera counts** as periodic truth: a handful of admin-recorded actual line lengths (or WSDOT SR-104 camera frames counted by hand) become the calibration set for `SPACING_M`, `laneCount`, the tail model, and the `queueBusyness` transform (§5.2).
- **Reach lower-bound label:** max-arc of self-mark + QR scans is a *lower bound on true reach* — the estimate must never fall below it. Cheap, always available, one-sided.
- **Derived-product validation:** did a rider who saw "likely the 2:30" actually board around then? Cross-check the per-position claim against WSF departures (`getSailingsForDate`). This validates the *useful output* without needing a true car-count.

**Reuse the accuracy *machinery pattern*** — `recordAccuracySnapshot` / `getAccuracy` / the overlay-store rollup and the MAE/RMSE/bias/levelMatch/within1 shape — in a **new `queue-observations.ts` backtest that scores against the labels above**, NOT by calling ferry `computeAccuracy` on car-counts. Snapshot into a new overlay store (`store="queue-sensing-accuracy", id="latest"`), surfaced on `/admin/queue-sensing`.

- **Behavioral thresholds** (`CORRIDOR_M`/per-segment, `DWELL_MIN`, `BEHAVIORAL_MIN`) and `SPACING_M` are field-calibrated against self-mark/QR labels **before behavioral is trusted beyond admin preview.**
- **Precedent to watch:** the planner's first accuracy sample showed the heuristic over-predicts busyness on near-empty early-July-evening boats (bias ≈ +22). The queue signal may *correct* that once probes arrive — validate before enabling public.

**Cron (reuse the exact pattern of `ferry-observe.yml` / `ferry-accuracy.yml`):**
- `.github/workflows/queue-observe.yml` → `GET /api/ferry/queue/observe?token=FERRY_OBSERVE_TOKEN` every 5–10 min during service hours (~5 AM–12:30 AM Pacific). Token-gated identically to `/api/ferry/observe` (`src/app/api/ferry/observe/route.ts` lines 22–32; `permissions:{}`, curl-with-retries workflow). **This cron flushes the roll-up; it is unrelated to live probe ingest.**
- `.github/workflows/queue-accuracy.yml` → runs post-observe to update the accuracy snapshot against the label sources above.

---

## 8. Phased rollout

Ship **dark by default** via the gate (§9), admin-preview throughout.

| Phase | Scope | Ships |
|---|---|---|
| **0 — Geometry & gate** | Seed queue-path line (+per-segment `lanes`/`corridorM`) + alternate-staging line + `queue-sensing` view + exclusion `kind:"area"` (snapshot of Port lots + residents) + starter QR markers in `map-features.ts`/`map-views.ts`. `ferry-queue-sensing-store.ts` gate. `queue-geometry.ts` + tests. `/admin/queue-sensing` shell. Schema-sync CI assertion. | Nothing public; admin can draw the route in `/admin/maps`. |
| **1 — Self-mark MVP** | `/queue` page + `queue-self-mark.tsx` + purpose-specific consent + **unthrottled** `/api/ferry/queue/probe` + short-TTL active set (Upstash-required) + gap→count with lane multiplier + tail model + **band/EWMA display** + `queue_observation` (k-anonymous, section-level) + **dual-source queue blend into `scoreAt()`** + observe/accuracy crons. | The standalone "how long is the line" **band**, self-mark only (lowest FP risk). Primary value. |
| **2 — QR signs** | `/q/[signId]` resolver (redirect-first) + `QUEUE_SIGN_SECRET` HMAC + **rate-limit + corroboration gating** + admin QR generation/printing + arc precompute on save. | Frictionless adoption + GPS-free *corroborated* tail anchors. Physical signs go up. |
| **3 — Behavioral (stretch)** | `scoreBehavioral()` + its **own consent** + exclusion gating + behavioral state TTL. Only after Phase-1/2 labels calibrate the thresholds. | Densifies coverage; off until accuracy validates it. |
| **4 — Per-position estimate** | "which sailing / minutes-to-board" from arc + **live** WSF capacity + vessel-swap/pass-based coarsening. | The per-position band. |

**Recommendation:** Phases 1–2 (self-mark + corroborated QR) deliver the standalone product with the least FP risk. Behavioral (Phase 3) is a fast-follow, not MVP (the seam map calls it a stretch goal). **The self-mark MVP is shippable and low-risk *as long as* it ships with the dual-table blend and label-based accuracy from this revision — not the earlier merge/reuse.**

---

## 9. Gating (ship dark) — reuse `ferry-prediction-store.ts` exactly

New `src/lib/stores/ferry-queue-sensing-store.ts` mirroring `src/lib/stores/ferry-prediction-store.ts`:

```ts
getFerryQueueSensingAccess(): Promise<{ enabled: boolean; adminPreview: boolean }>
setFerryQueueSensingEnabled(enabled: boolean, setBy: string): Promise<void>
```
Overlay `store="ferry-queue-sensing", id="settings"`, record `{ enabled, setAt, setBy }`, **default OFF** (no seed). Public sees queue features only when `enabled`; signed-in admins get `adminPreview` when off (via `getSessionUser()?.role === "admin"`, exactly as `getFerryPredictionAccess` lines ~61–65). Every queue surface renders `if (!access.enabled && !access.adminPreview) return null`. The **`/q/[signId]` scan route still redirects when off** (printed signs never 404) but records no anchor unless live-or-adminPreview. **Additionally fails closed if Upstash is absent in prod** (§6.2). Admin toggle on `/admin/queue-sensing` (or `/admin/ferry-info`), mirroring `prediction-control.tsx` → `/api/admin/ferry-prediction`.

---

## 10. Edge cases & failure modes

| Case | Handling |
|---|---|
| **Poor/absent GPS in tollbooth structures** | *Corroborated* QR scan supplies an exact arc with no GPS; `geometryFactor` skipped, so scans out-anchor degraded GPS where it fails most. |
| **Degraded GPS in a metal-car cluster** (fabricated gaps) | On large `accuracy_m`, coarse-snap to section (count by occupancy, not metre-gaps); merge anchors within `< SPACING_M`; cap per-gap density. Test: 40 m-error cluster must not report a 200 m span. |
| **Car parked in a Port lot** (biggest FP) | Rejected by `pointInPolygon` against the `queue-sensing` exclusion areas (Port-lot geometry + residents) before scoring. |
| **Through-traffic / westbound leavers on SR-104** | Fail the low-speed and/or heading gate + short dwell → not classified in-queue. |
| **Boarded car still marked** | Auto-clear when arc reaches ~1.0 then leaves the corridor; + 12-min stale-heartbeat TTL + 3-h hard cap. |
| **App closed mid-line** | `recencyFactor` → 0 at tier TTL; Redis key expires → silently drops, no stuck inflation. |
| **Sparse (1–3 probes) flicker** | EWMA smoothing + coarse band (short/moderate/long) below the confidence floor; bare integer never shown (§5.4). |
| **Mostly-tail at launch** | Tail model supplies the modeled remainder; `coveredFraction` down-weights confidence and forces a band; not presented as "measured" (§5.1). |
| **Multi-lane holding under-count** | Per-segment `lanes` multiplier in the count; band widened for lane-assignment uncertainty (§2, §5.1). |
| **Spoofed/guessed `signId`** | HMAC `shortSig` mismatch → still redirects (UX), records no anchor. |
| **Replayed / mass-scanned known sign** | Rate-limit `/q` per sign per IP/session; uncorroborated scans get low/zero durable weight, so cannot inflate the count or poison 90-day buckets (§4.3). |
| **Retired / unknown `signId`** | Redirect (no 404); no anchor recorded. |
| **Same car sensed by two tiers at one arc** | Behavioral anchor suppressed within `GAP_M` (§4.5). |
| **Rapid self-mark heartbeats / re-scans** | Keyed by `probeKey` (vk-sid) — newest replaces older, no duplicates. |
| **Consent declined** | No location read; self-mark idle; behavioral never runs for that session; surface degrades to heuristic-only. |
| **Feature gated OFF / Upstash absent in prod** | All queue surfaces return null except `/q/[signId]` (redirect only); with no Upstash in prod, feature stays admin-preview/fails closed. |
| **Empty line / zero probes** | No anchors → heuristic-only (like an empirical bucket below threshold); no false "line exists." |
| **Vessel swap / single-boat sailing** | Per-position estimate uses **live** `maxSpaces`; when capacity/vessel is uncertain, degrade to a coarse "next 1–2 sailings" band, not a false-precise sailing (§5.3). |
| **Boarding-pass system ACTIVE** (Barber Cutoff / Miller Bay) | Alternate staging is a **separate gated segment with its own count**; per-position switches to **pass-number** logic; not concatenated onto the main arc (§3.5). |
| **Multi-instance on Render** | Active set MUST be in Upstash Redis (hard prod requirement, §6.2), or anchors split across instances and counts fragment. |

---

## 11. Open questions & decisions to confirm

1. **Active-set store:** **Decided — Upstash Redis is a hard prod requirement** (§6.2); the in-memory `Map` is dev/single-instance only, and the feature fails closed in prod without Upstash. (No longer an open question, but flag the env in deploy.)
2. **Calibration constants:** `SPACING_M` (6–8 m ±30%), per-segment `lanes` and `corridorM`, `DWELL_MIN`, `BEHAVIORAL_MIN`, `TAIL_CAP`, and the `queueBusyness` transform need field calibration against early self-mark/QR labels **and** manual/camera counts before behavioral is trusted beyond preview.
3. **QR encoder:** pick and vendor a pure-JS inline-SVG QR library (CSP blocks external CDNs).
4. **Behavioral in MVP or fast-follow?** Fast-follow (Phase 3) — self-mark + corroborated QR deliver the number with far less FP risk.
5. **Capture `sailingTarget` at probe time** vs. derive downstream from arc + live `getSailingSpace`? Lean derive-downstream (and derive capacity live, never hardcode).
6. **Rate-limit `/api/ferry/queue/probe`** per-key via `rate-limit.ts`? **Yes** — but for abuse only; it must NOT throttle legitimate real-time probes (per-key window, not a global lock).
7. **Per-segment `CORRIDOR_M` and `lanes`:** confirmed as **per-segment fields on the queue-path feature**, not global constants (east multi-lane holding vs. west single shoulder).
8. **Blend model:** **Decided — dual-source/separate-quantity from the start** (§5.2), never merge into the ferry bucket. Revisit weight tuning as coverage grows.
9. **Exclusion polygons:** snapshot Port-lot geometry into `queue-sensing` `kind:"area"` (one store, one editor) vs. read both `map-features` and `parking-store` at runtime? Lean snapshot (stable geometry, one-editor authoring).
10. **Legal read (MHMDA):** (a) confirm behavioral needs its *own* purpose-specific consent (or a prior in-session self-mark), not inheritance from near-me; (b) confirm the redirect-first / record-after-consent `/q/[signId]` ordering satisfies "affirmative consent before position-derived capture." Get a written read before Phase 3 and before Phase 2 goes public.
11. **k-anonymity threshold `K`:** ≈5 distinct sessions per durable datapoint — confirm the value against expected off-peak volumes so the durable log isn't starved at quiet hours (below K, live-only is acceptable).

---

## 12. Change map — files to add / modify

### New (pure, unit-tested — no integration)
| File | Purpose |
|---|---|
| `src/lib/queue-signal.ts` | `QueueTier`, `TIER_BASE_CONFIDENCE`, `scoreBehavioral()`, `fuseAnchors()`, degraded-GPS coarse-snap/merge/density-cap, confidence math, thresholds, `queueBusyness()` transform |
| `src/lib/queue-geometry.ts` | `snapToArc()` (arc + offset + segment), `pointInPolygon()`, corridor/offset helpers |
| `src/lib/queue-signal.test.ts`, `src/lib/queue-geometry.test.ts` | Gap→count with lanes, tail model, dual-weight blend, projection, **clustered-GPS-must-not-fabricate-span** — all testable in isolation |

### New (stores / routes / UI)
| File | Purpose | Mirrors |
|---|---|---|
| `src/lib/stores/ferry-queue-sensing-store.ts` | On/off gate + admin preview + Upstash-required guard | `ferry-prediction-store.ts` |
| `src/lib/stores/queue-observations.ts` | Append-only **section-level k-anonymous** aggregate + prune + label-based `computeQueueAccuracy()` | `ferry-observations.ts` (pattern only) |
| `src/app/api/ferry/queue/probe/route.ts` | Accept precise fix, snap, classify, update active set; **UNTHROTTLED**, per-key rate-limited; consent-gated; never persists coordinates | `api/ferry/observe/route.ts` (token only, not the throttle) |
| `src/app/api/ferry/queue/observe/route.ts` | Token-gated cron flush of the roll-up | `api/ferry/observe/route.ts` |
| `src/app/q/[signId]/route.ts` | QR resolver — verify shortSig, **redirect first (no pre-consent record)**, rate-limit | — |
| `src/components/queue-self-mark.tsx` | Self-mark UX, purpose-specific consent, heartbeat, auto-clear | `components/near-me.tsx` |
| `src/app/queue/page.tsx` | Public `/queue` surface (gated), band/EWMA display, post-consent qr-scan POST | — |
| `src/app/(site)/admin/queue-sensing/page.tsx` + `src/app/api/admin/queue-sensing/route.ts` | Sign list, QR/deep-link generation, thresholds, on/off toggle, accuracy | `api/admin/boarding-pass/route.ts` |
| `.github/workflows/queue-observe.yml`, `.github/workflows/queue-accuracy.yml` | Crons | `ferry-observe.yml`, `ferry-accuracy.yml` |

### Modified
| File | Change |
|---|---|
| `src/lib/ferry-forecast.ts` | Add `QUEUE_MIN_PROBES` / `QUEUE_FULL_CONFIDENCE_N` / `QUEUE_MAX_WEIGHT` beside `EMP_*`; add a **dual-source `scoreAt()` overload** taking a separate `QueueTable {carCount, probeCount}` with independent weight `w_q` — **no merge into the ferry `EmpiricalBucket`** |
| `src/lib/stores/ferry-observations.ts` | (Optional) expose `pacificParts`/`empiricalBucketKey` usage the queue store mirrors; **do NOT** aggregate queue rows into the ferry table |
| `src/lib/db/schema.ts` | Add a `queue_observation (ts timestamptz, obs jsonb)` table and generate a checked-in migration (`npm run db:generate`) — the E05 substrate's single DDL path (no hand-kept sync, no assertion needed) |
| `src/lib/ferry-status.ts` | Fire-and-forget roll-up flush alongside the snapshot at line 47 (or per-trip); **log queue-write failures to the error channel** for the first weeks |
| `src/lib/data/map-features.ts` | Seed queue-path `kind:"line"` (+`lanes`/`corridorM` per segment) + alternate-staging `kind:"line"` + exclusion `kind:"area"` (Port-lot snapshot + residents) + starter QR `kind:"marker"` on `queue-sensing` |
| `src/lib/data/map-views.ts` | Seed `{ id:"queue-sensing", published:false }` |
| `docs/README.md` | Index this doc alongside the ferry + MAPS rows |

### Reused unchanged (grounded paths)
`getMapFeatures` / `saveMapFeature` / `deleteMapFeature` / `saveFeatureImage` (`src/lib/stores/map-store.ts`, via `/admin/maps` `MapBuilder`) · `readMerged` / `writeOverlayRecord` (`src/lib/stores/json-store.ts`) · `empiricalBucketKey` + `pacificParts` pattern (`ferry-forecast.ts` / `ferry-observations.ts`) · `getEffectiveBoardingPass` (`src/lib/stores/boarding-pass-store.ts`) · `getSessionUser` (`src/lib/auth.ts`) · `page-visibility.tsx` · `getSessionId` / `getCurrentPosition` pattern (`components/near-me.tsx`) · `getSailingSpace` (per-sailing `maxSpaces`/`vessel`) / `getSailingsForDate` / `pacificDayString` (`src/lib/wsf.ts`) · `checkRateLimit` (`src/lib/rate-limit.ts`, on `/q` and `/probe`) · the `recordAccuracySnapshot`/overlay *pattern* (NOT ferry `computeAccuracy` on car-counts) · `roundCoord`/`classifyArea` *pattern* (`analytics-store.ts`). **Explicitly NOT reused for queue data:** ferry `EmpiricalBucket`/`getEmpiricalBusyness` bucket merge (§5.2), `recordSailingSpaceSnapshot`'s module-global throttle (§6.2), and `computeAccuracy`'s deck-fullness ground truth (§7).

---

## Appendix — Queue Probe Data Retention (the durable privacy record)

- **Consent:** affirmative, **purpose-specific** ("share your spot in the line so we can measure how long it is"), distinct from near-me's block-sort consent; gated on `/queue` and on the `/q/[signId]` landing **before** any position-derived capture. Behavioral inference requires its **own** consent (or a prior in-session self-mark). RCW 19.373-oriented; pending a legal read (§11 Q10).
- **Position captured before consent:** none. `/q/[signId]` redirects first; the qr-scan anchor is recorded only after consent is accepted on `/queue`.
- **Raw retention:** raw probe GPS accepted transiently, **never persisted**; snapped to a 1-D arc/section, then discarded within the request.
- **Ephemeral:** active-set anchors + behavioral scalars in Upstash Redis, TTL 12–20 min, arc-only. `arcTrend`/`lastArc` are acknowledged as a sub-15-min coarse temporal derivative — bounded, arc-only, never durable.
- **Durable:** only k-anonymous, section-level `queue_observation` rows (≥K≈5 distinct sessions), coordinate-free, retained ≥90 days like `ferry_observation`. **No separate raw/24-h class exists — nothing raw is ever persisted.**
- **Never stored:** individual coordinates, tracks, gap endpoints, `vehicleDescription`, `accuracy`, `heading`, `speed`, or any datapoint from fewer than K sessions.
- **Stored (durable):** coarse section, direction, bucket key, section car-count, integer probe count, per-tier anchor counts, ts bucket.
- **No health-care geofence:** no queue-path, alternate-staging line, or exclusion polygon overlaps a clinic (documented).
- **Multi-instance correctness:** Upstash Redis is a hard prod requirement; without it the feature fails closed rather than fragmenting the live count.