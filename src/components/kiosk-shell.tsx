"use client";

// The kiosk's client runtime — everything an unattended wall-mounted panel
// needs the browser to do, in one component (docs/KIOSK.md §5).
//
// Nobody is standing next to this device. It runs for weeks, is touched by
// strangers in a hurry, and has no keyboard, no address bar and no back button.
// So every behaviour here is about one of three things: putting the screen back
// to a known state between visitors, keeping the visitor inside the app, and
// recovering from failure without a human.
//
// Timer POLICIES live in src/lib/kiosk/policy.ts as pure functions so vitest can
// drive them with fake timers; this file is the wiring. Zero server imports —
// it hydrates on the device.

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  canReload,
  FRESHNESS_RELOAD_MS,
  HEARTBEAT_MS,
  isDegraded,
  newKioskSessionId,
  nextNudge,
  NUDGE_INTERVAL_MS,
} from "@/lib/kiosk/policy";

/** Attract-loop photography. Local files only — a kiosk fetches nothing offsite. */
const ATTRACT_PHOTOS = [
  { src: "/brand/photo-kingston-harbor-35.jpg", alt: "Kingston harbour at dusk" },
  { src: "/brand/photo-hansville-hero.jpg", alt: "Point No Point across Puget Sound" },
  { src: "/brand/photo-kingston-59.jpg", alt: "Downtown Kingston waterfront" },
  { src: "/brand/photo-heritage-park.webp", alt: "Trails through Heritage Park" },
  { src: "/brand/photo-kingston-37.jpg", alt: "The Kingston shoreline" },
];
/** Seconds each attract photo holds before cross-fading to the next. */
const ATTRACT_PHOTO_MS = 8_000;

/** sessionStorage keys. Cleared on browser restart, which --incognito forces. */
const SESSION_KEY = "vk-kiosk-sid";
/** Set immediately before a reload the SHELL triggered, so the next page life
 *  knows nobody walked up — see the beacon effect. */
const AUTO_RELOAD_KEY = "vk-kiosk-auto";

function markAutomatedReload() {
  try {
    sessionStorage.setItem(AUTO_RELOAD_KEY, "1");
  } catch {
    // Storage disabled: the worst case is one extra counted screen view.
  }
}

/** True exactly once per automated reload; clears itself. */
function consumeAutomatedReload(): boolean {
  try {
    const was = sessionStorage.getItem(AUTO_RELOAD_KEY) === "1";
    if (was) sessionStorage.removeItem(AUTO_RELOAD_KEY);
    return was;
  } catch {
    return false;
  }
}

