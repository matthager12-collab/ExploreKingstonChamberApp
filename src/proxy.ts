// Request-boundary auth gate (E06).
//
// Next 16 file convention: this is `proxy.ts`, NOT `middleware.ts` — the
// middleware convention is deprecated and renamed (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md,
// and the warning in AGENTS.md). Proxy runs on the Node.js runtime by default;
// setting a `runtime` config here THROWS, so there is none.
//
// ── THIS IS DEFENSE IN DEPTH, NOT THE AUTHORIZATION CHECK. ────────────────
// All it can do is verify a cookie's signature and expiry. It deliberately
// does NOT touch the database, because the Next docs are explicit that proxy
// "is meant to be invoked separately of your render code and in optimized
// cases deployed to your CDN" and "you should not attempt relying on shared
// modules or globals."
//
// So it cannot see whether the account was disabled, demoted, or had its
// sessions revoked thirty seconds ago — all of which live in Postgres. A valid
// SIGNATURE is not a valid SESSION. The authoritative check stays where it can
// read the database: requireRole()/requireCan()/getSessionUser() inside every
// route and page. What this buys is that an unauthenticated request never
// reaches route code at all, and a route that forgets its gate is not instantly
// a public endpoint.
//
// Kept public on purpose (absent from the matcher): "/portal" itself (the login
// form, and the redirect to /portal/setup on a fresh install), "/portal/setup",
// "/portal/join" (invite redemption — the holder has no session yet), and
// "/api/auth/*", which self-gate where needed.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/tokens";

// Imported from ./lib/auth/tokens, which is PURE — no next/headers, no DB, no
// server-only import. Importing the barrel "@/lib/auth" here would drag the
// data layer into the proxy bundle.

export const config = {
  matcher: [
    // "/admin/:path*" alone would not match a bare "/admin".
    "/admin",
    "/admin/:path*",
    // Signed-in portal surfaces. "/portal" itself stays public: it IS the
    // login page.
    "/portal/account/:path*",
    "/portal/business/:path*",
    "/portal/nonprofit/:path*",
    "/portal/syndicate/:path*",
    "/api/admin/:path*",
    "/api/portal/:path*",
  ],
};

export function proxy(request: NextRequest): NextResponse {
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // Fail CLOSED when AUTH_SECRET is missing. Throwing would surface a 500 on
  // every gated path; treating it as "no valid session" keeps the public site
  // up and turns a misconfigured deploy into a locked door rather than an open
  // one. (The app itself still throws loudly on the next real auth call.)
  const secret = process.env.AUTH_SECRET;
  const claims = token && secret ? verifySessionToken(token, secret) : null;

  if (claims) return NextResponse.next();

  // API routes get a JSON 401 — a redirect would hand a fetch() caller an HTML
  // login page with a 200, which is much harder to debug.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  // Page routes go to the login page. No `next` / return-URL parameter: it
  // would be an open-redirect surface for the sake of a nicety, and the portal
  // is one click deep.
  return NextResponse.redirect(new URL("/portal", request.url));
}
