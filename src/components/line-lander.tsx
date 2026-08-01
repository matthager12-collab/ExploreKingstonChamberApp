// E33 — the Line Lander body: everything a driver parked in the SR-104 ferry
// line needs, in the order they need it (boarding pass → who's exempt → next
// boats → wait context → cameras → food → restrooms → map → where's the boat →
// link-outs).
//
// Shared by /line (the real ISR page) and /line/preview (the admin preview),
// so the Chamber signs off on EXACTLY the bytes visitors will get.
//
// PERF FLOOR (the page's whole premise is instant load on cellular):
//   - No cookies()/headers()/getSide() anywhere in this tree — the audience's
//     side is known, so side="kingston" is hardcoded and /line's
//     `revalidate = 60` stays real (the /ferry trap, memory
//     `visit-kingston-ferry-perf`).
//   - getEmpiricalBusyness() is deliberately NOT called: it full-scans the
//     observation log (5–8s warm-prod worst case) and belongs nowhere near
//     this page's critical path. FerryBusyToday renders its pure heuristic
//     without the empirical table; once the aggregation fix lands
//     (fix/ferry-busyness-agg) a cheap cached read can be wired in here.
//   - Sr104TrafficMap and FerryVesselMap both defer the ~200 KB MapLibre engine
//     behind an IntersectionObserver, and sit adjacent at the bottom so it is
//     loaded at most once, late, and only if the visitor scrolls that far.
//   - FerryVesselMap is mounted WITHOUT `initial`: getVesselLocations()
//     revalidates at 10s and a prerendered route inherits the shortest
//     revalidate reachable from it, so server-fetching it here would cut this
//     page's ISR window from 30s to 10s. It self-fetches on reveal instead.
//   - FerryWebcamsBox is collapsed by default, so the WSDOT JPEGs and their
//     refresh timer cost nothing until someone taps.
//
// BOUNDARIES (composition contract in the epic doc): no queue sensing or
// self-mark (E25), no pay-links (E26 — link /parking), no outbound sends
// (E21), no order/payment capture (deep links only), nothing position-derived
// collected or transmitted, no UGC.

import Link from "next/link";
import { FerryBusyToday } from "@/components/ferry-busy-today";
import { FerryVesselMap } from "@/components/ferry-vessel-map";
import { FerryWebcamsBox } from "@/components/ferry-webcams-box";
import { LineAmenities } from "@/components/line-amenities";
import { LineFood } from "@/components/line-food";
import { NextFerries } from "@/components/next-ferries";
import { Sr104TrafficMap } from "@/components/sr104-traffic-map";
import { Callout, PageHeader, Section } from "@/components/ui";
import { lineBacksPastBarberCutoff, parseWaitHours } from "@/lib/ferry-line";
import { getFerryStatusSnapshot } from "@/lib/ferry-status";
import { kingstonCamsFromLine, openFoodFromLine, splitAmenitiesFromLine } from "@/lib/line-lander";
import { getEffectiveHiddenPaths } from "@/lib/page-visibility";
import { getRestaurants } from "@/lib/stores/business-store";
import { getFerryInfo } from "@/lib/stores/ferry-info-store";
import { getFerryPredictionEnabled } from "@/lib/stores/ferry-prediction-store";
import { getWebcams } from "@/lib/stores/listing-stores";
import { getFeaturesForView } from "@/lib/stores/map-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { todayPacific } from "@/lib/time";

