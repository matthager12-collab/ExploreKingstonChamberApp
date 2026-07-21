"use client";

// E14 (vk/simple-mode) — the "Easy read" switch (M-14-03 / NFR-95).
//
// State is `localStorage["ek-simple"]` plus a `data-simple` attribute on <html>,
// and NEVER a cookie: a cookies() read in the root layout would opt every page
// out of static rendering (the audited v1 ISR trap). The layout's pre-paint
// inline bootstrap applies the stored value before first paint; this component
// is only the control that writes it. No server round-trip, so it works on the
// static pages too.
//
// The <html> attribute IS the store, read through useSyncExternalStore: the
// switch is mounted three times (desktop nav, mobile sheet, /simple), and this
// way every copy reflects the same truth without prop-drilling or a context,
// and the server snapshot is a plain `false` so hydration is never a mismatch.
//
// It is a toggle BUTTON with aria-pressed, not a checkbox — the whole control is
// one target, the visible label is its accessible name, and the pressed state is
// announced. The track/knob is decorative: the word "Easy read" plus the pressed
// state carry the meaning, so colour is never the only signal (M-14-04).

import { useSyncExternalStore } from "react";
import { useCopy } from "@/lib/copy-context";

/** Same key the root layout's bootstrap script reads. */
const STORAGE_KEY = "ek-simple";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  return document.documentElement.dataset.simple === "1";
}

/** Server (and hydration) snapshot: the markup always ships as "not simple";
 *  the bootstrap script has already fixed the attribute by the time this runs. */
function getServerSnapshot(): boolean {
  return false;
}

function setSimple(on: boolean): void {
  if (on) document.documentElement.dataset.simple = "1";
  else delete document.documentElement.dataset.simple;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Safari private mode throws on any localStorage access. The attribute
    // above still applies for this page view; only persistence is lost.
  }
  for (const notify of listeners) notify();
}

export function SimpleModeToggle({ className = "" }: { className?: string }) {
  const label = useCopy("simple.toggle.label");
  const on = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <button
      type="button"
      onClick={() => setSimple(!on)}
      aria-pressed={on}
      className={`inline-flex min-h-11 items-center gap-2.5 rounded-full px-3 py-2 text-sm font-semibold text-ink hover:bg-seaglass/40 ${className}`}
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
          on ? "border-sound bg-sound" : "border-ink-soft bg-white"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full transition-transform ${
            on ? "translate-x-6 bg-white" : "translate-x-1 bg-ink-soft"
          }`}
        />
      </span>
      {label}
    </button>
  );
}
