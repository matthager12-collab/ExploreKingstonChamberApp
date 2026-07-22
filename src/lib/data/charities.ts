// Kingston-area nonprofits and current volunteer needs.
// v1 is deliberately simple: no accounts, no signup forms. Each need points
// people straight at the org (email or website). The county-wide option is
// the Volunteer Center of Kitsap County (United Way's Get Connected instance)
// at https://unitedwaykitsap.galaxydigital.com/ — free for volunteers.
//
// Volunteer shifts below are Chamber-entered seed data for July–August 2026.
// Orgs confirm details when they claim their listing.

import type { Charity, VolunteerNeed } from "../types";

export const charities: Charity[] = [
  {
    id: "sharenet",
    name: "ShareNet Food Bank & Services",
    mission:
      "Kingston's food bank and family-services hub, stocking pantry shelves and quietly catching neighbors across the greater Kingston and North Kitsap area when money runs short.",
    website: "https://sharenetfoodbank.org",
  },
  {
    id: "village-green-foundation",
    name: "Village Green Foundation",
    mission:
      "The nonprofit behind Kingston's Village Green — the community campus with the community center, library branch, and park that serves as the town's living room.",
  },
  {
    id: "kingston-farmers-market",
    name: "Kingston Farmers Market",
    mission:
      "The nonprofit market at Mike Wallace Park by the marina — local farms, food, and makers, Sundays 10 AM–3 PM in season. Volunteer-powered since day one.",
    website: "https://kingstonfarmersmarket.com",
  },
  {
    id: "kingston-north-kitsap-rotary",
    name: "Kingston North Kitsap Rotary Club",
    mission:
      "Service club that funds scholarships and puts hands-on labor into community projects around Kingston and North Kitsap. Visitors welcome at meetings.",
  },
  {
    id: "kiwanis-greater-kingston",
    name: "Kiwanis Club of Greater Kingston",
    mission:
      "A service club focused on kids — school supports, youth programs, and work parties wherever young people in Kingston need a boost.",
  },
  {
    id: "united-way-kitsap",
    name: "United Way of Kitsap County",
    mission:
      "Runs the Volunteer Center of Kitsap County and the free VolunteerKitsap database that matches people with nonprofits county-wide. The on-ramp if you want to volunteer beyond Kingston.",
    website: "https://www.unitedwaykitsap.org",
    contactEmail: "sjones@unitedwaykitsap.org",
  },
];

// Shifts are stored as full ISO instants (Pacific offset included) so
// formatPacificDate() lands on the right day regardless of server timezone.
export const volunteerNeeds: VolunteerNeed[] = [
  {
    id: "sharenet-distribution-jul10",
    charityId: "sharenet",
    title: "Food bank distribution crew",
    date: "2026-07-10T09:00:00-07:00",
    timeRange: "9:00 AM – 1:00 PM",
    slotsTotal: 6,
    slotsFilled: 2,
    description:
      "Unload, sort, and restock shelves, then help neighbors shop. Some lifting, no experience needed. To claim a spot, reach out through ShareNet's website.",
  },
  {
    id: "kfm-setup-jul12",
    charityId: "kingston-farmers-market",
    title: "Sunday market setup crew",
    date: "2026-07-12T07:30:00-07:00",
    timeRange: "7:30 AM – 10:00 AM",
    slotsTotal: 4,
    slotsFilled: 1,
    description:
      "Early shift at Mike Wallace Park: haul canopies, set signage, point vendors to their stalls. Done by mid-morning with the whole market day ahead of you. Contact the market through its website to sign up.",
  },
  {
    id: "vgf-workparty-jul18",
    charityId: "village-green-foundation",
    title: "Village Green summer work party",
    date: "2026-07-18T09:00:00-07:00",
    timeRange: "9:00 AM – 12:00 PM",
    slotsTotal: 12,
    slotsFilled: 5,
    description:
      "Weeding, mulching, and general spruce-up around the Village Green campus. Bring gloves if you have them; tools provided. Stop by the community center front desk or use the contact link to raise your hand.",
  },
  {
    id: "rotary-cleanup-jul25",
    charityId: "kingston-north-kitsap-rotary",
    title: "Park and trail cleanup morning",
    date: "2026-07-25T09:00:00-07:00",
    timeRange: "9:00 AM – 11:30 AM",
    slotsTotal: 8,
    slotsFilled: 3,
    description:
      "Litter pickup and light trail brushing at Kingston-area parks. Family-friendly — kids welcome with an adult. Reach the club through the contact link below to join.",
  },
  {
    id: "sharenet-mealbags-aug7",
    charityId: "sharenet",
    title: "Summer meal-bag packing for kids",
    date: "2026-08-07T10:00:00-07:00",
    timeRange: "10:00 AM – 12:30 PM",
    slotsTotal: 5,
    slotsFilled: 0,
    description:
      "Assembly-line packing of weekend meal bags for local kids while school's out. Easy, seated work — great first shift. Contact ShareNet through their website to sign up.",
  },
  {
    id: "kiwanis-supplies-aug15",
    charityId: "kiwanis-greater-kingston",
    title: "Back-to-school supply sorting",
    date: "2026-08-15T10:00:00-07:00",
    timeRange: "10:00 AM – 1:00 PM",
    slotsTotal: 6,
    slotsFilled: 1,
    description:
      "Sort donated backpacks and school supplies into grade-level kits before the fall giveaway. Use the contact link below and the club will get back to you with details.",
  },
];
