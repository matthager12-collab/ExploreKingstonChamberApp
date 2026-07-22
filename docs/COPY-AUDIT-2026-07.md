# Explore Kingston — Website Copy Audit & Replacement Guide

**Date:** 2026-07-22 · **Revision:** 5
**Status: ✅ APPLIED** on branch `copy/evergreen-audit`, rebased onto current `main`. Verified against a clean-`main` baseline: identical results (1,211 passing / 4 pre-existing `sitemap.xml` failures, unrelated to copy), zero new lint errors. The document is retained as the rationale record and as the **style guide for new copy** — §2 (the evergreen rules) and §3 (the standing decisions) are the parts that stay live.

> **Revision 5** closes the §10 follow-up: `/simple`, `/es`, `/accessibility`, `/privacy`, `/print`, and `/offline` were audited. **Result: clean — no visitor copy edits warranted** (see §10 for why). Comment-only cleanups shipped: the stale `ferry-info.ts` header (after PR #90) and two ADA-date comments. Two legal-copy items on `/privacy` are flagged for the Chamber.

> ⚠️ **Two carve-outs, deliberate.** Main shipped an **E14 plain-language pass (NFR-04)** that rewrote 11 registry blocks to be *longer and simpler* for accessibility — the opposite direction from this audit's brevity goal. Where the two conflict, **E14 wins**. The following are therefore left untouched, and future copy passes must respect the `// E14 plain-language pass` marker as a do-not-shorten flag:
> `ferry.header.intro` · `parking.header.intro` · `parking.map.subtitle` · `webcams.header.intro` · `ferryLine.body1` · `ferryLine.body2` · `ferry.header.edmonds.intro` · `ferryLine.edmonds.body2` · `nearme.consent.body` · `hunt.disclosure` · `footer.credit`, plus the E14-marked parking callout on `/parking`.
>
> Separately, main's E27 work already retired the `(since March 2026)` surcharge stamp and the `summer 2026 rates` fare note — those findings needed no action.

> ✅ **Follow-up done (§10):** `/simple`, `/es`, `/accessibility`, `/privacy`, `/print`, `/offline` audited on 2026-07-22 — **clean, no edits.** These are the E14 / legal / accessibility surfaces, built to evergreen + plain-language principles already. Three items flagged for the Chamber/team rather than changed unilaterally. Details in §10.
**Scope:** All visitor- and member-facing text — the editable copy registry, SEO/social metadata, public page bodies and components, the member portal, and the seeded content data (restaurants, lodging, events, parking, itineraries, charities, ferry info).
**Two goals:** (1) cut verbosity — the site is too wordy; (2) remove *expiring verbiage* — wording that is accurate today but silently rots and makes the site look neglected. **Rule of thumb throughout: prefer evergreen over accurate-today, and the fix is almost always _cutting_ words, not adding them.**

> **Revision 2:** two standing decisions now govern this audit — July-4th commentary comes out of the standing copy (§3.1), and transient operational notices come out of the seeded defaults (§3.2). The boarding-pass dispenser was fact-checked against WSDOT; findings and the resulting one-line fix are in §3.2.
>
> **Revision 3:** all recommendations applied. Two deliberate carry-forwards, left as judgment calls rather than silently actioned: the optional "the fireworks" reference in `give.header.intro` was **kept** (it names a volunteer-run institution, not a date — see §3.1), and the §8 structural items (hours/prices/events into typed fields, deleting the dead `parkingAreas` block, the events live-ingest) are **engineering work, not copy edits**, so they remain open.

---

## 1. Summary

- The public site funnels most headline/intro copy through one file — `src/lib/site-copy-registry.ts` (**81 copy blocks, ~1,050 words**). The **18 longest blocks hold 62% of those words**, so verbosity is concentrated in page intros — that's where the biggest, safest cuts are.
- **The most damaging category is expiring verbiage**, clustering in three places: ferry/webcams page bodies (hard 2026 dates), the seeded data files (counts, prices, "newest," opening dates), and the member portal plus a few registry blocks (build-state language — "v1," "on the roadmap," "coming soon").
- The site's **voice is genuinely good** — warm, plainspoken, dry, small-town-confident. Almost every fix preserves it; we are trimming and de-dating, not rewriting personality out.
- **One real bug:** the public brand is **"Explore Kingston,"** but three visitor-facing spots say **"Visit Kingston"** (§7).
- Three data files — `webcams.ts`, `hunts.ts`, and the map files — are **models of how to do this right**. §9 explains why; the structural fixes in §8 aim to make the rest of the data look like them.

**Legend:** `EXPIRING` = will go stale on its own · `VERBOSE` = can lose ≥30% of words · `BOTH` = both. Every row gives `file:line`, the verbatim current string, and a proposed replacement.

---

## 2. The evergreen rules (reusable — apply to all new copy too)

These eight rules are what would have prevented every finding below. Adopt them as house style so the problem doesn't grow back.

1. **No calendar time in durable copy.** Ban "this summer / this year / right now / currently / these days / at the moment" from any string that isn't rendering genuinely live data. Use conditional or seasonal framing: *"in summer," "when the signs are flashing," "in season."* (Live status labels like "Where are the boats right now?" are correct — they describe real-time state.)
2. **No hard dates or years** unless the sentence is literally about that date. Note the exception: a *founding* date ("since 2003," "built 1879") is evergreen — it stays true forever. An *age* ("130-year-old") is not — it ticks every year.
3. **No build-state or roadmap language in user-facing text.** "v1," "beta," "coming soon," "not yet," "on the roadmap," "in a later phase," "over the coming weeks." Describe the capability you have, in the present tense.
4. **No fixed counts of things that can change.** "Eleven cameras," "18 taps," "Four itineraries," "~30 stalls." Drop the number, or keep it in a structured field the UI counts automatically.
5. **Don't restate what the UI already shows.** A restaurant blurb sitting next to a cuisine label, a walk-time badge, and an "Hours:" line should repeat none of them.
6. **Third-party names are liabilities.** A neighboring business used as a landmark ("the shops by Grocery Outlet," "the old Downpour spot") or a platform ("DoorDash") breaks when they close or rename. Prefer durable civic landmarks and generic phrasing.
7. **Cut throat-clearing and hedging.** "Heads up:", "Please note that," "Here's the fair catch," "People mix these up all the time," "That's normal here."
8. **Perishable facts belong in structured fields, not prose** — with a `lastVerified` date. Prose should describe the *enduring character* of a thing. This is the durable cure (§8).

**Rule 9, added in revision 2 — deliver time-bound advice conditionally, not as standing copy.** If something only matters on certain dates, let the code surface it on those dates. The site already does this well (§3.1).

---

## 3. Standing decisions from this review

These two decisions are policy, not one-off edits — they resolve whole classes of finding.

### 3.1 Drop standing July-4th commentary

The app was drafted around the Fourth, and the copy over-indexes on it. **Remove July-4th commentary from standing page copy.** Crucially, this loses *no information*, because the advice is already delivered conditionally:

`src/lib/ferry-forecast.ts:277` returns the label **"July 4th — the ferry's worst day of the year"**, and `explainFactors()` (`:479`) pushes it as the first "why" chip on the ferry planner — but only when the visitor actually picks that date. **That is the correct pattern**, and it's already shipped. The standing prose is a redundant, dated copy of advice the planner gives at the right moment.

**Keep vs. drop:**

| Keep | Why |
|---|---|
| `ferry-forecast.ts:276-278` — the July 4 surge multiplier + labels | Conditional logic; fires only on the relevant date. The model to follow. |
| `events.ts:18-40` — the 4th of July Car Show and Fireworks Show records | Calendar *data*, not commentary. (Superseded wholesale by the live-ingest work in §8.4.) |
| `events/page.tsx:24` — "markets, waterfront concerts, fireworks, and community events" | "Fireworks" here is an event *category*, undated. Fine. |
| `registry: give.header.intro` — "The fireworks, the market, the food bank…" | Names a volunteer-run institution rather than commenting on a date. **Optional** — drop only if you want zero fireworks references. |

| Drop | file:line |
|---|---|
| The entire "July 4th crowds" card | `ferry/page.tsx:321-329` |
| "…or a Fourth of July escape." | `ferry/plan/page.tsx:94` |
| "…and the whole town out for the 4th." | `registry: events.header.intro` (line 129) |

**The card replacement.** `ferry/page.tsx:321-329` is one of three cards in a `md:grid-cols-3` grid ("Watch out for" → July 4th / Hood Canal Bridge / Seasonal schedules). Deleting it outright leaves an unbalanced 2-up. Recommend **replacing** it with an evergreen card that keeps the genuinely useful warning:

> **Holiday weekends** — "Summer holiday weekends are the car ferry's worst stretch, and Kingston sits at the center of it. Expect multi-hour vehicle lines in both directions. Walk on if you possibly can."

This preserves the layout and the advice, and never goes stale.

### 3.2 Transient operational notices stay out of the default state

**The fact-check.** The seeded `ferry-info.ts` note says the automated boarding-pass dispenser "has been down" and an officer is handing passes out by hand. Checked against WSDOT on 2026-07-22:

- WSDOT's live ferry alert bulletin carries an **Edmonds/Kingston alert timestamped Mon, July 20, 2026, 3:08 PM** describing normal operation — the system is active daily 8 a.m.–8 p.m. through October 12, with ferry-bound vehicles receiving "an automated pass at a dispenser."
- **No WSDOT alert references a dispenser outage or manual distribution.**
- Officer hand-out matches the **May 2026 testing phase**, when WSDOT told drivers that on-site workers "may or may not hand you a boarding pass." It went fully automated at the June 1 go-live.

**Conclusion: there is no evidence the outage is ongoing.** Being precise about confidence — this is *absence of any outage notice plus a current alert describing normal automated operation*, not a WSDOT statement that a specific fault was repaired (their bulletins describe designed operation and may not log transient hardware faults). Treat it as "no longer supported by evidence," and drop it.

**The fix is one line — and the plumbing is already correct.** Both render sites already guard on a non-empty note:

- `ferry/page.tsx:156` — `{ferryInfo.boardingPass.currentNote.trim() && (…)}`
- `parking/page.tsx:76` — same guard
- `admin/ferry-info/editor.tsx:333` — exposes the field for editing (surfaced at the top of the editor), backed by the ferry-info overlay store.

So the banner already appears **only when someone puts text in it**, and the Chamber can add one at any time and clear it afterwards. The only defect is that the *seed* ships with an outage baked in:

| file:line | Current | Proposed |
|---|---|---|
| `ferry-info.ts:93` (`BOARDING_PASS.currentNote`) | "Current note (as of early July 2026): the automated dispenser has been down, so a uniformed traffic-control officer is handing passes out by hand at the Lindvog Road staging area instead." | `currentNote: ""` — ship empty. The Chamber types a note in the admin editor when something is actually wrong, then clears it. |

**Keep** `ferry-info.ts` `how` step 3 — "Stop at the dispenser near Lindvog Rd and take a pass **(or take one from the officer on duty)**." It carries no date and no claim of breakage, and it gracefully covers staff-assisted operation. That parenthetical is the evergreen way to say what the `currentNote` was saying badly.

**Generalize this.** Any field whose name or content implies "right now" — outage notices, temporary closures, construction alerts — should ship empty and be filled by an operator. A default-populated transient notice is guaranteed to be wrong eventually, and it's the kind of wrong that erodes trust in everything else on the page.

---

## 4. Priority fixes (do these first)

| # | Fix | Where | Why first |
|---|-----|-------|-----------|
| 1 | Empty the seeded `currentNote` — dispenser outage no longer evidenced | `ferry-info.ts:93` (§3.2) | Actively tells visitors something WSDOT's current alert contradicts |
| 2 | Site-wide meta description is 200 chars → truncated at ~155 | `layout.tsx:31` (§6b) | Highest-traffic string on the site; Google renders it |
| 3 | Kill build-state/roadmap language shown to members & visitors | portal, `syndicate`, `give`, `events`, registry (§5b) | Reads as neglected the moment it ships |
| 4 | Drop standing July-4th commentary; replace the ferry card | `ferry/page.tsx`, `ferry/plan`, registry (§3.1) | Dated commentary the planner already delivers conditionally |
| 5 | Remove hard 2026 dates from ferry & webcams guidance | `ferry/page.tsx`, `webcams/page.tsx`, `ferry-info.ts` (§5a) | Flatly wrong within a year |
| 6 | Brand: "Visit Kingston" → "Explore Kingston" (3 spots) | `about`, `stay`, registry (§7) | Inconsistent brand name |
| 7 | Trim the longest registry intros (parking is 61 words) | registry (§6a) | 62% of registry verbosity lives here |
| 8 | Strip novelty status and drifting counts | `restaurants.ts`, `parking.ts`, registry (§5b, §5c) | Self-expiring; counts silently go wrong |

---

## 5. Expiring verbiage — replacements

### 5a. Hard dates & years

| file:line | Current | Proposed | Tag |
|---|---|---|---|
| `ferry/page.tsx:343` | "…its current published schedule runs through September 12, 2026. WSF shifts to its fall schedule around then too." | "The fast ferry's Saturday service ends in mid-September, and WSF shifts to its fall schedule around then too." | EXPIRING |
| `ferry/page.tsx:234` | "Fares above are summer 2026 rates, checked July 2026 — WSF usually adjusts fares each October." | "Fares change periodically (typically each October) — always confirm before you travel." | EXPIRING |
| `ferry/page.tsx:289` | "…carries a 3% surcharge (since March 2026)" | "…carries a 3% surcharge" | EXPIRING |
| `webcams/page.tsx:41` | "since June 1, 2026, WSDOT runs a traffic management system on SR 104, with crews handing out boarding passes 8 a.m.–8 p.m." | "WSDOT runs a traffic-management system on SR 104 in season, with crews handing out boarding passes 8 a.m.–8 p.m." | EXPIRING |
| `sr104-traffic-map.tsx:200` | "Active daily 8 a.m.–8 p.m. in the peak season, on weekends and holidays, through October 12." | "Active daily 8 a.m.–8 p.m. through the peak season, plus weekends and holidays." | EXPIRING |
| `about/page.tsx:188` | "Kitsap County's next lodging-tax grant round (for 2027 funds) is expected to run October 1–30, 2026… Dates shift year to year — confirm on the Kitsap County LTAC page." | "Kitsap County runs a lodging-tax grant round each year (typically in the fall) and prioritizes unincorporated communities like Kingston — confirm dates on the Kitsap County LTAC page." | BOTH |
| `ferry-info.ts:79` (`whenRequired`) | "…daily through the season (Mother's Day through Indigenous Peoples' Day, Oct. 12, 2026), plus every Saturday and Sunday year-round…" | "…daily in season (roughly Mother's Day through mid-October), plus every Saturday and Sunday year-round…" | EXPIRING |
| `ferry-info.ts:93` (`currentNote`) | the dated dispenser note | ship empty — see §3.2 | EXPIRING |

> `ferry-info.ts:61` ("Since March 1, 2026… 3% surcharge") is RCW-cited and a "since DATE" claim — defensible to leave; review the *percentage* periodically. Founding years elsewhere (J'aime "since 2003," Point No Point "1879," Port Gamble "1850s") are correctly evergreen — **do not touch.**

### 5b. Build-state / roadmap language (the worst kind)

| file:line | Current | Proposed | Tag |
|---|---|---|---|
| `portal/page.tsx:120` | "The tools for this role arrive in a later phase — until then you can manage your own account details here." | "Your account and permissions are active. Manage your account details here anytime." | EXPIRING |
| `portal/syndicate/page.tsx:293` | title "Honest status: no auto-sync yet" · "Direct API sync to Google is on the roadmap — until then this page makes the manual update a 5-minute copy-paste round…" | title "Update these by hand" · "Copy your current hours below, then open each platform and paste — the fastest way to keep every listing matching the portal." | BOTH |
| `give/page.tsx:268` | callout "How this gets better" · "Today this is a read-only view… On the roadmap: nonprofits log in, post tentative dates… Until then, also cross-check…" | retitle "Double-check before you book" · "This is a read-only view of the town calendar — cross-check the Greater Kingston Chamber calendar too, since it may list events this page doesn't have yet." | BOTH |
| `give/page.tsx:121` (section title) | "Volunteer right now" | "Volunteer" | EXPIRING |
| `events/page.tsx:224` | "Automatic feed sync is on the roadmap — until then, always confirm details with the organizer before making the trip." | "Always confirm details with the organizer before making the trip." | EXPIRING |
| `parking/page.tsx:52` (fallback) | "Parking map coming soon." | "Parking map unavailable right now." | EXPIRING |
| `ferry/plan/ferry-planner.tsx:421` | "As we log live sailing data over the coming weeks, the estimate will sharpen." | "The estimate sharpens as we log more live sailing data." | EXPIRING |
| `webcams/page.tsx:98` | "No camera points at downtown Kingston or the marina yet — the WSDOT terminal cams above are the closest thing." | "No camera points at downtown Kingston or the marina — the WSDOT terminal cams above are the closest thing." | EXPIRING |
| `registry: give.volunteer.subtitle` | "Real shifts this summer, a couple hours each. No account needed — **v1 keeps it simple**: you contact the org, they put you to work." | "Real shifts, a couple hours each. No account needed — you contact the org, they put you to work." | BOTH |
| `restaurants.ts:471` (Kingston Coffee) | "**Kingston's newest** coffee shop, right on the downtown strip — espresso, matcha, paninis on house focaccia, and stuffed waffles." | "A coffee shop on the downtown strip — espresso, matcha, and paninis on house-made focaccia." | BOTH |
| `restaurants.ts:475` (Kingston Coffee, hours) | "Daily 9:30 am–4:30 pm (**new spot** — confirm)" | "Daily 9:30 am–4:30 pm (call to confirm)" | EXPIRING |
| `restaurants.ts:288` (Friends & Neighbors) | "…**Opened October 2025** in the old Downpour Brewing spot — ignore map apps that still say Downpour." | "Kingston's taproom — a wall of rotating taps, dogs and kids welcome, food trucks midweek." | BOTH |
| `charities.ts:57-123` (`volunteerNeeds`) | descriptions carry "…doesn't take signups **yet**" | drop "yet"; state the current path ("contact the org directly") | EXPIRING |

### 5c. Drifting counts

| file:line | Current | Proposed | Tag |
|---|---|---|---|
| `registry: webcams.header.intro` | "**Eleven** WSDOT cameras watch the Edmonds–Kingston run…" | drop the count — full rewrite in §6a | EXPIRING |
| `registry: itineraries.header.intro` | "**Four** ready-made Kingston days…" | drop the count — full rewrite in §6a | EXPIRING |
| `webcams/page.tsx:66` | "**A couple of** nearby non-WSDOT cams worth a look…" | "Nearby non-WSDOT cams worth a look…" | EXPIRING |
| `webcams/page.tsx:86` | "**Two views** on the far side of the run: the marina entrance and the Edmonds Marsh." | "A look at the far side of the run: the marina entrance and the Edmonds Marsh." | EXPIRING |
| `restaurants.ts:288` | "**18 taps**" | "a wall of rotating taps" (folded into the §5b rewrite) | EXPIRING |
| `restaurants.ts:68` / `itineraries.ts:42,117` | "**130-year-old** sourdough starter" (3 places) | "century-old sourdough starter" | EXPIRING |
| `restaurants.ts:233` / `itineraries.ts:89` | "they cap phone orders at **15 items**…" | "big groups, have your picks ready" | EXPIRING |
| `lodging.ts:35` | "**Around 30** whole homes and cabins…" | "Whole homes and cabins across Kingston, Indianola, Port Gamble, and Suquamish…" | EXPIRING |
| `parking.ts:108` | "Free, 2 hours strictly enforced (**~30 stalls**)… **$40 overstay ticket.**" | "Free, 2 hours strictly enforced — the Port says do NOT use it for ferry travel. Overstaying means a ticket." | EXPIRING |
| `parking.ts:177` | "Single row of **15 stalls**…" | "A single row along the drive NW of the yacht club." | EXPIRING |
| `parking.ts:339` | "…**73 stalls** at NE 1st St & Ohio Ave…" | "…at NE 1st St & Ohio Ave, one block from the ferry." | EXPIRING |
| `parking.ts:361` | "Free, **225 stalls**, max 24 hours…" | "Free, large lot, max 24 hours…" | EXPIRING |
| `parking.ts:374` | "Free, **210 stalls**, max 24 hours…" | "Free, max 24 hours…" | EXPIRING |
| `events.ts:117` (KYSA golf) | "**Third annual** tournament…" | "Annual tournament…" | EXPIRING |

### 5d. Seasonal / temporal words in evergreen slots

| file:line | Current | Proposed | Tag |
|---|---|---|---|
| `give/page.tsx:21` (meta) | "…volunteer shifts you can join **this summer**…" | "…volunteer shifts you can sign up for…" | EXPIRING |
| `registry: give.header.intro` | "…where help is needed **this summer**…" | "…where help is needed…" | EXPIRING |
| `registry: give.volunteer.subtitle` | "Real shifts **this summer**…" | see §5b | EXPIRING |

### 5e. Third-party landmarks & platforms

| file:line | Current | Proposed | Tag |
|---|---|---|---|
| `registry: eat.header.intro` | "…ten up the hill to **the shops by Grocery Outlet**…" | drop — full rewrite in §6a | EXPIRING |
| `eat/page.tsx:44` | "…toward Kola Kole Park, the Firehouse Theater, and **the Grocery Outlet shops**. Worth the walk." | "…toward Kola Kole Park and the Firehouse Theater. Worth the walk." (both are durable civic landmarks) | EXPIRING |
| `restaurants.ts:417` (Da Poke Shop) | "…some map apps still show its old name, **Ono Poke Too**…" | "Poke bowls a block off the main strip. Call ahead and grab it on the walk back." | BOTH |
| `restaurants.ts:259` (Nirvana) | "…delivered via **DoorDash or Uber Eats**." | "…order ahead for pickup or delivery." | BOTH |
| `itineraries.ts:171` | "…(it took over **the old Downpour Brewing spot** in fall 2025) pours 18 taps…" | "Kingston's taproom pours a wall of rotating taps and welcomes dogs and kids…" | EXPIRING |

### 5f. Perishable business facts trapped in prose

Volatile but *useful* — the durable answer is structural (§8). Interim wording:

| file:line | Current | Proposed | Tag |
|---|---|---|---|
| `restaurants.ts:291` | "…Sun 2–8 pm · **Mon closed until mid-Sept**" | "…Sun 2–8 pm · closed Mon" (set Monday hours when they resume) | EXPIRING |
| `restaurants.ts:205` (Filling Station) | "…The menu lives on their site as a PDF; call if you want food to go. **Happy hour 3–5 pm.**" | "No-frills bar and grill on the main drag. Call if you want food to go." | BOTH |
| `parking.ts` summaries (`:130,154,177,197,217,339`) | exact prices "$12/12 hr · $6 motorcycle · **$3.49/hr**", "$15", "$30", "$8" | move exact fares to a typed `rate` field (§8.2); per-vehicle-type breakdowns rot first | EXPIRING |
| `charities.ts:51` (United Way) | `contactEmail: "sjones@unitedwaykitsap.org"` | a role address (`volunteer@` / `info@`) if one exists | EXPIRING |

---

## 6. Verbosity — replacements

### 6a. Copy registry — page intros (`src/lib/site-copy-registry.ts`)

The 18 longest blocks hold 62% of the registry's words. **Edit the `fallback` strings in place** — the registry is the single source of truth, and it's what "Reset to default" restores. (`tests/unit/site-copy-registry.test.ts` enforces that wording lives *only* here — don't move copy inline.)

| key (line) | Current (words) | Proposed |
|---|---|---|
| `parking.header.intro` (195) | "Kingston's parking universe is small but full of gotchas: a paid Port lot by the marina, a commuter lot one block up, a strictly enforced free 2-hour row, a couple of genuinely unrestricted streets, and two free park & rides. The Chamber's live parking map shows where to leave the car — color-coded by type, with owner, payment, and time-limit details." (61) | "Kingston parking is small but full of gotchas — paid Port lots, a strictly enforced free 2-hour row, unrestricted streets, and free park & rides. The live map below shows each one, color-coded by type with owner, how to pay, and time limits." (42) |
| `parking.map.subtitle` (203) | "The Chamber's live parking map, built and kept current in the portal. Tap any lot for its type, owner, how to pay, and time limits. Colors are set automatically by parking type." (32) | "Tap any lot for its type, owner, how to pay, and time limits. Colors are set by parking type." (18) |
| `webcams.header.intro` (225) | "Eleven WSDOT cameras watch the Edmonds–Kingston run. They're still images, not video — most update about once a minute — but they'll tell you how long the ferry line is before you commit to getting in it." (37) | "WSDOT cameras watch the Edmonds–Kingston run — still images, not video, refreshing about once a minute. Enough to see how long the ferry line is before you get in it." (30) |
| `events.header.intro` (129) | "Markets on the marina lawn, free concerts two nights a week in high summer, and the whole town out for the 4th. Most of it is a short walk from the ferry." (32) | **(revised per §3.1)** "Markets on the marina lawn, free concerts on summer evenings, and the festivals that turn the whole town out. Most of it is a short walk from the ferry." (28) |
| `itineraries.header.intro` (151) | "Four ready-made Kingston days, built around real ferry arrivals and real local spots. Steal one whole or mix and match — everything downtown is within a few blocks of the dock." (31) | "Ready-made Kingston days built around ferry arrivals and local spots. Steal one whole or mix and match — everything downtown is a few blocks from the dock." (26) |
| `eat.header.intro` (93) | "Everything here is a walk from the ferry dock — two minutes to a crêpe, ten up the hill to the shops by Grocery Outlet. Heads up: plenty of Kingston kitchens take orders by phone, not app. That's normal here." (40) | "Everything here is a walk from the ferry dock — a couple minutes downtown, ten up the hill. Many Kingston kitchens still take orders by phone, not an app." (27) |
| `give.header.intro` (269) | "…none of it happens without neighbors raising their hands. Here's who does the work, where help is needed this summer, and a shared calendar so two good causes don't book the same day." (44) | Same, minus "this summer": "…where help is needed, and a shared calendar so two good causes don't book the same day." (41) |
| `hunt.header.intro` (315) | "…No app to download, no account to make — just heads up that posted photos go to the hunt organizers." (41) | "…No app, no account — just know that posted photos go to the hunt organizers." (34) |
| `eat.callout.body` (107) | "We verify this list against the real world, but small-town kitchens move fast. When it matters, call ahead or check the restaurant's own site. Run a food spot in Kingston?" (30) | "We keep this list current, but small-town kitchens move fast. When it matters, call ahead or check the restaurant's own site. Run a food spot in Kingston?" (26) |

**Leave as-is (on-brand, not expiring, earning their length):** `stay.header.intro` (the "gold Puget Sound" evening scene), `about.header.intro` (the ad-free ethos), `ferry.header.intro`, `map.header.intro`, `footer.tagline`, `footer.credit` (the "always confirm sailings with WSF" line is a *good* evergreen disclaimer). `ferryLine.body1` (55 words) is long but load-bearing wayfinding — trim cautiously if at all.

### 6b. SEO / social metadata

Anything past ~155 characters is truncated in search results and link previews.

| file:line | Current (chars) | Proposed (chars) | Tag |
|---|---|---|---|
| `layout.tsx:31` (site-wide) | "Ferry times, restaurants, events, parking, and itineraries for Kingston, Washington — the gateway to the Kitsap Peninsula and Olympic National Park. The interactive companion to explorekingstonwa.com." (**200**) | "Ferry times, restaurants, events, parking, and itineraries for Kingston, Washington — gateway to the Kitsap Peninsula and Olympic National Park." (**144**) | BOTH |
| `admin/ferry-info/page.tsx:27` | "Turn the ferry busyness prediction on or off and check its accuracy, pin today's boarding-pass status, and edit the ferry payment / boarding-pass / cash facts." (159) | "Toggle the ferry busyness prediction, check its accuracy, pin the boarding-pass status, and edit ferry payment and cash facts." (126) | VERBOSE |
| `parking/page.tsx:21` | "Interactive map of every place to park in Kingston, WA — the Port lots, the free 2-hour zone, street parking, and overnight options near the ferry dock." (152) | "Where to park in Kingston, WA — Port lots, the free 2-hour zone, street parking, and overnight options near the ferry dock, on one live map." (137) | VERBOSE |
| `give/page.tsx:21` | see §5d — "this summer" | "…volunteer shifts you can sign up for…" | EXPIRING |

Remaining meta descriptions (`eat`, `about`, `ferry/plan`, `map`, `itineraries`, `stay`, `hunt`, `webcams`, admin titles) are within length and on-voice — no action.

### 6c. Portal (member-facing)

| file:line | Current | Proposed | Tag |
|---|---|---|---|
| `portal/syndicate/page.tsx:220` | "These URLs always serve whatever is currently in the portal — update once here, and everything reading them follows." | "These URLs always serve your latest portal data — update once here and everything reading them follows." | VERBOSE |
| `portal/account/settings.tsx:196` | "Passwords are stored as one-way hashes, so they can never be displayed — not even by the Chamber. If you forget yours, an admin can reset it for you." | "We can't display your password — not even the Chamber can see it. Forget it? An admin can reset it for you." | VERBOSE |
| `portal/business/page.tsx:29` | "Update once, it's everywhere: your hours, menu links, and events flow straight to the food pages, the live open-now badge, the town calendar, and the feeds your own site can pull." | "Update once, and it's everywhere — your hours, menus, and events flow straight to the public pages, the open-now badge, and the town calendar." | VERBOSE |

> The "update once → everywhere" promise is **restated three times** (`business/page.tsx:29`, `business/[id]/page.tsx:38`, `business/[id]/editor.tsx:510`). Let one carry it; trim the others to plain labels.

**Leave as-is:** `join/page.tsx:13`, `setup/page.tsx:17`, the nonprofit intros, the deconfliction callouts, and empty states like "Nothing scheduled yet. Your first event is one click away." — exactly the register to keep.

### 6d. Seeded data — blurbs that restate the UI or sprawl

On `/eat` the card already shows **name, cuisine, walk-time badge, and Hours:** — blurbs repeating those are pure redundancy. On `/stay` the tag badges render under the blurb.

| file:line (record) | Current | Proposed | Tag |
|---|---|---|---|
| `restaurants.ts:68` (Sourdough Willy's) | "Pizza raised on a 130-year-old sourdough starter — crust with real tang, two minutes from the dock. Order online and it's boxed when you land." | "Pizza raised on a century-old sourdough starter — real tang in the crust. Order online and it's boxed when you land." | BOTH |
| `restaurants.ts:392` (Argensol) | "Argentinian cooking just off the main strip on Washington Boulevard, on a four-day week — every day closes at a different time, so glance at the hours before you make the walk." | "Argentinian cooking just off the main strip on Washington Boulevard. Days and closing times vary — check the hours before you walk over." | BOTH |
| `restaurants.ts:180` (Cellar Cat) | "A 21+ wine bar and jazz club in the middle of the strip — piano bar Fridays, live music Saturdays and Sunday evenings." | "A 21+ spot in the middle of the strip — piano and live jazz on the weekend." | BOTH |
| `restaurants.ts:154/342/367/313` | each blurb repeats the cuisine label beside it (Los Tres also carries a mild "the-only" claim) | drop the category noun, keep the specific detail | VERBOSE |
| `lodging.ts:17` (Point Casino) | "…the closest full-service hotel rooms to downtown Kingston. Restaurants on site; the gaming floor is 21+…" | "The Port Gamble S'Klallam Tribe's hotel, about a 10-minute drive north of the ferry — a comfortable base for the north end of the peninsula, with dining on site (gaming floor 21+)." | BOTH |
| `lodging.ts:26` (Clearwater) | "…Resort-style rooms and several restaurants, with the Agate Pass bridge to Bainbridge Island right next door." | "The Suquamish Tribe's resort on Agate Passage — resort rooms and dining, with the Agate Pass bridge to Bainbridge right next door." | VERBOSE |
| `lodging.ts:44` (Kitsap Memorial SP) | "…Fall asleep to saltwater on one side and tall firs on the other, then be back in Kingston in time for breakfast. Summer weekends book out early…" | "State-park camping on Hood Canal, about a 15-minute drive west — saltwater on one side, tall firs on the other. Summer weekends book out early; reserve through Washington State Parks." | VERBOSE |
| `events.ts:24` (4th of July Car Show) | "Cars, trucks, motorcycles and more — classic, modern, and everything in between on wheels, right in the middle of town. Free to wander, and a good warm-up before the fireworks." | "Classic and modern cars, trucks, and motorcycles right in the middle of town. Free to wander — a good warm-up before the fireworks." (record itself stays — §3.1) | VERBOSE |
| `events.ts:170` (Pie in the Park) | "Free slices of pie for everyone, plus pie-eating contests, face painting, and lawn games for the kids. A free annual community fundraiser for the Village Green Foundation, the volunteer-run nonprofit that keeps the Village Green affordable and thriving." | "Free pie for everyone, plus pie-eating contests, face painting, and lawn games. An annual fundraiser for the Village Green Foundation, the volunteers who keep the Green going." | VERBOSE |

### 6e. Public page bodies

| file:line | Current | Proposed | Tag |
|---|---|---|---|
| `ferry/page.tsx:321-329` | the "July 4th crowds" card | replace with the evergreen "Holiday weekends" card — §3.1 | EXPIRING |
| `ferry/plan/page.tsx:94` | "…how the crowds rise and fall across the day. Great for planning a summer weekend or a Fourth of July escape." | drop the second sentence: "…how crowds rise and fall across the day." | BOTH |
| `about/page.tsx:36` | "Here's the fair catch: any group that receives those dollars must report real visitor numbers to the state legislature's auditors, JLARC — how many people came, how many traveled 50+ miles, how many stayed overnight in paid lodging." | "Any group that receives those dollars must report real visitor numbers to the state's auditors (JLARC): how many came, how many traveled 50+ miles, how many stayed overnight in paid lodging." | VERBOSE |
| `parking/page.tsx:58` | "Chamber admins keep this map current in the portal at /admin/maps." | "The Chamber keeps this map current." (drop the internal path) | VERBOSE |
| `parking/page.tsx:68` | "People mix these up all the time." | delete — start at "If you're driving onto the boat…" | VERBOSE |
| `page.tsx:157` (home) | "Pick any date and time for a busyness estimate, when to arrive, and a trendline for the whole day." | "Pick any date and time for a busyness estimate, when to arrive, and a full-day trendline." (low priority) | VERBOSE |

---

## 7. Brand consistency — "Visit Kingston" → "Explore Kingston"

The public brand is **Explore Kingston** everywhere (nav, footer, `<title>`, home hero, event feeds). Three visitor-facing strings slip to "Visit Kingston" — likely leaked from the repo name `visit-kingston`.

| file:line | Current | Proposed |
|---|---|---|
| `about/page.tsx:11` (meta) | "Visit Kingston is a free, ad-free community project…" | "Explore Kingston is a free, ad-free community project…" |
| `stay/page.tsx:117` | "…and Visit Kingston earns nothing if you book." | "…and Explore Kingston earns nothing if you book." |
| `registry: about.header.title` (line 329) | "About Visit Kingston" | "About Explore Kingston" |

---

## 8. Structural recommendations (the durable fix)

Wording fixes stop the bleeding; these stop it recurring. Move load-bearing perishable facts out of hand-written prose into typed, admin-editable fields with a `lastVerified` date.

1. **Restaurant hours.** Every `restaurants.ts` record carries a free-text `hours:` string duplicating the structured `weeklyHours`, and it already drifts ("closed until mid-Sept," "new spot — confirm"). Derive the display string from `weeklyHours` + a structured `holidayNote`, or drop the free-text field.
2. **Parking prices, ticket amounts, stall counts.** Move every fare, the `$40`/`$139.99` figures, and all stall counts into typed fields (`rate`, `stallCount?`) with a `lastVerified` date. The file header already says "re-verify quarterly" — make that mechanical, not a prose promise.
3. **Delete the dead `parkingAreas` block** (`parking.ts:547-624`). Grep-verified against `docs/SDD.md`: nothing consumes it. It's a second, *diverging* copy of every price — a maintenance trap.
4. **Events → live ingest.** All of `events.ts` is a hand-maintained summer-2026 snapshot; the file header already names the roadmap (Chamber GrowthZone iCal + Port API). Landing that ingest retires "through August 26," "Third annual," and the dated 4th-of-July records wholesale.
5. **Volunteer shifts + fill counts.** `charities.ts:57-123` holds dated shifts with drifting `slotsFilled`/`slotsTotal` — these want a real signup backend, not seed data.
6. **Transient notices ship empty.** ✅ *The plumbing is already correct* — see §3.2. `currentNote` renders only when non-empty and is admin-editable; the only fix is emptying the seed. **Apply the same rule to any future "right now" field** (temporary closures, construction alerts): default empty, operator fills, operator clears.
7. **Contacts → role addresses.** Replace named-individual emails (`charities.ts:51`) with role-based addresses in a structured contact field.
8. **"Recently opened" as a dated flag, not a word.** Novelty is a timestamp. If a "new" badge is wanted, make it a dated boolean the UI auto-expires — never the word "newest" in prose.
9. **Time-bound advice belongs in conditional code, not standing copy.** `ferry-forecast.ts` is the model (§3.1): the July-4th warning fires as a "why" chip on the day it matters. Prefer this over prose that must be remembered and removed.

---

## 9. What's already right (don't undo it)

- **`webcams.ts`** — the camera *count* lives in the array, never in prose, so adding or removing a feed breaks no sentence. Location labels are evergreen and voicey ("The money shot: how full is the Edmonds lot?").
- **`hunts.ts`** — clues, hints, and fun-facts are rich creative writing with no perishable facts baked in.
- **`map-features.ts` / `map-views.ts` / `ferry-fallback.ts`** — tight, durable notes; "(May–Oct)" and "(1879)" are the *evergreen* kind of date.
- **`ferry-forecast.ts`** — conditional, date-aware advice. The pattern the rest of the site should borrow (§3.1, §8.9).
- **The copy-registry mechanism** — one source of truth, a contract test forbidding inline fallbacks, admin-editable overrides, and empty-guarded transient fields. Keep editing copy *there*; don't scatter it back inline.

---

## 10. Follow-up audit — the E14 / legal / accessibility pages (2026-07-22)

Revision 4 flagged six pages added on `main` as unaudited: `/simple`, `/es`, `/accessibility`, `/privacy`, `/print`, `/offline`. All six were read in full, plus the bilingual safety dictionary that feeds `/simple` and `/es`.

**Result: clean. No copy edits warranted.** These are the disciplined surfaces — E14 plain-language, the bilingual safety slice, and the legal/commitment pages — and their authors already applied the §2 rules. An objective grep for every expiring pattern (`this summer`, hard counts, `v1`, `coming soon`, …) across all six pages and the dictionary returned **zero hits**.

Why each is already right — and must stay that way:

- **`/simple` + `/es`** — copy comes from the registry (`simple.*` / `es.*`, already plain and evergreen) and from **`src/lib/i18n/safety-content.ts`**, a typed EN+ES dictionary. That dictionary is a *model*: fares and the phone are `{tokens}` (never literals), it deliberately refuses to bake in a last-boat time ("it changes with the season and with repairs"), agency numbers are sourced literals, and it is guarded by a **parity test** plus a **bilingual review gate** (`/es` ships dark until a human reviews it). Editing it — especially the Spanish — would break parity and isn't a call to make unilaterally.
- **`/print` + `/offline`** — registry copy, sourced agency phone numbers, and dynamic "As of {time}" honesty stamps that are *deliberately not* editable copy. Nothing to cut.
- **`/privacy`** — a legal page, code-owned, with retention windows / version / changelog driven by the policy manifest (`src/lib/privacy/policy.ts`) that the purge job enforces. Its date-like content is legal commitment, not stale prose.
- **`/accessibility`** — a public conformance commitment. Its "actively improving / coming next" language and its dates (`accessibility.ada.deadline`, `accessibility.lastReviewed`) are **mandatory honesty for the genre**, not neglect-signal build-state. An accessibility statement that hides what it doesn't do yet is *worse*, and a "last reviewed" date is required. Do not cut.

### Comment-only changes that shipped (no visitor-facing text touched)
- `src/lib/data/ferry-info.ts` header — trimmed a stale "As of July 1–2, 2026 the dispenser was down" line left over after PR #90 emptied `currentNote`; now documents why the field ships empty.
- `accessibility/statement.tsx` + `accessibility/page.tsx` — the two comments (flag #3 below) claimed the ADA date is "deliberately absent"; the statement now renders it, so the comments were corrected to describe how the date is sourced (a registry block) and kept current. The `docs/OPERATIONS.md` §9 item-15 verification gate is treated as closed, consistent with what the code already renders.

### Flagged for the Chamber / team (deliberately NOT changed — legal territory)
1. **`/privacy:146` — "The app _is becoming_ the … membership records system."** Transitional/build-state phrasing inside a legal data-handling claim. If it *is* now the system of record, "is" is both tighter and more accurate — but that's a legal-accuracy call for the Chamber, not a unilateral copy edit.
2. **`/privacy:146` — "Greater Kingston _Community_ Chamber of Commerce."** This is the **only** occurrence of "Community" in the name; the brand appears as "Greater Kingston Chamber of Commerce" 11× elsewhere. Either this legal page uses the correct full registered name (and the others are informal) or it's a typo. The Chamber should confirm which is the legal entity name and align the rest.
3. **Stale ADA-date comments — ✅ fixed in this pass.** `accessibility/statement.tsx` and `accessibility/page.tsx` said the ADA compliance date was "deliberately absent," but the statement renders it ("April 26, 2028", via `accessibility.ada.deadline`). Comments corrected to match; no visitor copy changed.

---

## Appendix — verification notes

- All `file:line` anchors were re-checked against the working tree on **2026-07-22**, branch `docs-cutover-reality`. Where a line number points at an enclosing element (e.g. `give/page.tsx:268` is the `<Callout>` tag; `parking.ts:108` is the `summary:` key), the quoted string is on the following line(s).
- Character counts in §6b were measured, not estimated (`layout.tsx` description: 200 → 144).
- Dispenser status (§3.2) was checked against WSDOT's live ferry alert bulletin and WSDOT/press coverage of the June 1, 2026 go-live. Sources: [WSDOT ferry alerts bulletin](https://wsdot.com/ferries/schedule/bulletin.aspx) · [WSDOT Blog — the new SR 104 traffic management system](https://wsdotblog.blogspot.com/2026/04/smoother-sailing-in-kingston-new-sr-104.html) · [Kitsap Daily News — testing begins at Kingston terminal](https://www.kitsapdailynews.com/2026/05/01/testing-for-vehicle-boarding-process-to-begin-at-kingston-terminal/)
- Method: a full read of the copy registry plus three parallel readers over (a) public pages and shared components, (b) the seeded data files, and (c) SEO metadata, portal, and admin. Re-grep before applying if the tree has moved.
