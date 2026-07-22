import type { Itinerary } from "@/lib/types";

// Hand-built itineraries using verified Kingston businesses and public parks.
// Times are pegged to typical Edmonds-Kingston arrivals (boats roughly every
// 50 minutes from early morning) — plausible, not gospel. Always check /ferry.
export const itineraries: Itinerary[] = [
  {
    id: "walk-on-half-day",
    slug: "walk-on-half-day",
    title: "The Walk-On Wander",
    tagline:
      "Leave the car in Edmonds. Everything good in Kingston is within three blocks of the dock.",
    duration: "About 5 hours",
    mode: "walk-on",
    audience: ["Couples", "Solo travelers", "No car needed"],
    stops: [
      {
        time: "9:40 AM",
        title: "Walk off the ferry",
        description:
          "Foot passengers roll off first. Bonus: WSF collects the walk-on fare only on the Edmonds side, so your ride home from Kingston is already paid. The whole town is flat and close — no plan B required.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
      {
        time: "9:50 AM",
        title: "Coffee and a crêpe at J'aime Les Crêpes",
        description:
          "A French creperie that's been at it since 2003, two minutes from the dock and open daily from early morning. Get a sweet crêpe with your coffee and take it slow — the boat crowd thins out fast.",
        mapQuery: "J'aime Les Crêpes, 11264 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "10:40 AM",
        title: "Mike Wallace Park and the marina boardwalk",
        description:
          "The little waterfront park right beside the ferry dock. Wander the marina docks, watch sailboats come and go on Appletree Cove, and look for your ferry making its return run to Edmonds.",
        mapQuery: "Mike Wallace Park, Kingston, WA",
      },
      {
        time: "12:15 PM",
        title: "Lunch at Sourdough Willy's Pizzeria",
        description:
          "Pizza built on a century-old sourdough starter — the crust is the point. Opens at noon daily, a short walk up Highway 104. If pizza's not the mood, The Saucy Sailor next block over does gourmet fast-casual with vegan and gluten-free options.",
        mapQuery: "Sourdough Willy's Pizzeria, 11265 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "1:30 PM",
        title: "Stroll up to the Village Green",
        description:
          "An easy 15-minute walk from downtown brings you to Kingston's community heart — big lawn, community center, and a second small cluster of shops and eateries nearby on Central Ave.",
        mapQuery: "Kingston Village Green Community Center, Kingston, WA",
      },
      {
        time: "2:30 PM",
        title: "Milkshake at The Grub Hut",
        description:
          "Old-school burgers-and-shakes joint on the walk back toward the dock. A shake for the road is the correct move. They're call-in friendly if there's a line: (360) 881-0147.",
        mapQuery: "The Grub Hut, 11130 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "3:15 PM",
        title: "Amble back for the boat",
        description:
          "You're five minutes from the terminal, and walk-ons never miss the boat the way cars do. Grab a bench, watch the ferry come in, and board for free — you paid in Edmonds.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "family-day",
    slug: "family-day",
    title: "Family Beach Day",
    tagline:
      "Driftwood forts, Puget Sound's oldest lighthouse, forest trails, and pizza. Kids sleep on the boat home.",
    duration: "Full day",
    mode: "car",
    audience: ["Families", "Kids", "Beach lovers"],
    stops: [
      {
        time: "10:25 AM",
        title: "Drive off the ferry",
        description:
          "Roll off in Kingston and you're 20 minutes from one of the best beaches on the Sound. Top off snacks and water in town before you head north — services get thin past Kingston.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
      {
        time: "10:40 AM",
        title: "Picnic pickup at The Grub Hut",
        description:
          "Burgers, fries, and shakes travel well to a beach log. Call ahead — (360) 881-0147 — and plan ahead: big call-in orders add up fast with three kids.",
        mapQuery: "The Grub Hut, 11130 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "11:15 AM",
        title: "Point No Point County Park",
        description:
          "A long driftwood-strewn beach with views across the shipping lanes — freighters, seals, and on a lucky day, orcas. The driftwood begs to be built into forts. Watch the tide if you spread a blanket low on the beach.",
        mapQuery: "Point No Point County Park, Hansville, WA",
      },
      {
        time: "1:00 PM",
        title: "Point No Point Lighthouse",
        description:
          "The oldest lighthouse on Puget Sound, lighting the entrance to Admiralty Inlet since 1879. It's a short flat walk from the parking area, and the keeper's grounds are a great photo stop even when the tower itself is closed.",
        mapQuery: "Point No Point Lighthouse, Hansville, WA",
      },
      {
        time: "2:30 PM",
        title: "North Kitsap Heritage Park",
        description:
          "Hundreds of acres of second-growth forest with wide, kid-tolerant gravel trails on the drive back toward Kingston. A 45-minute loop burns off exactly the right amount of remaining energy.",
        mapQuery: "North Kitsap Heritage Park, Kingston, WA",
      },
      {
        time: "4:30 PM",
        title: "Early pizza at Sourdough Willy's",
        description:
          "Back in town, split pizzas made on a century-old sourdough starter. Open until 8, but going early means you beat the dinner rush and keep your ferry options open.",
        mapQuery: "Sourdough Willy's Pizzeria, 11265 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "5:45 PM",
        title: "Get in the ferry line",
        description:
          "Summer evenings eastbound can back up, especially Sundays and holidays. Check the Kingston terminal status before you commit to the line — if it's long, that's your excuse for a second dessert.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "rainy-day",
    slug: "rainy-day",
    title: "Rainy Day Kingston",
    tagline:
      "Crêpes, curry, a forest walk in the mist, and a taproom to dry out in. Rain is a feature here.",
    duration: "Half day, easily stretched",
    mode: "either",
    audience: ["All-weather walkers", "Couples", "Cozy seekers"],
    stops: [
      {
        time: "10:30 AM",
        title: "Warm up at J'aime Les Crêpes",
        description:
          "Steamed-up windows, hot coffee, and a savory crêpe while the rain does its thing. Open daily from early morning, two minutes' walk from the dock.",
        mapQuery: "J'aime Les Crêpes, 11264 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "11:15 AM",
        title: "Kingston Public Market at Mike Wallace Park (Sundays)",
        description:
          "In season, the Kingston Public Market sets up under canopies at the little park by the marina on Sundays, 10 AM–3 PM — vendors show up rain or shine, and the crowd is friendlier in the drizzle. Not a Sunday, or shoulder season? Check our Events page for dates and stroll the marina boardwalk instead.",
        mapQuery: "Mike Wallace Park, Kingston, WA",
      },
      {
        time: "12:30 PM",
        title: "Curry at Nirvana Indian & Nepali Cuisine",
        description:
          "Rain food, solved. Indian and Nepali classics a short walk up Highway 104 — order a thali or a curry hot enough to fog your glasses from the inside.",
        mapQuery: "Nirvana Indian & Nepali Cuisine, 11171 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "2:00 PM",
        title: "A short forest walk, properly misty",
        description:
          "Puget Sound forests are at their best in the rain. With a car, hit the gravel loops at North Kitsap Heritage Park — good drainage, big trees, zero mud drama. On foot, the paths around the Village Green scratch the same itch in 20 minutes.",
        mapQuery: "North Kitsap Heritage Park, Kingston, WA",
      },
      {
        time: "3:30 PM",
        title: "Dry out at Friends and Neighbors Brewing",
        description:
          "Kingston's taproom pours a wall of rotating taps and welcomes dogs and kids. Prefer a pub? The Kingston Ale House across the way does American and seafood classics.",
        mapQuery: "Friends and Neighbors Brewing, 10991 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "5:00 PM",
        title: "Linger or catch the boat",
        description:
          "If it's Thursday through Sunday and you're 21+, Cellar Cat wine bar pours by the glass with live jazz some nights — a very good reason to take a later ferry. Otherwise, the dock is five minutes away.",
        mapQuery: "Cellar Cat, 11253 State Hwy 104 NE, Kingston, WA",
      },
    ],
  },
  {
    id: "gateway-olympics",
    slug: "gateway-olympics",
    title: "Gateway to the Olympics",
    tagline:
      "Kingston is the shortcut to Olympic National Park. Early boat, historic Port Gamble, then over the Hood Canal Bridge.",
    duration: "Full day (a long one)",
    mode: "car",
    audience: ["Road-trippers", "Hikers", "National park baggers"],
    stops: [
      {
        time: "7:15 AM",
        title: "Arrive on an early boat",
        description:
          "Car ferries run from early morning, roughly every 50 minutes. The earlier you cross, the shorter the westbound traffic and the more mountain you get. Book nothing before 10 on the peninsula and you'll never feel rushed.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
      {
        time: "7:25 AM",
        title: "Drive-thru breakfast at The Cup & Muffin",
        description:
          "Espresso and breakfast sandwiches from a drive-thru right on your way out of town — open daily from 6 AM, so it's ready before you are. No need to leave the car.",
        mapQuery: "The Cup & Muffin, 10969 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "7:50 AM",
        title: "Stroll historic Port Gamble",
        description:
          "Ten minutes west on SR 104, Port Gamble is a preserved 1850s company mill town — New England-style houses, a general store, and big maples over the main street. At this hour you'll mostly have it to yourself; give it 45 unhurried minutes.",
        mapQuery: "Port Gamble, WA",
      },
      {
        time: "9:00 AM",
        title: "Cross the Hood Canal Bridge",
        description:
          "SR 104 floats across Hood Canal about 14 miles west of Kingston. Heads-up: the drawspan opens for Navy and large vessel traffic and can stop cars for 45 minutes or more, unannounced. If you're stopped, it's not you — enjoy the canal view.",
        mapQuery: "Hood Canal Bridge, WA",
      },
      {
        time: "10:30 AM",
        title: "Into Olympic National Park country",
        description:
          "From the bridge it's roughly an hour to Sequim and 90 minutes to Port Angeles, the main gateways to Olympic National Park — Hurricane Ridge, lavender farms, and the Dungeness Spit are all in reach. Pick one mountain thing and one water thing; don't try for three.",
        mapQuery: "Olympic National Park Visitor Center, Port Angeles, WA",
      },
      {
        time: "4:30 PM",
        title: "Plan the boat home before you drive back",
        description:
          "Before you point the car east, check the Kingston terminal on the Ferry page — summer evening sailings to Edmonds can back up, and you want to know before you re-cross the Hood Canal Bridge, not after. If the line is ugly, dinner in Kingston is a much better waiting room than the holding lanes.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
];

export function getItinerary(slug: string): Itinerary | undefined {
  return itineraries.find((i) => i.slug === slug);
}
