// The site-wide editable-copy registry.
//
// Each CopyBlock names one piece of headline text on a public page. The
// `fallback` is the exact string hardcoded in the page component — the page
// renders copyText(overrides, key, fallback), so an untouched block always
// tracks the code, and the admin UI (/admin/content) can show the current
// default next to any override. Overrides live in the "site-copy" overlay
// store (src/lib/stores/site-store.ts); this file is pure data and safe to
// import anywhere.
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

export const COPY_BLOCKS: CopyBlock[] = [
  // ------------------------------------------------------------- Home (/)
  {
    key: "home.hero.eyebrow",
    page: "Home",
    label: "Hero eyebrow",
    fallback: "Gateway to the Kitsap & Olympic Peninsulas",
  },
  {
    key: "home.hero.title1",
    page: "Home",
    label: "Hero headline, line 1",
    fallback: "You made the boat.",
  },
  {
    key: "home.hero.title2",
    page: "Home",
    label: "Hero headline, line 2 (the script “Kingston.” is appended after)",
    fallback: "Now make the most of",
  },
  {
    key: "home.hero.intro",
    page: "Home",
    label: "Hero intro paragraph",
    multiline: true,
    fallback:
      "Ferry times, food worth walking to, and everything happening in our little town on Appletree Cove — from the folks who live here.",
  },
  {
    key: "home.hero.ctaPrimary",
    page: "Home",
    label: "Primary button label",
    fallback: "Next boats →",
  },
  {
    key: "home.hero.ctaSecondary",
    page: "Home",
    label: "Secondary button label",
    fallback: "Plan my day",
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
      "Everything here is a walk from the ferry dock — two minutes to a crêpe, ten to the Village Green. Heads up: plenty of Kingston kitchens take orders by phone, not app. That's normal here.",
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
];
