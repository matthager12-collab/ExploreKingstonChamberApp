// Chamber-facing listings workbench: Lodging and Webcams in one
// schema-driven editor (editor.tsx). Page access is admin-gated by the /admin
// layout; the API it saves through (/api/admin/content-records) re-checks the
// admin role server-side.

import type { Metadata } from "next";
import { getLodgingAdmin, getWebcamsAdmin } from "@/lib/stores/listing-stores";
import { getRestaurantsAdmin } from "@/lib/stores/business-store";
import { getDirectoryListingsAdmin } from "@/lib/stores/directory-store";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { lodging as lodgingSeed } from "@/lib/data/lodging";
import { webcams as webcamSeed } from "@/lib/data/webcams";
import { PageHeader, Section } from "@/components/ui";
import { getMediaItems } from "@/lib/stores/media-store";
import { ListingsEditor } from "./editor";
import { DirectoryPublish } from "./directory-publish";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Listings Workbench",
  description: "Edit the restaurant, lodging, and webcam records behind /eat, /stay, and /webcams.",
};

export default async function AdminListingsPage() {
  // Admin read (E08): includes pending/draft records with status surfaced —
  // once members submit work, the reviewers must be able to see it.
  const [restaurants, lodging, webcams, directory, photoLibrary] = await Promise.all([
    getRestaurantsAdmin(),
    getLodgingAdmin(),
    getWebcamsAdmin(),
    getDirectoryListingsAdmin(),
    getMediaItems(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Listings Workbench"
        intro="The data behind /eat, /stay, and /webcams. Seed records ship with the app; editing one saves a custom copy that overrides it, and new records appear on the public page within a minute."
      />
      <Section
        title="Records"
        subtitle="Pick a tab, then a record to edit — or add a new one. Plain and to the point: every field maps straight onto what visitors see. Restaurants can be hidden and shown again with the checkbox; deleting removes them."
      >
        <ListingsEditor
          photoLibrary={photoLibrary}
          initial={{ restaurants, lodging, webcams, directory }}
          seedIds={{
            restaurants: restaurantSeed.map((r) => r.id),
            lodging: lodgingSeed.map((r) => r.id),
            webcams: webcamSeed.map((r) => r.id),
            directory: [],
          }}
        />
      </Section>
      <Section
        title="Directory publishing"
        subtitle="Imported member listings start as drafts. This publishes every draft belonging to an active roster member in one pass — it previews the counts and asks before writing. Courtesy members and special cases stay per-listing decisions in the editor above."
      >
        <DirectoryPublish />
      </Section>
    </>
  );
}
