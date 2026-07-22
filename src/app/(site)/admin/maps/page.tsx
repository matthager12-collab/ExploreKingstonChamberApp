// /admin/maps — the Chamber's general-purpose map builder (the CMS the owner
// asked for). Create named views, draw markers / lines / trails / areas, and
// assign each feature to one or more views.
//
// Access is gated by src/app/admin/layout.tsx (admin role required); we also
// re-check here (defense in depth) and the /api/admin/map-* routes re-check
// again because API routes bypass layouts.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getMapFeatures, getMapViews } from "@/lib/stores/map-store";
import { PageHeader } from "@/components/ui";
import { MapBuilder } from "./editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Map builder",
  description:
    "Create map views and drop markers, trails, and areas onto them — the Chamber's map CMS.",
};

export default async function AdminMapsPage() {
  const user = await getSessionUser();
  if (user?.role !== "admin") redirect("/portal");

  const [views, features] = await Promise.all([getMapViews(), getMapFeatures()]);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Map builder"
        intro="Build named map views (Food & Drink, Trails, Explore…) and draw the things that go on them — markers with icons and photos, colored lines, trails, and areas. Assign each feature to one or more views, then publish."
      />
      {/* Wider than the standard Section: the map canvas is the dominant
          element of the builder, so give it the room a laptop screen has. */}
      <section className="mx-auto w-full max-w-[1500px] px-4 py-8">
        <MapBuilder initialViews={views} initialFeatures={features} />
        {/* E09: the builder is a frozen monolith, so its change history lives
            in the audit browser — one link per store it writes. */}
        <p className="mt-4 text-sm text-ink-soft">
          Made a change you regret? View the change history for{" "}
          <a
            href="/admin/audit?store=map-features"
            className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
          >
            map features
          </a>{" "}
          or{" "}
          <a
            href="/admin/audit?store=map-views"
            className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
          >
            map views
          </a>{" "}
          — every edit is recorded and any version can be restored.
        </p>
      </section>
    </>
  );
}
