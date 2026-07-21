// Chamber-facing site-content console: show/hide public pages and edit the
// headline text on every page. Access is admin-gated by the /admin layout;
// the API it saves through (/api/admin/site) re-checks the admin role
// server-side.

import type { Metadata } from "next";
import { getCopyOverrides, getPageSettings } from "@/lib/stores/site-store";
import { COPY_BLOCKS } from "@/lib/site-copy-registry";
import { effectiveHiddenPaths, HIDEABLE_PAGES } from "@/lib/page-visibility";
import { PageHeader } from "@/components/ui";
import { ContentManager } from "./manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site Content",
  description: "Edit page text and show or hide entire public pages.",
};

export default async function AdminContentPage() {
  const [overrides, pageSettings] = await Promise.all([
    getCopyOverrides(),
    getPageSettings(),
  ]);
  // E14: the effective view, so a default-hidden page (/es) shows as HIDDEN
  // here even before anyone has ever written a record for it — otherwise the
  // toggle would read "Visible" for a page visitors are getting a 404 on, and
  // pressing it would hide an already-hidden page.
  const hiddenPaths = effectiveHiddenPaths(pageSettings);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Site content"
        intro="Every page's headline text, editable in one place — and a switch to take a whole page off the site while you get it ready. Blocks you never touch always follow the site's built-in wording."
      />
      <ContentManager
        pages={HIDEABLE_PAGES}
        initialHidden={hiddenPaths}
        blocks={[...COPY_BLOCKS]}
        initialOverrides={overrides}
      />
    </>
  );
}
