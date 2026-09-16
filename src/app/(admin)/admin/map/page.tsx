// /admin/map — the Chamber's parking-map editor.
//
// The seed polygons were georeferenced from the Port's schematic map (±10–15 m),
// so some shapes sit a stall or two off reality. This page lets an admin with
// local eyes drag vertices and pins to where things actually are, then mark a
// zone "field-verified". Edits save to the parking-zones overlay store and go
// live on /parking within a minute (revalidate = 60).
//
// Access is gated by src/app/admin/layout.tsx (admin role required); the
// /api/admin/parking routes re-check the role themselves.

import type { Metadata } from "next";
import { getParkingZones } from "@/lib/stores/parking-store";
import { parkingZones } from "@/lib/data/parking";
import { getMediaItems } from "@/lib/stores/media-store";
import { PageHeader, Section } from "@/components/ui";
import { MapZoneEditor } from "./editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Parking Map Editor",
  description:
    "Drag parking-lot shapes and pins to match reality, edit their rules, and mark them field-verified.",
};

export default async function AdminMapPage() {
  const [zones, mediaLibrary] = await Promise.all([getParkingZones(), getMediaItems()]);

  // Seed lots that have been DELETED. A delete writes a tombstone that hides
  // the seed row, and until now there was no way back: the editor lists the
  // merged zones, a tombstoned lot is not in that list, so there is nothing to
  // click. Restoring from /admin/audit does not work either — a delete stores
  // only `{id}` with the `deleted` column set (writeRecord strips `_deleted`
  // from the audited doc), so replaying that snapshot would resurrect an empty
  // record and the schema would reject it.
  //
  // Deriving the list here needs no new store API: anything in the git seed
  // that survived the merge is live, so anything missing was tombstoned.
  const liveIds = new Set(zones.map((z) => z.id));
  const deletedSeedZones = parkingZones.filter((z) => !liveIds.has(z.id));

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Parking map editor"
        intro="The shapes below were traced from the Port's schematic map, so they can sit a few meters off. Pick a zone, drag its corners and pin to where the stalls really are, and hit Save — the public map updates within a minute. When you've checked a zone on the ground, mark it field-verified."
      />
      <Section
        title="Zones"
        subtitle="Click a zone in the list (or on the map) to edit it. Drag the white corner handles to reshape, drag the pin to move the map label, or draw a brand-new zone."
      >
        <MapZoneEditor
          initialZones={zones}
          mediaLibrary={mediaLibrary}
          deletedSeedZones={deletedSeedZones}
        />
      </Section>
      {/* E09: the zone editor is a frozen monolith, so its change history
          lives in the audit browser — pick a zone there to see and restore
          old versions. */}
      <Section>
        <p className="text-sm text-ink-soft">
          Made a change you regret?{" "}
          <a
            href="/admin/audit?store=parking-zones"
            className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
          >
            View the parking zones&apos; change history
          </a>{" "}
          — every edit is recorded and any version can be restored.
        </p>
      </Section>
    </>
  );
}
