// Chamber-facing listings workbench: Lodging, Webcams, and ATMs in one
// schema-driven editor (editor.tsx). Page access is admin-gated by the /admin
// layout; the API it saves through (/api/admin/content-records) re-checks the
// admin role server-side.

import type { Metadata } from "next";
import { getAtms, getLodging, getWebcams } from "@/lib/stores/listing-stores";
import { lodging as lodgingSeed } from "@/lib/data/lodging";
import { webcams as webcamSeed } from "@/lib/data/webcams";
import { atms as atmSeed } from "@/lib/data/atms";
import { PageHeader, Section } from "@/components/ui";
import { ListingsEditor } from "./editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Listings Workbench",
  description: "Edit the lodging, webcam, and ATM records behind /stay, /webcams, and /parking.",
};

export default async function AdminListingsPage() {
  const [lodging, webcams, atms] = await Promise.all([
    getLodging(),
    getWebcams(),
    getAtms(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Listings Workbench"
        intro="The data behind /stay, /webcams, and the ATM section of /parking. Seed records ship with the app; editing one saves a custom copy that overrides it, and new records appear on the public page within a minute."
      />
      <Section
        title="Records"
        subtitle="Pick a tab, then a record to edit — or add a new one. Plain and to the point: every field maps straight onto what visitors see."
      >
        <ListingsEditor
          initial={{ lodging, webcams, atms }}
          seedIds={{
            lodging: lodgingSeed.map((r) => r.id),
            webcams: webcamSeed.map((r) => r.id),
            atms: atmSeed.map((r) => r.id),
          }}
        />
      </Section>
    </>
  );
}
