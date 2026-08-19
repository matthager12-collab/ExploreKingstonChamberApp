import type { Itinerary } from "@/lib/types";

// Hand-built itineraries using verified Kingston businesses and public parks.
// Times are pegged to typical Edmonds-Kingston arrivals (boats roughly every
// 50 minutes from early morning) — plausible, not gospel. Always check /ferry.
//
// SOURCING RULE (added 2026-08-19, after visitor feedback that the content read
// as generic and that "ExploreKingston" claimed a lighthouse at Alki Point —
// which is in West Seattle, in King County, across the Sound). That error was
// on the Chamber's WordPress site, not here, but the lesson governs this file:
//
//   1. Every business, park, price, and opening time traces to the operator's
//      own source, checked on the date in the note beside it. Kingston-town
//      hours come from src/lib/data/restaurants.ts, which is two-source
//      verified and carries its own dispute notes — do not restate hours here
//      that contradict that file.
//   2. NEVER send a visitor to a closed door. Where a place keeps a short or
//      seasonal week (Heronswood Wed–Sun; Suquamish Museum Wed–Fri; the Port
//      Gamble Historic Museum Thu–Sun, May–Sept; Argensol Thu–Sun; the Point
//      No Point tower Sat–Sun, Apr–Sept), the itinerary SAYS SO in the stop,
//      rather than quietly assuming the reader arrives on a good day.
//   3. Where sources genuinely conflict, say that too and give the phone
//      number — see the Point No Point parking note, where Kitsap County's own
//      pages disagreed about the main lot on 2026-08-19. An honest "call
//      first" beats a confident wrong answer, which is what started all this.
//   4. Distances and drive times are approximate and labelled as such. The
//      mapQuery deep link is what actually routes the visitor.
//
// Two of these records — walk-on-half-day and family-day — are ALSO overridden
// by an admin overlay in production (custom-wins-by-id), so edits here do not
// change what those two pages show. Fix those in Admin → Itineraries.
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
          "The oldest lighthouse on Puget Sound: built in 1879 and first lit in 1880. It's a short flat walk from the parking area, and the keeper's grounds are a great photo stop even when the tower itself is closed. Volunteer docents open the tower Saturdays and Sundays, noon to 4, April through September.",
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
          "Rain food, solved. Indian and Nepali classics a short walk up Highway 104 — order a thali or a curry hot enough to fog your glasses from the inside. Check the day before you count on lunch here: they open at noon Friday through Monday, but not until 4 PM on Wednesday and Thursday, and they're closed Tuesdays. Los Tres Compadres up the road opens at 11 every day but Sunday.",
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
          "Kingston's taproom pours a wall of rotating taps and welcomes dogs and kids — but it opens at 2 PM only on Saturday and Sunday, and at 4 PM Tuesday through Friday (closed Mondays). If you're early, or it's a Monday, The Kingston Ale House across the way opens at 11 daily and does American and seafood classics.",
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
          "About fifteen minutes west on SR 104, Port Gamble is a preserved 1850s company mill town — New England-style houses, a general store, and big maples over the main street. At this hour you'll mostly have it to yourself; give it 45 unhurried minutes.",
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
  {
    id: "heronswood-garden-day",
    slug: "heronswood-garden-day",
    title: "A Day at Heronswood",
    tagline:
      "Fifteen acres of one of the country's great plant collections, tended by the Port Gamble S'Klallam Tribe — and you can reach it without a car.",
    duration: "About 6 hours",
    mode: "either",
    audience: ["Garden lovers", "Couples", "Easy pace", "Leashed dogs welcome"],
    stops: [
      {
        time: "9:00 AM",
        title: "First, check the day — this one is not a Monday plan",
        description:
          "Heronswood opens Wednesday through Sunday, 9 AM to 3 PM, from April 1 to October 11, with last entry at 2:30. From October 12 through the end of March it's weekends only, same hours. Come on a Monday or Tuesday in summer and the gate is shut, so build the rest of the day around the garden rather than the other way round.",
        mapQuery: "Heronswood Garden, 7530 NE 288th St, Kingston, WA",
      },
      {
        time: "9:40 AM",
        title: "Walk off the ferry — and decide about the shuttle",
        description:
          "You do not need a car for this. The Point Casino & Hotel runs a complimentary shuttle from the Kingston ferry terminal to the casino and on to Heronswood, then back to the boat. Check the casino's current schedule before you travel, and call (360) 655-5471 when you're ready to be collected from the garden. Driving instead? The garden is north of town, off NE 288th Street.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
      {
        time: "9:55 AM",
        title: "Coffee first at Over the Moon Coffee Roasters",
        description:
          "House-roasted coffee a couple of minutes from the ferry lanes, roasting in Kingston since 2020, with a brunch menu made in house. They're closed Tuesdays — which lines up neatly, because so is the garden.",
        mapQuery: "Over the Moon Coffee Roasters, 11229 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "10:45 AM",
        title: "Into the garden",
        description:
          "Admission is $15 for adults, $10 for ages 7 to 17, free for children 6 and under, and free for members and Port Gamble S'Klallam tribal members. Heronswood was founded in 1987 by Dan Hinkley and Robert Jones and grew into a plant collection with a worldwide reputation — some 8,000 varieties across fifteen acres. The Tribe bought it in 2012 and runs it through the Port Gamble S'Klallam Foundation.",
        mapQuery: "Heronswood Garden, 7530 NE 288th St, Kingston, WA",
      },
      {
        time: "11:15 AM",
        title: "Start with the S'Klallam Connections Garden",
        description:
          "The part of Heronswood you will not find at any other botanical garden: a planting of species that matter to the S'Klallam people — camas, sweetgrass, cedar. Read the signs slowly. It reframes everything you walk through afterwards as a place people have used, not just admired.",
        mapQuery: "Heronswood Garden, 7530 NE 288th St, Kingston, WA",
      },
      {
        time: "12:00 PM",
        title: "The woodland, the rock garden, and the old lumber camp",
        description:
          "The Woodland Garden shelters the hydrangea, barberry, aralia, begonia and lily collections under big trees. The Renaissance Garden fills a reclaimed lumber-camp clearing with ferns and cedars. In the Formal Gardens, the Potager is a boxwood parterre that was once the vegetable and herb plot and is now replanted seasonally with flowers. Give it two hours and you'll still be finding things.",
        mapQuery: "Heronswood Garden, 7530 NE 288th St, Kingston, WA",
      },
      {
        time: "1:45 PM",
        title: "Late lunch back in Kingston",
        description:
          "The garden has no restaurant, so eat afterwards. Back in town, The Saucy Sailor does gourmet fast-casual with serious vegan and gluten-free options, and Sourdough Willy's is open daily from noon. If you took the shuttle, The Point Casino has food on site — ring (360) 655-5471 when you want collecting from the garden, and check with them how the return leg runs.",
        mapQuery: "The Saucy Sailor, 11252 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "3:00 PM",
        title: "Plants you can take home, and a bookshop",
        description:
          "Heronswood runs plant sales through the season — a spring sale in May and an autumn one in September are the big ones, plus classes and the Hydrangea Festival in August. Check their events page before you come if you want to buy. Otherwise, Saltwater Bookshop up at Kingston Center has a good gardening shelf and is a fine way to spend the last hour — it keeps its own hours and doesn't post them widely, so ring ahead on (360) 638-6136 if it's late in the day.",
        mapQuery: "Saltwater Bookshop, Kingston, WA",
      },
      {
        time: "4:15 PM",
        title: "Back to the boat",
        description:
          "Walk-ons never miss the ferry the way cars do, and your ride home is already paid — WSF collects the walk-on fare on the Edmonds side only. Check the Ferry page for tonight's sailings before you settle onto a bench.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "suquamish-day",
    slug: "suquamish-day",
    title: "A Day in Suquamish",
    tagline:
      "The Suquamish Tribe tells its own story, in its own museum, on its own land — fifteen minutes from the Kingston dock.",
    duration: "Full day",
    mode: "car",
    audience: ["History & culture", "Museums", "Easy pace"],
    stops: [
      {
        time: "9:00 AM",
        title: "Come on a Wednesday, Thursday or Friday",
        description:
          "The Suquamish Museum's posted hours are currently temporary and narrow: Wednesday through Friday, 9 AM to 4 PM, closed Saturday through Tuesday. That is unusual enough — and important enough to the day — that you should check suquamishmuseum.org before you drive over. Everything else on this list is open whenever you arrive.",
        mapQuery: "Suquamish Museum, 6861 NE South St, Suquamish, WA",
      },
      {
        time: "10:00 AM",
        title: "Drive south to Suquamish",
        description:
          "About fifteen minutes from the ferry: west on Highway 104, then south on Miller Bay Road NE. (Not Bond Road — that is SR 307, and it runs to Poulsbo, not Suquamish.) No car? Kitsap Transit's route 391 runs from the Kingston terminal through Suquamish and Poulsbo to the Bainbridge ferry. Times change, so scan the schedule on your phone rather than trusting a printed one.",
        mapQuery: "Suquamish, WA",
      },
      {
        time: "10:20 AM",
        title: "The Suquamish Museum",
        description:
          "Admission is $8 for adults, $6 for elders 55 and over and for youth 5 to 17, free under 5, and $18 for a family of four to six. The permanent exhibit, Ancient Shores – Changing Tides, is built around a carved canoe roughly three centuries old that was last paddled in the 1989 Paddle to Seattle. Photography without flash is fine in the exhibit hall; leave outside food and drink in the car.",
        mapQuery: "Suquamish Museum, 6861 NE South St, Suquamish, WA",
      },
      {
        time: "12:00 PM",
        title: "The Leota Anthony Museum Store",
        description:
          "Native-made jewellery, art and books, with a consignment programme that puts money directly back to the makers. If you buy one thing on this trip, buy it here rather than at an airport.",
        mapQuery: "Suquamish Museum, 6861 NE South St, Suquamish, WA",
      },
      {
        time: "12:40 PM",
        title: "Chief Seattle's grave",
        description:
          "In the Suquamish Memorial Cemetery beside St. Peter's, about a five-minute walk from the museum, with free parking at the church. The memorial carries interpretive signage and was rededicated in 2011. It is a working cemetery and Suquamish families still bury their dead here — walk quietly, stay on the paths, and treat it as you would any family's burial ground.",
        mapQuery: "Chief Seattle Grave, Suquamish Memorial Cemetery, Suquamish, WA",
      },
      {
        time: "1:30 PM",
        title: "Old Man House Park",
        description:
          "An acre of waterfront where the great longhouse of D'Suq'Wub stood — the village Chief Seattle lived in. Washington State Parks returned the site to the Tribe in 2004. There's a grass terrace running down to a sandy beach and a vault toilet, dogs on leash. It is an active cultural site the Tribe still uses for ceremony, not an exhibit.",
        mapQuery: "Old Man House Park, Suquamish, WA",
      },
      {
        time: "2:30 PM",
        title: "The House of Awakened Culture, from outside",
        description:
          "The big cedar longhouse on the water is a working community building — ceremonies, funerals, weddings, naming events — and not somewhere you can wander into on a Tuesday afternoon. Look from the grounds. If you want to see it alive, come for Chief Seattle Days, which the Tribe holds every August.",
        mapQuery: "House of Awakened Culture, Suquamish, WA",
      },
      {
        time: "3:15 PM",
        title: "Coffee or an early dinner at Clearwater",
        description:
          "The Suquamish Tribe's resort sits on Agate Passage a couple of minutes away and has six places to eat, from a deli and a coffee bar to a seafood restaurant. The restaurants are open to everyone; the gaming floor has its own age policy, which the resort posts.",
        mapQuery: "Clearwater Casino Resort, 15347 Suquamish Way NE, Suquamish, WA",
      },
      {
        time: "4:45 PM",
        title: "North again for the boat",
        description:
          "Fifteen minutes back to Kingston. Check the terminal on the Ferry page before you leave Suquamish — if the eastbound line has grown, you would rather learn that now and have dinner in Kingston than learn it in the holding lanes.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "port-gamble-day",
    slug: "port-gamble-day",
    title: "Port Gamble, All Day",
    tagline:
      "An 1850s company mill town with its New England bones intact, a quarter-hour west — shops, a free shell museum, forest trails, and a boat on the bay.",
    duration: "Full day",
    mode: "car",
    audience: ["History", "Shoppers", "Families", "Easy pace"],
    stops: [
      {
        time: "8:35 AM",
        title: "Off the boat and straight to coffee",
        description:
          "The Cup & Muffin is a drive-thru at the top of the Kingston strip, open daily from 6 AM, so you can be caffeinated without leaving the car. Port Gamble is about fifteen minutes further west on SR 104.",
        mapQuery: "The Cup & Muffin, 10969 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "9:15 AM",
        title: "Walk the town before the day warms up",
        description:
          "Come Thursday to Sunday if you possibly can — that is the honest shape of this day. All three of Port Gamble's sit-down kitchens are shut on Monday and Tuesday, Butcher & Baker is shut Wednesday too, and several of the shops keep the same short week. Mondays and Tuesdays you get the town and the walking, not the eating. Wandering it is free and always has been: the Pope & Talbot mill company built it in the 1850s in the image of East Machias, Maine — clapboard houses, big maples, a church on the rise. St. Paul's, built in 1879, is now largely a wedding venue. At this hour you will have the street mostly to yourself.",
        mapQuery: "Port Gamble, WA",
      },
      {
        time: "10:00 AM",
        title: "The General Store, and the shells upstairs",
        description:
          "The Port Gamble General Store & Cafe is open daily and has a gift shop, a cafe, and — up on the second floor — the Sea & Shore Museum, free to walk into and billed as the second-largest privately owned shell collection in the world. It has been assembled since the 1970s. It is a genuinely strange and wonderful thing to find above a small-town store.",
        mapQuery: "Port Gamble General Store & Cafe, 32400 Rainier Ave NE, Port Gamble, WA",
      },
      {
        time: "11:15 AM",
        title: "The shops, which are the real reason people come back",
        description:
          "A short row of them, all independent: The Artful Ewe and Gamble Bay Textiles for yarn and cloth, Quilted Strait for quilting, Artful Connextions, Pretty Stick, and the WISH gift shop. Several keep short weeks — The Artful Ewe is Friday to Sunday only, and Gamble Bay Textiles and Artful Connextions are both shut Monday and Tuesday. This is a browsing town, not a rushing one.",
        mapQuery: "Port Gamble, WA",
      },
      {
        time: "12:30 PM",
        title: "Lunch at Butcher & Baker Provisions",
        description:
          "A farmhouse restaurant, butcher shop and bakery on SR 104 in town, run by chefs Adam Sawasy and Patricia Horton — the best-known kitchen in Port Gamble. It opens Thursday to Sunday, as does House 11 Taproom; Whiskey and Waffles runs Wednesday to Sunday. So on a Monday or Tuesday all three are dark and the General Store & Cafe, open daily, is your lunch. Steel Bridge Coffee handles the rest.",
        mapQuery: "Butcher & Baker Provisions, 4719 NE State Hwy 104, Port Gamble, WA",
      },
      {
        time: "2:00 PM",
        title: "The Port Gamble Historic Museum — but only in season",
        description:
          "Free to enter, and open Thursday through Sunday, noon to 5 PM, from May 1 to September 27. Outside that window the door is locked, so this is a stop that only exists for part of the year. It walks through the mill's story and the company town it paid for.",
        mapQuery: "Port Gamble Historic Museum, Port Gamble, WA",
      },
      {
        time: "3:00 PM",
        title: "Trees or water, your choice",
        description:
          "Port Gamble Forest Heritage Park runs right up against the town with a well-used network of trails through second growth — walkers and mountain bikers share it. Or go out on the bay: Olympic Outdoor Center on Rainier Avenue rents kayaks, paddleboards and bikes, Monday to Saturday 10 to 6 and Sunday 10 to 5, with last rentals ninety minutes before closing.",
        mapQuery: "Olympic Outdoor Center, 32379 Rainier Ave NE, Port Gamble, WA",
      },
      {
        time: "5:00 PM",
        title: "Back to Kingston for dinner and the boat",
        description:
          "A quarter-hour back east. The Kingston Ale House opens at 11 daily and runs late at the weekend, and Sourdough Willy's is open until 8. Check the Ferry page for the eastbound line before you commit to a table.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "hansville-north-end",
    slug: "hansville-north-end",
    title: "The Wild North End",
    tagline:
      "The oldest lighthouse on Puget Sound, a beach where the shipping lanes come close, and a preserve worth timing to the tide.",
    duration: "Full day",
    mode: "car",
    audience: ["Hikers", "Beachcombers", "Wildlife watching", "Moderate pace"],
    stops: [
      {
        time: "9:20 AM",
        title: "Stock up before you go north",
        description:
          "Grocery Outlet and the Kingston Center shops are your last full supermarket. Past Kingston the services thin out fast — Hansville has one grocery and not much else — so get water, snacks and a full tank now.",
        mapQuery: "Grocery Outlet, Kingston, WA",
      },
      {
        time: "10:00 AM",
        title: "Point No Point County Park",
        description:
          "About twenty minutes and ten miles north. A wide sandy beach piled with driftwood, right where the shipping lanes swing close — freighters, seals, and on a good day whales. Read this before you drive up: Kitsap County's own two pages disagree. The park page says the park has reopened after shoreline restoration, while the county's Parks FAQ says the main lot \"remains closed due to the significant damage caused by the past winter storms\" with the park open to pedestrians. That same FAQ points to the Washington Department of Fish and Wildlife lot on Point No Point Road, open for the summer season and needing a Discover Pass. Park there and you're fine either way; ring Kitsap Parks on (360) 337-5350 if you want it settled first.",
        mapQuery: "Point No Point County Park, Hansville, WA",
      },
      {
        time: "11:15 AM",
        title: "Point No Point Lighthouse",
        description:
          "Built in 1879 and first lit in 1880, which makes it the oldest lighthouse on Puget Sound. It is a short square tower — about thirty feet — rather than the tall column people expect, and it is all the more charming for it. Volunteer docents open it for tours on Saturdays and Sundays, noon to 4, April through September. Outside those months and days you are admiring it from the grounds, which is still worth the drive.",
        mapQuery: "Point No Point Lighthouse, Hansville, WA",
      },
      {
        time: "12:00 PM",
        title: "About that second lighthouse on the map",
        description:
          "You may spot Skunk Bay Lighthouse a few miles up the shore and wonder why nobody mentions it. It is private — built in 1964 by a former keeper, now held by a small association of owners who ask visitors not to come up to it. Admire it from the water or from a distance, and leave the residents alone. Point No Point is the one you can walk into.",
        mapQuery: "Norwegian Point Park, Hansville, WA",
      },
      {
        time: "12:30 PM",
        title: "Lunch at Hansville Grocery & Hansgrill",
        description:
          "The only real kitchen in the village, on Twin Spits Road, open daily — breakfast until about 11:15, then lunch and dinner through the afternoon. It is a grocery and a grill in one building, and on a weekday it is mostly locals.",
        mapQuery: "Hansville Grocery, 7525 NE Twin Spits Rd, Hansville, WA",
      },
      {
        time: "1:45 PM",
        title: "Foulweather Bluff Preserve — check the tide first",
        description:
          "A hundred acres of forest and marsh belonging to The Nature Conservancy, with about a mile of walking round trip — a short half-mile through the trees each way — out to nearly 3,800 feet of beach. Free, daylight hours, no pass. Two hard rules: no dogs at all, service animals excepted, because the intertidal is what the preserve exists to protect; and parking is roadside on Twin Spits Road with space for perhaps seven to ten cars, so arrive early on a sunny weekend. Come at low tide or you will miss the point of it.",
        mapQuery: "Foulweather Bluff Preserve, Hansville, WA",
      },
      {
        time: "3:15 PM",
        title: "Buck Lake and the Hansville Greenway",
        description:
          "Buck Lake County Park is open 8 to 5, with a playground, ball field and courts, and a swimming area with life-jacket kiosks you can borrow from. It is also the main trailhead for the Hansville Greenway, about nine and a half miles of trail in total; the signature loop is 2.6 miles, easy, roughly a hundred feet of climb, and fine for leashed dogs. Note the park restrooms close annually from October 1 through March 31.",
        mapQuery: "Buck Lake County Park, Hansville, WA",
      },
      {
        time: "5:00 PM",
        title: "A pint back in Kingston",
        description:
          "Friends and Neighbors Brewing took over the old Downpour building on Highway 104 and pours a wall of rotating taps, dogs and kids welcome. Doors at 2 PM on Saturday and Sunday and 4 PM midweek. Mondays are the one to check — they have been dark on Mondays through this summer, with the night due back in September.",
        mapQuery: "Friends and Neighbors Brewing, 10991 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "6:15 PM",
        title: "The boat home",
        description:
          "Check the Ferry page before you join the queue. Summer evenings eastbound can back up, and if the boarding-pass system is running you will pick up a ticket near Lindvog Road before the tollbooth — which usually buys you time to walk back for food.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "taste-of-kingston",
    slug: "taste-of-kingston",
    title: "Eat Your Way Off the Boat",
    tagline:
      "Argentinian empanadas, a century-old sourdough starter, house-roasted coffee and a jazz cellar — all within about ten minutes' walk of the dock.",
    duration: "About 5 hours",
    mode: "walk-on",
    audience: ["Food lovers", "Couples", "No car needed"],
    stops: [
      {
        time: "9:30 AM",
        title: "Come Thursday to Sunday if you can",
        description:
          "Kingston's kitchens keep small, individual weeks. Argensol only opens Thursday through Sunday, Cellar Cat is Thursday through Sunday, Borrowed Kitchen is closed Sunday and Monday, and Over the Moon is closed Tuesdays. A Friday or Saturday gets you the whole list; a Tuesday gets you about half of it.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
      {
        time: "9:50 AM",
        title: "Over the Moon Coffee Roasters",
        description:
          "They roast their own, two minutes from the ferry lanes, and have been at it in Kingston since 2020. Sandwiches, burritos and quiche made in house if you want to start properly rather than politely. Closed Tuesdays.",
        mapQuery: "Over the Moon Coffee Roasters, 11229 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "10:45 AM",
        title: "Empanadas at Argensol Kitchen",
        description:
          "Argentinian cooking on Washington Boulevard, just off the main strip and easy to walk past. Thursday 11 to 5, Friday 11 to 6, Saturday 10 to 6, Sunday 10 to 4 — closed the rest of the week, so this is the stop that sets your day.",
        mapQuery: "Argensol Kitchen, 25923 Washington Blvd NE, Kingston, WA",
      },
      {
        time: "12:00 PM",
        title: "Sourdough Willy's, or poke, or the vegan option",
        description:
          "Sourdough Willy's raises its pizza on a century-old starter and opens daily at noon — the crust is genuinely the point. If you'd rather not eat pizza standing up, Da Poke Shop is a block off the strip (closed Mondays) and The Saucy Sailor does chef-driven takeout with real vegan and gluten-free cooking.",
        mapQuery: "Sourdough Willy's Pizzeria, 11265 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "1:15 PM",
        title: "Walk up the hill to Kingston Center",
        description:
          "Ten to twelve minutes uphill on Highway 104, and it is a real hill. At the top: Grocery Outlet if you're provisioning a rental or a boat, and two bookshops a few doors apart — Saltwater Bookshop for new titles, Kingston Bookery for second-hand.",
        mapQuery: "Saltwater Bookshop, Kingston, WA",
      },
      {
        time: "2:15 PM",
        title: "Borrowed Kitchen Bakery, while there's still something left",
        description:
          "In the Kingston Center strip. Tuesday to Friday 8 to 5, Saturday 8 to 3, closed Sunday and Monday — and the pastries can sell out well before closing, so this is a go-early-or-shrug stop rather than a guarantee.",
        mapQuery: "Borrowed Kitchen Bakery, 10978 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "3:15 PM",
        title: "Downhill to a glass of something",
        description:
          "Cellar Cat is the 21-and-over room in the middle of the block and the one that is actually open at this hour — Thursday and Sunday 3 to 8, Friday and Saturday 3 to 10, with live jazz on some nights. The Lounge at d'Vine Bistro pours by the glass Wednesday to Saturday but not until 4 PM, so it is the stop after this one, not this one. Friends and Neighbors Brewing is the beer answer, five minutes further up.",
        mapQuery: "Cellar Cat, 11253 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "4:30 PM",
        title: "One more, or the boat",
        description:
          "The Kingston Ale House opens at 11 daily and does pub plates and seafood if you want to make it a dinner rather than a crawl. Otherwise the terminal is two minutes away and your ride home was paid for in Edmonds.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "easy-pace-waterfront",
    slug: "easy-pace-waterfront",
    title: "Take It Slow",
    tagline:
      "Flat ground, short distances, benches and a boat to watch. Everything here is within a few minutes of the terminal on the level.",
    duration: "About 4 hours",
    mode: "walk-on",
    audience: ["Gentle pace", "Short flat walks", "Grandparents and grandkids"],
    stops: [
      {
        time: "9:40 AM",
        title: "Off the boat, and no hurry",
        description:
          "The walk from the passenger ramp into town is short and level. Your ride home is already paid — WSF collects the walk-on fare on the Edmonds side only — so there is no ticket queue on this end and no reason to rush anything today.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
      {
        time: "9:55 AM",
        title: "Mike Wallace Park",
        description:
          "The waterfront park right beside the ferry dock: lawn, benches, and Appletree Cove in front of you. Public restrooms are on the waterfront promenade by the Port marina, with more by the boat launch — both locations come from the Port of Kingston's published map rather than our own field check, so allow a little slack in exactly where you find them.",
        mapQuery: "Mike Wallace Park, Kingston, WA",
      },
      {
        time: "10:40 AM",
        title: "The marina boardwalk",
        description:
          "Flat and even, out along the guest docks, and about as pleasant a place to push a stroller or a wheelchair as the town has. Sailboats come and go, and you can usually see your ferry making its return run to Edmonds.",
        mapQuery: "Port of Kingston Marina, Kingston, WA",
      },
      {
        time: "11:30 AM",
        title: "Lunch without leaving the flat",
        description:
          "J'aime Les Crêpes has been making sweet and savoury crêpes two minutes from the dock since 2003 and opens early. The Kingston Ale House is a similar distance and opens at 11 every day for pub plates and seafood. Neither one asks you to climb anything.",
        mapQuery: "J'aime Les Crêpes, 11264 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "1:00 PM",
        title: "A bench, and whatever the day brings",
        description:
          "On a Sunday from May into October the Kingston Public Market sets up on the park lawn from 10 to 3 — produce, crafts and food vendors a few steps from where you're sitting. Check the Events page for this week before counting on it.",
        mapQuery: "Mike Wallace Park, Kingston, WA",
      },
      {
        time: "2:00 PM",
        title: "About the hill, honestly",
        description:
          "Most of Kingston's shops — the two bookshops, the bakery, the hardware store — sit at Kingston Center, roughly a ten to twelve minute walk uphill on Highway 104. It is a genuine climb and we would rather say so than let you find out halfway. Kitsap Transit's route 307 runs up Highway 104 past the Village Green — but not every day, so check the schedule rather than assume it. Kingston Ride is their book-ahead shared ride for trips the numbered routes don't cover; Kitsap Transit's site carries the current reservation line and hours.",
        mapQuery: "Kingston Center, Kingston, WA",
      },
      {
        time: "3:00 PM",
        title: "Home on an easy boat",
        description:
          "Back to the terminal on level ground, five minutes at a stroll. Check tonight's sailings on the Ferry page, find a seat, and watch it come in.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "paddle-pedal-hike",
    slug: "paddle-pedal-hike",
    title: "Paddle, Pedal, Hike",
    tagline:
      "A boat on Port Gamble Bay in the morning, singletrack after lunch, and a forest loop before the beer. Bring your legs.",
    duration: "Full day, active",
    mode: "car",
    audience: ["Active", "Cyclists", "Paddlers", "Strenuous"],
    stops: [
      {
        time: "8:35 AM",
        title: "An early boat, and a word about bikes",
        description:
          "Bicycles ride the ferry and load ahead of the car deck, which makes a bike one of the smartest ways to arrive in Kingston on a summer weekend — no vehicle line, no reservation anxiety. Check the current bike fare on the Ferry page.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
      {
        time: "10:00 AM",
        title: "Gear up at Olympic Outdoor Center",
        description:
          "On Rainier Avenue in Port Gamble, about fifteen minutes west of the ferry. Sit-on-top, touring and pedal kayaks, paddleboards, mountain, gravel and road bikes, camping kit and dry suits — Monday to Saturday 10 to 6 and Sunday 10 to 5 in season. Last rentals go out ninety minutes before close, and they run free kayak demos daily, so turning up without a plan is a perfectly good plan. Rentals are weather permitting, and off-season hours can shift, so ring ahead in winter.",
        mapQuery: "Olympic Outdoor Center, 32379 Rainier Ave NE, Port Gamble, WA",
      },
      {
        time: "10:30 AM",
        title: "Out onto Port Gamble Bay",
        description:
          "Sheltered water with the mill town on one shore and forest on the other. Paddling here is calmer than the open Sound, which is the whole reason the rental shop is where it is. Weather permitting, as always on this coast.",
        mapQuery: "Port Gamble Bay, Port Gamble, WA",
      },
      {
        time: "12:30 PM",
        title: "Refuel in town",
        description:
          "Butcher & Baker Provisions is the serious lunch and House 11 Taproom the easy one — but both keep a Thursday-to-Sunday week. The Port Gamble General Store & Cafe is open daily and will feed you whatever the day.",
        mapQuery: "Butcher & Baker Provisions, 4719 NE State Hwy 104, Port Gamble, WA",
      },
      {
        time: "1:45 PM",
        title: "Port Gamble Forest Heritage Park",
        description:
          "A large working forest at the edge of town, laced with a well-ridden network of singletrack and gravel that walkers and mountain bikers share. Ask at the rental shop which loop suits your legs and the day's mud — they ride it and you don't.",
        mapQuery: "Port Gamble Forest Heritage Park, Port Gamble, WA",
      },
      {
        time: "4:00 PM",
        title: "Swap wheels for boots on the Greenway",
        description:
          "If there is still daylight and appetite, drive north to Buck Lake County Park and walk the Hansville Greenway — nine and a half miles of trail across the network, with a 2.6-mile signature loop that's easy going and about a hundred feet of climb. Leashed dogs welcome. Buck Lake's gates close at 5.",
        mapQuery: "Buck Lake County Park, Hansville, WA",
      },
      {
        time: "5:30 PM",
        title: "You have earned this",
        description:
          "Friends and Neighbors Brewing on Highway 104 in Kingston — rotating taps, dogs and kids welcome, and a food truck outside midweek. Doors at 2 PM on Saturday and Sunday, 4 PM midweek; check Mondays before you bank on one.",
        mapQuery: "Friends and Neighbors Brewing, 10991 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "6:45 PM",
        title: "The boat, and a nap on it",
        description:
          "Check the Ferry page for the eastbound line before you load up. Walk-ons and cyclists rarely wait; cars on a summer Sunday sometimes do.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "north-kitsap-weekend",
    slug: "north-kitsap-weekend",
    title: "A North Kitsap Weekend",
    tagline:
      "Two days, one night, no rushing. A mill town on the first afternoon, a garden or a lighthouse on the second, and dinner in Kingston in between.",
    duration: "Two days, one night",
    mode: "car",
    audience: ["Weekenders", "Couples", "Mixed pace"],
    stops: [
      {
        time: "Day 1 10:25 AM",
        title: "Arrive, and leave the car where it lands",
        description:
          "Roll off in Kingston and resist the urge to drive somewhere immediately. Coffee at Over the Moon (closed Tuesdays) or a crêpe at J'aime Les Crêpes, both two minutes from the lanes, and a walk out along the marina boardwalk to see what the weather is doing.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
      {
        time: "Day 1 12:30 PM",
        title: "West to Port Gamble",
        description:
          "About fifteen minutes on SR 104 to the 1850s mill town. Wandering it is free; the shell museum above the General Store is too. The shops — The Artful Ewe, Quilted Strait, Gamble Bay Textiles — are the sort you lose an hour in. The Historic Museum is open Thursday to Sunday, noon to 5, from May through late September.",
        mapQuery: "Port Gamble, WA",
      },
      {
        time: "Day 1 4:00 PM",
        title: "Check in",
        description:
          "The Point Casino & Hotel is about ten minutes north and the easiest hotel to reach from the ferry. Clearwater Casino Resort is fifteen minutes south on the water at Suquamish. Port Gamble Guest Houses put you in the town itself, Kitsap Memorial State Park has campsites on Hood Canal a short drive west, just south of the Hood Canal Bridge, and the Chamber keeps a hand-checked list of vacation rentals. The most memorable option: the U.S. Lighthouse Society rents two units at Point No Point — the historic keeper's duplex and the John Maggs house — so you can actually sleep at the lighthouse.",
        mapQuery: "The Point Casino & Hotel, Kingston, WA",
      },
      {
        time: "Day 1 6:30 PM",
        title: "Dinner back in Kingston",
        description:
          "The Kingston Ale House for pub plates and seafood, Los Tres Compadres for generous Mexican plates (closed Sundays), or Nirvana for Indian and Nepali — Nirvana opens at noon Friday through Monday and at 4 PM on Wednesday and Thursday, closed Tuesdays. Afterwards, Cellar Cat pours until 10 on Friday and Saturday with live jazz some nights.",
        mapQuery: "The Kingston Ale House, 11225 NE State Hwy 104, Kingston, WA",
      },
      {
        time: "Day 2 9:00 AM",
        title: "Pick your second day",
        description:
          "Two good options and they suit different moods. The garden day: Heronswood opens Wednesday to Sunday, 9 to 3, April to mid-October, and is fifteen quiet acres run by the Port Gamble S'Klallam Tribe. The wild day: north to Point No Point, the oldest lighthouse on Puget Sound, with a driftwood beach and the shipping lanes close in.",
        mapQuery: "Heronswood Garden, 7530 NE 288th St, Kingston, WA",
      },
      {
        time: "Day 2 12:30 PM",
        title: "Lunch in Poulsbo, if you want a third town",
        description:
          "About twenty minutes south on Bond Road. Sluys Poulsbo Bakery has been the reason people stop here for decades and opens at 5 AM daily — though it takes one scheduled week off each September, so check before you make a special trip. The Maritime Museum on Front Street is free and open daily, and the waterfront park is a short flat walk from the shops.",
        mapQuery: "Sluys Poulsbo Bakery, 18924 Front St NE, Poulsbo, WA",
      },
      {
        time: "Day 2 3:30 PM",
        title: "One last stop in Kingston",
        description:
          "Saltwater Bookshop and the Kingston Bookery are a few doors apart at Kingston Center. Neither posts hours widely and this is a Sunday afternoon, so ring ahead if the trip up the hill matters to you. Then down to the water.",
        mapQuery: "Saltwater Bookshop, Kingston, WA",
      },
      {
        time: "Day 2 5:00 PM",
        title: "The boat home",
        description:
          "Sunday evenings eastbound are the busiest sailings of the week in summer. Check the Ferry page before you join the queue, and if the wait is long, take it as permission for one more round of something.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
  {
    id: "three-day-north-kitsap",
    slug: "three-day-north-kitsap",
    title: "Three Days on the North Peninsula",
    tagline:
      "Come Thursday to Saturday and every door on this list opens on at least one of your days — a museum, a mill town, a garden and a lighthouse.",
    duration: "Three days",
    mode: "car",
    audience: ["Road-trippers", "First-timers", "Mixed pace"],
    stops: [
      {
        time: "Before you book",
        title: "Why Thursday to Saturday",
        description:
          "North Kitsap's best places keep awkward, non-overlapping weeks. The Suquamish Museum is currently Wednesday to Friday. The Port Gamble Historic Museum is Thursday to Sunday, May to late September. Heronswood is Wednesday to Sunday in season. Point No Point's lighthouse tower opens Saturdays and Sundays, noon to 4, April through September. A Thursday arrival and a Saturday departure is the window where all four are reachable. Any three days will make a good trip; these three make a complete one.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
      {
        time: "Day 1 10:25 AM",
        title: "Land in Kingston and go west",
        description:
          "Coffee two minutes from the lanes, then about fifteen minutes on SR 104 to Port Gamble. The town is free to wander, the shell museum above the General Store is free to enter, and the Historic Museum — Thursday being one of its days — is free as well. Lunch at Butcher & Baker Provisions.",
        mapQuery: "Port Gamble, WA",
      },
      {
        time: "Day 1 3:00 PM",
        title: "Heronswood, before it closes at three",
        description:
          "Fifteen acres and some eight thousand plant varieties, founded in 1987 and owned since 2012 by the Port Gamble S'Klallam Tribe. Last entry is 2:30, so this is a get-there-early-afternoon stop, not a late one. Admission $15, $10 for ages 7 to 17. Don't skip the S'Klallam Connections Garden.",
        mapQuery: "Heronswood Garden, 7530 NE 288th St, Kingston, WA",
      },
      {
        time: "Day 1 6:00 PM",
        title: "Dinner and a bed",
        description:
          "Eat in Kingston — the Ale House, Los Tres Compadres, or Nirvana — and sleep at The Point Casino & Hotel ten minutes north, Clearwater at Suquamish, Port Gamble Guest Houses, or a vacation rental from the Chamber's list.",
        mapQuery: "Kingston, WA",
      },
      {
        time: "Day 2 9:30 AM",
        title: "South to the Suquamish Museum",
        description:
          "Fifteen minutes south on Miller Bay Road NE. Friday is inside the museum's current Wednesday-to-Friday window, so this is the day for it. Ancient Shores – Changing Tides is built around a canoe some three hundred years old, last paddled in the 1989 Paddle to Seattle. Adults $8, elders and youth $6, families of four to six $18.",
        mapQuery: "Suquamish Museum, 6861 NE South St, Suquamish, WA",
      },
      {
        time: "Day 2 12:00 PM",
        title: "Chief Seattle's grave and Old Man House",
        description:
          "The grave is a five-minute walk from the museum, in the working cemetery beside St. Peter's — quiet, on the paths, as you would anywhere families still bury their dead. Old Man House Park is the shoreline where the great longhouse of D'Suq'Wub stood, returned to the Tribe in 2004.",
        mapQuery: "Old Man House Park, Suquamish, WA",
      },
      {
        time: "Day 2 2:30 PM",
        title: "Poulsbo for the afternoon",
        description:
          "Twenty minutes north. Front Street is a Norwegian-heritage shopping street with the mountains behind it; Sluys Bakery opens at 5 AM daily; the Maritime Museum is free and open daily. Western Washington University's SEA Discovery Center on Front Street opens Friday and Saturday, 11 to 4, and is free with a suggested couple of dollars — a small marine science centre and a good hour with children.",
        mapQuery: "SEA Discovery Center, 18743 Front St NE, Poulsbo, WA",
      },
      {
        time: "Day 3 9:30 AM",
        title: "North to Point No Point",
        description:
          "Twenty minutes and ten miles from Kingston. Built in 1879, first lit in 1880, the oldest lighthouse on Puget Sound and a short square tower rather than the tall one people picture. Saturday is a tour day: volunteer docents open it noon to 4, April through September. Check parking first: the county's park page says the lot has reopened after storm repairs, while the county Parks FAQ still says the main lot \"remains closed\" and points to the Fish and Wildlife lot on Point No Point Road (Discover Pass, summer season). Kitsap Parks can settle it on (360) 337-5350.",
        mapQuery: "Point No Point Lighthouse, Hansville, WA",
      },
      {
        time: "Day 3 12:30 PM",
        title: "The village, then the preserve",
        description:
          "Lunch at Hansville Grocery & Hansgrill on Twin Spits Road, the only kitchen up here. Then Foulweather Bluff Preserve — about a mile of walking round trip to nearly 3,800 feet of Nature Conservancy beach, best at low tide. No dogs at all, and parking is roadside for under ten cars.",
        mapQuery: "Foulweather Bluff Preserve, Hansville, WA",
      },
      {
        time: "Day 3 4:00 PM",
        title: "Last look, and the boat",
        description:
          "Back through Kingston. A pint at Friends and Neighbors (doors at 2 PM on Saturdays), a last browse at Saltwater Bookshop, and down to the terminal. Check the Ferry page — a Saturday evening eastbound is a real queue in summer.",
        mapQuery: "Kingston Ferry Terminal, Kingston, WA",
      },
    ],
  },
];

export function getItinerary(slug: string): Itinerary | undefined {
  return itineraries.find((i) => i.slug === slug);
}
