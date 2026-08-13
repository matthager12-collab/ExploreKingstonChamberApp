// @vitest-environment jsdom

// THE RAIL'S LAYOUT CONTRACT.
//
// The manifest suites (admin-nav / portal-nav) guard WHAT is in the rail. This
// one guards WHERE it lands, which is the half a manifest cannot express: the
// exits sit at the foot of the rail, below every section you actually work in,
// and they get there from the `leavesShell` flag rather than from their position
// in the array a caller happens to pass.
//
// Ordering is the whole point of the change, and ordering is exactly what a
// screenshot review misses on a console nobody re-reads once it looks fine.
//
// Same jsdom + explicit-cleanup pattern as site-nav.test.tsx (this config runs
// node-by-default and without `globals: true`).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

let pathname = "/admin";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { AppRail, type RailSection } from "@/components/shell/app-rail";

afterEach(() => {
  cleanup();
  pathname = "/admin";
  document.documentElement.removeAttribute("data-rail");
});

const SECTIONS: RailSection[] = [
  { id: "insights", label: "Insights", icon: "insights", items: [{ href: "/admin", label: "Insights" }] },
  {
    id: "worklist",
    label: "Worklist",
    icon: "worklist",
    items: [{ href: "/admin/worklist", label: "Worklist" }],
  },
  {
    id: "members",
    label: "Members",
    icon: "members",
    items: [
      { href: "/admin/accounts", label: "Accounts" },
      { href: "/admin/claims", label: "Claims" },
    ],
  },
];

const EXITS: RailSection[] = [
  { id: "exit-site", label: "Explore Kingston", icon: "site", leavesShell: true, items: [{ href: "/", label: "Public site" }] },
  { id: "exit-portal", label: "Member portal", icon: "leave", leavesShell: true, items: [{ href: "/portal", label: "Member portal" }] },
];

function renderRail(sections: RailSection[]) {
  return render(
    <AppRail
      surface="admin"
      brand={{ full: "Chamber admin", short: "CA" }}
      brandHref="/admin"
      sections={sections}
      footer={{ primary: "Mat", secondary: "Administrator" }}
    >
      <p>page</p>
    </AppRail>,
  );
}

/** Every link inside the rail column itself, in DOM order. */
const railLinks = () =>
  within(screen.getByRole("navigation", { name: "Sections" }))
    .getAllByRole("link")
    .map((el) => el.textContent?.trim() ?? "");

describe("AppRail — the exits sink to the foot of the rail", () => {
  it("renders every exit after every working section", () => {
    renderRail([...SECTIONS, ...EXITS]);
    const links = railLinks();

    const lastSection = Math.max(
      links.indexOf("Insights"),
      links.indexOf("Worklist"),
      links.indexOf("Members"),
    );
    for (const exit of ["Explore Kingston (leaves this console)", "Member portal (leaves this console)"]) {
      expect(links.indexOf(exit), `"${exit}" is not below the sections`).toBeGreaterThan(
        lastSection,
      );
    }
  });

  it("sinks them by the leavesShell FLAG, not by array position", () => {
    // The bug this prevents: someone reorders a manifest, an exit stops being
    // last in the array, and it silently reappears among the working sections.
    renderRail([EXITS[0], ...SECTIONS, EXITS[1]]);
    const links = railLinks();

    expect(links.indexOf("Explore Kingston (leaves this console)")).toBeGreaterThan(
      links.indexOf("Members"),
    );
  });

  it("puts the exits in their own group, not loose among the sections", () => {
    // Bottom-pinning is a property of a container (mt-auto + a rule above it).
    // If the exits share a parent with the working sections they are inline
    // again however the array is ordered.
    renderRail([...SECTIONS, ...EXITS]);
    const parentOf = (name: string | RegExp) =>
      screen.getByRole("link", { name }).parentElement;

    expect(parentOf(/^Explore Kingston/)).toBe(parentOf(/^Member portal/));
    expect(parentOf(/^Explore Kingston/)).not.toBe(parentOf("Members"));
  });

  it("keeps the signed-in line below the exits", () => {
    const { container } = renderRail([...SECTIONS, ...EXITS]);
    const text = container.textContent ?? "";
    expect(text.indexOf("Signed in as")).toBeGreaterThan(text.indexOf("Member portal"));
  });

  it("still pins the footer when a console has no exits at all", () => {
    // mt-auto moved off the footer and onto the shared bottom block; a rail with
    // no exits must not lose it.
    renderRail(SECTIONS);
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Explore Kingston/ })).toBeNull();
  });
});

describe("AppRail — an exit never takes the active highlight", () => {
  it("leaves the working section highlighted, not the way out", () => {
    // "/" is a prefix of every path. Matching exits would light up Explore
    // Kingston on every admin page.
    pathname = "/admin/accounts";
    renderRail([...SECTIONS, ...EXITS]);

    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /^Explore Kingston/ })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("AppRail — a one-page section is one click", () => {
  it("opens no section panel for Worklist", () => {
    // The reason promoting Worklist out of Members is worth doing: a section
    // holding a single page renders no second column, so the rail link IS the
    // destination.
    pathname = "/admin/worklist";
    renderRail([...SECTIONS, ...EXITS]);

    expect(screen.queryByRole("navigation", { name: /Worklist pages/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Worklist" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("still opens one for a multi-page section", () => {
    pathname = "/admin/accounts";
    renderRail([...SECTIONS, ...EXITS]);
    expect(screen.getByRole("navigation", { name: "Members pages" })).toBeInTheDocument();
  });
});
