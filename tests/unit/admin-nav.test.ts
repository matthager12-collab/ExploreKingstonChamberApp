import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ADMIN_NAV, adminNavFor, type AdminNavEntry } from "@/lib/admin-nav";
import type { AuthSubject } from "@/lib/auth/authz";
import type { Role } from "@/lib/db/schema";

const SRC_APP = path.join(process.cwd(), "src", "app");

// A dead nav link should be a red build, not a 404 a visitor discovers. This is
// the manifest's reason to exist: every href must map to a real page file.
describe("admin nav manifest ↔ routes", () => {
  it("has at least the twelve known admin surfaces", () => {
    expect(ADMIN_NAV.length).toBeGreaterThanOrEqual(12);
  });

  it.each(ADMIN_NAV.map((e) => [e.href, e] as const))(
    "%s resolves to a page.tsx",
    (href) => {
      const rel = href.replace(/[?#].*$/, "").replace(/^\//, "");
      const pageFile = path.join(SRC_APP, rel, "page.tsx");
      expect(fs.existsSync(pageFile), `${href} → ${pageFile} missing`).toBe(true);
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
