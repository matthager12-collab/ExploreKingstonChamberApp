# Domain schemas (E07)

Every editable content domain has exactly **one** zod schema in
`src/lib/schemas/`, consumed by all three validation surfaces:

| surface | file | how |
| --- | --- | --- |
| Admin API | `src/app/api/admin/content-records/route.ts` | `POST` runs `<domain>Schema.safeParse(record)`; failures 400 with `firstZodMessage` |
| Admin editors | `src/components/admin/record-editor.tsx` (engine), `src/app/admin/itineraries/editor.tsx` (bespoke stops UI) | `buildRecord` coerces the form draft, then parses with the **same schema object** |
| Portal self-edit | `src/app/api/portal/listing/route.ts` | field rules imported from the schemas; the merged record gets a belt-and-braces `restaurantSchema.safeParse` before save |

Before E07 the server sanitizers and the client `buildRecord`s were hand-synced
copies, and they had already drifted once (the client never learned the numeric
ranges). Now there is nothing to sync.

## The pattern — how a domain is built

Each domain module (`restaurant.ts`, `lodging.ts`, `webcam.ts`, `itinerary.ts`)
exports:

1. **`<domain>Schema`** — a `z.object` in default *strip* mode (unknown keys are
   dropped, not rejected — parity with the old "rebuilt from known fields"
   sanitizers). Every rule carries an explicit, plain-English message; raw zod
   phrasing like "Invalid input" must never reach an operator.
2. **`<domain>Fields: FieldDef[]`** — the admin form's field list (label, kind,
   help text, placeholders). Itineraries have none: their nested-stops UI is
   bespoke and only shares the schema.
3. **Pure helpers for IO-bound rules** — anything that needs a store read stays
   *out* of zod as a pure function the route calls (e.g.
   `findItinerarySlugClash(existing, record)`); the route supplies the store
   read, the helper stays unit-testable.

`shared.ts` holds the building blocks, and they encode the **coercion parity
contract** with the old sanitizers:

- numeric strings convert (`"2"` → priceLevel `2`); `roundedInt` rounds like the
  old `Math.round(num(v))`, `numberInRange` keeps decimals (lat/lng);
- text trims; empty optional fields parse to `undefined` so the key is **absent
  after `JSON.stringify`**, never stored as `""`;
- `tagsSchema` coerces a non-array to `[]` instead of erroring (old `strArray`
  behavior — only reachable via direct API calls);
- restaurant `hidden`: only `true` survives; `false`/absent → key omitted.

`type-parity.ts` asserts mutual assignability between each `z.infer<…>` and its
interface in `src/lib/types.ts` — `src/lib/types.ts` stays the type source the
app imports, and schema/type drift is a `tsc --noEmit` failure. The bar is
mutual assignability, not identical optionality tokens; if an assertion won't
line up, the schema is wrong, not the interface.

`index.ts` exports `DOMAIN_SCHEMAS` keyed by the API's domain names
(`restaurants | lodging | webcams | itineraries`) plus re-exports of everything.

## Adding a domain (E08 moderated UGC, E12 events, E17 imports)

1. Create `src/lib/schemas/<domain>.ts`: the zod schema (messages included),
   the `FieldDef[]` if it runs on the shared editor engine, and pure helpers
   for any rule that needs IO.
2. Add a parity assertion in `type-parity.ts` against the interface in
   `src/lib/types.ts`.
3. Register it in `DOMAIN_SCHEMAS` in `index.ts` (and the API route's domain
   union, if it's served by `content-records`).
4. Write the test suite: valid fixture, every message verbatim, the coercion
   matrix, and — if the domain has git-committed seeds — extend
   `seeds.test.ts` so every seed record parses **and round-trips
   byte-identically** (parsing a canonical record must be a no-op).
5. Schemas validate the domain *document* only. Record metadata (`status`,
   `source`, `updated_by`, …) belongs to the Drizzle layer (E05), and
   status-gated rendering belongs to E08 — don't duplicate either here.

## The copy-registry contract (E07)

The same drift problem existed for site copy, and got the same fix:
`src/lib/site-copy-registry.ts` is the **only** home of default wording.

- Call sites pass keys only: `copyText(overrides, key)` (server),
  `useCopy(key)` / `<EditableText copyKey … />` (client). No inline fallbacks
  anywhere — the resolvers read `copyFallback(key)` from the registry.
- `CopyKey` is the literal union of registered keys, so a typo at a call site
  is a `tsc` error before it is anything else.
- `tests/unit/site-copy-registry.test.ts` enforces the bijection: every
  call-site key exists in the registry, every registry block is referenced by
  at least one call site (`ALLOW_UNREFERENCED` is the explicit exception
  list, empty today), no call site carries an inline fallback, keys are
  unique, fallbacks non-empty.
- Consequence for operators: the "default" shown in `/admin/content` and the
  "Reset to default" button are truthful by construction — they can no longer
  drift from what the site renders.

Adding a copy block: add it to `COPY_BLOCKS` *and* reference it from a call
site in the same change; the test fails the build if either half is missing.

## Deliberate behavior changes (E07)

Two, both documented in the E07 PR:

1. **Client forms now enforce the server's numeric ranges** (lat/lng bounds,
   walk minutes 0–120, refreshSeconds 15–3600, priceLevel 1|2|3). Before, the
   client only checked `Number.isFinite` and the operator learned about ranges
   from the server round-trip. Strictly better feedback; the rules themselves
   are unchanged.
2. **Invalid optional URLs are a 400 with a friendly message** (e.g. lodging
   `website: "foo"` → `website must be an http(s) URL`). The old sanitizers
   silently dropped invalid optional URLs, which lost operator input without
   telling anyone.

## Wiring the importer (done 2026-07-19)

E05's importer (`scripts/import-core.ts`) validates through `validateRecord` /
`STORE_SCHEMAS` in `src/lib/db/store-schemas.ts`. E07 deliberately did **not**
register the strict domain schemas there, because `STORE_SCHEMAS` also gates
the runtime write choke point used by backup **restore** — strict rules could
have quarantined legitimate pre-E07 production records.

The documented gate ran 2026-07-19 and reported clean, so the four entries now
point at `DOMAIN_SCHEMAS`:

- `scripts/verify-bundle-domains.ts` (the gate, reusable) validated every
  four-domain record in the git seeds and in **three** production bundles —
  2026-07-10, cutover bundle A (2026-07-11), and a fresh post-cutover v2
  bundle pulled 2026-07-19 — against the strict schemas.
- Production held **zero** four-domain records outside the git seeds (no
  overlay files pre-cutover, no `db.records` rows post-cutover), and all 37
  seeds parse and round-trip (`seeds.test.ts` enforces this in CI).

Before tightening any *other* store's entry, re-run the same gate against a
freshly pulled bundle:

```bash
npx tsx scripts/verify-bundle-domains.ts --seeds --self-test <bundle.json>
```

E17's importer inherits the strict validation automatically — anything it
feeds through the choke point for these four domains is now held to the same
rules as an admin edit.
