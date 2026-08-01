"use client";

// "Which side of the water are you on?" control. A compact segmented toggle
// (Kingston side / Edmonds side) plus a "use my location" button. Setting a side
// writes the "vk-side" cookie and calls router.refresh() so the server
// components re-render for the new side — no full-page reload, so scroll and the
// live ferry widget's polling survive.
//
// Location is USER-INITIATED only (MHMDA consent floor, E11 follow-up):
// geolocation runs solely when the visitor taps "use my location" — a one-shot
// read, never on mount and never a watch. The tap is the affirmative act the
// /privacy page promises. The coordinate is classified on the device by
// sideFromLngLat and immediately discarded; the only thing that persists is
// the binary kingston/edmonds choice in the vk-side cookie. No coordinate is
// ever transmitted or stored, which is why this component is a reviewed
// exemption in tests/unit/geolocation-consent-guard.test.ts rather than being
// routed through the consent card (src/lib/privacy/consent.ts) that near-me
// and the hunt use. tests/unit/side-switcher.test.tsx pins the
// no-geolocation-on-mount behavior.
//
// `tone`: "dark" places light controls on the navy hero; "light" is the default
// for pale backgrounds. All color comes from the design tokens.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SIDE_COOKIE, sideFromLngLat, type WaterSide } from "@/lib/side";

type Tone = "light" | "dark";

const THEME: Record<
  Tone,
  {
    group: string;
    btnBase: string;
    btnOn: string;
    btnOff: string;
    locate: string;
    note: string;
  }
> = {
  light: {
    group: "border-sand bg-white",
    btnBase: "text-ink-soft",
    // E14 contrast: white on --color-tide is 3.39:1 at this 12px size; the
    // deeper cyan is 5.28:1. Usage-site fix — the token value is untouched.
    btnOn: "bg-tide-deep text-white shadow-sm",
    btnOff: "hover:text-sound-deep",
    locate:
      "border-sand text-tide-deep hover:border-tide hover:text-sound",
    note: "text-ink-soft",
  },
  dark: {
    group: "border-white/25 bg-white/10",
    btnBase: "text-seaglass",
    btnOn: "bg-white text-sound-deep shadow-sm",
    btnOff: "hover:text-white",
    locate: "border-white/30 text-seaglass hover:border-white hover:text-white",
    note: "text-seaglass",
  },
};

function writeSide(side: WaterSide) {
  document.cookie = `${SIDE_COOKIE}=${side}; path=/; max-age=31536000; samesite=lax`;
}

export function SideSwitcher({
  side,
  className = "",
  tone = "light",
}: {
  side: WaterSide;
  className?: string;
  tone?: Tone;
}) {
  const t = THEME[tone];
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function choose(next: WaterSide) {
    setNote(null);
    if (next === side) return;
    writeSide(next);
    startTransition(() => router.refresh());
  }

  function useMyLocation() {
    setNote(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNote("Location isn't available — pick a side above.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const detected = sideFromLngLat(pos.coords.latitude, pos.coords.longitude);
        if (!detected) {
          setNote("You're not near the crossing — pick a side above.");
          return;
        }
        setNote(
          detected === "kingston"
            ? "📍 You're on the Kingston side."
            : "📍 You're on the Edmonds side.",
        );
        if (detected !== side) {
          writeSide(detected);
          startTransition(() => router.refresh());
        }
      },
      () => {
        setLocating(false);
        setNote("Couldn't tell — pick a side above.");
      },
      { timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }

  const btn = (value: WaterSide, label: string) => {
    const on = side === value;
    return (
      <button
        type="button"
        onClick={() => choose(value)}
        aria-pressed={on}
        disabled={pending}
        className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${t.btnBase} ${
          on ? t.btnOn : t.btnOff
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className={`inline-flex items-center gap-1 rounded-full border p-0.5 ${t.group}`}>
        {btn("kingston", "🚢 Kingston side")}
        {btn("edmonds", "🌊 Edmonds side")}
      </div>
      <button
        type="button"
        onClick={useMyLocation}
        disabled={locating || pending}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${t.locate}`}
      >
        📍 {locating ? "Locating…" : "Use my location"}
      </button>
      <span role="status" aria-live="polite" className={note ? `text-xs ${t.note}` : "sr-only"}>
        {note ?? ""}
      </span>
    </div>
  );
}
