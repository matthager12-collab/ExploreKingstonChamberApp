// Render-side floor for hrefs that come from STORED CONTENT rather than
// literals: only web URLs may become links, whoever wrote the record.
//
// The write paths are the primary gate — the domain schemas' httpUrl fields
// and the intake routes' own checks all enforce http(s) before anything is
// stored. But not every store schema is strict (the grandfathered ones are
// deliberately loose for restore-safety), so a future or alternate writer
// could in principle land a non-web scheme in a field a page renders as a
// link. This helper is the one place the render side says no: a candidate
// that isn't plainly http(s) becomes no link at all, never an attribute.
//
// Scope: external web links only. mailto:/tel: anchors are built from
// site-config values by their own call sites and don't route through this.

/** The stored string as a renderable href, or undefined when it must not
 *  become one. Callers render plain text (no anchor) on undefined. */
export function safeExternalHref(candidate: string | null | undefined): string | undefined {
  if (typeof candidate !== "string") return undefined;
  const href = candidate.trim();
  return /^https?:\/\//i.test(href) ? href : undefined;
}
