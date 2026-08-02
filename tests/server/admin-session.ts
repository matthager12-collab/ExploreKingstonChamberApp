// Shared admin session for the server suites — minted, not logged in.
//
// WHY THIS EXISTS. /api/auth/login is rate-limited to 8 attempts per 60s per
// IP *and* per account (src/app/api/auth/login/route.ts). Every server suite
// authenticates as the same ci@example.test over 127.0.0.1, so they all draw
// on ONE shared bucket. With seven suites logging in — and axe-smoke logging
// in once per admin page — the total sat at 9 against a cap of 8: the ninth
// attempt 429s and the failure lands on whichever suite happens to be running
// ("admin login for the … spec must succeed" in a file nobody touched). It
// only reproduces on a warm window, which is exactly the kind of flake that
// wastes a launch week.
//
// Minting the cookie from the same tokens module the server verifies with
// costs zero login budget and is strictly more deterministic. It is not a
// weaker check: every caller still asserts on real authenticated behaviour
// (an admin page rendering, an admin API accepting a write), so a bad cookie
// fails the suite loudly rather than silently scanning a login page.
//
// The login ROUTE itself still gets real coverage — axe-smoke signs in for
// its admin pages, and the generated admin-walk proves the 401 gate.

import { makeSessionToken, sessionCookie } from "@/lib/auth/tokens";
import { BASE_URL } from "./config";

/** Mirrors tests/server/global-setup.ts: the seeded admin's id, and the
 *  secret it exports to the server process. session_version starts at 0
 *  (auth-schema default) and no server suite bumps it. */
const ADMIN_ID = "ci-admin";
const HARNESS_SECRET = "vitest-only-secret";

const token = makeSessionToken(ADMIN_ID, 0, HARNESS_SECRET);

/** `Cookie:` header value for hand-rolled fetch() calls. */
export const ADMIN_COOKIE_HEADER = `${sessionCookie.name}=${token}`;

/** Playwright cookie record for context.addCookies(). */
export const ADMIN_CONTEXT_COOKIE = {
  name: sessionCookie.name,
  value: token,
  url: BASE_URL,
};

/** Sign a Playwright context in as the seeded admin. Pages AND
 *  context.request share the jar, so API probes are authenticated too. */
export async function signInAdmin(context: {
  addCookies: (cookies: { name: string; value: string; url: string }[]) => Promise<void>;
}): Promise<void> {
  await context.addCookies([ADMIN_CONTEXT_COOKIE]);
}
