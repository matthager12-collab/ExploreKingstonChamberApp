// The shared photo library, and where each photo appears.
//
// Two sections, placements first: someone opening this page almost always
// wants to change a photo that is already on the site, not admire the library.
//
// Access is admin-gated by the /admin layout; the APIs it saves through
// (/api/admin/media, /api/admin/photos) re-check the admin role server-side.

import type { Metadata } from "next";
import { getMediaItems } from "@/lib/stores/media-store";
import { getPhotoContext } from "@/lib/stores/photo-store";
import { PageHeader, Section } from "@/components/ui";
import { photoSlot, type PhotoSlotKey } from "@/lib/photo-slots";
import { MediaLibrary } from "./library";
import { PhotoSlots } from "./slots";

/**
 * photo name → the human labels of the spots using it.
 *
 * Computed here rather than in the library component so the library stays a
 * dumb grid: it renders a warning if it is handed one, and knows nothing about
 * slots. Removing a placed photo is not blocked — resolvePhoto falls back to
 * the shipped default, so nothing breaks — but it silently changes a public
 * page, and a silent change to the home page is exactly the kind of surprise
 * worth one confirmation.
 */
function placementsByPhoto(
  overrides: Record<string, { name: string }>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, override] of Object.entries(overrides)) {
    const label = photoSlot(key as PhotoSlotKey)?.label;
    if (!label) continue; // a slot retired from the registry — nothing renders it
    (out[override.name] ??= []).push(label);
  }
  return out;
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Photos",
  description: "Upload photos and choose where they appear on the site.",
};

export default async function AdminMediaPage() {
  const [items, photoCtx] = await Promise.all([getMediaItems(), getPhotoContext()]);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Photos"
        intro="Add a photo once and it becomes available everywhere — the home page, the kiosk screens, and business listings. Choose where each one appears below, and swap it any time without waiting on a code change."
      />
      <Section
        title="Where photos appear"
        subtitle="Each spot on the site, showing exactly what visitors see right now."
      >
        <PhotoSlots initial={photoCtx} />
      </Section>
      <Section
        title="Photo library"
        subtitle="Every photo the site can use. Removing one that is in use sends that spot back to its default photo, so the library warns before it happens."
      >
        <MediaLibrary
          initialItems={items}
          placements={placementsByPhoto(photoCtx.overrides)}
        />
      </Section>
    </>
  );
}
