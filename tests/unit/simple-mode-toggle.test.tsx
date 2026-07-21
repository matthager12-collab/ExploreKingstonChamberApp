// @vitest-environment jsdom

// E14 slice 3 — the "Easy read" switch's contract (M-14-03 / NFR-95).
//
// Two things must move together on every toggle, or simple mode is broken in a
// way nobody notices until a reader complains:
//   1. document.documentElement.dataset.simple — what the CSS actually keys on
//      (html[data-simple="1"] in globals.css), i.e. what the reader sees NOW;
//   2. localStorage["ek-simple"] — what the root layout's pre-paint bootstrap
//      reads on the NEXT page load, i.e. whether the setting survives.
// A cookie would be the third possibility and is forbidden: a cookies() read in
// the root layout makes every page dynamic (the audited v1 ISR trap), which is
// why the state lives in these two places and nowhere else.
//
// jsdom per-file pragma above rather than a config change — the shared unit
// config stays environment: "node" for every existing suite.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { SimpleModeToggle } from "@/components/simple-mode-toggle";

const STORAGE_KEY = "ek-simple";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.simple;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.simple;
});

describe("SimpleModeToggle", () => {
  it("turns simple mode on: sets the html attribute AND persists the key", async () => {
    const user = userEvent.setup();
    render(<SimpleModeToggle />);

    const toggle = screen.getByRole("button", { name: "Easy read" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.dataset.simple).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.simple).toBe("1");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("turns simple mode off again: clears both", async () => {
    const user = userEvent.setup();
    render(<SimpleModeToggle />);
    const toggle = screen.getByRole("button", { name: "Easy read" });

    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.dataset.simple).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("adopts the state the pre-paint bootstrap already applied", () => {
    // What a returning reader gets: the layout script set the attribute before
    // React ever ran, so the switch must render pressed without being clicked.
    document.documentElement.dataset.simple = "1";
    localStorage.setItem(STORAGE_KEY, "1");

    render(<SimpleModeToggle />);

    expect(screen.getByRole("button", { name: "Easy read" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("never writes a cookie — the state is localStorage + the attribute only", async () => {
    const user = userEvent.setup();
    render(<SimpleModeToggle />);

    await user.click(screen.getByRole("button", { name: "Easy read" }));

    expect(document.cookie).not.toContain(STORAGE_KEY);
    expect(document.cookie).toBe("");
  });
});
