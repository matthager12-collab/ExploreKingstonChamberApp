import Link from "next/link";

import { KioskFerryStrip } from "@/components/kiosk-ferry-strip";
import { getFerryStatusSnapshot } from "@/lib/ferry-status";
import { enabledScreensInOrder } from "@/lib/kiosk/screens";
import { getKioskSettings } from "@/lib/stores/kiosk-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

// The kiosk home screen — what a visitor sees the moment they touch the panel
// and the attract loop lifts.
//
// Two jobs, in this order: answer "when is the next boat" before anyone asks,
// because that is why most people are standing here, and then offer a small
// number of very large buttons for everything else. Only screens the Chamber
// has enabled get a tile, so an unfinished or switched-off screen is absent
// rather than a button that goes nowhere.

// Sixty seconds, matching the rest of the app's store-backed pages. The device
// also reloads itself while idle, so the practical staleness ceiling is the
// shorter of the two.
export const revalidate = 60;

export default async function KioskHomePage() {
  const [settings, copy, ferry] = await Promise.all([
    getKioskSettings(),
    getCopyOverrides(),
    // Never let a WSDOT hiccup take down the whole kiosk: the strip renders a
    // plain "check the board" line when the snapshot is unavailable, and the
    // category tiles below do not depend on it at all.
    getFerryStatusSnapshot().catch(() => null),
  ]);
  const screens = enabledScreensInOrder(settings.enabledScreens);

  return (
    <div className="flex h-full flex-col bg-sound-deep">
      <header className="shrink-0 px-16 pt-16 pb-8">
        <p className="font-display text-7xl leading-tight font-semibold text-white">
          Welcome to Kingston
        </p>
      </header>

      {ferry && <KioskFerryStrip snapshot={ferry} />}

      <div className="min-h-0 flex-1 overflow-y-auto px-16 pb-16">
        <h2 className="mt-10 mb-8 text-4xl font-semibold text-white/80">
          {copyText(copy, "kiosk.home.heading")}
        </h2>
        <ul className="grid grid-cols-2 gap-8">
          {screens.map((screen) => (
            <li key={screen.id}>
              <Link
                href={`/kiosk/${screen.id}`}
                // min-h well past the 60px floor: these are the primary targets
                // on the whole device and are pressed by people holding coffee,
                // luggage, and a child's hand.
                className="flex min-h-[15rem] flex-col justify-center rounded-3xl bg-white/10 p-10 active:bg-white/20"
              >
                <span aria-hidden="true" className="text-7xl">
                  {screen.icon}
                </span>
                <span className="mt-4 text-5xl font-semibold text-white">{screen.label}</span>
                <span className="mt-2 text-2xl text-white/70">{screen.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
