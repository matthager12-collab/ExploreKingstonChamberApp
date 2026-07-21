# Accessibility

How Explore Kingston stays usable for everyone: the standard we hold, the plain-language
rules the copy follows, what the machine checks, what only a person can check, and the
policy for anything we cannot fix yet.

Owner: whoever is on the code. Cadence: the manual audit is quarterly (§3); the public
statement at `/accessibility` is reviewed at least once a year (docs/OPERATIONS.md,
"Accessibility & language").

---

## 1. WCAG posture — what we claim, and what we only try for

| | Standard | Status |
|---|---|---|
| **The gate** | WCAG 2.1 AA | What we build to and what the public statement claims. This is the ADA Title II rule baseline — DOJ's deadline for the tier Kingston sits in (public entities under 50,000 people, and special district governments) is **April 26, 2028**, verified against [ada.gov](https://www.ada.gov/resources/2024-03-08-web-rule/) on 2026-07-21. The Chamber is a private nonprofit, so this is a voluntary target, not a legal obligation on the site. Re-verify at every annual review: DOJ extended this date a year (from April 26, 2027) effective 2026-04-20, so pre-2026 sources are stale. |
| **Best effort** | WCAG 2.2 — Target Size (Minimum), Focus Not Obscured | Applied on everything new (44px targets on the new pages, a visible focus ring that is never covered), but **not** gate-blocking and **not** claimed publicly. |
| **Out of scope** | WCAG 2.2 AAA, anything requiring a paid third-party audit | Commissioning an external audit is an operator/LTAC decision, recorded in the statement when it happens. |

Two consequences worth stating plainly:

- **Automated scanners catch roughly 30–40% of WCAG issues.** A green pipeline is a floor,
  never a pass. The remaining 60% is what §3 is for.
- **We fix at usage sites, not in the palette.** `src/app/globals.css`'s `--color-*` tokens
  are Chamber-approved brand values. A contrast failure is fixed with a darker text token,
  a larger size, or a solid background — never by repainting the brand. Changing a token
  value is an ask-first with before/after ratios.

---

## 2. Plain-language style guide (NFR-04)

The audience floor is real people this app was built for: a visitor in their late seventies
who never downloaded an app, a fixed-income visitor on an eight-year-old Android, and a
visitor whose English is their third language. The rules below are what "grade 6–9" means
in practice.

**Sentences**

1. **One idea per sentence.** If it has a "and then" or a "but", it is probably two sentences.
2. **Aim for 15–20 words.** Anything over 25 in a decision-critical instruction is a rewrite.
3. **Put the instruction in its own sentence**, never in a trailing clause after an em dash.
   "Board at the Edmonds dock." is a sentence. "…and walk-ons are always welcome — board at
   the Edmonds dock." buries it.
4. **Active voice for anything with a consequence.** "The county can tow it", not "it can be
   impounded".
5. **No double negatives.** "The rules do not say you can, and they do not say you cannot"
   is the honest version of "never explicitly forbids but never explicitly allows".

**Words**

6. **No unexplained abbreviations.** Expand on first use: "WSDOT, the state transportation
   department". "Washington State Ferries", not "WSF", the first time.
7. **No ferry-industry jargon.** Not "sailings" (boat times), not "this run" (this route),
   not "tally" (boarding pass), not "void" (stops working), not "dispenser" (machine).
8. **No idioms or metaphors.** "Full of gotchas" and "parking universe" do not survive a
   translation or a reader with limited English.
9. **Gloss legal codes, don't lead with them.** State the rule in plain words first, then
   "(The law is Washington state code RCW 46.55.085.)" in its own parenthetical.

**Numbers and time**

10. **Every clock time carries am/pm.** House style is lowercase, no periods: `8 am`,
    `6:45 pm`.
11. **Ranges use "to", not a dash**, in instructions: "8 am to 8 pm". A dash between two
    times misreads at small sizes on an old phone.
12. **Never promise a "last boat".** Times move with the season, the weather, and repairs.
    Say to confirm with Washington State Ferries, and give the number.

**Where the copy lives**

- Public headline prose is a block in `src/lib/site-copy-registry.ts` with a hardcoded
  fallback, so the Chamber can edit it without a deploy. Fallback edits are safe; key
  renames are not.