export function KioskShell({
  idleSeconds,
  adminPreview,
  attractTitle,
  attractPrompt,
  children,
}: {
  idleSeconds: number;
  adminPreview: boolean;
  /** Resolved from the copy registry by the server layout — see (kiosk)/layout.tsx. */
  attractTitle: string;
  attractPrompt: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Attract is the resting state: a panel nobody has touched is showing the
  // loop, not the last visitor's restaurant listing.
  const [attract, setAttract] = useState(true);
  const [photo, setPhoto] = useState(0);
  const [degraded, setDegraded] = useState(false);

  const lastReloadAt = useRef<number | null>(null);
  const failures = useRef(0);
  const nudgeStep = useRef(0);
  // A ref, not state — nothing renders it, and as state it dragged the beacon
  // effect along with it: rotating the id re-ran the effect while `pathname`
  // was still the PREVIOUS visitor's screen (router.replace has not landed
  // yet), emitting a phantom pageview for their screen under the next
  // visitor's id. Lazily initialised from inside effects and handlers only, so
  // it is never written during render.
  const sessionIdRef = useRef<string | null>(null);

  /**
   * The current walk-up's analytics id.
   *
   * Persisted in sessionStorage so it SURVIVES A RELOAD. That is what keeps the
   * kiosk series honest: the shell reloads itself every fifteen idle minutes,
   * and a fresh id per reload would invent ~96 "walk-ups" a day on a panel
   * nobody had touched — straight into the figure the Chamber reports to LTAC.
   * A genuine idle reset rotates it explicitly instead (see the idle effect).
   */
  const currentSessionId = useCallback((): string => {
    if (sessionIdRef.current) return sessionIdRef.current;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(SESSION_KEY);
    } catch {
      // Storage disabled — fall through to a fresh id for this page life.
    }
    if (!id) {
      id = newKioskSessionId();
      try {
        sessionStorage.setItem(SESSION_KEY, id);
      } catch {
        // Nothing to do; the id still works for this page life.
      }
    }
    sessionIdRef.current = id;
    return id;
  }, []);

  const rotateSessionId = useCallback(() => {
    const id = newKioskSessionId();
    sessionIdRef.current = id;
    try {
      sessionStorage.setItem(SESSION_KEY, id);
    } catch {
      // best-effort
    }
  }, []);

  /* ── self-heal reload, debounced ────────────────────────────────────── */

  const selfHealReload = useCallback(() => {
    const now = Date.now();
    if (!canReload(lastReloadAt.current, now)) return;
    lastReloadAt.current = now;
    // Tell the next page life this reload was ours, so the beacon does not
    // count it as somebody walking up to the panel.
    markAutomatedReload();
    window.location.reload();
  }, []);

  /* ── beacon ─────────────────────────────────────────────────────────── */

  // One screen-view per kiosk navigation, tagged source:"kiosk" so
  // analytics-store can report walk-up use as its own series instead of
  // inflating visitor counts with a device that never leaves.
  //
  // Deps are [pathname] and NOT the session id: see sessionIdRef for why that
  // combination emitted a pageview for the previous visitor's screen.
  useEffect(() => {
    if (!pathname || adminPreview) return;
    // A reload the SHELL triggered is not a visit. The freshness reload fires
    // every fifteen idle minutes and self-heal fires on error; counting either
    // would manufacture screen views — and, with a rotating id, whole
    // "walk-ups" — on a panel nobody had touched. The kiosk series is a number
    // the Chamber reports to LTAC, so inventing ~96 visits a day out of a timer
    // is a reporting problem, not a telemetry nicety.
    if (consumeAutomatedReload()) return;
    const body = JSON.stringify({
      type: "pageview",
      path: pathname,
      sessionId: currentSessionId(),
      source: "kiosk",
    });
    try {
      if (navigator.sendBeacon?.("/api/track", body)) return;
    } catch {
      // fall through to fetch
    }
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // best-effort telemetry; a kiosk must never show a network error
    });
  }, [pathname, adminPreview, currentSessionId]);

  /* ── idle reset ─────────────────────────────────────────────────────── */

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Back to the attract loop AND back to /kiosk, so the next person never
        // inherits the last one's screen. The session id rotates here, and ONLY
        // here: this is the one moment we know one walk-up ended and the next
        // will begin. Rotating on reload instead would invent visits.
        rotateSessionId();
        setAttract(true);
        router.replace("/kiosk");
      }, idleSeconds * 1000);
    };

    // DELIBERATELY ONLY RESETS THE TIMER — it does NOT dismiss the attract
    // overlay. It used to, and that made the very first touch ambiguous:
    // pointerdown tore the overlay down, and the pointerup/click that followed
    // landed on whatever tile happened to be underneath, so a visitor's "wake
    // it up" tap opened a random screen. The overlay is a full-bleed button and
    // dismisses itself on its own click, which completes on the overlay.
    const wake = () => reset();

    // pointerdown covers touch and mouse in one listener; keydown is here for
    // the maintenance keyboard someone plugs in at the dock, not for visitors.
    const events = ["pointerdown", "touchstart", "keydown", "mousemove"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    reset();
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [idleSeconds, router, rotateSessionId]);

  /* ── attract photo rotation ─────────────────────────────────────────── */

  useEffect(() => {
    if (!attract) return;
    // Only ticks while the overlay is up. This IS the burn-in defence: the
    // attract state has to be genuinely moving content, not a held frame.
    const id = setInterval(() => setPhoto((p) => (p + 1) % ATTRACT_PHOTOS.length), ATTRACT_PHOTO_MS);
    return () => clearInterval(id);
  }, [attract]);

  /* ── input lockdown (JS half) ───────────────────────────────────────── */

  useEffect(() => {
    // Defence in depth only. The real lock is the Chromium kiosk policy on the
    // device (docs/KIOSK-DEPLOY.md); this removes the affordances a curious
    // visitor finds first — long-press menus, text selection, image dragging.
    const block = (e: Event) => e.preventDefault();
    const events = ["contextmenu", "selectstart", "dragstart", "gesturestart"];
    for (const e of events) document.addEventListener(e, block);
    return () => {
      for (const e of events) document.removeEventListener(e, block);
    };
  }, []);

  /* ── stay in-app ────────────────────────────────────────────────────── */

  useEffect(() => {
    // Last line of defence behind the no-external-anchors test and the device
    // URL allowlist: if any anchor ever escapes review, cancel the navigation
    // rather than strand the panel on a third-party page with no way back.
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;
      let dest: URL;
      try {
        dest = new URL(href, window.location.href);
      } catch {
        e.preventDefault();
        return;
      }
      const internal = dest.origin === window.location.origin && dest.pathname.startsWith("/kiosk");
      if (!internal) e.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  /* ── self-heal: errors ──────────────────────────────────────────────── */

  useEffect(() => {
    const onError = () => selfHealReload();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
    };
  }, [selfHealReload]);

  /* ── self-heal: heartbeat ───────────────────────────────────────────── */

  useEffect(() => {
    const beat = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) throw new Error("unhealthy");
        failures.current = 0;
        setDegraded(false);
      } catch {
        failures.current += 1;
        // NOTE: degraded shows a small banner and NEVER blanks the screen. The
        // page already on the panel is real content the server sent; hiding it
        // behind a full-screen "offline" card would take a working ferry board
        // away from someone standing in the queue over a router reboot.
        if (isDegraded(failures.current)) setDegraded(true);
      }
    };
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  /* ── idle freshness reload ──────────────────────────────────────────── */

  useEffect(() => {
    if (!attract) return;
    // Only while attract is up, so a reload can never interrupt a reader.
    const id = setInterval(() => {
      lastReloadAt.current = Date.now();
      markAutomatedReload();
      window.location.reload();
    }, FRESHNESS_RELOAD_MS);
    return () => clearInterval(id);
  }, [attract]);

  /* ── burn-in nudge ──────────────────────────────────────────────────── */

  useEffect(() => {
    const id = setInterval(() => {
      nudgeStep.current += 1;
      const { x, y } = nextNudge(nudgeStep.current);
      const root = document.documentElement;
      root.style.setProperty("--kiosk-nudge-x", `${x}px`);
      root.style.setProperty("--kiosk-nudge-y", `${y}px`);
    }, NUDGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  /* ── keep the stage scaled to the panel ─────────────────────────────── */

  useEffect(() => {
    // The layout's inline script does this before first paint; this keeps it
    // true if the panel is rotated or the window is ever resized.
    const rescale = () => {
      const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
      const root = document.documentElement;
      root.style.setProperty("--kiosk-scale", String(s));
      root.style.setProperty("--kiosk-x", `${(window.innerWidth - 1080 * s) / 2}px`);
      root.style.setProperty("--kiosk-y", `${(window.innerHeight - 1920 * s) / 2}px`);
    };
    window.addEventListener("resize", rescale);
    window.addEventListener("orientationchange", rescale);
    rescale();
    return () => {
      window.removeEventListener("resize", rescale);
      window.removeEventListener("orientationchange", rescale);
    };
  }, []);

  return (
    <>
      {children}

      {degraded && (
        // Deliberately a strip, not a curtain. See the heartbeat effect.
        <div
          role="status"
          className="absolute inset-x-0 bottom-0 z-40 bg-coral-deep px-10 py-6 text-center"
        >
          <p className="text-3xl font-semibold text-white">
            Be right back — showing the last information we loaded.
          </p>
        </div>
      )}

      {attract && (
        <button
          type="button"
          // The whole screen is the target. A kiosk should never ask someone to
          // find a button; the instruction is "touch", so all of it is touchable.
          onClick={() => setAttract(false)}
          aria-label="Touch to explore Kingston"
          className="absolute inset-0 z-50 flex cursor-none flex-col items-center justify-end overflow-hidden bg-sound-deep pb-40"
        >
          {ATTRACT_PHOTOS.map((p, i) => (
            <Image
              key={p.src}
              src={p.src}
              alt=""
              fill
              // Only the first is priority: the rest are pulled in behind the
              // loop and are cache-first in the service worker after that.
              priority={i === 0}
              sizes="1080px"
              className={`object-cover transition-opacity duration-1000 ${
                i === photo ? "opacity-100" : "opacity-0"
              }`}
            />
          ))}
          {/* Scrim so the prompt clears AA over any photograph underneath. */}
          <div className="absolute inset-0 bg-gradient-to-t from-sound-deep via-sound-deep/40 to-transparent" />
          <div className="relative z-10 px-16 text-center">
            <p className="font-display text-8xl leading-tight font-semibold text-white drop-shadow-lg">
              {attractTitle}
            </p>
            <p className="mt-8 animate-pulse text-5xl font-semibold text-white">{attractPrompt}</p>
          </div>
        </button>
      )}
    </>
  );
}
