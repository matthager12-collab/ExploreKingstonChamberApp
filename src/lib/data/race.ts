// The Chamber's paid race — hand-edited content like every file in this
// folder. Registration and payment live on Zeffy: the app links out and holds
// no payment code (the FR-A15 floor, docs/ROLLOFF-GROWTHZONE.md). Bibs and
// timing belong to the timing company, so nothing here assigns them.

export const race = {
  /** Keys the race-day check-in link; change it for a new edition. */
  id: "nadt-5k-2026",
  path: "/race",
  name: "“Not Afraid of the Dark 5K” Kingston Fun Run",
  shortName: "Not Afraid of the Dark 5K",
  date: "2026-11-07",
  start: "2026-11-07T15:00:00-08:00",
  end: "2026-11-07T19:00:00-08:00",
  whenLabel: "Saturday, November 7 · 3:00–7:00 PM",
  venue: "Downtown Kingston",
  address: "10900 NE State Hwy 104, Kingston, WA 98346",
  partyVenue: "Mike Wallace Park",
  organizer: "Greater Kingston Community Chamber of Commerce",
  organizerEmail: "director@kingstonchamber.com",
  /** The Zeffy ticketing campaign. The only place a runner pays. /race embeds
   *  this campaign's form from it, so paste the campaign's own ticketing link
   *  (https://www.zeffy.com/…/ticketing/…); anything else shows as a plain link. */
  registrationUrl:
    "https://www.zeffy.com/en-US/ticketing/not-afraid-of-the-dark-5k-kingston-fun-run",
  rates: [
    { title: "Early Bird Runner Registration", price: "$30", note: "Through October 9" },
    { title: "Standard 5K Runner Entry", price: "$36", note: "From October 10" },
  ],
  includes: [
    "Race bib and official timing by Olympics Edge Timing",
    "Finisher medal",
    "Swag bag at the finish-line party",
  ],
  intro:
    "Bust out your Halloween costume one more time and outrun the dark. The 5K starts at 3 PM, so there is plenty of time to finish and start celebrating at the After Dark Party at Mike Wallace Park by sunset (about 4:45 PM after the November 1 time change).",
  party: [
    "Local businesses and nonprofits with booths, plus a “Light up the Night” beer garden raising money for the 4th of July fireworks.",
  ],
  fundsNote:
    "Registration and sponsorship fees support the free community events the Chamber organizes throughout the year.",
  /**
   * Zeffy custom questions the roster keeps, matched by the WHOLE question
   * text — case, spacing and curly quotes ignored, nothing else. If the
   * Chamber rewords the question in Zeffy, paste the new wording here or the
   * Shirt column goes empty. Every other answer is dropped before it reaches
   * the database. `null` = the form does not ask.
   *
   * The shirt itself is a $15 add-on on the campaign; the roster shows how
   * many an order bought ("Order: 2 × …") beside this sizing answer.
   */
  questions: {
    // Copied from the live form, 2026-09-22. One free-text answer per order.
    shirt:
      "If adding ExploreKingston t-shirt(s), note desired sizing otherwise you'll be given first-come/first-served choice of remaining options: small (S), medium (M), large (L), extra large (XL), extra extra large (2XL)",
    waiver: null as string | null,
  },
  /** Days after the race date before runner names and emails are anonymized. */
  retentionDays: 45,
} as const;

export type Race = typeof race;
