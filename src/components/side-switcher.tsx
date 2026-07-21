"use client";

// "Which side of the water are you on?" control. A compact segmented toggle
// (Kingston side / Edmonds side) plus a "use my location" button. Setting a side
// writes the "vk-side" cookie and calls router.refresh() so the server
// components re-render for the new side — no full-page reload, so scroll and the
// live ferry widget's polling survive.
//
// Location is opt-out: on a visitor's very first arrival we proactively ask the
// browser for their location and set the side for them (see the mount effect).
// We ask exactly once — a hand-picked side or a previous ask suppresses it, and
// any denial/dismissal is remembered — so nobody gets nagged. The toggle and the
// "use my location" button remain as the manual override.
//
// `tone`: "dark" places light controls on the navy hero; "light" is the default
// for pale backgrounds. All color comes from the design tokens.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SIDE_ASKED_COOKIE, SIDE_COOKIE, sideFromLngLat, type WaterSide } from "@/lib/side";

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

function markAsked() {
  document.cookie = `${SIDE_ASKED_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
}

function hasCookie(name: string) {
  return (
    typeof document !== "undefined" &&
    document.cookie.split("; ").some((c) => c.startsWith(`${name}=`))
  );
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
  const autoRan = useRef(false);

  // Opt-out auto-detect. On first arrival — no hand-picked side and we've never
  // asked — request location once. A granted position sets the side; a denial or
  // dismissal is remembered (markAsked) so we never prompt again. StrictMode can
  // double-invoke effects, so autoRan guards a single request per mount.
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (hasCookie(SIDE_COOKIE) || hasCookie(SIDE_ASKED_COOKIE)) return;

    const request = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          markAsked();
          const detected = sideFromLngLat(pos.coords.latitude, pos.coords.longitude);
          if (detected && detected !== side) {
            writeSide(detected);
            setNote(
              detected === "kingston"
                ? "📍 You're on the Kingston side."
                : "📍 You're on the Edmonds side.",
            );
            startTransition(() => router.refresh());
          }
        },
        // Denied, dismissed, or unavailable — remember it and stay on the default.
        () => markAsked(),
        { timeout: 8000, maximumAge: 5 * 60_000 },
      );
    };

    // Skip the native prompt if the browser already has a decision on file:
    // "granted" resolves silently, "denied" means don't nag, "prompt" pops up.
    const perms = navigator.permissions;
    if (perms?.query) {
      perms
        .query({ name: "geolocation" as PermissionName })
        .then((status) => {
          if (status.state === "denied") {
            markAsked();
            return;
          }
          request();
        })
        .catch(request);
    } else {
      request();
    }
    // Runs once on mount; `side` here is the SSR default (no cookie yet).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
