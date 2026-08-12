/** Icon slots the shared app rail can render.
 *
 * Declared in lib, not in the icon component, because both nav manifests
 * (src/lib/portal-nav.ts and src/lib/admin-nav.ts) are DATA and the
 * lib-not-to-components rule in .dependency-cruiser.cjs stops the lower layer
 * reaching up into the UI.
 *
 * The component satisfies this union rather than defining it, so adding a nav
 * slot without drawing its glyph is a type error rather than a blank square.
 */
export type NavIconName =
  // portal
  | "overview"
  | "business"
  | "nonprofit"
  | "syndicate"
  | "account"
  | "admin"
  // admin sections
  | "insights"
  | "members"
  | "listings"
  | "events"
  | "experiences"
  | "maps"
  | "system"
  // exits — the way OUT of a console, back to the public site or across to the
  // other one. Kept separate from the section icons above because they name a
  // destination outside the console rather than a section within it.
  | "site"
  | "leave";
