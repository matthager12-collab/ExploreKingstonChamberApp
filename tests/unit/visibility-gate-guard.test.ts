// Guard: an ISR page must use the cookie-free visibility gate.
//
// THE TRAP (found live 2026-08-03: /give hidden in admin yet serving 200):
// `assertPageVisible` reads the admin session — cookies() — on its hidden
// branch. A page with `export const revalidate` prerenders VISIBLE at build
// time (the build store is empty), so the route is static; when an admin
// later hides it, the hidden branch's cookies() read cannot work during
// background revalidation, the 404 never bakes, and the stale visible page
// keeps serving to everyone. The admin "hide" toggle — the Chamber's
// emergency lever for a misbehaving page — silently does nothing.
//
// `assertPageVisibleStatic` never touches the session, so revalidation
// re-runs the check and bakes the 404 within the revalidate window (the
// mechanism /line's live↔dark flips proved in production, E33).
//
// Rule: a page file that exports `revalidate` may not call the bare
// `assertPageVisible(`. Exemptions are pages that are DYNAMIC for reasons
// independent of (or accepted despite) their inert revalidate export — on a
// dynamic route the bare gate runs per-request and its admin preview
// genuinely works:
//   - (site)/ferry + (site)/ferry/plan: getSide() reads the side cookie on
//     every request (the known-inert revalidate, memory
//     `visit-kingston-ferry-perf` item 3 — accepted by design).
//   - (site)/es: DEFAULT_HIDDEN_PAGES member — hidden AT BUILD TIME, so the
//     bare gate's cookies() fires during prerender and the route ships
//     dynamic; accepted on-demand rendering (page-visibility.tsx doc).
//
// Removing a page from the exemption list (e.g. after making /ferry truly
// static) should flip it to the static gate in the same change.

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.join("src", "app");

const EXEMPT = new Set([
  path.join(APP_ROOT, "(site)", "ferry", "page.tsx"),
  path.join(APP_ROOT, "(site)", "ferry", "plan", "page.tsx"),
  path.join(APP_ROOT, "(site)", "es", "page.tsx"),
]);

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(full));
    else if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("ISR pages use the cookie-free visibility gate", () => {
  const offenders: string[] = [];
  const exemptStillPresent = new Set<string>();

  for (const file of pageFiles(APP_ROOT)) {
    const src = fs.readFileSync(file, "utf8");
    const isr = /export const revalidate\b/.test(src);
    const bareGate = /await assertPageVisible\(/.test(src);
    if (!(isr && bareGate)) continue;
    if (EXEMPT.has(file)) exemptStillPresent.add(file);
    else offenders.push(file);
  }

  it("no ISR page calls the bare assertPageVisible", () => {
    expect(offenders, "swap these to assertPageVisibleStatic (see this file's header)").toEqual(
      [],
    );
  });

  it("the exemption list matches reality (stale entries get removed)", () => {
    expect([...exemptStillPresent].sort()).toEqual([...EXEMPT].sort());
  });
});
