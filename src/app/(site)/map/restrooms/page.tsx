import type { Metadata } from "next";
import { FeatureMap } from "@/components/feature-map";
import { NearestAmenity, type AmenityPlace } from "@/components/nearest-amenity";
import { PageHeader, Section } from "@/components/ui";
import { walkMinutesFromDock } from "@/lib/geo";
import { resolveMapView } from "@/lib/map/resolve";
import { getFeaturesForView } from "@/lib/stores/map-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";

// E27 practical basics — the one-tap restroom/water finder over the amenities
// map layer (M-04-02 / M-04-05).
//
// Deliberately NOT wired to assertPageVisible/HIDEABLE_PAGES: "where is a
// restroom" is a permanent basic, not a seasonal page the Chamber toggles. That
// also keeps the whole tree free of cookies()/getSide(), so the route stays
// statically renderable and E13's service worker can precache it — which is the
// point, since the visitor who needs this most is the one with one bar of
// signal standing on the dock.

export const metadata: Metadata = {
  title: "Restrooms & water",
  description:
    "Public restrooms and drinking water in Kingston, WA — find the nearest one on foot from the Edmonds–Kingston ferry.",
};

export const revalidate = 60;

export default async function RestroomsPage() {
  const [copy, features, resolved] = await Promise.all([
    getCopyOverrides(),
    // Merged store, never the seed array — Chamber additions must show up.
    getFeaturesForView("amenities"),
    resolveMapView("amenities"),
  ]);

  // Map to the finder's serializable shape: drop everything but what a walk
  // decision needs. Markers only — a line or area has no single point to walk to.
  const places: AmenityPlace[] = features
    .filter((f) => f.kind === "marker" && Array.isArray(f.point))
    .map((f) => {
      const [lat, lng] = f.point!;
      return {
        id: f.id,
        name: f.title,
        category: f.category ?? "info",
        lat,
        lng,
        notes: f.notes,
        cost: f.cost,
        walkMinutesFromFerry: walkMinutesFromDock(lat, lng),
      };
    });

  return (
    <>
      <PageHeader
        eyebrow={copyText(copy, "restrooms.header.eyebrow")}
        title={copyText(copy, "restrooms.header.title")}
        intro={copyText(copy, "restrooms.header.intro")}
      />

      <Section>
        <NearestAmenity places={places} />
      </Section>

      <Section title="Every mapped amenity">
        <p className="mb-4 text-ink">
          Restrooms, drinking water, benches, shade, and trailheads around downtown Kingston. Tap a
          pin for what the Chamber knows about it.
        </p>
        <FeatureMap resolved={resolved} height="460px" />
      </Section>
    </>
  );
}
