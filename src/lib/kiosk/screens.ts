// The kiosk's screen catalogue — the ONE list of what the ferry-dock kiosk can
// show, and the only place a screen id is defined.
//
// Pure data with no imports, deliberately: the admin control (a client
// component), the kiosk layout and pages (server components), the store, and
// vitest all read this same array. Anything that pulled in the database here
// would make it unusable from the client half.
//
// Adding a screen is a two-step change and the order matters: add the entry
// here AND create src/app/(kiosk)/kiosk/<id>/page.tsx. The kiosk renders a tile
// only for screens that are BOTH listed here and present in the admin's
// enabledScreens, so a half-finished screen shows nothing rather than a dead
// tile — but tests/unit/kiosk-screens.test.ts fails the build on an entry with
// no page file, because a tile that leads nowhere is the worst possible outcome
// on an unattended device with no back button.

export const KIOSK_SCREENS = [
  {
    id: "ferry",
    label: "Ferry",
    blurb: "Next sailings to Edmonds",
    icon: "⛴️",
  },
  {
    id: "eat",
    label: "Eat & Drink",
    blurb: "What's open right now",
    icon: "🍴",
  },
  {
    id: "events",
    label: "Events",
    blurb: "Happening in town",
    icon: "📅",
  },
  {
    id: "map",
    label: "Map",
    blurb: "Find your way around",
    icon: "🗺️",
  },
  {
    id: "parking",
    label: "Parking",
    blurb: "Where to leave the car",
    icon: "🅿️",
  },
  {
    id: "stay",
    label: "Stay",
    blurb: "Rooms and lodging",
    icon: "🛏️",
  },
  {
    id: "do",
    label: "Things to Do",
    blurb: "Beaches, trails, shops",
    icon: "🌲",
  },
] as const;

export type KioskScreen = (typeof KIOSK_SCREENS)[number];
export type KioskScreenId = KioskScreen["id"];

export const KIOSK_SCREEN_IDS: readonly KioskScreenId[] = KIOSK_SCREENS.map((s) => s.id);

/**
 * What a kiosk shows before anyone has touched the admin page.
 *
 * The ferry-rider core is Ferry + Eat + Map (docs/KIOSK.md §12) — a walk-on
 * passenger has 20-60 seconds and wants the boat, food, and where things are.
 * Events and Parking earn their place because they are the two questions the
 * Chamber's front desk is asked most. Stay and Things to Do are built and
 * available but default OFF: they serve a visitor who is staying the night,
 * which is not who is standing at the dock, and seven tiles is more than a
 * hurried person reads.
 */
export const DEFAULT_ENABLED_SCREENS: readonly KioskScreenId[] = [
  "ferry",
  "eat",
  "events",
  "map",
  "parking",
];

/** Narrow an unknown value to a real screen id — the API's input filter. */
export function isKioskScreenId(value: unknown): value is KioskScreenId {
  return typeof value === "string" && (KIOSK_SCREEN_IDS as readonly string[]).includes(value);
}

/** Screens to render, in catalogue order, for a given enabled list. */
export function enabledScreensInOrder(enabled: readonly string[]): KioskScreen[] {
  return KIOSK_SCREENS.filter((s) => enabled.includes(s.id));
}
