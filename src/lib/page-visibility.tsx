// Server-side enforcement for admin page show/hide.
//
// Public pages call `await assertPageVisible("/hunt")` at the top of their
// server component. Hidden page + visitor → notFound() (a clean 404).
// Hidden page + admin session → renders normally so the Chamber can preview;
// pair with <HiddenPageBanner/> from the same import for an on-page notice.
//
// The list of hideable paths (with labels) lives here so the admin UI and
// the nav filter agree on one source of truth. Home ("/") and the portal/
// admin/api routes are deliberately not hideable.

import { notFound } from "next/navigation";
import { getSessionUser } from "./auth";
import { HiddenPreviewEvict } from "./hidden-preview-evict";
import { getHiddenPaths } from "./stores/site-store";

export const HIDEABLE_PAGES: { path: string; label: string }[] = [
  { path: "/ferry", label: "Ferry" },
  { path: "/eat", label: "Eat & Drink" },
  { path: "/events", label: "Events" },
  { path: "/itineraries", label: "Itineraries" },
  { path: "/stay", label: "Stay" },
  { path: "/parking", label: "Parking" },
  { path: "/webcams", label: "Webcams" },
  { path: "/map", label: "Town Map" },
  { path: "/give", label: "Give Back" },
  { path: "/hunt", label: "Scavenger Hunt" },
  { path: "/about", label: "About" },
];

/**
 * 404 for visitors when the page is hidden; admins pass through.
 * Returns true when the page is hidden-but-admin (show the banner).
 */
export async function assertPageVisible(path: string): Promise<boolean> {
  const hidden = await getHiddenPaths();
  if (!hidden.includes(path)) return false;
  const user = await getSessionUser();
  if (user?.role === "admin") return true;
  notFound();
}

/**
 * Small notice admins see on a page that is hidden from the public.
 *
 * This banner is also the marker for "the bytes on screen are an admin-only
 * render", so it carries <HiddenPreviewEvict/> — a render-nothing client child
 * that pulls this pathname back out of the service worker's shell cache. See
 * hidden-preview-evict.tsx for why the worker can't make that call itself.
 */
export function HiddenPageBanner() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-4">
      <HiddenPreviewEvict />
      <p className="rounded-xl border border-coral/40 bg-coral/10 px-4 py-2 text-sm font-medium text-coral-deep">
        Hidden page — visitors get a 404. Only admins can see this preview.
        Unhide it in Admin → Site content.
      </p>
    </div>
  );
}