- Safety-critical bilingual copy is `src/lib/i18n/safety-content.ts` (§5).

---

## 3. The quarterly manual audit

Book an hour. Do it on a phone, not a laptop, for at least half of it. Record the date and
what you found in the PR or issue that carries the fixes.

**Pages in scope (every quarter):** `/`, `/ferry`, `/eat`, `/simple`. Add `/es` once it is
public, and rotate one admin or portal page in each time.

### 3.1 Screen-reader pass — VoiceOver (iOS/macOS) or NVDA (Windows)

- [ ] Reach the main content with the skip link as the very first Tab stop.
- [ ] Read the page by headings only. The order makes sense; there is exactly one `<h1>`;
      no level is skipped.
- [ ] Every link's name says where it goes out of context ("Ferry", never "click here",
      never "⛴ Ferry" — icon glyphs must be `aria-hidden`).
- [ ] Every form control announces a label, and announces "required" where it is.
- [ ] Errors are announced when they appear, and land on the field they describe.
- [ ] Saving something announces the result — success as well as failure.
- [ ] Spanish content reads in a Spanish voice (the `lang="es"` wrapper is doing its job),
      and switches back for the "In English" link.

### 3.2 Keyboard-only walk

- [ ] Unplug the mouse. Reach every interactive control with Tab/Shift-Tab.
- [ ] The focus ring is always visible and never hidden behind the sticky nav or the mobile
      bottom bar.
- [ ] Escape closes the desktop "More" menu and the mobile sheet, and focus returns to the
      trigger that opened it.
- [ ] Focus order matches visual order.
- [ ] Nothing traps focus.

### 3.3 Zoom and text scaling

- [ ] Browser zoom to 200%: no horizontal scrolling, nothing clipped, nothing overlapping.
- [ ] Phone text size to its largest setting: layout holds. (Every size is rem, so it should
      — an arbitrary px font size is a regression the test suite blocks.)
- [ ] Pinch-zoom works. `user-scalable=no` / `maximum-scale` must never appear.
- [ ] Turn on "Easy read" (simple mode) and repeat the two checks above.

### 3.4 Colour-alone check (M-14-04 / NFR-94)

- [ ] Screenshot the page and view it in greyscale. Every status still readable?
- [ ] Every status dot, chip, and swatch has text beside it; the decorative half is
      `aria-hidden`. The reference pattern is `src/components/open-badge.tsx`.
- [ ] The current nav item is marked with `aria-current="page"` and something other than
      colour.
- [ ] Selected filters/toggles expose `aria-pressed`.

### 3.5 Non-app fallbacks (M-18-07 / FR-47)

- [ ] `/print` prints on one sheet with no site chrome, and carries today's boats, the
      "As of" stamp, and at least two dialable numbers.
- [ ] The Chamber phone number is on every page, in the footer, as text and as a `tel:`.

---

## 4. Automated checks

**Today.** `npm run test:server` boots the standalone production build and runs
`tests/server/axe-smoke.test.ts` — axe against a sample of pages, serious/critical only,
failing on any rule id not in `tests/server/axe-baseline.json`. The baseline shrinks only:
a new violation is a fix, never a new baseline entry. Regenerate with
`AXE_UPDATE_BASELINE=1` and expect to justify it.

Static invariants run in `npm test` (`tests/unit/a11y-static-invariants.test.ts`): no
arbitrary px font sizes outside the frozen zones, no zoom blocking, no `next/headers` in the
root layout, skip link present, and the frozen-map contrast override still wired to its
markup. `tests/server/keyboard-focus.test.ts` drives a real browser for the skip link, so a
CSS regression that keeps the markup but breaks the mechanism fails CI.

**Known gap in the smoke, on purpose.** After the `--color-ink-soft` sweep below, all seven
`color-contrast` entries in `axe-baseline.json` report *"no longer firing"* — the routes are
clean, but the entries are still there. They were deliberately **not** pruned in that change:
pruning ratchets those seven routes to zero tolerance, and the sweep was verified against one
render of data that varies (ferry live/scheduled, event counts, empty states), so a
conditional block could fire overnight with nobody awake to triage it. Until then the smoke
does **not** guard `color-contrast` on `/`, `/ferry`, `/eat`, `/events`, `/stay`, `/about` or
`/admin/worklist`. The three pages E14 added — `/simple`, `/print`, `/accessibility` — are
baselined **empty**, i.e. zero tolerance from the day they landed. Prune the rest when the
hard gate below lands and replaces this file.

