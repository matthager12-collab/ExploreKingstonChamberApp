"use client";

// Sign out, rendered at the foot of the app rail in BOTH consoles.
//
// Moved here from src/components/portal/auth-forms.tsx, where it was exported
// as LogoutButton and rendered as a page action on the portal Overview. That
// placement was the reason the admin console had no sign-out: its rail never
// passes through /portal, so the only way out of the console was to take the
// "Member portal" exit and hunt for the button on the far side. Sign-out is
// chrome — it belongs to the shell that is on screen everywhere, not to one
// page inside one of the two consoles.
//
// It lives under shell/ rather than portal/ for the same reason app-rail.tsx
// does: the admin console must be able to import it without pulling in the
// portal's login/setup/invite forms, which is exactly what importing
// auth-forms would have cost.

import { IconSignOut } from "./icons";

export function SignOutButton({ expanded }: { expanded: boolean }) {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        // A hard navigation, not router.push: the session cookie was just
        // cleared server-side, and every rendered page above this one was
        // built for a signed-in user. Reloading throws that cache away rather
        // than leaving a stale, authenticated-looking shell on screen.
        window.location.href = "/portal";
      }}
      // Collapsed, the glyph is the only visible content — so the control
      // carries its own name, per the labelling rule in app-rail.tsx.
      aria-label={expanded ? undefined : "Sign out"}
      title={expanded ? undefined : "Sign out"}
      className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 font-semibold text-ink-soft transition-colors hover:bg-white hover:text-ink"
    >
      <IconSignOut size={22} className="shrink-0" />
      {expanded && <span className="truncate text-sm">Sign out</span>}
    </button>
  );
}
