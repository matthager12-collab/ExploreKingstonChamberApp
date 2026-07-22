// The site-wide editable-copy registry — the ONLY home of default copy (E07).
//
// Each CopyBlock names one piece of headline text on a public page. The
// `fallback` is the default the site renders when no admin override exists:
// call sites resolve copyText(overrides, key) / useCopy(key) /
// <EditableText copyKey … /> and the wording comes from here via
// copyFallback(key) — never from an inline string at the call site, so the
// admin UI's "default" and "Reset to default" are truthful by construction.
// tests/unit/site-copy-registry.test.ts enforces the contract both ways:
// every call-site key exists here, every block is referenced by some call
// site (or sits in the test's explicit allowlist), and no call site carries
// an inline fallback. Overrides live in the "site-copy" overlay store
// (src/lib/stores/site-store.ts); this file is pure data and safe to import
// anywhere, client components included.
//
// Key naming: "<page>.<block>", e.g. "eat.header.intro".

export interface CopyBlock {
  key: string;
  /** Group heading in the admin editor — a page name or a component name. */
  page: string;
  label: string;
  multiline?: boolean;
  /** Block supports **bold** and [links](url), rendered via <RichText/>. */
  rich?: boolean;
  fallback: string;
}

export const COPY_BLOCKS = [
  // ------------------------------------------------------------- Home (/)
  {
    key: "home.hero.eyebrow",
    page: "Home",
    label: "Hero eyebrow",
    fallback: "Gateway to the Peninsula",
  },
  {
    key: "home.hero.title1",
    page: "Home",
    label: "Hero headline, line 1",
    fallback: "Discover",
  },
  {
    key: "home.hero.intro",
    page: "Home",
    label: "Hero intro paragraph",
    multiline: true,
    fallback:
      "Ferry times, food worth walking to, and everything happening in our little town.",
  },

  // ------------------------------------------------------------- /ferry
  {
    key: "ferry.header.eyebrow",
    page: "Ferry",
    label: "Header eyebrow",
    fallback: "Getting here and back",
  },
  {
    key: "ferry.header.title",
    page: "Ferry",
    label: "Page title",
    fallback: "Ferry times",
  },
  {
    key: "ferry.header.intro",
    page: "Ferry",
    label: "Intro sentence",
    multiline: true,
    // E14 plain-language pass (NFR-04): was one 30-word sentence with a nested
    // em-dash aside; "walk-ons" and "passengers-only" are now explained.
    fallback:
      "Two boats serve Kingston. The Edmonds–Kingston car ferry runs every day and takes about 30 minutes. You can drive on, or walk on without a car. The second boat is a fast ferry for people only — no cars. It goes straight to downtown Seattle in 39 minutes.",
  },

  // --------------------------------------------------------------- /eat
  {
    key: "eat.header.eyebrow",
    page: "Eat & Drink",
    label: "Header eyebrow",
    fallback: "Downtown Kingston",
  },
  {
    key: "eat.header.title",
    page: "Eat & Drink",
    label: "Page title",
    fallback: "Eat & Drink",
  },
  {
    key: "eat.header.intro",
    page: "Eat & Drink",
    label: "Header intro",
    multiline: true,
    fallback:
      "Everything here is a walk from the ferry dock — two minutes to a crêpe, ten up the hill to the shops by Grocery Outlet. Heads up: plenty of Kingston kitchens take orders by phone, not app. That's normal here.",
  },
  {
    key: "eat.callout.title",
    page: "Eat & Drink",
    label: "Closing callout title",
    fallback: "Menus and hours change — trust the kitchen, not the internet.",
  },
  {
    key: "eat.callout.body",
    page: "Eat & Drink",
    label: "Closing callout body (the “update your listing” link is appended after)",
    multiline: true,
    fallback:
      "We verify this list against the real world, but small-town kitchens move fast. When it matters, call ahead or check the restaurant's own site. Run a food spot in Kingston?",
  },

  // ------------------------------------------------------------ /events
  {
    key: "events.header.eyebrow",
    page: "Events",
    label: "Header eyebrow",
    fallback: "What's happening",
  },
  {
    key: "events.header.title",
    page: "Events",
    label: "Page title",
    fallback: "Events",
  },
  {
    key: "events.header.intro",
    page: "Events",
    label: "Header intro",
    multiline: true,
    fallback:
      "Markets on the marina lawn, free concerts two nights a week in high summer, and the whole town out for the 4th. Most of it is a short walk from the ferry.",
  },

  // ------------------------------------------------------- /itineraries
  {
    key: "itineraries.header.eyebrow",
    page: "Itineraries",
    label: "Header eyebrow",
    fallback: "Plan your day",
  },
  {
    key: "itineraries.header.title",
    page: "Itineraries",
    label: "Page title",
    fallback: "Itineraries",
  },
  {
    key: "itineraries.header.intro",
    page: "Itineraries",
    label: "Header intro",
    multiline: true,
    fallback:
      "Four ready-made Kingston days, built around real ferry arrivals and real local spots. Steal one whole or mix and match — everything downtown is within a few blocks of the dock.",
  },

  // -------------------------------------------------------------- /stay
  {
    key: "stay.header.eyebrow",
    page: "Stay",
    label: "Header eyebrow",
    fallback: "Spend the night",
  },
  {
    key: "stay.header.title",
    page: "Stay",
    label: "Page title",
    fallback: "Stay the night",
  },
  {
    key: "stay.header.intro",
    page: "Stay",
    label: "Header intro",
    multiline: true,
    fallback:
      "Day-trippers catch the boat home right when the light gets good. Stay over instead: watch the evening ferry cross a gold Puget Sound, walk Appletree Cove after dinner, and have the waterfront nearly to yourself at breakfast.",
  },

  // ----------------------------------------------------------- /parking
  {
    key: "parking.header.eyebrow",
    page: "Parking",
    label: "Header eyebrow",
    fallback: "Plan your visit",
  },
  {
    key: "parking.header.title",
    page: "Parking",
    label: "Page title",
    fallback: "Parking",
  },
  {
    key: "parking.header.intro",
    page: "Parking",
    label: "Header intro",
    multiline: true,
    // E14 plain-language pass (NFR-04): a 40-word sentence with a five-item
    // embedded list, the idiom "gotchas", and "park & rides" unexplained.
    fallback:
      "Kingston has only a few places to park, and each one has its own rules. There is a paid Port lot by the marina. There is a commuter lot one block up the hill. There is a free row with a 2-hour limit, and it is strictly enforced. A few streets have no limit at all. And there are two free park-and-ride lots, where you leave the car and take a bus or the ferry. The map below shows all of them. Each spot is colored by its parking type, and tells you who owns it, how to pay, and how long you can stay.",
  },
  {
    key: "parking.map.subtitle",
    page: "Parking",
    label: "Map section subtitle",
    multiline: true,
    // E14 plain-language pass: dropped "the portal" (internal admin vocabulary
    // that means nothing to a visitor) and the passive "are set automatically".
    fallback:
      "The Chamber keeps this parking map up to date. Tap any lot to see what kind it is, who owns it, how to pay, and how long you can stay. The color of each lot shows its parking type.",
  },

  // ----------------------------------------------------------- /webcams
  {
    key: "webcams.header.eyebrow",
    page: "Webcams",
    label: "Header eyebrow",
    fallback: "Check before you drive",
  },
  {
    key: "webcams.header.title",
    page: "Webcams",
    label: "Page title",
    fallback: "Webcams",
  },
  {
    key: "webcams.header.intro",
    page: "Webcams",
    label: "Header intro",
    multiline: true,
    // E14 plain-language pass (NFR-04): "WSDOT" is now glossed on first use and
    // the ferry-jargon "run" is gone; this page's whole job is a go/no-go call.
    fallback:
      "Eleven state highway cameras watch the Edmonds–Kingston ferry route. (WSDOT is the state transportation department.) They show still photos, not video. Most take a new photo about once a minute. Use them to see how long the ferry line is before you drive over and join it.",
  },

  // --------------------------------------------------------------- /map
  {
    key: "map.header.eyebrow",
    page: "Town Map",
    label: "Header eyebrow",
    fallback: "Get your bearings",
  },
  {
    key: "map.header.title",
    page: "Town Map",
    label: "Page title",
    fallback: "Kingston, mapped",
  },
  {
    key: "map.header.intro",
    page: "Town Map",
    label: "Header intro",
    multiline: true,
    fallback:
      "Pick a layer — where to eat, where to park, what to explore — and see it all on one map of downtown Kingston.",
  },

  // ---------------------------------------------------- /map/restrooms (E27)
  {
    key: "restrooms.header.eyebrow",
    page: "Restrooms & water",
    label: "Header eyebrow",
    fallback: "Practical basics",
  },
  {
    key: "restrooms.header.title",
    page: "Restrooms & water",
    label: "Page title",
    fallback: "Restrooms & water",
  },
  {
    key: "restrooms.header.intro",
    page: "Restrooms & water",
    label: "Header intro",
    multiline: true,
    fallback:
      "Public restrooms and drinking water in downtown Kingston, with the walk from the ferry. Tap the button to sort by what's closest to you.",
  },
  {
    key: "map.restrooms.link",
    page: "Town Map",
    label: "Link to the restroom & water finder",
    fallback: "Need a restroom? Find the nearest one →",
  },

  // -------------------------------------------------------------- /give
  {
    key: "give.header.eyebrow",
    page: "Give Back",
    label: "Header eyebrow",
    fallback: "Give back",
  },
  {
    key: "give.header.title",
    page: "Give Back",
    label: "Page title",
    fallback: "Kingston runs on volunteers",
  },
  {
    key: "give.header.intro",
    page: "Give Back",
    label: "Header intro",
    multiline: true,
    fallback:
      "The fireworks, the market, the food bank, the Village Green — none of it happens without neighbors raising their hands. Here's who does the work, where help is needed this summer, and a shared calendar so two good causes don't book the same day.",
  },
  {
    key: "give.directory.subtitle",
    page: "Give Back",
    label: "Nonprofit directory — section intro",
    multiline: true,
    fallback:
      "The orgs doing the heavy lifting around town. Reach out directly — they're small, friendly, and always short a pair of hands.",
  },
  {
    key: "give.volunteer.subtitle",
    page: "Give Back",
    label: "Volunteer right now — section intro",
    multiline: true,
    fallback:
      "Real shifts this summer, a couple hours each. No account needed — v1 keeps it simple: you contact the org, they put you to work.",
  },
  {
    key: "give.deconflict.subtitle",
    page: "Give Back",
    label: "Deconflict section intro",
    multiline: true,
    fallback:
      "Two good causes on the same day split the same crowd — and the same wallets. Scan the dates below before you book yours.",
  },

  // -------------------------------------------------------------- /hunt
  {
    key: "hunt.header.eyebrow",
    page: "Scavenger Hunt",
    label: "Header eyebrow",
    fallback: "Get out and play",
  },
  {
    key: "hunt.header.title",
    page: "Scavenger Hunt",
    label: "Page title",
    fallback: "Kingston Scavenger Hunt",
  },
  {
    key: "hunt.header.intro",
    page: "Scavenger Hunt",
    label: "Header intro",
    multiline: true,
    fallback:
      "Free, self-guided, and built for your phone. Solve riddles around town and post a photo at each spot to check in. No app to download, no account to make — just heads up that posted photos go to the hunt organizers.",
  },

  // ------------------------------------------------------------- /about
  {
    key: "about.header.eyebrow",
    page: "About",
    label: "Header eyebrow",
    fallback: "The story",
  },
  {
    key: "about.header.title",
    page: "About",
    label: "Page title",
    fallback: "About Visit Kingston",
  },
  {
    key: "about.header.intro",
    page: "About",
    label: "Header intro",
    multiline: true,
    fallback:
      "This site is a community project, built with the Greater Kingston Chamber of Commerce by people who live here. It's free to use and free of ads — no sponsored placements, no pay-to-rank listings. If it's on the site, it's because it's useful.",
  },
  // ---- Component & structured text (added 2026-07-03) ----
  // Ferry line card
  {
    key: "ferryLine.title",
    page: "Ferry line card",
    label: "Title (the emoji stays outside the editable text)",
    fallback: "Driving onto the ferry?",
  },
  {
    key: "ferryLine.body1",
    page: "Ferry line card",
    label: "Body paragraph 1",
    multiline: true,
    rich: true,
    // E14 plain-language pass (NFR-04): this is the most consequence-heavy
    // instruction on the site. Was one 37-word sentence chaining four actions;
    // now one idea per sentence, and "void" is said in plain words.
    fallback: "The overhead signs at **SR 104 and Barber Cutoff Rd** flash when Kingston's boarding-pass system is on. If they are flashing, follow the signs into the ferry lane. **Take a pass from the machine near Lindvog Rd.** Then wait for a green light before you drive up to the toll booths. Stay in the line the whole time. If you leave the line, your pass stops working.",
  },
  {
    key: "ferryLine.body2",
    page: "Ferry line card",
    label: "\"Active daily …\" line",
    multiline: true,
    rich: true,
    // E14 plain-language pass (NFR-04): sentence 1 had no verb, and "skip it"
    // read two opposite ways to the exact audience most likely to walk on.
    fallback: "The pass system runs every day from **8 am to 8 pm** in the busy summer season, and on weekends and holidays. You do not need a pass if you are walking on, riding a bike, or riding a motorcycle.",
  },
  {
    key: "ferryLine.navButton",
    page: "Ferry line card",
    label: "Navigate button label",
    fallback: "Navigate to the ferry →",
  },
  {
    key: "ferryLine.navButtonPass",
    page: "Ferry line card",
    label: "Navigate button label (when boarding pass is active)",
    fallback: "Get in the ferry line →",
  },
  {
    key: "ferryLine.mapLink",
    page: "Ferry line card",
    label: "\"see the line map\" link label",
    fallback: "see the line map",
  },
  // ---- Edmonds side (shown when the visitor sets/detects the Edmonds side) ----
  {
    key: "home.hero.edmonds.eyebrow",
    page: "Home — Edmonds side",
    label: "Hero eyebrow",
    fallback: "Headed across the water?",
  },
  {
    key: "home.hero.edmonds.title1",
    page: "Home — Edmonds side",
    label: "Hero headline, line 1 (before the “short sail” script word)",
    fallback: "Kingston is a",
  },
  {
    key: "home.hero.edmonds.title2",
    page: "Home — Edmonds side",
    label: "Hero headline, line 1 (after the “short sail” script word)",
    fallback: "away.",
  },
  {
    key: "home.hero.edmonds.intro",
    page: "Home — Edmonds side",
    label: "Hero intro",
    multiline: true,
    fallback:
      "Catch the Edmonds–Kingston boat and you're minutes from our little town on Appletree Cove.",
  },
  {
    key: "ferry.header.edmonds.eyebrow",
    page: "Ferry page — Edmonds side",
    label: "Header eyebrow",
    fallback: "Crossing to Kingston",
  },
  {
    key: "ferry.header.edmonds.title",
    page: "Ferry page — Edmonds side",
    label: "Header title",
    fallback: "Ferry times",
  },
  {
    key: "ferry.header.edmonds.intro",
    page: "Ferry page — Edmonds side",
    label: "Header intro",
    multiline: true,
    // E14 plain-language pass (NFR-04): the instruction ("board at the Edmonds
    // dock") was a trailing aside on a 26-word sentence. It leads now.
    fallback:
      "From Edmonds, the car ferry takes about 30 minutes to reach Kingston. It runs every day. You can walk on without a car. Board at the Edmonds dock. There is also a fast ferry for people only. It runs from Pier 50 in downtown Seattle to Kingston in 39 minutes.",
  },
  {
    key: "ferryLine.edmonds.title",
    page: "Ferry line card — Edmonds side",
    label: "Title",
    fallback: "Driving to Kingston?",
  },
  {
    key: "ferryLine.edmonds.body1",
    page: "Ferry line card — Edmonds side",
    label: "Body, paragraph 1",
    rich: true,
    fallback:
      "You board the ferry at the **Edmonds terminal** — not Kingston. The Kingston SR-104 boarding-pass line only matters for the trip back.",
  },
  {
    key: "ferryLine.edmonds.body2",
    page: "Ferry line card — Edmonds side",
    label: "Body, paragraph 2",
    rich: true,
    // E14 plain-language pass (NFR-04): "this run" is ferry jargon and the
    // instruction was buried mid-sentence.
    fallback:
      "You **cannot reserve a spot for your car** on this route. In summer, come early. The car line in Edmonds can fill up hours before the boat you want.",
  },
  {
    key: "ferryLine.edmonds.navButton",
    page: "Ferry line card — Edmonds side",
    label: "Navigate button",
    fallback: "Directions to the Edmonds dock →",
  },
  // Near-me (client)
  {
    key: "nearme.button.idle",
    page: "Near-me (client)",
    label: "Button label (idle)",
    fallback: "What's open near me?",
  },
  {
    key: "nearme.button.locating",
    page: "Near-me (client)",
    label: "Button label (while locating)",
    fallback: "Finding you…",
  },
  {
    key: "nearme.disclosure",
    page: "Near-me (client)",
    label: "Disclosure line under the button",
    multiline: true,
    // E11: storage is the neighborhood BUCKET only — the old "rounded to about
    // a block" wording described the retired coordinate-storing behavior.
    fallback: "Uses your location once to sort this list — we store only the neighborhood, never a coordinate.",
  },
  {
    key: "nearme.consent.title",
    page: "Near-me (client)",
    label: "Consent card heading",
    fallback: "Use your location?",
  },
  {
    key: "nearme.consent.body",
    page: "Near-me (client)",
    label: "Consent card purpose text (what happens if you allow)",
    multiline: true,
    // E14 plain-language pass (NFR-04): this is a consent decision, so the
    // abstract noun stack "one anonymous neighborhood-level count" and the
    // compressed "declining loses nothing" both had to go. Same promise, said
    // plainly — the behavior it describes is unchanged (E11).
    fallback: "It sorts this list by how close each place is to you. It also adds one visit to Kingston's visitor count. That count has no name on it, and it records only your neighborhood, not your exact spot. We never save your exact location. If you say no, nothing on this page stops working.",
  },
  {
    key: "nearme.consent.allow",
    page: "Near-me (client)",
    label: "Consent card — allow button",
    fallback: "Use my location",
  },
  {
    key: "nearme.consent.decline",
    page: "Near-me (client)",
    label: "Consent card — decline button",
    fallback: "No thanks",
  },
  // Scavenger hunt (client)
  {
    key: "hunt.disclosure",
    page: "Scavenger hunt (client)",
    label: "Disclosure under the photo-post button",
    multiline: true,
    // E14 plain-language pass (NFR-04): was one 27-word sentence with a dangling
    // "kept 12 months", on a screen where the reader decides what to send.
    fallback:
      "When you post, your photo goes to the hunt organizers so they can check you off. Your location goes with it only if you allow that. They keep both for 12 months. Do not include anything you would not want shared.",
  },
  {
    key: "hunt.consent.declined",
    page: "Scavenger hunt (client)",
    label: "Shown after declining the location check-in",
    multiline: true,
    fallback:
      "No problem — location stays off. Post the photo and we'll check you off on the honor system.",
  },
  {
    key: "hunt.consent.body",
    page: "Scavenger hunt (client)",
    label: "Location-consent card text",
    multiline: true,
    fallback:
      "Use your location to check you in at this stop? It's sent with your photo to the hunt organizers. You can skip it — you can still post the photo and finish the stop.",
  },
  {
    key: "nearme.denied",
    page: "Near-me (client)",
    label: "Permission-denied fallback",
    multiline: true,
    fallback: "No problem — we never see your location unless you say yes. Everything below is sorted by walk time from the ferry dock instead.",
  },
  {
    key: "nearme.error",
    page: "Near-me (client)",
    label: "Location-error fallback",
    multiline: true,
    fallback: "Couldn't get a location fix just now. Kingston is small — the walk times from the ferry on each card below are a good guide.",
  },
  // Restroom & water finder (client) — E27 practical basics
  {
    key: "restrooms.finder.button",
    page: "Restrooms & water (client)",
    label: "Finder button label",
    fallback: "Find the nearest restroom",
  },
  {
    key: "restrooms.finder.locating",
    page: "Restrooms & water (client)",
    label: "Finder button label while locating",
    fallback: "Finding you…",
  },
  {
    key: "restrooms.finder.disclosure",
    page: "Restrooms & water (client)",
    label: "Disclosure line under the finder button",
    multiline: true,
    // Stronger promise than nearme.disclosure on purpose: this finder makes no
    // network call at all, so nothing is stored, not even a neighborhood.
    fallback: "Sorts this list on your phone. Your location is never sent anywhere and never saved.",
  },
  {
    key: "restrooms.finder.denied",
    page: "Restrooms & water (client)",
    label: "Location-declined fallback",
    multiline: true,
    fallback: "No problem — the list below is ordered by walk time from the ferry dock instead.",
  },
  {
    key: "restrooms.finder.error",
    page: "Restrooms & water (client)",
    label: "Location-error fallback",
    multiline: true,
    fallback: "Couldn't get a location fix just now. The list below is ordered by walk time from the ferry dock.",
  },
  {
    key: "restrooms.finder.nowater",
    page: "Restrooms & water (client)",
    label: "Note shown when no drinking water is mapped",
    multiline: true,
    // Honest empty state. Delete this block's call site only when water pins
    // exist — see the sourcing note in src/lib/data/map-features.ts.
    fallback: "No public drinking water is mapped in Kingston yet. We'd rather say so than send you to a fountain that might not be there — know one? Tell the Chamber and we'll add it.",
  },
  // Webcams (client)
  {
    key: "webcams.card.loading",
    page: "Webcams (client)",
    label: "Card: initial loading label",
    fallback: "Loading camera…",
  },
  {
    key: "webcams.card.offlineTitle",
    page: "Webcams (client)",
    label: "Card: offline title",
    fallback: "Camera offline",
  },
  {
    key: "webcams.card.offlineBody",
    page: "Webcams (client)",
    label: "Card: offline explanation",
    multiline: true,
    fallback: "WSDOT feeds hiccup sometimes — we’ll retry automatically.",
  },
  {
    key: "webcams.card.connecting",
    page: "Webcams (client)",
    label: "Card footer: connecting status",
    fallback: "Connecting…",
  },
  {
    key: "webcams.card.noImage",
    page: "Webcams (client)",
    label: "Card footer: no-image status",
    fallback: "No image right now",
  },
  // Visitor survey (client)
  {
    key: "survey.intro.title",
    page: "Visitor survey (client)",
    label: "Card intro title",
    fallback: "Quick anonymous question",
  },
  {
    key: "survey.intro.subtitle",
    page: "Visitor survey (client)",
    label: "Card intro subtitle",
    multiline: true,
    fallback: "Your answer helps Kingston qualify for tourism funding. Nothing personal is stored.",
  },
  {
    key: "survey.overnight.question",
    page: "Visitor survey (client)",
    label: "Overnight question",
    fallback: "Are you staying overnight in the Kingston area?",
  },
  {
    key: "survey.details.nightsLabel",
    page: "Visitor survey (client)",
    label: "Details: nights field label",
    fallback: "Nights in the area",
  },
  {
    key: "survey.details.lodgingLabel",
    page: "Visitor survey (client)",
    label: "Details: lodging field label",
    fallback: "Where are you staying?",
  },
  {
    key: "survey.details.partyLabel",
    page: "Visitor survey (client)",
    label: "Details: party-size field label",
    fallback: "People in your group",
  },
  {
    key: "survey.thankyou",
    page: "Visitor survey (client)",
    label: "Thank-you message",
    multiline: true,
    fallback: "Thank you! Answers like yours help fund the events and trails you came for. Enjoy Kingston. 🌲",
  },
  {
    // E13: shown instead of survey.thankyou when the answer went to the
    // offline outbox — it is already saved on the device and replays later.
    key: "survey.queued",
    page: "Visitor survey (client)",
    label: "Thank-you message (answer queued offline)",
    multiline: true,
    fallback: "Saved — we'll send it when you're back online.",
  },
  // Map switcher (client)
  {
    key: "mapswitcher.empty",
    page: "Map switcher (client)",
    label: "Empty state (no published maps)",
    fallback: "No maps are published yet.",
  },
  // Home (live strip)
  {
    key: "home.strip.fastFerry",
    page: "Home (live strip)",
    label: "Label: fast ferry to Seattle",
    fallback: "Fast Ferry:",
  },

  // ---- E14: the non-app fallbacks (M-18-07 / FR-47) ----
  // The Chamber's own phone number lives in the registry, not in code, so the
  // office can change it without a deploy. Fallback corroborated three ways:
  // docs/OPERATIONS.md §9 item 7, the Chamber's public site footer at
  // explorekingstonwa.com, and public business listings.
  {
    key: "contact.phone.number",
    page: "Contact (phone fallback)",
    label: "Chamber phone number (digits as printed)",
    fallback: "360-860-2239",
  },
  {
    key: "contact.phone.label",
    page: "Contact (phone fallback)",
    label: "Phone link label",
    fallback: "Call the Kingston Chamber",
  },

  // ---- Install the app (nav "More" surfaces, client) ----
  {
    key: "install.menu.label",
    page: "Install app (client)",
    label: "Add-to-home-screen menu entry",
    fallback: "Add to home screen",
  },
  {
    key: "install.menu.ios",
    page: "Install app (client)",
    label: "iOS instructions (no install button exists on iPhone/iPad)",
    fallback: "Tap the Share button, then “Add to Home Screen”.",
  },

  // ---- /simple — "Kingston basics" (M-14-03 plain-language page) ----
  {
    key: "simple.toggle.label",
    page: "Simple mode (client)",
    label: "Easy-read switch label",
    fallback: "Easy read",
  },
  {
    key: "simple.header.eyebrow",
    page: "Kingston basics (/simple)",
    label: "Header eyebrow",
    fallback: "The short version",
  },
  {
    key: "simple.header.title",
    page: "Kingston basics (/simple)",
    label: "Page title",
    fallback: "Kingston basics",
  },
  {
    key: "simple.header.intro",
    page: "Kingston basics (/simple)",
    label: "Intro sentence",
    multiline: true,
    fallback: "Big type. Short words. The few things most visitors need.",
  },
  {
    key: "simple.help.body",
    page: "Kingston basics (/simple)",
    label: "Phone block: what the Chamber can help with",
    multiline: true,
    fallback: "A real person answers during office hours. Ask about ferries, parking, food, or anything else in town.",
  },
  {
    key: "simple.boats.none",
    page: "Kingston basics (/simple)",
    label: "Boats: nothing left today",
    multiline: true,
    fallback: "No more boats today. Boats start again tomorrow morning.",
  },

  // Shared by /simple and /print: the same honesty line next-ferries.tsx shows
  // when the WSF feed is down and the bundled schedule is standing in for it.
  {
    key: "ferry.schedule.notLive",
    page: "Ferry times (shared)",
    label: "Caveat when live ferry data is unavailable",
    multiline: true,
    fallback: "These are schedule times, not live times. Call to check before you go.",
  },

  // ---- /print — the printable one-pager ----
  {
    key: "print.header.title",
    page: "Printable page (/print)",
    label: "Page title",
    fallback: "Kingston at a glance",
  },
  {
    key: "print.header.intro",
    page: "Printable page (/print)",
    label: "Intro sentence",
    multiline: true,
    fallback: "One page to print or save: today's boats, the numbers to call, and where to park.",
  },
  {
    key: "print.button.label",
    page: "Printable page (/print)",
    label: "Print button label",
    fallback: "Print this page",
  },
  {
    key: "print.basics.body",
    page: "Printable page (/print)",
    label: "Restroom and parking basics",
    multiline: true,
    fallback: "Restrooms: there are public restrooms on the waterfront promenade by the Port marina, near the boat launch. Parking: the Port lot by the marina is paid, the free row nearest the shops has a 2-hour limit that is strictly enforced, and street parking has rules only where a sign says so.",
  },
  {
    key: "print.caveat",
    page: "Printable page (/print)",
    label: "Closing caveat line",
    multiline: true,
    fallback: "Times change — call to confirm.",
  },

  // Footer
  {
    key: "footer.brand",
    page: "Footer",
    label: "Wordmark / brand line",
    fallback: "Explore Kingston",
  },
  {
    key: "footer.tagline",
    page: "Footer",
    label: "Tagline / description sentence",
    multiline: true,
    rich: true,
    fallback: "The interactive companion to [explorekingstonwa.com](https://explorekingstonwa.com) — your community guide to Kingston, Washington, ferry gateway to the Kitsap Peninsula and the Olympic Peninsula beyond.",
  },
  {
    key: "footer.credit",
    page: "Footer",
    label: "Bottom credit line",
    multiline: true,
    rich: true,
    // E14 plain-language pass (NFR-04): "sailings" is the ferry-industry term
    // NFR-04 names, and this footer carries the site's one standing instruction
    // on every single page.
    fallback: "Built with the Greater Kingston Chamber of Commerce, which publishes [explorekingstonwa.com](https://explorekingstonwa.com). Ferry times come from WSDOT, the state transportation department. Always check boat times with Washington State Ferries before you travel.",
  },

  // ---- E14: the EN+ES safety slice (FR-92) and the accessibility statement ----
  // The Spanish PAGE FURNITURE lives here so the Chamber can adjust a heading
  // without a deploy; the safety INSTRUCTIONS live in
  // src/lib/i18n/safety-content.ts, where they are hand-authored, key-parity
  // tested, and reviewed as one block before /es is unhidden.
  {
    key: "es.header.eyebrow",
    page: "Kingston en español (/es)",
    label: "Header eyebrow (Spanish)",
    fallback: "Lo esencial",
  },
  {
    key: "es.header.title",
    page: "Kingston en español (/es)",
    label: "Page title (Spanish)",
    fallback: "Kingston en español",
  },
  {
    key: "es.header.intro",
    page: "Kingston en español (/es)",
    label: "Intro sentence (Spanish)",
    multiline: true,
    fallback: "Lo más importante para su visita, en palabras sencillas: los barcos, el estacionamiento, los baños y a quién llamar.",
  },
  {
    key: "es.help.body",
    page: "Kingston en español (/es)",
    label: "Phone block: what the Chamber can help with (Spanish)",
    multiline: true,
    fallback: "Una persona contesta en horas de oficina. Puede preguntar sobre los ferris, el estacionamiento, dónde comer o cualquier otra cosa del pueblo.",
  },
  {
    key: "es.boats.none",
    page: "Kingston en español (/es)",
    label: "Boats: nothing left today (Spanish)",
    multiline: true,
    fallback: "Hoy ya no hay más barcos. Los barcos empiezan otra vez mañana por la mañana.",
  },
  {
    key: "es.schedule.notLive",
    page: "Kingston en español (/es)",
    label: "Caveat when live ferry data is unavailable (Spanish)",
    multiline: true,
    fallback: "Estos son horarios programados, no horarios en vivo. Llame para confirmar antes de salir.",
  },
  {
    key: "es.link.english",
    page: "Kingston en español (/es)",
    label: "Cross-link back to the English page (this label stays in English)",
    fallback: "In English",
  },
  {
    key: "simple.link.spanish",
    page: "Kingston basics (/simple)",
    label: "Cross-link to the Spanish page (this label stays in Spanish)",
    fallback: "En español",
  },

  // The public email, beside the phone number, so the office can change either
  // without a deploy. docs/OPERATIONS.md §9 item 7 tracks confirming it is
  // monitored.
  {
    key: "contact.email.address",
    page: "Contact (phone fallback)",
    label: "Chamber public email address",
    fallback: "info@kingstonchamber.com",
  },

  // ---- /accessibility — the statement ----
  // Only the parts an operator legitimately maintains are editable: the header,
  // the feedback promise, and the review date (docs/OPERATIONS.md, "Accessibility
  // & language", asks for an annual review). The conformance and legal-posture
  // paragraphs stay code-owned in src/app/accessibility/page.tsx — see the
  // comment there.
  {
    key: "accessibility.header.eyebrow",
    page: "Accessibility statement (/accessibility)",
    label: "Header eyebrow",
    fallback: "Accessibility",
  },
  {
    key: "accessibility.header.title",
    page: "Accessibility statement (/accessibility)",
    label: "Page title",
    fallback: "Accessibility statement",
  },
  {
    key: "accessibility.header.intro",
    page: "Accessibility statement (/accessibility)",
    label: "Intro sentence",
    multiline: true,
    fallback: "We want Explore Kingston to work for everyone, and we are actively improving it toward that goal.",
  },
  {
    key: "accessibility.feedback.body",
    page: "Accessibility statement (/accessibility)",
    label: "Feedback invitation",
    multiline: true,
    fallback: "If something is hard to use, or you hit a barrier, please tell us. Say what page you were on and what happened. It genuinely helps us decide what to fix first.",
  },
  {
    key: "accessibility.feedback.response",
    page: "Accessibility statement (/accessibility)",
    label: "Expected response time",
    multiline: true,
    fallback: "The Chamber office is staffed part time. We aim to reply within five business days, and to tell you what we can fix and when.",
  },
  {
    key: "accessibility.ada.deadline",
    page: "Accessibility statement (/accessibility)",
    // Editable on purpose: the DOJ has already moved this date once (extended a
    // year, from 2027, by a rule effective 2026-04-20), so the Chamber must be
    // able to correct it without waiting on a deploy. Verify against ada.gov
    // before changing it — see docs/OPERATIONS.md "Accessibility & language".
    label: "ADA Title II WCAG 2.1 AA compliance deadline (verify at ada.gov before editing)",
    fallback: "April 26, 2028",
  },
  {
    key: "accessibility.lastReviewed",
    page: "Accessibility statement (/accessibility)",
    label: "Date this statement was last reviewed (update at least once a year)",
    fallback: "July 2026",
  },
] as const satisfies readonly CopyBlock[];

/** Union of every registered copy key — a typo at a call site is a tsc error. */
export type CopyKey = (typeof COPY_BLOCKS)[number]["key"];

const FALLBACKS = new Map<string, string>(COPY_BLOCKS.map((b) => [b.key, b.fallback]));

/** The registry-owned default wording for one block (E07: single-sourced). */
export function copyFallback(key: CopyKey): string {
  return FALLBACKS.get(key) ?? "";
}
