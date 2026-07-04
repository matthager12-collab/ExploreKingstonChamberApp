// Chamber-facing listings workbench: Lodging and Webcams in one
// schema-driven editor (editor.tsx). Page access is admin-gated by the /admin
// layout; the API it saves through (/api/admin/content-records) re-checks the
// admin role server-side.

import type { Metadata } from "next";
import { getLodging, getWebcams } from "@/lib/stores/listing-stores";
import { getRestaurants } from "@/lib/stores/business-store";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { lodging as lodgingSeed } from "@/lib/data/lodging";
import { webcams as webcamSeed } from "@/lib/data/webcams";
import { PageHeader, Section } from "@/components/ui";
import { ListingsEditor } from "./editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Listings Workbench",
  description: "Edit the restaurant, lodging, and webcam records behind /eat, /stay, and /webcams.",
};

export default async function AdminListingsPage() {
  const [restaurants, lodging, webcams] = await Promise.all([
    getRestaurants(),
    getLodging(),
    getWebcams(),
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
          initial={{ restaurants, lodging, webcams }}
          seedIds={{
            restaurants: restaurantSeed.map((r) => r.id),
            lodging: lodgingSeed.map((r) => r.id),
            webcams: webcamSeed.map((r) => r.id),
          }}
        />
      </Section>
    </>
  );
}
