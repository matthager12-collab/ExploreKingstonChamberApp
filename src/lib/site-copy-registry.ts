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
    fallback:
      "Two boats serve Kingston: the Edmonds–Kingston car ferry — about 30 minutes, every day, walk-ons welcome — and a passengers-only fast ferry straight to downtown Seattle in 39 minutes.",
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
    fallback:
      "Kingston's parking universe is small but full of gotchas: a paid Port lot by the marina, a commuter lot one block up, a strictly enforced free 2-hour row, a couple of genuinely unrestricted streets, and two free park & rides. The Chamber's live parking map shows where to leave the car — color-coded by type, with owner, payment, and time-limit details.",
  },
  {
    key: "parking.map.subtitle",
    page: "Parking",
    label: "Map section subtitle",
    multiline: true,
    fallback:
      "The Chamber's live parking map, built and kept current in the portal. Tap any lot for its type, owner, how to pay, and time limits. Colors are set automatically by parking type.",
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
    fallback:
      "Eleven WSDOT cameras watch the Edmonds–Kingston run. They're still images, not video — most update about once a minute — but they'll tell you how long the ferry line is before you commit to getting in it.",
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
    fallback: "When the overhead signs at **SR 104 & Barber Cutoff Rd** are flashing, Kingston's boarding-pass system is on. Follow the signal into the ferry lane, **take a pass at the dispenser near Lindvog Rd**, then wait for a green light to pull up to the tollbooths — leave the line and your pass is void.",
  },
  {
    key: "ferryLine.body2",
    page: "Ferry line card",
    label: "\"Active daily …\" line",
    multiline: true,
    rich: true,
    fallback: "Active daily **8 a.m.–8 p.m.** in season, plus weekends and holidays. Walk-ons, cyclists, and motorcycles skip it.",
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
    fallback:
      "From Edmonds, the car ferry reaches Kingston in about 30 minutes, every day, and walk-ons are always welcome — board at the Edmonds dock. There's also a passengers-only fast ferry from downtown Seattle's Pier 50 to Kingston in 39 minutes.",
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
    fallback:
      "There are **no vehicle reservations** on this run, so in summer arrive early — the Edmonds car line can fill hours ahead of the boat you want.",
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
    fallback: "Uses your location once, rounded to about a block, to sort this list — helps Kingston's visitor stats too.",
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
    fallback: "Built with the Greater Kingston Chamber of Commerce, publisher of [explorekingstonwa.com](https://explorekingstonwa.com). Ferry data courtesy of WSDOT. Always confirm sailings with Washington State Ferries before traveling.",
  },
] as const satisfies readonly CopyBlock[];

/** Union of every registered copy key — a typo at a call site is a tsc error. */
export type CopyKey = (typeof COPY_BLOCKS)[number]["key"];

const FALLBACKS = new Map<string, string>(COPY_BLOCKS.map((b) => [b.key, b.fallback]));

/** The registry-owned default wording for one block (E07: single-sourced). */
export function copyFallback(key: CopyKey): string {
  return FALLBACKS.get(key) ?? "";
}