export async function LineLander() {
  // NOTE: getFerryPredictionEnabled (not getFerryPredictionAccess) — the
  // access variant reads the admin session (cookies) when the flag is off,
  // which would break the perf floor above. Session-free flag check only
  // (the E12 pattern): while the prediction feature ships dark, /line simply
  // omits the panel; admins validate it on /ferry/plan.
  const [
    snapshot,
    copy,
    ferryInfo,
    restaurants,
    amenityFeatures,
    predictionEnabled,
    cams,
    hiddenPaths,
  ] = await Promise.all([
    // E25 swap point: when E25's versioned prediction contract
    // (SailingPrediction / goNoGo / safeToDeliverUntil) lands, the
    // prediction-ish bits below (wait context, busyness panel) swap from
    // this snapshot to that contract at this call site.
    getFerryStatusSnapshot(),
    getCopyOverrides(),
    getFerryInfo(),
    getRestaurants(),
    // Merged store, never the seed array — Chamber additions must show up.
    getFeaturesForView("amenities"),
    getFerryPredictionEnabled(),
    // Same rule: the merged store, so a camera the Chamber adds appears here.
    getWebcams(),
    // Store read, NOT a session read — this is the cookie-free half of the
    // visibility helpers (assertPageVisibleStatic uses the very same call), so
    // it cannot mark the route dynamic. Only used to decide whether linking to
    // /webcams would send someone to a 404.
    getEffectiveHiddenPaths(),
  ]);

  const pass = snapshot.boardingPass;
  const bp = ferryInfo.boardingPass;
  const waitNote = snapshot.terminals.kingston.waitEstimate;
  // Only surface the wait line when WSDOT's staff note actually names a wait —
  // waitEstimate is free text, and a note that parses to no hours is not a
  // wait figure a stressed driver should be handed as one.
  const waitHours = parseWaitHours(waitNote);
  const longWait = lineBacksPastBarberCutoff(waitNote);
  const food = openFoodFromLine(restaurants);
  const amenities = splitAmenitiesFromLine(amenityFeatures);
  const serverNow = new Date().toISOString();
  // Kingston-side cameras, ordered front-of-line-first (tollbooths lead — see
  // the lib). No side variable to consult here; that is the point of this page.
  const kingstonCams = kingstonCamsFromLine(cams);
  const webcamsPageVisible = !hiddenPaths.includes("/webcams");

  // Pins for the boarding-pass map, built from the SAME rows the food list and
  // the restroom block above it render — so the map cannot show a kitchen the
  // list calls closed, or a restroom the list does not know about.
  const foodPins = food.map(({ restaurant: r, lineWalkMinutes }) => ({
    id: r.id,
    title: r.name,
    lat: r.lat,
    lng: r.lng,
    note: `About ${lineWalkMinutes} min walk from the line.`,
  }));
  // Both halves of the split: the tollbooth portable and the two dock
  // restrooms. The split matters for the honesty block's wording, not for
  // where a pin belongs on a map.
  const restroomPins = [...amenities.walkable, ...amenities.atTerminal]
    .filter((row) => row.feature.category === "restroom")
    .map((row) => ({
      id: row.feature.id,
      title: row.feature.title,
      lat: row.lat,
      lng: row.lng,
      // The provenance caveat travels with the pin. These locations are read
      // off a Port map or Chamber-reported, not field-checked, and someone
      // deciding whether to leave their car deserves to know that.
      note: row.feature.notes,
    }));

  return (
    <>
      <PageHeader
        eyebrow={copyText(copy, "line.header.eyebrow")}
        title={copyText(copy, "line.header.title")}
        intro={copyText(copy, "line.header.intro")}
      />

      <div className="mx-auto max-w-5xl space-y-4 px-4">
        {/* Chamber-transient notice (dispenser outage etc.) — same guard as
            /ferry: an empty string renders nothing. */}
        {bp.currentNote.trim() && (
          <Callout tone="coral" title={copyText(copy, "line.note.title")}>
            <p>{bp.currentNote}</p>
          </Callout>
        )}

        {/* Boarding-pass status. The words carry the state (never colour
            alone): the ON/OFF sentence is the first thing on the card. */}
        <div
          className={`rounded-2xl border p-5 ${
            pass.active ? "border-coral/40 bg-coral/5" : "border-sand bg-white"
          }`}
        >
          <h2 className="text-sm font-semibold tracking-widest text-tide-deep uppercase">
            {copyText(copy, "line.pass.title")}
          </h2>
          <p className="mt-1 text-xl font-bold text-ink sm:text-2xl">
            {pass.active ? copyText(copy, "line.pass.on") : copyText(copy, "line.pass.off")}
          </p>
          {/* Why we think so — the season/hours estimate or today's staff
              override, worded upstream in wsf.ts / boarding-pass-store. */}
          <p className="mt-2 text-xs text-ink-soft">{pass.reason}</p>
          <p className="mt-2 text-sm text-ink">{bp.whenRequired}</p>
        </div>

        {/* Who does not need a pass at all. Wording is the Chamber-editable
            boarding-pass record (/admin/ferry-info), the same source /ferry
            quotes, so the two pages can never disagree.

            This block used to lead with bp.voids ("leave the line and your pass
            is void"). That rule is not enforced, so the app no longer states it
            anywhere and the field is gone from the record entirely — see
            BoardingPass in lib/data/ferry-info.ts. Tone dropped from coral to
            neutral with it: what is left is a helpful exemption, not a warning. */}
        <Callout title={copyText(copy, "line.exempt.title")}>
          <p>{bp.exempt}</p>
        </Callout>
      </div>

      <Section
        title={copyText(copy, "line.boats.title")}
        subtitle={copyText(copy, "line.boats.subtitle")}
      >
        {/* side is HARDCODED: everyone reading this page is in Kingston, and
            the side cookie is exactly what the perf floor forbids. */}
        <NextFerries initial={snapshot} serverNow={serverNow} side="kingston" />

        {waitNote && waitHours !== null && (
          <div className="mt-4 rounded-xl border border-sand bg-white p-4">
            <p className="text-ink">
              <span className="font-semibold">{copyText(copy, "line.wait.label")}:</span>{" "}
              {waitNote}
            </p>
            {longWait && <p className="mt-1 text-sm text-ink">{copyText(copy, "line.wait.longLine")}</p>}
          </div>
        )}

        {/* E25 swap point: this heuristic panel is the placeholder for E25's
            accuracy-gated prediction feature. It renders WITHOUT the empirical
            table on purpose — see the perf-floor note in the file header. */}
        {predictionEnabled && (
          <div className="mt-4">
            <FerryBusyToday
              today={todayPacific()}
              serverNow={serverNow}
              defaultDirection="from-kingston"
            />
          </div>
        )}
      </Section>

      {/* Cheap enough to sit this high: collapsed, it is a button. The WSDOT
          JPEGs and their refresh timer only exist once someone taps. */}
      <Section>
        <FerryWebcamsBox
          cams={kingstonCams}
          totalCount={cams.length}
          webcamsPageVisible={webcamsPageVisible}
          title={copyText(copy, "line.cams.title")}
          blurb={copyText(copy, "line.cams.blurb")}
        />
      </Section>

      <Section
        title={copyText(copy, "line.food.title")}
        subtitle={copyText(copy, "line.food.subtitle")}
      >
        <LineFood rows={food} copy={copy} />
      </Section>

      <Section title={copyText(copy, "line.amenities.title")}>
        <LineAmenities split={amenities} copy={copy} />
      </Section>

      <Section
        title={copyText(copy, "line.map.title")}
        subtitle={copyText(copy, "line.map.subtitle")}
      >
        <Sr104TrafficMap food={foodPins} restrooms={restroomPins} />
      </Section>

      {/* Sits next to the other map on purpose. Both defer MapLibre behind an
          IntersectionObserver, so keeping them adjacent and well below the fold
          means the ~200 KB engine loads at most once, late, and only for a
          visitor who scrolled this far.

          NO `initial` PROP — deliberate, and the reason is in the component's
          doc comment: getVesselLocations() revalidates at 10s, and a
          prerendered route inherits the shortest revalidate reachable from it,
          so server-fetching here would cut this page's ISR window from 30s to
          10s. The map fetches its own first payload on reveal instead. */}
      <Section
        title={copyText(copy, "line.boat.title")}
        subtitle={copyText(copy, "line.boat.subtitle")}
      >
        <FerryVesselMap />
      </Section>

      <Section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/parking"
            className="block rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)] hover:border-tide"
          >
            <span className="font-semibold text-sound-deep">
              {copyText(copy, "line.more.parkingTitle")} →
            </span>
            <span className="mt-1 block text-sm text-ink">
              {copyText(copy, "line.more.parking")}
            </span>
          </Link>
          <Link
            href="/ferry"
            className="block rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)] hover:border-tide"
          >
            <span className="font-semibold text-sound-deep">
              {copyText(copy, "line.more.ferryTitle")} →
            </span>
            <span className="mt-1 block text-sm text-ink">{copyText(copy, "line.more.ferry")}</span>
          </Link>
        </div>
      </Section>
    </>
  );
}
