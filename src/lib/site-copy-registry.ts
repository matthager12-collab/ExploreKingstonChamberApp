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
    fallback: "Not Just the Gateway to the Kitsap & Olympic Peninsulas; A Destination Itself!",
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
      "Everything here is a walk from the ferry dock — a couple minutes downtown, ten up the hill. Many Kingston kitchens still take orders by phone, not an app.",
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
      "We keep this list current, but small-town kitchens move fast. When it matters, call ahead or check the restaurant's own site. Run a food spot in Kingston?",
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
      "Markets on the marina lawn, free concerts on summer evenings, and the festivals that turn the whole town out. Most of it is a short walk from the ferry.",
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
      "Ready-made Kingston days built around ferry arrivals and local spots. Steal one whole or mix and match — everything downtown is a few blocks from the dock.",
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
      "Kingston has plenty of parking if you know where to look. There is a text-to-pay waterfront Port lot. There are several monthly pass commuter lots within a block of ferry. There is a free row with a 2-hour limit in the Port lot, and it is strictly enforced. There are two rows of 2-hour free parking alongside the waterfront Kiwanis park. Most residential streets within 2 blocks of ferry have 2 hour limits but beyond that, most have no limit at all. There are also two free park-and-ride lots, where you leave the car and take a bus or walk to the ferry. The map below shows all of them. Each spot is colored by its parking type, and tells you who owns it, how to pay, and how long you can stay.",
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
  {
    key: "parking.pay.title",
    page: "Parking",
    label: "Pay for parking — section title",
    fallback: "Pay for parking",
  },
  {
    key: "parking.pay.subtitle",
    page: "Parking",
    label: "Pay for parking — section subtitle",
    multiline: true,
    fallback:
      "The Port lots take payment by text. Tap the button, or send the message yourself — the code works either way, and it is the same code posted on the sign at the lot. The Diamond commuter lot uses ParkMobile or PayByPhone.",
  },
  {
    key: "parking.pay.footer",
    page: "Parking",
    label: "Pay for parking — footnote under the cards",
    multiline: true,
    rich: true,
    fallback:
      "Rates and codes belong to the lot operators — the Port of Kingston, and Diamond Parking for the D515 commuter lot — not to the Chamber, and they change. **The sign at the lot is always the authority.** To get a list of every Port lot on your phone, text **PARKATPOK** to **25023**.",
  },

  // The Port's own "NEED HELP?" sign, photographed at the lot 2026-08-06. This
  // is the fallback path for the visitor text-to-pay leaves stranded — no
  // smartphone, no signal, a QR that will not scan — and until now the app
  // published the Marina Office hours and number but not what to do outside
  // them. The four bullets are the Port's list verbatim, in the Port's order:
  // a message missing one of them is not the message the sign promises will
  // keep you from being ticketed.
  {
    key: "parking.help.title",
    page: "Parking",
    label: "Trouble paying — section title",
    fallback: "Can't pay? Here's what the Port says to do",
  },
  {
    key: "parking.help.body",
    page: "Parking",
    label: "Trouble paying — body",
    multiline: true,
    rich: true,
    fallback:
      "No smartphone, or the QR code and text-to-pay will not work? Call or stop by the **Marina Office at 360-297-3545**, open **8 am – 5 pm**.\n\nOutside those hours, call the same number and leave a message with your **space number**, your **license plate number**, the **time you parked**, and **how many hours you are parking**. Port staff return the call in business hours to take the payment. The Port's posted sign says you will not be ticketed or towed as long as you leave that message.",
  },
  {
    key: "parking.pr.title",
    page: "Parking",
    label: "Park & ride section title",
    fallback: "Leave the car here",
  },
  {
    key: "parking.pr.subtitle",
    page: "Parking",
    label: "Park & ride section subtitle",
    multiline: true,
    fallback:
      "Two free park-and-ride lots skip the downtown parking hunt: leave the car and ride a Kitsap Transit bus to the ferry. Both are marked with the orange P&R badge on the map. Day use only — 24 hours max.",
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
      "The fireworks, the market, the food bank, the Village Green — none of it happens without neighbors raising their hands. Here's who does the work, where help is needed, and a shared calendar so two good causes don't book the same day.",
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
      "Real shifts, a couple hours each. No account needed — you contact the org, they put you to work.",
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
    fallback: "About Explore Kingston",
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
    fallback: "The overhead signs at **SR 104 and Barber Cutoff Rd** flash when Kingston's boarding-pass system is on. If they are flashing, follow the signs into the ferry lane. **Take a pass from the machine near Lindvog Rd.** Then wait for a green light before you drive up to the toll booths.",
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

  // ------------------------------------------- Ferry-dock kiosk (E22, /kiosk)
  // Editable because the kiosk is the Chamber's most public piece of writing —
  // it is read by people standing at the ferry who have never seen the website
  // — and the panel is the one surface where "wait for a deploy" is least
  // acceptable. All four render on the physical device only.
  {
    key: "kiosk.attract.title",
    page: "Kiosk (/kiosk)",
    label: "Welcome screen headline, shown over the rotating photographs",
    fallback: "Explore Kingston",
  },
  {
    key: "kiosk.attract.prompt",
    page: "Kiosk (/kiosk)",
    label: "Welcome screen instruction — say what to DO, in as few words as possible",
    fallback: "Touch anywhere to begin",
  },
  {
    key: "kiosk.home.heading",
    page: "Kiosk (/kiosk)",
    label: "Heading above the row of big category buttons on the kiosk home screen",
    fallback: "What are you looking for?",
  },
  {
    key: "kiosk.handoff.prompt",
    page: "Kiosk (/kiosk)",
    label: "Caption above the QR codes that hand a page to the visitor's phone",
    fallback: "Scan to take this with you",
  },

  // ══════════════════════ BEGIN /line (E33 — Line Lander) ══════════════════════
  // Every visitor-facing sentence on /line. The reader is a stressed driver
  // parked in the SR-104 line with kids in the back and one bar of signal —
  // short sentences, no staff vocabulary, the E14 plain-language rules.
  // Boarding-pass FACTS (when a pass is required, who is exempt) are NOT here:
  // they come from the ferry-info record at /admin/ferry-info, shared with
  // /ferry so the two pages can never disagree.
  {
    key: "line.header.eyebrow",
    page: "Ferry line (/line)",
    label: "Header eyebrow",
    fallback: "Waiting in the SR 104 ferry line",
  },
  {
    key: "line.header.title",
    page: "Ferry line (/line)",
    label: "Page title",
    fallback: "You're in the ferry line. Here's what matters.",
  },
  {
    key: "line.header.intro",
    page: "Ferry line (/line)",
    label: "Intro sentence",
    multiline: true,
    fallback:
      "Your boarding-pass status, the next boats, and what you can get from right where you're parked.",
  },
  {
    key: "line.note.title",
    page: "Ferry line (/line)",
    label: "Title above the Chamber's transient ferry-info notice (shown only when a notice is set)",
    fallback: "Heads up right now",
  },
  {
    key: "line.pass.title",
    page: "Ferry line (/line)",
    label: "Small heading above the boarding-pass status",
    fallback: "Boarding pass",
  },
  {
    key: "line.pass.on",
    page: "Ferry line (/line)",
    label: "Status sentence when the boarding-pass system is ON",
    fallback: "The boarding-pass system is on right now — every car in line needs a pass.",
  },
  {
    key: "line.pass.off",
    page: "Ferry line (/line)",
    label: "Status sentence when the boarding-pass system is OFF",
    fallback: "The boarding-pass system is off right now — no pass needed at the moment.",
  },
  {
    key: "line.exempt.title",
    page: "Ferry line (/line)",
    label: "Title of the who's-exempt block (walk-ons, bikes, motorcycles)",
    fallback: "Who doesn't need a pass",
  },
  {
    key: "line.boats.title",
    page: "Ferry line (/line)",
    label: "Next-boats section title",
    fallback: "Next boats",
  },
  {
    key: "line.boats.subtitle",
    page: "Ferry line (/line)",
    label: "Next-boats section subtitle",
    fallback: "Live times for both directions. Updates every minute while you watch.",
  },
  {
    key: "line.wait.label",
    page: "Ferry line (/line)",
    label: "Label in front of WSDOT's posted driver-wait note (shown only when one is posted)",
    fallback: "Posted wait for drivers",
  },
  {
    key: "line.wait.longLine",
    page: "Ferry line (/line)",
    label: "Extra note when the wait tops 2 hours (line past Barber Cutoff)",
    multiline: true,
    fallback:
      "With a wait this long, the line usually reaches past Barber Cutoff Rd. Sending someone to join you? Tell them to come down SR 104 from Miller Bay Rd — not to U-turn into the line.",
  },
  {
    key: "line.cams.title",
    page: "Ferry line (/line)",
    label: "Heading on the collapsed WSDOT camera box",
    fallback: "📷 See the line right now",
  },
  {
    key: "line.cams.blurb",
    page: "Ferry line (/line)",
    label: "Sub-line on the camera box — framed for someone already in the line",
    multiline: true,
    // Kept short on purpose: this sits beside the Show/Hide control, and a
    // longer sentence wraps to four lines on a 375px phone and squeezes it.
    fallback: "WSDOT cameras on SR 104 — find your spot, and see if it's moving.",
  },
  {
    key: "line.map.title",
    page: "Ferry line (/line)",
    label: "Map section title",
    fallback: "How the line works",
  },
  {
    key: "line.map.subtitle",
    page: "Ferry line (/line)",
    label: "Map section subtitle",
    fallback: "The SR 104 boarding-pass system, mapped — sign, pass machine, tollbooths.",
  },
  {
    key: "line.boat.title",
    page: "Ferry line (/line)",
    label: "Vessel-map section title",
    fallback: "Where's the boat?",
  },
  {
    key: "line.boat.subtitle",
    page: "Ferry line (/line)",
    label: "Vessel-map section subtitle",
    multiline: true,
    fallback:
      "Live positions of the Edmonds–Kingston ferries. A boat still mid-Sound is a boat that has to dock and unload before it takes you.",
  },
  {
    key: "line.food.title",
    page: "Ferry line (/line)",
    label: "Food section title",
    fallback: "Hungry? Order ahead",
  },
  {
    key: "line.food.subtitle",
    page: "Ferry line (/line)",
    label: "Food section subtitle — sets the deep-link-only expectation",
    multiline: true,
    fallback:
      "These Kingston kitchens are open right now. You order and pay with the restaurant directly — their website or their phone line, never through this app.",
  },
  {
    key: "line.food.empty",
    page: "Ferry line (/line)",
    label: "Shown when no restaurant with verified hours is open right now",
    multiline: true,
    fallback:
      "No Kingston kitchen with verified hours is open right now. Check the Eat & Drink page for every place in town and when they open.",
  },
  {
    key: "line.food.distanceNote",
    page: "Ferry line (/line)",
    label: "Small print under the food list about what the walk figures mean",
    fallback:
      "Walk times are from the ferry dock — for planning a pickup once you're parked at the terminal, not a walk from the middle of the line.",
  },
  {
    key: "line.amenities.title",
    page: "Ferry line (/line)",
    label: "Restrooms section title",
    fallback: "Need a restroom?",
  },
  {
    key: "line.amenities.walkableTitle",
    page: "Ferry line (/line)",
    label: "Heading over restrooms that ARE reachable from the waiting stretch",
    fallback: "On the line itself",
  },
  {
    key: "line.amenities.walkableNote",
    page: "Ferry line (/line)",
    label: "Explains what the walk figures are measured FROM — they are not from you",
    multiline: true,
    // The distance is to the nearest point of the waiting stretch, which is
    // where the app knows the line is — not where the reader is sitting in it.
    // Without this, "~1 min from the line" reads as "~1 min from me" to someone
    // parked a mile back at Barber Cutoff.
    fallback:
      "Walk times are to the nearest point of the line, not to your car — if you're further back on SR 104, it's further for you.",
  },
  {
    key: "line.amenities.empty",
    page: "Ferry line (/line)",
    label: "The honest empty state: nothing walkable from the waiting stretch",
    multiline: true,
    fallback:
      "Honestly: we know of no public restroom you can walk to from the line itself. The nearest ones are at the dock — you'll reach them once you're through the tollbooths.",
  },
  {
    key: "line.amenities.atDock",
    page: "Ferry line (/line)",
    label: "Heading over the list of restrooms at the dock",
    fallback: "At the dock, once you're through the tollbooths",
  },
  {
    key: "line.more.parkingTitle",
    page: "Ferry line (/line)",
    label: "Parking link-out title",
    fallback: "Parking in Kingston",
  },
  {
    key: "line.more.parking",
    page: "Ferry line (/line)",
    label: "Parking link-out sentence",
    fallback: "Leaving the car in town and walking on instead? Lots, street rules, and how to pay.",
  },
  {
    key: "line.more.ferryTitle",
    page: "Ferry line (/line)",
    label: "Ferry page link-out title",
    fallback: "The full ferry page",
  },
  {
    key: "line.more.ferry",
    page: "Ferry line (/line)",
    label: "Ferry page link-out sentence",
    fallback: "Fares, the passenger-only fast ferry to Seattle, webcams, and live boat positions.",
  },
  // ═══════════════════════ END /line (E33 — Line Lander) ═══════════════════════

  // ================= "Get listed" CTAs (copy/get-listed-cta) =================
  // The door-is-open notice for businesses NOT on the site yet: a shared
  // callout at the bottom of /eat and /stay, plus the hint under the /portal
  // sign-in form (src/components/get-listed.tsx). The Chamber email and phone
  // these CTAs render come from the contact.email.address / contact.phone.*
  // blocks above, so contact details stay editable in exactly one place.
  {
    key: "getListed.callout.title",
    page: "Get listed (shared callout, /eat + /stay)",
    label: "Callout title",
    fallback: "Run a Kingston business?",
  },
  {
    key: "getListed.callout.body",
    page: "Get listed (shared callout, /eat + /stay)",
    label: "Callout body (the Chamber email and phone links are appended after)",
    multiline: true,
    fallback:
      "Listings on this site are free for Kingston businesses — restaurants, lodging, shops, and services. One message to the Chamber is all it takes.",
  },
  {
    key: "portal.login.noAccount",
    page: "Portal (/portal)",
    label:
      "Hint under the sign-in form for businesses without an account (the Chamber email and phone links are appended after)",
    multiline: true,
    fallback:
      "Run a Kingston business and don't have an account yet? Portal invite codes come from the Kingston Chamber.",
  },
  // =============== end "Get listed" CTAs (copy/get-listed-cta) ===============

  // ============== BEGIN edmonds.* (Edmonds-side parking, /parking) ==============
  // The "park in Edmonds, walk on" section (feat/edmonds-side-parking). Facts
  // verified 2026-07-31 — sources live on each card via
  // src/lib/data/edmonds-parking.ts; the copy here is the SENTENCES only.
  // {walkOnRoundTrip} is the E27 fare token (admin-editable at
  // /admin/ferry-info → Fares), filled at render time exactly as /simple and
  // /es fill it — never hardcode a fare figure in this block.
  // Time-sensitive facts (U-Park rate drift, Sound Transit's 2027 paid-parking
  // watch) belong in docs/OPERATIONS.md §14.5, not in this copy.
  {
    key: "edmonds.section.title",
    page: "Parking — Edmonds side",
    label: "Section title",
    fallback: "Parking on the Edmonds side",
  },
  {
    key: "edmonds.section.subtitle",
    page: "Parking — Edmonds side",
    label: "Section subtitle",
    multiline: true,
    fallback:
      "Leave the car in Edmonds and walk onto the boat. You skip the car line, and there is always room on foot. Here is where a car can actually stay over there — and where it gets towed.",
  },
  {
    key: "edmonds.fare",
    page: "Parking — Edmonds side",
    label: "Walk-on fare sentence ({walkOnRoundTrip} is filled from the fares record)",
    multiline: true,
    fallback:
      "A walk-on ticket is {walkOnRoundTrip} and covers the whole round trip. You pay it once, in Edmonds — the boat home from Kingston is free.",
  },
  {
    key: "edmonds.upark.summary",
    page: "Parking — Edmonds side",
    label: "U-Park card body",
    multiline: true,
    fallback:
      "The one real all-day lot near the dock, about a 2-minute walk from the terminal: 64 spaces, including 2 spaces that are free with a disabled parking placard. WSDOT lists the rate as $15–$20 — verify the posted rate at the pay station before you leave the car. Staying overnight or longer? Call U-Park first at (206) 284-9797.",
  },
  {
    key: "edmonds.shortterm.summary",
    page: "Parking — Edmonds side",
    label: "Short-term streets card body",
    multiline: true,
    fallback:
      "Most signed streets near the dock allow 3 hours, and the clock only runs from midnight to 6 pm, except Sundays and holidays. After 6 pm, and all day Sunday, the limit lapses on most streets — an evening or Sunday trip can usually park free. Brackett's Landing, the beach lot beside the terminal, allows 4 hours. Good for a quick out-and-back, not for a day trip. The sign on the pole is always the rule.",
  },
  {
    key: "edmonds.avoid.title",
    page: "Parking — Edmonds side",
    label: "Do-not-park callout title",
    fallback: "Do not park here for the ferry",
  },
  {
    key: "edmonds.avoid.intro",
    page: "Parking — Edmonds side",
    label: "Do-not-park callout intro",
    multiline: true,
    fallback:
      "These places sit right by the terminal and look convenient. You risk towing or a warning on the windshield — a ferry rider is not their customer.",
  },
  {
    key: "edmonds.avoid.salish",
    page: "Parking — Edmonds side",
    label: "Do-not-park: Salish Crossing",
    multiline: true,
    fallback:
      "The shopping center is for its own customers only and tows and boots actively. The old commuter-parking arrangement there ended in 2023.",
  },
  {
    key: "edmonds.avoid.harborsquare",
    page: "Parking — Edmonds side",
    label: "Do-not-park: Harbor Square",
    multiline: true,
    fallback: "For patrons of its businesses only — no all-day parking.",
  },
  {
    key: "edmonds.avoid.portlots",
    page: "Parking — Edmonds side",
    label: "Do-not-park: Port of Edmonds lots",
    multiline: true,
    fallback:
      "For people using the marina or Port facilities only. Guest spaces allow 3 hours.",
  },
  {
    key: "edmonds.avoid.sounder",
    page: "Parking — Edmonds side",
    label: "Do-not-park: Edmonds Station Sounder lot",
    multiline: true,
    fallback:
      "The free Sound Transit lot is for transit passengers only, 24 hours max — walking onto the ferry does not count, even when the lot sits half empty. Cars parked there for anything else can be impounded.",
  },
  {
    key: "edmonds.avoid.terminal",
    page: "Parking — Edmonds side",
    label: "Do-not-park: the terminal itself",
    multiline: true,
    fallback: "The Edmonds ferry terminal itself has no parking lot — the lots are all a few blocks away.",
  },
  {
    key: "edmonds.bus.summary",
    page: "Parking — Edmonds side",
    label: "Bus-in card body",
    multiline: true,
    fallback:
      "Skip Edmonds parking entirely: leave the car at Community Transit's free Edmonds Park & Ride and ride the bus in. Routes 102, 130, 166 and 909 connect directly to the ferry terminal. Community Transit itself recommends the bus, because parking near the terminal is limited.",
  },
  {
    key: "edmonds.multiday.title",
    page: "Parking — Edmonds side",
    label: "Multi-day gap callout title",
    fallback: "Leaving a car for several days? Edmonds has no verified option",
  },
  {
    key: "edmonds.multiday.body",
    page: "Parking — Edmonds side",
    label: "Multi-day gap callout body",
    multiline: true,
    fallback:
      "As of July 2026 we can find no published option for leaving a car near the Edmonds terminal for more than about a day, so rather than guess, we say so plainly. For a multi-day trip: have someone drop you off, come by bus or train, or call U-Park at (206) 284-9797 and ask before you count on their lot.",
  },
  {
    key: "edmonds.ferry.crosslink",
    page: "Parking — Edmonds side",
    label: "Cross-link text on /ferry's walk-on card (links to /parking#edmonds)",
    fallback: "Parking on the Edmonds side — where a car can stay, and where it gets towed",
  },
  // =============== END edmonds.* (Edmonds-side parking, /parking) ===============

  // ===== claim.* (E17 claim-listing disclosure on the /eat and /stay cards) =====
  {
    key: "claim.disclosure.label",
    page: "Claim listing",
    label: "Disclosure link text (collapsed state)",
    fallback: "Own this business? Claim this listing",
  },
  {
    key: "claim.form.intro",
    page: "Claim listing",
    label: "Form intro — what a request does (and does not do)",
    multiline: true,
    fallback:
      "Tell us who you are and the Chamber will call the business's listed phone number to verify. Nothing on this page changes until then.",
  },
  {
    key: "claim.form.name.label",
    page: "Claim listing",
    label: "Name field label",
    fallback: "Your name",
  },
  {
    key: "claim.form.contact.label",
    page: "Claim listing",
    label: "Contact field label",
    fallback: "Phone number (or email)",
  },
  {
    key: "claim.form.contact.hint",
    page: "Claim listing",
    label: "Contact field hint",
    fallback: "Phone is best — the Chamber verifies claims by phone.",
  },
  {
    key: "claim.form.message.label",
    page: "Claim listing",
    label: "Message field label (the field is optional)",
    fallback: "Anything we should know",
  },
  {
    key: "claim.form.optional",
    page: "Claim listing",
    label: "Marker shown beside the optional field's label",
    fallback: "(optional)",
  },
  {
    key: "claim.form.submit",
    page: "Claim listing",
    label: "Submit button",
    fallback: "Send claim request",
  },
  {
    key: "claim.form.sending",
    page: "Claim listing",
    label: "Submit button while the request is in flight",
    fallback: "Sending…",
  },
  {
    key: "claim.form.cancel",
    page: "Claim listing",
    label: "Cancel button",
    fallback: "Cancel",
  },
  {
    key: "claim.form.success",
    page: "Claim listing",
    label: "Success message (shown after the request is received)",
    multiline: true,
    fallback:
      "Thanks — your request is with the Chamber. They'll reach out to verify before anything changes.",
  },
  {
    key: "claim.form.error",
    page: "Claim listing",
    label: "Generic failure message",
    fallback: "Could not send your request — please try again.",
  },
  // =============== END claim.* (claim-listing disclosure) ===============
] as const satisfies readonly CopyBlock[];

/** Union of every registered copy key — a typo at a call site is a tsc error. */
export type CopyKey = (typeof COPY_BLOCKS)[number]["key"];

const FALLBACKS = new Map<string, string>(COPY_BLOCKS.map((b) => [b.key, b.fallback]));

/** The registry-owned default wording for one block (E07: single-sourced). */
export function copyFallback(key: CopyKey): string {
  return FALLBACKS.get(key) ?? "";
}
