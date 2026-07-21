"use client";

// Keeps an admin's preview of a HIDDEN page out of the shared-device cache.
//
// assertPageVisible() (page-visibility.tsx) deliberately lets an admin through
// to a page that is hidden from the public: they get a normal HTTP 200 render
// with <HiddenPageBanner/> on top. The service worker cannot tell that render
// apart from a visitor's — fetch events never carry the session cookie — so
// public/sw.js's navigate() sees "200, not redirected, allowlisted pathname"
// and files the admin's copy in the shell cache under the bare pathname.
//
// Nothing undoes that later: signing out clears the cookie, not CacheStorage,
// and the shell cache never fills up in normal browsing, so the entry survives
// until the worker's VERSION is bumped. On the front-desk tablet the next
// person to open that page offline would be served the admin preview, banner
// text and all. E13 says session-gated content never enters a shared cache.
//
// So the preview evicts itself: we delete this pathname back out of the shell
// cache as soon as the admin's preview renders.
//
// This RACES, and the race is not closed. navigate() in public/sw.js hands its
// cache.put to event.waitUntil and returns the response immediately (it has to
// — a storage write must never decide what a visitor is shown), so the write
// can land either side of this effect. Usually the write wins and we clean up
// after it; occasionally we delete first and the worker files the entry anyway.
// Re-running on a later preview clears it, and bumping VERSION clears it for
// certain.
//
// A stopgap, not a cure. The durable fix is teaching the worker which renders
// are personalised — the server marking them uncacheable and navigate()
// honouring that — which means a proxy change and belongs to whichever epic
// owns src/proxy.ts. Tracked in docs/PWA.md §7 (Known limitations).
//
// Every step is feature-detected and every failure is a silent no-op: this
// must never throw into an admin's page render, and a browser with no
// CacheStorage (private mode, insecure origin) has no cache to poison anyway.

import { useEffect } from "react";

/**
 * Cache-name PREFIX, not the full name. public/sw.js builds its shell cache as
 * `vk-shell-${VERSION}`; matching on the prefix means a VERSION bump over there
 * can never quietly orphan the eviction over here.
 */
const SHELL_CACHE_PREFIX = "vk-shell-";

/** Renders nothing. Mounted by <HiddenPageBanner/>, which is the only render
 *  path that proves this page is an admin-only preview. */
export function HiddenPreviewEvict() {
  useEffect(() => {
    if (typeof caches === "undefined") return;
    // The worker keys navigations by pathname alone (its comment explains why),
    // so the pathname is the whole key — no search string, no origin.
    const pathname = window.location.pathname;
    void (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(SHELL_CACHE_PREFIX))
          .map(async (name) => {
            const cache = await caches.open(name);
            await cache.delete(pathname);
          }),
      );
    })().catch(() => {
      // Storage disabled or the delete raced a worker update. The worst case is
      // the entry we meant to remove, which is where we started — never an error
      // in front of the admin.
    });
  }, []);

  return null;
}
