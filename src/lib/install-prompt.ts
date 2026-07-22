// The one place the browser's install capability is observed and held.
//
// Two surfaces need this and they have opposite lifecycles, which is why it is
// a module-level store rather than component state:
//
//   - <InstallNudge/> (components/pwa.tsx) — the at-most-once card, which a
//     visitor can permanently dismiss.
//   - <InstallAppButton/> (components/install-app-button.tsx) — the always-there
//     entry in the nav's "More" surfaces, which must keep working AFTER that
//     dismissal. That is the whole point of it.
//
// So the Chromium event is captured UNCONDITIONALLY here. Dismissal suppresses
// the card, never the capture — the old code kept the event in a ref inside the
// card, so a dismissed visitor had no way back in even if we offered one.
//
// Every browser touch is feature-detected and every failure path is a silent
// no-op, matching the rest of the PWA layer: a visitor on a browser that cannot
// install simply never sees an install control.

/** The Chromium-only event. Not in lib.dom, so the minimum shape we call. */
type InstallPromptEvent = Event & { prompt: () => Promise<unknown> };

/** The deferred event, or null when the browser has not offered one (yet, or
 *  ever, or because it has already been spent — it is single-use). */
let deferred: InstallPromptEvent | null = null;
let listening = false;
const subscribers = new Set<() => void>();

function emit() {
  for (const notify of subscribers) notify();
}

function handleBeforeInstallPrompt(event: Event) {
  // Suppresses Chromium's own mini-infobar so the app's quiet surfaces are the
  // only ask. Unconditional on purpose: a visitor who dismissed our card must
  // not be handed the browser's built-in bar as a consolation prize.
  event.preventDefault();
  deferred = event as InstallPromptEvent;
  emit();
}

function handleAppInstalled() {
  // The event is spent and the app is on the home screen — every install
  // control should disappear on the spot, without waiting for a reload.
  deferred = null;
  emit();
}

/**
 * useSyncExternalStore subscribe. The window listeners are attached once, on
 * the first subscription, and deliberately never removed: this store outlives
 * every component that reads it (the nav unmounts on some routes, the card
 * unmounts on dismissal) and losing the listener would mean losing a capability
 * the browser announces exactly once per page load.
 */
export function subscribeToInstallPrompt(onChange: () => void): () => void {
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
  }
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/** Whether the browser has an install prompt ready for us to show. */
export function readCanInstall(): boolean {
  return deferred !== null;
}

/** The server has no browser capability, so the first client render matches the
 *  server's exactly and nothing flashes in before hydration settles. */
export function serverCanInstall(): boolean {
  return false;
}

/**
 * Show the browser's own install dialog. Must be called from inside a user
 * gesture — Chromium rejects prompt() otherwise.
 *
 * The event is cleared BEFORE it is used because it is single-use: a second
 * prompt() on a spent event throws, and leaving it in place would keep every
 * install control on screen after the visitor already answered.
 */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  deferred = null;
  emit();
  if (!event) return;
  try {
    await event.prompt();
  } catch {
    // The visitor dismissed the browser dialog, or it was called outside a
    // gesture. Either way there is nothing honest left to say.
  }
}

/** Already on the home screen — no install control should be rendered at all. */
export function isInstalled(): boolean {
  try {
    if (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches) {
      return true;
    }
  } catch {
    // matchMedia missing or the query is unsupported — fall through to iOS.
  }
  // iOS Safari reports installed state here instead of via display-mode.
  return (
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS Safari, the one engine that never fires beforeinstallprompt — the Share
 * sheet is the only route, so both surfaces carry instructions instead of a
 * button there.
 *
 * navigator.standalone exists ONLY on iOS Safari and is present whether or not
 * the app is installed, so this is a capability check, not a user-agent sniff.
 */
export function isIosSafari(): boolean {
  return typeof navigator !== "undefined" && "standalone" in navigator;
}
