// The shared photo library. Upload once here, then place photos on the home
// page, the kiosk, and business listings without re-uploading.
//
// Access is admin-gated by the /admin layout; the API it saves through
// (/api/admin/media) re-checks the admin role server-side.

import type { Metadata } from "next";
import { getMediaItems } from "@/lib/stores/media-store";
import { PageHeader } from "@/components/ui";
import { MediaLibrary } from "./library";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Photos",
  description: "Upload and manage the photos used across the site.",
};

export default async function AdminMediaPage() {
  const items = await getMediaItems();

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Photos"
        intro="Every photo the site can use, in one place. Add a photo once and it becomes available to the home page, the kiosk screens, and business listings — no need to upload the same picture twice."
      />
      <MediaLibrary initialItems={items} />
    </>
  );
}
