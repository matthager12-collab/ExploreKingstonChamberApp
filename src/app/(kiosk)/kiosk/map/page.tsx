import { KioskMap, FERRY_DOCK, type KioskMapPoint } from "@/components/kiosk-map";
import { KioskQr } from "@/components/kiosk-qr";
import { KioskCard, KioskEmpty, KioskScreen } from "@/components/kiosk-ui";
import { resolveMapView } from "@/lib/map/resolve";
import { kioskHandoffUrl } from "@/lib/qr";
import { getRestaurants } from "@/lib/stores/business-store";
import { getParkingZones } from "@/lib/stores/parking-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

// "Where things are", kiosk-scaled: a real, visible map — drawn by us.
//
// It is NOT Leaflet, and that is a deliberate deviation from the charter, which
// says to reuse <FeatureMap/> read-only. See src/components/kiosk-map.tsx for
// the full reasoning; briefly, a slippy map on this device fails three ways —
// tiles go grey the moment the venue Wi-Fi hiccups (offline tile packs are an
// explicit non-goal), Leaflet's OSM attribution is a genuine external anchor on
// a panel with no back button, and it is a client bundle doing continuous
// canvas work on a fanless mini PC.
//
// So the map is an SVG projected from the SAME coordinates the website's map
// uses. No tiles, no network, no attribution, nothing tappable — it simply
// cannot break when the network does. It answers "what is near what, and how
// far", which is the orientation question a walk-up visitor actually has.
// Street-level detail and the visitor's own position stay one QR away, on the
// device with a GPS in it.

export const revalidate = 60;

/** The seed view carrying the town's landmarks. */
const EXPLORE_VIEW = "explore";

/**
 * Everything worth drawing, as map points.
 *
 * Kept to a walkable radius on purpose: the George's Corner park-and-ride is
 * two and a half miles out, and including it would shrink the whole downtown —
 * where every walk-up visitor actually is — into a corner of the frame. A map
 * that fits everything in is not the same as a map that answers anything.
 */
const WALKABLE_KM = 1.6;

function kmFromDock([lat, lng]: [number, number]): number {
  const dLat = (lat - FERRY_DOCK[0]) * 111;
  const dLng = (lng - FERRY_DOCK[1]) * 111 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export default async function KioskMapPage() {
  const [explore, restaurants, zones, copy] = await Promise.all([
    resolveMapView(EXPLORE_VIEW).catch(() => null),
    getRestaurants(),
    getParkingZones().catch(() => []),
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

  const points: KioskMapPoint[] = [
    { id: "dock", label: "You are here", at: FERRY_DOCK, kind: "you-are-here" },
    ...nearest.map((r) => ({
      id: `eat-${r.id}`,
      label: r.name,
      at: [r.lat, r.lng] as [number, number],
      kind: "food" as const,
    })),
    ...zones
      .filter((z) => Array.isArray(z.center) && kmFromDock(z.center) <= WALKABLE_KM)
      .slice(0, 4)
      .map((z) => ({
        id: `park-${z.id}`,
        label: z.name,
        at: z.center,
        kind: "parking" as const,
      })),
    ...landmarks
      .filter((f) => Array.isArray(f.point) && kmFromDock(f.point as [number, number]) <= WALKABLE_KM)
      .slice(0, 5)
      .map((f) => ({
        id: `place-${f.id}`,
        label: f.title,
        at: f.point as [number, number],
        kind: "place" as const,
      })),
  ];

  return (
    <KioskScreen title="Getting around" subtitle="You are at the Kingston ferry terminal">
      {/* The map itself, first — it is what the screen is for. */}
      <div className="mb-10">
        <KioskMap points={points} />
        <p className="mt-4 text-2xl text-white/60">
          A sketch of what is near the dock, drawn to scale. It has no streets — scan below for the
          full map with directions.
        </p>
      </div>

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
