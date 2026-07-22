"use client";

// The deliberate way back in.
//
// <InstallNudge/> (components/pwa.tsx) asks at most once and a dismissal is
// permanent — the never-nag doctrine. That is only defensible if a visitor who
// said "Not now" while rushing for a ferry can still install later, so this
// entry lives in both "More" surfaces alongside the "Easy read" switch: one
// predictable, calm place on desktop and mobile alike.
//
// The browser capability comes from lib/install-prompt's shared store, which
// captures the Chromium event regardless of dismissal. This component decides
// only whether there is anything honest to OFFER:
//
//   installed already        → nothing (there is nowhere left to add it)
//   Chromium with a prompt   → a button that opens the browser's own dialog
//   iOS Safari               → the Share-sheet instructions, the only route there
//   anything else            → nothing, rather than a button that cannot work
//
// The last line is the important one: Firefox on desktop and most in-app
// webviews fire no install event and have no Share-sheet route, so an entry
// there would be a control that silently does nothing when tapped.

import { useState, useSyncExternalStore } from "react";
import { useCopy } from "@/lib/copy-context";
import {
  isInstalled,
  isIosSafari,
  promptInstall,
  readCanInstall,
  serverCanInstall,
  subscribeToInstallPrompt,
} from "@/lib/install-prompt";

export function InstallAppButton({
  className = "",
  onInstalled,
}: {
  className?: string;
  /** Closes the surrounding menu — fired only on the path that actually hands
   *  off to the browser, never when the iOS instructions merely open. */
  onInstalled?: () => void;
}) {
  const label = useCopy("install.menu.label");
  const iosHint = useCopy("install.menu.ios");
  const canInstall = useSyncExternalStore(
    subscribeToInstallPrompt,
    readCanInstall,
    serverCanInstall,
  );
  // Both are browser capability reads, so they go through the same store rather
  // than through an effect that assigns state: the server snapshot is a plain
  // false, which keeps the first client render identical to the server's, and
  // React re-reads the real answer immediately after hydration. Subscribing to
  // the install store (rather than a never-firing one) is what makes `installed`
  // update the instant an "appinstalled" event lands.
  const installed = useSyncExternalStore(subscribeToInstallPrompt, isInstalled, serverCanInstall);
  const ios = useSyncExternalStore(subscribeToInstallPrompt, isIosSafari, serverCanInstall);
  const [hintOpen, setHintOpen] = useState(false);

  if (installed) return null;
  if (!canInstall && !ios) return null;

  const buttonClass = `inline-flex min-h-11 w-full items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-seaglass/40 ${className}`;

  // Chromium: hand straight off to the browser's own install dialog. prompt()
  // must run inside this click's gesture, so it is called synchronously here.
  if (canInstall) {
    return (
      <button
        type="button"
        onClick={() => {
          void promptInstall();
          onInstalled?.();
        }}
        className={buttonClass}
      >
        <span aria-hidden="true">⤓</span>
        {label}
      </button>
    );
  }

  // iOS Safari: no programmatic install exists, so the entry is a disclosure
  // over the instructions rather than a button that pretends to do something.
  return (
    <div>
      <button
        type="button"
        aria-expanded={hintOpen}
        onClick={() => setHintOpen((open) => !open)}
        className={buttonClass}
      >
        <span aria-hidden="true">⤓</span>
        {label}
      </button>
      {hintOpen && <p className="px-3 pb-1 text-sm text-ink-soft">{iosHint}</p>}
    </div>
  );
}
