import { describe, it, expect } from "vitest";
import { LANDING_FALLBACK, landingFor, safeLandingPath } from "@/lib/auth/landing";
import { ROLES, type Role } from "@/lib/auth/roles";

import { candidatePageFiles, resolvesToPage } from "../helpers/app-routes";

// Post-login routing sends each role to its own console. Three things can go
// wrong with a table like that, and each gets a test: the destination stops
// existing, a role is sent somewhere its layout will bounce it back from, or
// the wire value grows into an open redirect.

describe("landingFor ↔ routes", () => {
  // Same tripwire the two nav manifests carry: a landing page that no longer
  // exists should be a red build, not a 404 someone meets one second after
  // typing their password.
  it.each(ROLES.map((role) => [role] as const))(
    "%s lands on a page that exists",
    (role: Role) => {
      const href = landingFor(role);
      expect(
        resolvesToPage(href),
        `${role} lands on ${href}, which matched no page.tsx — looked in:\n  ${candidatePageFiles(href).join("\n  ")}`,
      ).toBe(true);
    },
  );

  it("routes admin to the Chamber console and everyone else to the portal", () => {
    expect(landingFor("admin")).toBe("/admin");
    for (const role of ROLES.filter((r) => r !== "admin")) {
      expect(landingFor(role), `${role} should land on the portal`).toBe(
        LANDING_FALLBACK,
      );
    }
  });

  // THE LOOP GUARD, and the reason moderator/viewer are not in the table.
  //
  // src/app/(admin)/admin/layout.tsx admits `role === "admin"` and redirects
  // everyone else to /portal. Landing any other role on an /admin path would
  // therefore complete a round trip and dump them where they started, having
  // flashed a page they may not open. If the console ever becomes role-scoped,
  // this test is the thing that has to be updated deliberately — which is
  // exactly when someone should be re-reading that layout.
  it("sends no role into a console its layout would bounce it out of", () => {
    for (const role of ROLES) {
      const href = landingFor(role);
      const entersAdmin = href === "/admin" || href.startsWith("/admin/");
      expect(
        entersAdmin && role !== "admin",
        `${role} lands on ${href}, but the /admin layout admits only "admin" — it would be redirected straight back to ${LANDING_FALLBACK}`,
      ).toBe(false);
    }
  });
});

describe("safeLandingPath", () => {
  it("passes the paths the table actually produces", () => {
    for (const role of ROLES) {
      expect(safeLandingPath(landingFor(role))).toBe(landingFor(role));
    }
  });

  it.each([
    ["//evil.example/pwn", "protocol-relative URL — a real off-site redirect"],
    ["https://evil.example", "absolute URL"],
    ["http://evil.example", "absolute URL, plaintext"],
    ["portal", "relative path"],
    ["", "empty string"],
    // Reads as an absolute local path and survives a startsWith("//") check,
    // but browsers normalize "\" to "/" in the authority and resolve it to
    // //evil.example. The one entry here that a careful reviewer would pass.
    ["/\\evil.example", "backslash normalized to a protocol-relative URL"],
    ["/\\\\evil.example", "double backslash, same normalization"],
  ])("falls back rather than following %s (%s)", (value) => {
    expect(safeLandingPath(value)).toBe(LANDING_FALLBACK);
  });

  it.each([[undefined], [null], [42], [{ toString: () => "/admin" }]])(
    "falls back on non-string %s",
    (value) => {
      expect(safeLandingPath(value)).toBe(LANDING_FALLBACK);
    },
  );
});
