// @vitest-environment jsdom

// E14 slice 2 — the nav's keyboard and ARIA contract.
//
// This is the repo's first DOM/component suite (E02 shipped a node-only unit
// config), so it opts into jsdom with the pragma above rather than changing the
// shared environment. RTL's auto-cleanup only registers when vitest runs with
// `globals: true`, which this config deliberately does not — hence the explicit
// cleanup() in afterEach.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { SiteNav } from "@/components/site-nav";

afterEach(() => {
  cleanup();
  pathname = "/";
});

/** Both "More" controls are named exactly "More" (their ▾ / ☰ glyphs are
 *  aria-hidden, which is the point), so every lookup is scoped to its nav. */
const desktopMore = () =>
  within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", {
    name: /^more$/i,
  });
const mobileMore = () =>
  within(screen.getByRole("navigation", { name: "Mobile" })).getByRole("button", {
    name: /^more$/i,
  });

describe("SiteNav — desktop More disclosure", () => {
  it("Escape closes the menu and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<SiteNav />);
    const trigger = desktopMore();

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    // The menu the trigger claims to control really exists while open.
    const menuId = trigger.getAttribute("aria-controls");
    expect(menuId).toBeTruthy();
    expect(document.getElementById(menuId!)).not.toBeNull();
    expect(within(document.getElementById(menuId!)!).getByRole("link", { name: "Parking" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(document.getElementById(menuId!)).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("a click outside closes the menu (the old timer-deferred onBlur close is gone)", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SiteNav />
        <button type="button">elsewhere</button>
      </div>,
    );
    const trigger = desktopMore();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  });
});

describe("SiteNav — mobile More sheet", () => {
  it("opens onto its first link and Escape closes it with focus back on the toggle", async () => {
    const user = userEvent.setup();
    render(<SiteNav />);
    // Two "More" controls exist (desktop trigger + bottom-bar toggle); the
    // sheet toggle is the one inside the Mobile nav landmark.
    const toggle = mobileMore();

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const sheetId = toggle.getAttribute("aria-controls");
    expect(sheetId).toBeTruthy();
    const sheet = document.getElementById(sheetId!);
    expect(sheet).not.toBeNull();
    const firstLink = within(sheet!).getAllByRole("link")[0];
    await waitFor(() => expect(firstLink).toHaveFocus());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
    expect(document.getElementById(sheetId!)).toBeNull();
    expect(toggle).toHaveFocus();
  });
});

describe("SiteNav — link semantics", () => {
  it("marks the current page with aria-current in every link group", async () => {
    const user = userEvent.setup();
    pathname = "/parking";
    render(<SiteNav />);

    // Desktop primary group: /parking is not primary, so /ferry must NOT claim it.
    const mainNav = screen.getByRole("navigation", { name: "Main" });
    expect(within(mainNav).getByRole("link", { name: "Ferry" })).not.toHaveAttribute(
      "aria-current",
    );

    // Desktop More menu.
    const trigger = desktopMore();
    await user.click(trigger);
    const menu = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    expect(within(menu).getByRole("link", { name: "Parking" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.keyboard("{Escape}");

    // Mobile sheet.
    const toggle = mobileMore();
    await user.click(toggle);
    const sheet = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(within(sheet).getByRole("link", { name: "Parking" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks the active bottom-bar tab with aria-current", () => {
    pathname = "/ferry";
    render(<SiteNav />);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile" });
    const ferry = within(mobileNav).getByRole("link", { name: "Ferry" });
    expect(ferry).toHaveAttribute("aria-current", "page");
    expect(within(mobileNav).getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it('the bottom-bar ferry link is named exactly "Ferry" — the ⛴ glyph is aria-hidden', () => {
    render(<SiteNav />);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile" });
    const ferry = within(mobileNav).getByRole("link", { name: "Ferry" });
    // getByRole's name match is exact, so finding it already proves the emoji
    // is out of the accessible name; assert the mechanism too.
    expect(ferry).toHaveAccessibleName("Ferry");
    expect(ferry.textContent).toContain("⛴");
    expect(ferry.querySelector("[aria-hidden='true']")?.textContent).toBe("⛴");
  });
});
