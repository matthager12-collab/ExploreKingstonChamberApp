// A VISIBLE map for the kiosk, drawn from our own coordinates as an SVG.
//
// WHY NOT LEAFLET, which is what the website uses. Three things rule a slippy
// map out on this specific device, and all three are properties of the kiosk
// rather than opinions about Leaflet:
//
//   1. Tiles come off the network per pan and zoom, and offline tile packs are
//      an explicit non-goal. The first thing anyone does to a map is drag it —
//      straight into grey squares the moment the venue Wi-Fi hiccups, on the
//      one screen whose entire job is orientation.
//   2. Leaflet's attribution control is a real anchor to openstreetmap.org,
//      rendered client-side where the no-external-anchors test cannot see it.
//      Removing it would breach the tile licence; leaving it puts a tappable
//      way off-app on a panel with no back button.
//   3. It is a client bundle plus continuous canvas work on a fanless mini PC
//      that runs twelve hours a day.
//
// Drawing it ourselves sidesteps all three. We already hold real coordinates —
// parking zones with centres and polygons, map features with points and paths,
// every restaurant's lat/lng — so this is the same data the website's map
// renders, projected and drawn server-side. No tiles, no network, no
// attribution, no external request, nothing to tap. It scales perfectly on the
// 1080x1920 stage because it is vector, and it updates the moment an admin
// moves a pin in /admin/maps.
//
// What it is NOT: a substitute for a real map. It has no streets and no
// coastline, so it answers "what is near what, and how far" rather than "which
// turning do I take". The interactive map with the visitor's own position on it
// stays one QR away, on the device that has a GPS in it.

export interface KioskMapPoint {
  id: string;
  label: string;
  /** [lat, lng] */
  at: [number, number];
  kind: "you-are-here" | "food" | "parking" | "place";
}

/** The Kingston ferry terminal — the fixed centre of a walk-up visitor's world. */
export const FERRY_DOCK: [number, number] = [47.7973, -122.4968];

/** Stage-space size. Portrait-ish to suit the 1080-wide kiosk column. */
const W = 960;
const H = 760;
const PAD = 90;

const KIND_STYLE: Record<KioskMapPoint["kind"], { fill: string; r: number }> = {
  // Solid brand colours, not tints: these sit on the navy stage where a tint
  // would drop under AA, the same arithmetic E14/E15 fixed across the palette.
  "you-are-here": { fill: "#ffffff", r: 16 },
  food: { fill: "#a85c28", r: 10 },
  parking: { fill: "#1e96c0", r: 10 },
  place: { fill: "#4a7c59", r: 10 },
};

/**
 * Project lat/lng onto the SVG box.
 *
 * An equirectangular projection with a cos(lat) correction on longitude — at
 * Kingston's latitude a degree of longitude is about 0.67 of a degree of
 * latitude, and without the correction the town comes out visibly stretched
 * east-west. Over a two-kilometre span the error from ignoring the earth's
 * curvature is far below one pixel, so nothing fancier earns its complexity.
 */
function project(points: KioskMapPoint[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (points.length === 0) return out;

  const lats = points.map((p) => p.at[0]);
  const lngs = points.map((p) => p.at[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);

  // Work in a flat metres-ish space first, then fit that box to the viewport.
  const xs = lngs.map((lng) => lng * lngScale);
  const ys = lats.map((lat) => -lat); // screen y grows downward; north is up

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // ONE scale for both axes, never two. Fitting each axis independently is the
  // classic way a hand-rolled map ends up lying about distance — the town would
  // stretch to fill the box and "ten minutes that way" would look like two.
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);

  // Centre whatever the scale did not consume.
  const offsetX = (W - spanX * scale) / 2;
  const offsetY = (H - spanY * scale) / 2;

  points.forEach((p, i) => {
    out.set(p.id, {
      x: (xs[i] - minX) * scale + offsetX,
      y: (ys[i] - minY) * scale + offsetY,
    });
  });
  return out;
}

export function KioskMap({ points }: { points: KioskMapPoint[] }) {
  const placed = project(points);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full rounded-3xl bg-sound"
      role="img"
      aria-label={`Sketch map of Kingston showing ${points.length} places relative to the ferry terminal`}
    >
      {/* Water hint behind everything — purely decorative, aria-hidden so it is
          not announced as content. */}
      <rect width={W} height={H} fill="#22334d" />

      {points.map((p) => {
        const at = placed.get(p.id);
        if (!at) return null;
        const style = KIND_STYLE[p.kind];
        const isHere = p.kind === "you-are-here";
        return (
          <g key={p.id}>
            {isHere && (
              // A ring so the dock reads as the anchor at a glance, from
              // further away than the label is legible.
              <circle cx={at.x} cy={at.y} r={style.r + 12} fill="none" stroke="#ffffff" strokeWidth={4} />
            )}
            <circle cx={at.x} cy={at.y} r={style.r} fill={style.fill} />
            {/* Halo behind the text so a label crossing a marker stays readable
                without needing collision detection. */}
            <text
              x={at.x}
              y={at.y - style.r - 10}
              textAnchor="middle"
              fontSize={isHere ? 30 : 22}
              fontWeight={isHere ? 700 : 600}
              fill="#ffffff"
              stroke="#22334d"
              strokeWidth={6}
              paintOrder="stroke"
            >
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
