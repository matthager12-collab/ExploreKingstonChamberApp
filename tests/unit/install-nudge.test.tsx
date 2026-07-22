// @vitest-environment jsdom

// The install nudge's dismissal contract (E13's <InstallNudge/>).
//
// The bug these tests pin: PwaClient is mounted from the ROOT layout, so its
// mount effect — the only place the stored dismissal was ever read — runs once
// per hard page load and never again. Chromium re-fires beforeinstallprompt as
// a visitor moves around the SPA, and the handler used to call setMode("prompt")
// unconditionally, so "Not now" was undone by the very next link click.
//
// The component keeps two page-load-scoped module flags (visitCounted,
// dismissedThisLoad). A test FILE is one module instance, so each case re-imports
// the module through vi.resetModules() rather than the component exporting a
// reset hook it would then have to ship to every visitor.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/outbox", () => ({ flushOutbox: () => Promise.resolve() }));

const VISITS_KEY = "vk-visits";
const DISMISSED_KEY = "vk-install-nudge";

type PwaClient = (props: { renderedAt: string }) => React.ReactNode;

/** Fresh module instance, so the page-load flags start clean in every case. */
async function freshPwaClient(): Promise<PwaClient> {
  vi.resetModules();
  return ((await import("@/components/pwa")) as { default: PwaClient }).default;
}

/** The Chromium event, in the minimum shape the component consumes. */
function fireInstallPrompt(): Event {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, { prompt: () => Promise.resolve() });
  window.dispatchEvent(event);
  return event;
}

const card = () => screen.queryByText("Add Explore Kingston to your home screen");
const notNow = () => screen.getByRole("button", { name: "Not now" });
/** Lets the dispatched event's setState flush without asserting on a timer. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  // Past the MIN_VISITS floor, so the nudge is eligible in every case below.
  localStorage.setItem(VISITS_KEY, "2");
  pathname = "/";
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("InstallNudge — dismissal holds", () => {
  it("shows the card when Chromium offers the prompt", async () => {
    const PwaClient = await freshPwaClient();
    render(<PwaClient renderedAt={new Date().toISOString()} />);

    fireInstallPrompt();

    await waitFor(() => expect(card()).toBeInTheDocument());
  });

  it("stays gone when beforeinstallprompt re-fires after Not now (the SPA bug)", async () => {
    const user = userEvent.setup();
    const PwaClient = await freshPwaClient();
    render(<PwaClient renderedAt={new Date().toISOString()} />);

    fireInstallPrompt();
    await waitFor(() => expect(card()).toBeInTheDocument());
    await user.click(notNow());
    expect(card()).not.toBeInTheDocument();

    // Chromium re-evaluates installability on same-document navigation and
    // fires again. This is what put the card straight back on screen.
    fireInstallPrompt();
    await settle();

    expect(card()).not.toBeInTheDocument();
  });

  it("keeps suppressing Chromium's own mini-infobar after dismissal", async () => {
    // preventDefault() must still be called on the re-fired event, or the
    // visitor trades our quiet card for Chrome's built-in install bar.
    const user = userEvent.setup();
    const PwaClient = await freshPwaClient();
    render(<PwaClient renderedAt={new Date().toISOString()} />);

    fireInstallPrompt();
    await waitFor(() => expect(card()).toBeInTheDocument());
    await user.click(notNow());

    const refired = fireInstallPrompt();
    await settle();

    expect(refired.defaultPrevented).toBe(true);
  });

  it("stays gone across a remount in the same document", async () => {
    const user = userEvent.setup();
    const PwaClient = await freshPwaClient();
    const first = render(<PwaClient renderedAt={new Date().toISOString()} />);

    fireInstallPrompt();
    await waitFor(() => expect(card()).toBeInTheDocument());
    await user.click(notNow());
    first.unmount();

    render(<PwaClient renderedAt={new Date().toISOString()} />);
    fireInstallPrompt();
    await settle();

    expect(card()).not.toBeInTheDocument();
  });

  it("persists the dismissal so the next page load never asks", async () => {
    const user = userEvent.setup();
    const PwaClient = await freshPwaClient();
    render(<PwaClient renderedAt={new Date().toISOString()} />);

    fireInstallPrompt();
    await waitFor(() => expect(card()).toBeInTheDocument());
    await user.click(notNow());

    expect(localStorage.getItem(DISMISSED_KEY)).toBe("dismissed");
  });

  it("never shows once the permanent dismissal is on record", async () => {
    localStorage.setItem(DISMISSED_KEY, "dismissed");
    const PwaClient = await freshPwaClient();
    render(<PwaClient renderedAt={new Date().toISOString()} />);

    fireInstallPrompt();
    await settle();

    expect(card()).not.toBeInTheDocument();
  });

  it("holds for the rest of the load when localStorage cannot be written", async () => {
    // Safari private mode / quota exhaustion. The visit counter fails first, so
    // the nudge is never offered at all — fail-closed, which is the honest
    // outcome when we cannot promise to remember a "no".
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (this === localStorage) throw new DOMException("QuotaExceededError");
      return setItem.call(this, key, value);
    });

    const PwaClient = await freshPwaClient();
    render(<PwaClient renderedAt={new Date().toISOString()} />);
    fireInstallPrompt();
    await settle();

    expect(card()).not.toBeInTheDocument();
  });

  it("is never shown to chamber staff on /admin", async () => {
    pathname = "/admin/events";
    const PwaClient = await freshPwaClient();
    render(<PwaClient renderedAt={new Date().toISOString()} />);

    fireInstallPrompt();
    await settle();

    expect(card()).not.toBeInTheDocument();
  });
});
