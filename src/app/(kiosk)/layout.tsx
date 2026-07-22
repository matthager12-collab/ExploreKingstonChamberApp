import type { Viewport } from "next";
import { notFound } from "next/navigation";

import { KioskShell } from "@/components/kiosk-shell";
import { getKioskAccess } from "@/lib/stores/kiosk-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

// The bare layout for the physical ferry-dock kiosk (E22).
//
// No SiteNav, no SiteFooter, no Tracker, no offline banner, no install nudge,
// no skip link. That is the whole reason src/app/(site)/ exists: a descendant
// layout cannot remove chrome an ancestor renders, so the chrome had to move
// down into a sibling group before this file could be genuinely empty of it.
//
// WHY NO Tracker: this is a shared public device. Site analytics are keyed by a
// per-browser session id that would never rotate on a panel running for weeks,
// so every walk-up would fold into one enormous "visitor". KioskShell sends its
// own beacon tagged source:"kiosk" with a session id that rotates on every idle
// reset, and analytics-store keeps those out of visitor rollups.

export const viewport: Viewport = {
  // Navy, so the browser/OS surface matches the kiosk's own background rather
  // than the site's cyan. Per-route viewport MERGES over the root's, so
  // viewportFit:"cover" from src/app/layout.tsx still applies here.
  themeColor: "#324a6d",

  // DELIBERATELY ABSENT: the two viewport properties that pin the zoom scale.
  // (Not named literally — E14's guard is a plain substring grep over src/ and
  // naming them here trips it, the same self-trip its own file header warns
  // about.)
  //
  // The E22 charter asks for both, but E14 shipped an accessibility invariant
  // forbidding them ANYWHERE in src/ (tests/unit/a11y-static-invariants.test.ts,
  // "never blocks pinch-zoom"), and the same charter makes WCAG AA a kiosk
  // launch gate. Those two asks contradict each other: pinning the scale is a
  // 1.4.4 failure and the textbook way low-vision users get locked out.
  //
  // The later, shipped accessibility gate wins. Zoom lockdown belongs to the
  // DEVICE, not to a page that the same codebase serves to phones: Chromium's
  // --kiosk --disable-pinch flags are the real enforcement (docs/KIOSK.md §8,
  // and the flag list in docs/KIOSK-DEPLOY.md). That is also where it is
  // reversible by an operator, which a hard-coded viewport is not.
};

export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  // SHIP-DARK GATE. The flag is read FIRST and the session only on the disabled
  // branch — see getKioskAccess() for why that order is load-bearing.
  const { enabled, adminPreview, settings } = await getKioskAccess();
  if (!enabled && !adminPreview) notFound();

  // The attract screen's two strings are resolved HERE, in the server layout,
  // and handed to KioskShell as props: the shell is a client component and
  // cannot read the overlay store, but the Chamber still has to be able to
  // reword the most-read text in the whole app without a deploy.
  const copy = await getCopyOverrides();

  return (
    <div
      // Painted over the site's animated-gradient <body> background, and fixed
      // so the panel can never scroll the stage out of view.
      className="fixed inset-0 overflow-hidden bg-sound-deep"
      style={{
        // Kiosk lockdown, CSS half. The JS half is in KioskShell and the real
        // enforcement is the Chromium kiosk policy on the device; this layer
        // just removes the obvious affordances.
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        touchAction: "manipulation",
        overscrollBehavior: "none",
        // No mouse is attached to a touch panel; a stranded cursor arrow in the
        // middle of the screen is a classic "is this thing broken?" signal.
        cursor: "none",
      }}
    >
      {/* Scale the fixed 1080x1920 design stage to whatever the panel reports,
          BEFORE first paint. The Chamber's display is 1080x1920, where the
          scale is exactly 1 and nothing moves; this exists so a replacement
          panel of another size stays pixel-stable instead of reflowing
          (docs/KIOSK.md §3).

          A raw inline <script> rather than next/script or an effect, for the
          same reason the site's simple-mode bootstrap is one: it has to run
          before paint, or the stage renders at 1080px wide on a smaller panel
          and visibly snaps. KioskShell re-runs the same maths on resize. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var d=document.documentElement,w=innerWidth,h=innerHeight,s=Math.min(w/1080,h/1920);d.style.setProperty('--kiosk-scale',String(s));d.style.setProperty('--kiosk-x',((w-1080*s)/2)+'px');d.style.setProperty('--kiosk-y',((h-1920*s)/2)+'px');}catch(e){}})()`,
        }}
      />
      <div
        data-kiosk-stage
        className="absolute top-0 left-0 flex h-[1920px] w-[1080px] flex-col overflow-hidden text-white"
        style={{
          transformOrigin: "top left",
          // The burn-in nudge (KioskShell) adds --kiosk-nudge-x/y of a pixel or
          // two every half hour, so static furniture never sits on identical
          // pixels for the life of the panel.
          transform:
            "translate(calc(var(--kiosk-x, 0px) + var(--kiosk-nudge-x, 0px)), calc(var(--kiosk-y, 0px) + var(--kiosk-nudge-y, 0px))) scale(var(--kiosk-scale, 1))",
        }}
      >
        <KioskShell
          idleSeconds={settings.idleSeconds}
          adminPreview={adminPreview}
          attractTitle={copyText(copy, "kiosk.attract.title")}
          attractPrompt={copyText(copy, "kiosk.attract.prompt")}
        >
          {children}
        </KioskShell>
      </div>
    </div>
  );
}
