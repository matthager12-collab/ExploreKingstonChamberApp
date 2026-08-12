import { describe, it, expect } from "vitest";
import { PORTAL_NAV, portalNavFor, portalSectionFor } from "@/lib/portal-nav";
import { ADMIN_EXITS } from "@/components/admin/admin-shell";
import { ROLES, type Role } from "@/lib/auth/roles";

import { candidatePageFiles, resolvesToPage } from "../helpers/app-routes";

// Same tripwire as the admin manifest: a dead nav link should be a red build,
// not a 404 a member discovers. The shared resolver walks route groups, so it
// finds the portal pages under src/app/(portal)/ without being told about the
// group — which is the point of sharing it.
describe("portal nav manifest ↔ routes", () => {
  it.each(PORTAL_NAV.flatMap((s) => s.items.map((i) => [i.href] as const)))(
    "%s resolves to a page.tsx",
    (href) => {
      expect(
        resolvesToPage(href),
        `${href} matched no page.tsx — looked in:\n  ${candidatePageFiles(href).join("\n  ")}`,
      ).toBe(true);
    },
  );

  it("has unique section ids and unique hrefs", () => {
    const ids = PORTAL_NAV.map((s) => s.id);
    const hrefs = PORTAL_NAV.flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("gives every section at least one item", () => {
    // A rail entry with nothing behind it renders a link to nowhere and an
    // empty section panel.
    for (const section of PORTAL_NAV) {
      expect(section.items.length, `${section.id} has no items`).toBeGreaterThan(0);
    }
  });
});

describe("portalNavFor(role)", () => {
  it("gives every role the self-service sections", () => {
    for (const role of ROLES) {
      const ids = portalNavFor(role).map((s) => s.id);
      expect(ids, `${role} lost Overview`).toContain("overview");
      expect(ids, `${role} lost My account`).toContain("account");
    }
  });

  it("scopes the org sections to the roles that own an org", () => {
    const ids = (role: Role) => portalNavFor(role).map((s) => s.id);

    expect(ids("member-business")).toContain("business");
    expect(ids("member-business")).not.toContain("nonprofit");

    expect(ids("org-editor")).toContain("nonprofit");
    expect(ids("org-editor")).not.toContain("business");

    // Admin sees both, matching the pre-shell portal dashboard's card logic.
    expect(ids("admin")).toEqual(expect.arrayContaining(["business", "nonprofit"]));
  });

  it("shows the admin entry point to admins only", () => {
    for (const role of ROLES) {
      const hasAdmin = portalNavFor(role).some((s) => s.id === "admin");
      expect(hasAdmin, `${role} admin visibility`).toBe(role === "admin");
    }
  });

  it("leaves moderator and viewer with real surfaces, not an empty rail", () => {
    // Both roles are provisioned and enforced but have no tools yet. An empty
    // rail looks broken; they should still reach their own account.
    for (const role of ["moderator", "viewer"] as const) {
      expect(portalNavFor(role).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("portalSectionFor(pathname)", () => {
  it("prefers the longest matching href", () => {
    // /portal is a prefix of everything, so a naive startsWith would pin every
    // page to Overview and the rail would never move.
    expect(portalSectionFor("/portal", "admin")?.id).toBe("overview");
    expect(portalSectionFor("/portal/business", "admin")?.id).toBe("business");
    expect(portalSectionFor("/portal/business/42", "admin")?.id).toBe("business");
    expect(portalSectionFor("/portal/nonprofit/7", "admin")?.id).toBe("nonprofit");
    expect(portalSectionFor("/portal/account", "admin")?.id).toBe("account");
  });

  it("never returns a section the role cannot see, and falls back to Overview", () => {
    // The contract is "the nearest VISIBLE section", not "nothing". An
    // org-editor who somehow reaches /portal/business gets Overview
    // highlighted rather than an empty rail — and the server gate redirects
    // them anyway, so this path is close to unreachable. Showing the nearest
    // visible ancestor beats showing no position at all.
    expect(portalSectionFor("/portal/business", "org-editor")?.id).toBe("overview");
    expect(portalSectionFor("/portal/nonprofit", "member-business")?.id).toBe("overview");

    // The thing that must never happen: handing back a section the role is not
    // allowed to see.
    expect(portalSectionFor("/portal/business", "org-editor")?.id).not.toBe("business");
    expect(portalSectionFor("/portal/nonprofit", "member-business")?.id).not.toBe(
      "nonprofit",
    );
  });
});

/* ---------------------------------------------------------------------------
 * THE WAY OUT
 *
 * Both consoles moved into their own route groups and lost the public header
 * with it. For a while the result was a one-way door: every link in the portal
 * rail pointed at /portal/*, every link in the admin rail at /admin/*, and once
 * you were inside there was no route back to the site the console belongs to.
 * It reached production before anyone noticed, because the people building it
 * always arrived by typing the URL.
 *
 * These are cheap tripwires for a failure that is invisible in a screenshot of
 * either console on its own.
 * ------------------------------------------------------------------------- */
describe("every console offers a way out", () => {
  it("the portal rail links back to the public site, for every role", () => {
    for (const role of ["admin", "member-business", "org-editor"] as const) {
      const hrefs = portalNavFor(role).flatMap((s) => s.items.map((i) => i.href));
      expect(hrefs, `role "${role}" is trapped in the portal`).toContain("/");
    }
  });

  it("the admin rail links back to the public site AND to the portal", () => {
    const hrefs = ADMIN_EXITS.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/portal");
  });

  it("marks every exit as leaving the console", () => {
    // Without it a screen-reader user follows a rail link and lands somewhere
    // with entirely different chrome, announced as an ordinary in-console move.
    for (const exit of ADMIN_EXITS) {
      expect(exit.leavesShell, `admin exit "${exit.id}"`).toBe(true);
    }
    for (const section of portalNavFor("admin")) {
      const leaves = section.items.some((i) => !i.href.startsWith("/portal"));
      if (leaves) {
        expect(section.leavesShell, `portal exit "${section.id}"`).toBe(true);
      }
    }
  });
});
