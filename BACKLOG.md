# Backlog — deliberately deferred capabilities

Things the requirements asked for that are **knowingly not built yet**, each with
a priority and a concrete trigger for revisiting it.

The rule this file exists to enforce (decisions doc §amendment): **no capability
is silently absent.** If a requirement was scoped out, it is written down here
with the reason — so "we decided not to yet" never decays into "nobody noticed."

Format: one section per deferred item — what it is, why it is deferred, what
would make us pick it up, and what ships in the meantime.

---

## Verified access-facts data-gathering programme (M-14-05, non-app half)

**Priority:** P1
**Deferred:** 2026-07-21 (E27)
**Owner when picked up:** Chamber, with app support

### What is deferred

The *programme* that produces verified accessibility facts at scale: who
physically visits venues, how a fact gets confirmed, how often it is re-checked,
and what volunteer or partner arrangement sustains it. That is an operational
commitment, not code.

### What ships instead (E27)

The whole app-side half is live:

- Typed access fields on the restaurant and lodging schemas — step-free
  entrance, accessible restroom, accessible parking (Yes / No / Partly / Not
  checked), notes, verified-on date, and source. Editable in the listings
  workbench.
- A read-only display block that shows only what someone actually recorded, with
  honest freshness ("Checked <date>" vs "Not verified in person yet — call
  ahead").
- A report-inaccuracy hand-off into E08's existing moderation queue.

So the moment a fact is verified, there is somewhere to put it and it renders
correctly. **The container exists; it is mostly empty.**

### Why defer

The app cannot generate these facts. Someone has to stand at a door and look.
Building intake before anyone has committed to the fieldwork would produce a
page full of "Not checked" — which is honest, but is not the capability the
requirement asked for. The honest interim posture is: assert nothing, and say
plainly that nothing has been verified.

### Revisit when either of these happens

1. **A volunteer or partner commits to a venue-audit cadence** — even a dozen
   venues a quarter beats zero, and downtown Kingston is small enough that one
   determined afternoon covers the walk-off cluster.
2. **E08's report queue accumulates enough inaccuracy reports to seed a first
   pass** — visitor reports are themselves a fieldwork signal, and the venues
   people complain about are exactly the ones worth checking first.

A third, weaker trigger: the ADA compliance date tracked in
`docs/ACCESSIBILITY.md` drawing attention to accessibility data generally.

### Related

- `docs/OPERATIONS.md` §14.4 — how to edit access facts today.
- `src/lib/schemas/access.ts` — the field definitions and honesty rules.
- M-04-03 (step-free / pace-aware routing) is a **separate, larger** capability
  and is not implied by this one. Access facts here are static per-place
  attributes, not a routing engine.

---

## Public drinking-water locations (M-04-02, data half)

**Priority:** P2 (trivial effort, blocked only on knowledge)
**Deferred:** 2026-07-21 (E27)

### What is deferred

Actual drinking-water pins on the amenities map. **No code work remains** — the
`water` category, the map layer, the finder, and the admin editor all support it
today. What is missing is a single sourced location.

### Why

No published source places a fountain or potable-water spigot anywhere in
Kingston. Rather than guess plausible spots (a marina, a park), nothing was
seeded, and the finder tells visitors so in plain language. Sending a thirsty
visitor to a fountain that does not exist is a real harm and an M-19-03 accuracy
failure.

### Revisit when

Anyone at the Chamber, the Port, or the city can name one — it is a two-minute
add at `/admin/maps` with no deploy. See `docs/OPERATIONS.md` §14.2.
