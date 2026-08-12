import { describe, it, expect } from "vitest";
import {
  ADMIN_NAV,
  ADMIN_SECTIONS,
  adminNavFor,
  adminSectionsFor,
  type AdminNavEntry,
} from "@/lib/admin-nav";
import type { AuthSubject } from "@/lib/auth/authz";
import type { Role } from "@/lib/db/schema";

import { candidatePageFiles, resolvesToPage } from "../helpers/app-routes";

// A dead nav link should be a red build, not a 404 a visitor discovers. This is
// the manifest's reason to exist: every href must map to a real page file.
describe("admin nav manifest ↔ routes", () => {
  it("has at least the twelve known admin surfaces", () => {
    expect(ADMIN_NAV.length).toBeGreaterThanOrEqual(12);
  });

  it.each(ADMIN_NAV.map((e) => [e.href, e] as const))(
    "%s resolves to a page.tsx",
    (href) => {
      // Route-group aware since E22 — /admin/* is served from
      // src/app/(admin)/admin/*, and the group is stripped from the URL.
      expect(
        resolvesToPage(href),
        `${href} matched no page.tsx — looked in:\n  ${candidatePageFiles(href).join("\n  ")}`,
      ).toBe(true);
    },
  );

  it("has unique hrefs and ids", () => {
    const hrefs = ADMIN_NAV.map((e) => e.href);
    const ids = ADMIN_NAV.map((e) => e.id);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// adminNavFor filters by the E06 can() seam. Prove the capability keys mean what
// the role model says, so a future role-scoped shell hides the right surfaces.
describe("adminNavFor(user) capability filtering", () => {
  const subject = (role: Role): AuthSubject => ({
    id: "u1",
    email: "u@example.com",
    name: "U",
    role,
    orgId: null,
    editableIds: [],
    entitlements: {},
  });

  it("an admin sees every surface", () => {
    expect(adminNavFor(subject("admin"))).toHaveLength(ADMIN_NAV.length);
  });

  it("a viewer sees only view-reports surfaces (insights, history, no ops)", () => {
    const hrefs = adminNavFor(subject("viewer")).map((e) => e.href);
    expect(hrefs).toContain("/admin");
    expect(hrefs).toContain("/admin/audit");
    expect(hrefs).not.toContain("/admin/ops"); // manage-site, admin-only
    expect(hrefs).not.toContain("/admin/accounts");
  });

  it("a moderator sees only the worklist", () => {
    const hrefs = adminNavFor(subject("moderator")).map((e) => e.href);
    expect(hrefs).toEqual(["/admin/worklist"]);
  });

  it("an org role with no editable ids sees nothing in the admin shell", () => {
    expect(adminNavFor(subject("member-business"))).toHaveLength(0);
    expect(adminNavFor(subject("org-editor"))).toHaveLength(0);
  });

  it("every entry declares a capability in the Action union", () => {
    const actions = new Set<AdminNavEntry["capability"]>([
      "edit-record",
      "manage-accounts",
      "moderate",
      "view-reports",
      "manage-site",
    ]);
    for (const e of ADMIN_NAV) expect(actions.has(e.capability)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SECTIONS (the N5 rail). The manifest gained a `section` per entry; these guard
// the grouping the way the block above guards the hrefs.

describe("admin nav sections", () => {
  // Local subject: the one above is scoped to its own describe block.
  const subject = (role: Role): AuthSubject => ({
    id: "u1",
    email: "u@example.com",
    name: "U",
    role,
    orgId: null,
    editableIds: [],
    entitlements: {},
  });

  it("gives every entry a section that actually exists", () => {
    const known = new Set(ADMIN_SECTIONS.map((s) => s.id));
    for (const entry of ADMIN_NAV) {
      expect(known.has(entry.section), `${entry.id} → unknown section "${entry.section}"`).toBe(
        true,
      );
    }
  });

  it("leaves no section empty", () => {
    // An empty section renders a rail entry that leads nowhere.
    for (const section of ADMIN_SECTIONS) {
      const count = ADMIN_NAV.filter((e) => e.section === section.id).length;
      expect(count, `section "${section.id}" has no surfaces`).toBeGreaterThan(0);
    }
  });

  it("keeps sections small enough to scan", () => {
    // The whole point of grouping was that 19 flat chips overflowed the bar. A
    // section that grows past ~6 pages has re-created the problem one level down.
    for (const section of ADMIN_SECTIONS) {
      const count = ADMIN_NAV.filter((e) => e.section === section.id).length;
      expect(count, `section "${section.id}" is getting long`).toBeLessThanOrEqual(6);
    }
  });

  it("adminSectionsFor(admin) covers every surface exactly once", () => {
    const sections = adminSectionsFor(subject("admin"));
    const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.sort()).toEqual(ADMIN_NAV.map((e) => e.href).sort());
  });

  it("drops sections a role cannot see rather than rendering them empty", () => {
    for (const role of ["admin", "moderator", "viewer"] as const) {
      for (const section of adminSectionsFor(subject(role))) {
        expect(section.items.length, `${role}/${section.id}`).toBeGreaterThan(0);
      }
    }
  });
});
