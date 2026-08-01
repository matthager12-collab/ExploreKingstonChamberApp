// E33 — the admin preview of /line.
//
// /line itself uses the cookie-free assertPageVisibleStatic gate so its ISR
// stays real (see that page's header), which costs it the usual
// hidden-but-admin pass-through. This sibling route restores the preview: it
// is admin-only, renders the SAME <LineLander/> inside the same (site) chrome
// — so the Chamber signs off on exactly what visitors will get — and is free
// to be dynamic because nobody's afternoon depends on its load time.
//
// Anonymous visitors get a 404 whether /line is hidden or not: this URL is a
// staff tool, not a public alias.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LineLander } from "@/components/line-lander";
import { getSessionUser } from "@/lib/auth";
import { getEffectiveHiddenPaths, HiddenPageBanner } from "@/lib/page-visibility";

export const metadata: Metadata = {
  title: "Ferry line (SR-104) — admin preview",
  robots: { index: false },
};

export default async function LinePreviewPage() {
  const user = await getSessionUser();
  if (user?.role !== "admin") notFound();

  const hidden = (await getEffectiveHiddenPaths()).includes("/line");
  return (
    <>
      {hidden ? (
        <HiddenPageBanner />
      ) : (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <p className="rounded-xl border border-sand bg-shell px-4 py-2 text-sm font-medium text-ink">
            Admin preview — /line is currently live for visitors. This copy renders fresh on
            every load; the public page is cached for up to a minute.
          </p>
        </div>
      )}
      <LineLander />
    </>
  );
}