**Planned — the hard gate.** Extending that to every route, at every severity, with a
manifest-completeness test so a new page cannot be added without being scanned. It is
deliberately not shipped yet: it lands after the in-flight PWA work merges, so it does not
tax an epic whose own scope never mentioned it. `/accessibility` describes this honestly as
planned, not shipped — keep it that way until it is true.

### Exclusions policy (for the future gate)

There is exactly one escape hatch and it is typed. Every entry needs:

1. **A justification in the entry itself.** An empty justification fails the schema test.
2. **A reason that is structural, not "we ran out of time."** The only accepted class today
   is the frozen zone: `src/components/feature-map.tsx` and the two map editors are in
   `.agent-frozen`, so "fix it in the component" is not an available move.
3. **A page-level text alternative that carries the same facts**, named in the exclusion and
   linked from `/accessibility`. Excluding the map canvas is only acceptable because
   "Every lot, in words" exists on `/parking` and the listings pages carry the same places.
4. **Disclosure in the public statement.** If a visitor cannot use it, we say so.

Never permitted: a blanket `axe.disableRules`, dropping a scan tag, removing a route from
the manifest, or excluding a route to make a build green.

### The `--color-ink-soft` sweep, and why it is written down

The muted body grey `--color-ink-soft` (`#6b7683`) measures **4.4993:1** on the page fill
`--color-shell` — under the AA 1.4.3 floor of 4.5:1 by a rounding error, and worse on the
tinted panels (4.22:1 on the callout fill, 4.21:1 on the survey panel, **3.73:1** for the
`text-ink-soft/90` variant on the home feature cards). The site's background texture made
axe report those nodes as *incomplete* rather than *failing*, which is why they survived
this long.

They were measured by running axe with the contrast rule alone over every public route with
`body,.bg-topo{background-image:none}` injected, then repaired **at each usage site** — the
token's value is unchanged, per the E14 rule. Two consequences worth remembering:

- **`text-ink-soft` on a white card passes (4.62:1); on the page background it does not.**
  Before reaching for it on a new page, ask what is behind the text.
- **One set of nodes could not be fixed at its source.** The map legend and the map's two
  loading overlays live in `src/components/feature-map.tsx`, which is frozen, so
  `src/app/globals.css` overrides the rendered elements by their utility classes.
  `tests/unit/a11y-static-invariants.test.ts` asserts the selector and the component's
  markup still match. **If that file is ever unfrozen, fix the classes there and delete the
  override.**

Re-run the measurement (not just the smoke) after any change to the page fill, the texture,
or the muted-text token.

---

## 5. The EN+ES safety slice

`src/lib/i18n/safety-content.ts` is a typed dictionary, `{ en, es }`, covering walking on
versus driving on, getting back to Edmonds, paying for parking, restrooms, and who to call.
Both halves render through `src/components/safety-essentials.tsx` — English on `/simple`,
Spanish on `/es` — so the two pages cannot drift apart.

Rules:

- **Hand-authored only.** No machine translation, no translation widget (Google Translate,
  Weglot, ConveyThis), no i18n framework. A typed object is the entire mechanism; the full
  multilingual pipeline is separately funded later work.
- **Neutral Latin-American Spanish**, held to the same §2 bar as the English.
- **Parity is enforced** by `tests/unit/safety-content-parity.test.ts`: identical section
  sets, identical step counts, notes present in both or neither, nothing empty.
- **`/es` ships dark.** It is in `DEFAULT_HIDDEN_PAGES`, so absence of a site-pages record
  means hidden. Unhiding is an operator action after a bilingual human review — procedure in
  docs/OPERATIONS.md, "Accessibility & language".
- **Every Spanish text node sits inside `lang="es"`** (WCAG 3.1.2), and the English
  cross-link label carries its own `lang="en"`.
