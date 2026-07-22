// Seed event data for summer 2026, hand-checked on July 2, 2026 against the
// two authoritative calendars:
//   - Greater Kingston Chamber (GrowthZone): business.kingstonchamber.com/events
//     (dates/times pulled from the per-event iCal files, TZID America/Los_Angeles)
//   - Port of Kingston (The Events Calendar REST API): portofkingston.org/events
// Roadmap: replace this file with a server-side ingest of the Chamber's
// GrowthZone iCal feed (free, admin-generated) + the Port's Tribe API,
// deduped on title + start date. Until then, this is curated by hand.

import type { EventItem } from "../types";

const CHAMBER = "https://business.kingstonchamber.com/events/Details";

export const events: EventItem[] = [
  // ---------------------------------------------------------------- July
  {
    id: "july4-car-show-2026",
    title: "The Kingston 4th of July Car Show",
    start: "2026-07-04T15:00:00-07:00",
    end: "2026-07-04T18:00:00-07:00",
    venue: "Downtown Kingston",
    address: "10900 NE State Hwy 104, Kingston, WA 98346",
    description:
      "Classic and modern cars, trucks, and motorcycles right in the middle of town. Free to wander — a good warm-up before the fireworks.",
    category: "community",
    organizer: "Greater Kingston Chamber of Commerce",
    url: `${CHAMBER}/the-kingston-4th-of-july-car-show-1759097?sourceTypeId=Website`,
  },
  {
    id: "july4-fireworks-2026",
    title: "Kingston 4th of July Fireworks Show",
    start: "2026-07-04T22:15:00-07:00",
    end: "2026-07-04T22:35:00-07:00",
    venue: "Appletree Cove (Kingston waterfront)",
    address: "Mike Wallace Park, Kingston, WA 98346",
    description:
      "The show goes up over Appletree Cove at 10:15 PM. Best seats are Mike Wallace Park and the marina — bring a blanket and a layer, it cools off fast on the water.",
    category: "festival",
    organizer: "Greater Kingston Chamber of Commerce",
    url: `${CHAMBER}/kingston-4th-of-july-fireworks-show-1133348?sourceTypeId=Website`,
  },
  {
    id: "public-market-2026-07-05",
    title: "Kingston Public Market",
    start: "2026-07-05T10:00:00-07:00",
    end: "2026-07-05T15:00:00-07:00",
    venue: "Mike Wallace Marina Park",
    address: "25864 Washington Blvd NE, Kingston, WA 98346",
    description:
      "Local produce, crafts, and food vendors on the water next to the ferry dock — an easy walk-on trip. Every Sunday, 10 AM to 3 PM, through the season (it runs into October). Confirm dates on the Port of Kingston calendar.",
    category: "market",
    organizer: "Kingston Farmers Market",
    url: "https://portofkingston.org/event/kingston-public-market-99/",
    charityId: "kingston-farmers-market",
  },
  {
    id: "music-at-the-green-anzanga-2026-07-08",
    title: "Music at the Green: Anzanga (marimba)",
    start: "2026-07-08T18:30:00-07:00",
    end: "2026-07-08T21:00:00-07:00",
    venue: "Kingston Village Green Park",
    address: "26159 Dulay Rd NE, Kingston, WA 98346",
    description:
      "Free live music in Kingston Village Green Park — this week it's Anzanga's African marimba. Bring a lawn chair or a blanket. The Summer Outdoor Concert Series runs Wednesday evenings through August 26.",
    category: "music",
    organizer: "Kingston Village Green",
    url: `${CHAMBER}/anzanga-marimba-summer-outdoor-concert-series-1736704?sourceTypeId=Website`,
  },
  {
    id: "public-market-2026-07-12",
    title: "Kingston Public Market",
    start: "2026-07-12T10:00:00-07:00",
    end: "2026-07-12T15:00:00-07:00",
    venue: "Mike Wallace Marina Park",
    address: "25864 Washington Blvd NE, Kingston, WA 98346",
    description:
      "Sunday market on the marina lawn — produce, crafts, and food vendors, 10 AM to 3 PM. Weekly through the season; confirm dates on the Port of Kingston calendar.",
    category: "market",
    organizer: "Kingston Farmers Market",
    url: "https://portofkingston.org/event/kingston-public-market-100/",
    charityId: "kingston-farmers-market",
  },
  {
    id: "music-at-the-green-whozyamama-2026-07-15",
    title: "Music at the Green: Whozyamama (Cajun/zydeco)",
    start: "2026-07-15T18:30:00-07:00",
    end: "2026-07-15T21:00:00-07:00",
    venue: "Kingston Village Green Park",
    address: "26159 Dulay Rd NE, Kingston, WA 98346",
    description:
      "Free Cajun and zydeco on the Village Green lawn. Wednesdays through August 26 the series keeps going — steel drum, bluegrass, concert band, strings, rock & blues, and folk still to come.",
    category: "music",
    organizer: "Kingston Village Green",
    url: `${CHAMBER}/whozyamama-cajun-zydeco-summer-outdoor-concert-series-1736715?sourceTypeId=Website`,
  },
  {
    id: "public-market-2026-07-19",
    title: "Kingston Public Market",
    start: "2026-07-19T10:00:00-07:00",
    end: "2026-07-19T15:00:00-07:00",
    venue: "Mike Wallace Marina Park",
    address: "25864 Washington Blvd NE, Kingston, WA 98346",
    description:
      "Sunday market on the marina lawn — produce, crafts, and food vendors, 10 AM to 3 PM. Weekly through the season; confirm dates on the Port of Kingston calendar.",
    category: "market",
    organizer: "Kingston Farmers Market",
    url: "https://portofkingston.org/event/kingston-public-market-101/",
    charityId: "kingston-farmers-market",
  },
  {
    id: "kysa-golf-tournament-2026-07-24",
    title: "KYSA “Swing for Youth Sports” Golf Tournament",
    start: "2026-07-24T00:00:00-07:00",
    venue: "White Horse Golf Club",
    address: "22795 Three Lions Pl NE, Kingston, WA 98346",
    description:
      "Annual tournament supporting the Kingston Youth Sports Association. 18+, teams and sponsorships both welcome — spots fill fast. Register at kysagolf.com.",
    category: "sports",
    organizer: "Kingston Youth Sports Association",
    url: "https://www.kysagolf.com",
  },
  // -------------------------------------------------------------- August
  {
    id: "concerts-on-the-cove-jack-dwyer-trio-2026-08-01",
    title: "Concerts on the Cove: Jack Dwyer Trio",
    start: "2026-08-01T17:00:00-07:00",
    end: "2026-08-01T19:00:00-07:00",
    venue: "Mike Wallace Park",
    address: "25864 Washington Blvd, Kingston, WA 98346",
    description:
      "Bluegrass and honkytonk to open the Cove series. Bring chairs and blankets, pack a picnic or grab take-out from a spot downtown — there's a beer garden, and it's family-friendly. Saturdays at 5 PM through August 29.",
    category: "music",
    organizer: "Port of Kingston",
    url: `${CHAMBER}/kingston-s-concerts-on-the-cove-jack-dwyer-trio-1842288?sourceTypeId=Website`,
  },
  {
    id: "concerts-on-the-cove-abracadabra-trip-2026-08-08",
    title: "Concerts on the Cove: Abracadabra Trip",
    start: "2026-08-08T17:00:00-07:00",
    end: "2026-08-08T19:00:00-07:00",
    venue: "Mike Wallace Park",
    address: "25864 Washington Blvd, Kingston, WA 98346",
    description:
      "Funky rock and soul on the waterfront, 5 to 7 PM. Chairs, blankets, picnics welcome; beer garden on site. All are welcome.",
    category: "music",
    organizer: "Port of Kingston",
    url: `${CHAMBER}/kingston-s-concerts-on-the-cove-abracadabra-trip-1843375?sourceTypeId=Website`,
  },
  {
    id: "maritime-music-festival-2026-08-09",
    title: "Maritime Music Festival",
    start: "2026-08-09T09:00:00-07:00",
    end: "2026-08-09T17:00:00-07:00",
    venue: "Port Gamble",
    address: "Port Gamble, WA",
    description:
      "A day of sea shanties and pirate-themed fun in the historic mill town of Port Gamble — about a 15-minute drive from the Kingston ferry dock, and worth pairing with lunch there.",
    category: "festival",
    organizer: "Port Gamble",
    url: `${CHAMBER}/maritime-music-festival-1631673?sourceTypeId=Website`,
  },
  {
    id: "pie-in-the-park-2026-08-13",
    title: "Pie in the Park",
    start: "2026-08-13T16:30:00-07:00",
    end: "2026-08-13T18:30:00-07:00",
    venue: "Kingston Village Green Park",
    address: "26159 Dulay Rd NE, Kingston, WA 98346",
    description:
      "Free pie for everyone, plus pie-eating contests, face painting, and lawn games. An annual fundraiser for the Village Green Foundation, the volunteers who keep the Green going.",
    category: "charity",
    organizer: "Village Green Foundation",
    url: `${CHAMBER}/pie-in-the-park-1776053?sourceTypeId=Website`,
    charityId: "village-green-foundation",
  },
  {
    id: "concerts-on-the-cove-allswell-2026-08-15",
    title: "Concerts on the Cove: Allswell",
    start: "2026-08-15T17:00:00-07:00",
    end: "2026-08-15T19:00:00-07:00",
    venue: "Mike Wallace Park",
    address: "25864 Washington Blvd, Kingston, WA 98346",
    description:
      "Alternative folk rock by the marina, 5 to 7 PM. Chairs, blankets, picnics welcome; beer garden on site. Family-friendly.",
    category: "music",
    organizer: "Port of Kingston",
    url: `${CHAMBER}/kingston-s-concerts-on-the-cove-allswell-1843389?sourceTypeId=Website`,
  },
  {
    id: "concerts-on-the-cove-the-lumberjax-2026-08-22",
    title: "Concerts on the Cove: The Lumberjax",
    start: "2026-08-22T17:00:00-07:00",
    end: "2026-08-22T19:00:00-07:00",
    venue: "Mike Wallace Park",
    address: "25864 Washington Blvd, Kingston, WA 98346",
    description:
      "'80s hits on the waterfront, 5 to 7 PM. Bring chairs and blankets, pack a picnic, or grab take-out from a local favorite. Beer garden on site.",
    category: "music",
    organizer: "Port of Kingston",
    url: `${CHAMBER}/kingston-s-concerts-on-the-cove-the-lumberjax-1843394?sourceTypeId=Website`,
  },
  {
    id: "concerts-on-the-cove-noah-delos-reyes-2026-08-29",
    title: "Concerts on the Cove: Noah Delos Reyes & Friends",
    start: "2026-08-29T17:00:00-07:00",
    end: "2026-08-29T19:00:00-07:00",
    venue: "Mike Wallace Park",
    address: "25864 Washington Blvd, Kingston, WA 98346",
    description:
      "A Kingston local plays old-school country to close out the Cove season. 5 to 7 PM, beer garden on site, family-friendly — bring a chair and say goodbye to summer properly.",
    category: "music",
    organizer: "Port of Kingston",
    url: `${CHAMBER}/kingston-s-concerts-on-the-cove-noah-delos-reyes-friends-1843400?sourceTypeId=Website`,
  },
  // ----------------------------------------------------------- September
  {
    id: "public-market-2026-09-06",
    title: "Kingston Public Market",
    start: "2026-09-06T10:00:00-07:00",
    end: "2026-09-06T15:00:00-07:00",
    venue: "Mike Wallace Marina Park",
    address: "25864 Washington Blvd NE, Kingston, WA 98346",
    description:
      "The Sunday market keeps rolling into fall — produce, crafts, and food vendors on the marina lawn, 10 AM to 3 PM, with dates running into October. Confirm the schedule on the Port of Kingston calendar.",
    category: "market",
    organizer: "Kingston Farmers Market",
    url: "https://portofkingston.org/event/kingston-public-market-108/",
    charityId: "kingston-farmers-market",
  },
];
