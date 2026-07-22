// Layout for the public website — every URL the site had before E22, unchanged.
//
// Route groups are stripped from the URL, so this file adds a layout LEVEL
// without adding a path segment: src/app/(site)/eat/page.tsx still serves /eat.
// Its whole job is to hold the chrome that used to sit in the root layout, so
// that the sibling (kiosk) group can render genuinely bare — a descendant
// layout can never REMOVE what an ancestor renders, which is the entire reason
// this split exists (docs/KIOSK.md §2, §4).
//
// Everything visible lives in <SiteChrome/>, shared with the root 404. Fonts,
// <html>/<body>, viewport and metadata stay one level up in src/app/layout.tsx
// because both groups need them.

import type { ReactNode } from "react";

import { SiteChrome } from "@/components/site-chrome";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
