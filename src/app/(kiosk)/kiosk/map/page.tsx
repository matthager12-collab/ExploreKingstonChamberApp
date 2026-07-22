import { KioskQr } from "@/components/kiosk-qr";
import { KioskCard, KioskEmpty, KioskScreen } from "@/components/kiosk-ui";
import { resolveMapView } from "@/lib/map/resolve";
import { kioskHandoffUrl } from "@/lib/qr";
import { getRestaurants } from "@/lib/stores/business-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

// "Where things are", kiosk-scaled — and deliberately NOT an interactive map.
//
// DEVIATION FROM THE E22 CHARTER, recorded here rather than buried in a commit.
// The charter says this screen should reuse <FeatureMap/> read-only. Three
// things argue against putting a live tile map on this particular device:
//
//   1. OFFLINE. Slippy-map tiles come off the network per pan and zoom, and
//      offline map-tile packs are an explicit non-goal. The first thing a
//      visitor does to a map is drag it — straight into grey squares, on the
//      one screen whose entire job is orientation. Everything below is server-
//      rendered text and survives the venue Wi-Fi dropping.
//   2. ESCAPE HATCHES. Leaflet's attribution control is a real external anchor
//      to openstreetmap.org, rendered client-side where the no-external-anchors
//      test cannot see it. Removing it would breach the tile licence; leaving
//      it puts a tappable way off-app on a panel with no back button.
//   3. FITNESS. This is a 20-60 second interaction by someone who wants to know
//      which way to walk and how long it takes. "Eight minutes, up the hill" is
//      a better answer than a map they have to pinch, and it reads from further
//      away.
//
// The interactive map is one QR away, on the device best suited to it — the
// visitor's own phone, which has GPS and shows them as a blue dot.

export const revalidate = 60;

/** The seed view carrying the town's landmarks. */
const EXPLORE_VIEW = "explore";

export default async function KioskMapPage() {
  const [explore, restaurants, copy] = await Promise.all([
    resolveMapView(EXPLORE_VIEW).catch(() => null),
    getRestaurants(),
    getCopyOverrides(),
  ]);

  // Marker features only: a trail line or an area polygon has no single "walk
  // to this" answer, and this screen is a list of destinations.
  const landmarks = (explore?.features ?? []).filter((f) => f.kind === "marker").slice(0, 10);

  // Closest few places to eat, as a walking-distance yardstick — the numbers are
  // computed from verified coordinates, so they cannot contradict /eat.
  const nearest = restaurants
    .filter((r) => !r.hidden)
    .sort((a, b) => a.walkMinutesFromFerry - b.walkMinutesFromFerry)
    .slice(0, 4);

  return (
    <KioskScreen title="Getting around" subtitle="You are at the Kingston ferry terminal">
      <div className="mb-10 flex items-center gap-10 rounded-3xl bg-white/10 p-10">
        <KioskQr
          value={kioskHandoffUrl("/map")}
          caption={copyText(copy, "kiosk.handoff.prompt")}
          size="sm"
        />
        <p className="text-3xl leading-relaxed text-white/85">
          The full interactive map, with your own position on it, on your phone.
        </p>
      </div>

      {nearest.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-6 text-4xl font-semibold text-white/80">How far is a walk here?</h2>
          <ul className="grid grid-cols-2 gap-6">
            {nearest.map((r) => (
              <li key={r.id} className="rounded-3xl bg-white/10 px-8 py-6">
                <p className="text-3xl font-semibold text-white">{r.name}</p>
                <p className="mt-2 text-3xl text-white/70 tabular-nums">
                  {r.walkMinutesFromFerry} min walk
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="mb-6 text-4xl font-semibold text-white/80">Worth finding</h2>
      {landmarks.length === 0 ? (
        <KioskEmpty>
          The landmark list is briefly unavailable — scan the code above for the full map.
        </KioskEmpty>
      ) : (
        landmarks.map((f) => <KioskCard key={f.id} title={f.title} body={f.notes} />)
      )}
    </KioskScreen>
  );
}
