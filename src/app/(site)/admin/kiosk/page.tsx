// Chamber-facing controls for the ferry-dock kiosk (E22).
//
// Page access is admin-gated by the /admin layout; the API it saves through
// (/api/admin/kiosk) re-checks the admin role server-side because API routes
// bypass layouts.

import type { Metadata } from "next";
import { getKioskSettings } from "@/lib/stores/kiosk-store";
import { PageHeader, Section } from "@/components/ui";
import { KioskControl } from "./kiosk-control";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kiosk",
  description:
    "Turn the ferry-dock touchscreen on or off, choose which screens it shows, and push an update to it immediately.",
};

export default async function AdminKioskPage() {
  const settings = await getKioskSettings();

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Ferry-dock kiosk"
        intro="The touchscreen by the ferry runs this website in a locked-down, full-screen mode. It reads the same listings, events, ferry times and parking information as every other page, so keeping it current is just keeping the site current — there is no second system to update."
      />
      <Section
        title="Controls"
        subtitle="Turn it on or off, pick which screens it offers, and set how long it waits before returning to the welcome screen."
      >
        <KioskControl initial={settings} />
      </Section>
      <Section
        title="If something looks wrong at the dock"
        subtitle="The one-page version of this lives in docs/KIOSK-DEPLOY.md, printed and kept at the front desk."
      >
        <div className="rounded-2xl border border-sand bg-white p-4">
          <ul className="space-y-3 text-sm text-ink-soft">
            <li>
              <span className="font-semibold text-ink">The screen is stuck, black, or frozen.</span>{" "}
              Switch the small computer behind the screen off and on again. It returns to the
              welcome screen by itself in a minute or two — nothing needs to be typed.
            </li>
            <li>
              <span className="font-semibold text-ink">
                It says &ldquo;Be right back.&rdquo;
              </span>{" "}
              The kiosk cannot reach the internet. Check the network at the dock first. The kiosk
              keeps showing the last information it successfully loaded rather than going blank, so
              this is not urgent unless it persists.
            </li>
            <li>
              <span className="font-semibold text-ink">The information is out of date.</span> Edit
              it in admin like any other page, wait about a minute, or press{" "}
              <span className="font-semibold text-ink">Refresh now</span> above to push it
              immediately.
            </li>
          </ul>
        </div>
      </Section>
    </>
  );
}
