// @vitest-environment jsdom

// The site-wide feedback tab.
//
// The load-bearing tests here are the two failure modes that make a feedback
// widget worse than no widget:
//
//  1. Telling the visitor "thanks" when the submission was REJECTED. The outbox
//     reports "sent" for any HTTP response including a 429, so a naive caller
//     shows the thank-you on a rate-limited submission — and because the outbox
//     drops its copy on a non-transport response, nothing ever retries. The
//     visitor's words are gone and they have been told they landed.
//  2. Filing feedback against the WRONG page. The path is what makes the whole
//     feature actionable, so it is captured from the live pathname at submit
//     time and the panel resets across a navigation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { isFeedbackHidden } from "@/components/feedback-tab";

const submitOrQueue = vi.hoisted(() => vi.fn());
const pathname = vi.hoisted(() => ({ current: "/parking" }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));
vi.mock("@/lib/outbox", async () => {
  // isDeliveredStatus is real policy shared with the outbox's own replay loop —
  // mocking it would let this suite pass against a definition the app doesn't
  // use. Only the network call is faked.
  const actual = await vi.importActual<typeof import("@/lib/outbox")>("@/lib/outbox");
  return { ...actual, submitOrQueue };
});

async function load() {
  const mod = await import("@/components/feedback-tab");
  return mod.FeedbackTab;
}

beforeEach(() => {
  submitOrQueue.mockReset();
  submitOrQueue.mockResolvedValue({ status: "sent", httpStatus: 200 });
  pathname.current = "/parking";
});
afterEach(cleanup);

/** Open the panel and pick `stars`. The accessible name is singular at 1 —
 *  "1 star", not "1 stars" — which is exactly what the group promises a screen
 *  reader, so the helper matches it rather than working around it. */
async function openAndRate(user: ReturnType<typeof userEvent.setup>, stars: number) {
  await user.click(screen.getByRole("button", { name: /give feedback/i }));
  await user.click(
    screen.getByRole("radio", { name: `${stars} ${stars === 1 ? "star" : "stars"}` }),
  );
}

describe("feedback tab — visibility", () => {
  it("hides itself on staff and print routes, and nowhere else", () => {
    expect(isFeedbackHidden("/admin")).toBe(true);
    expect(isFeedbackHidden("/admin/feedback")).toBe(true);
    expect(isFeedbackHidden("/portal/syndicate")).toBe(true);
    expect(isFeedbackHidden("/print/itinerary")).toBe(true);
    expect(isFeedbackHidden("/offline")).toBe(true);

    expect(isFeedbackHidden("/")).toBe(false);
    expect(isFeedbackHidden("/eat")).toBe(false);
    expect(isFeedbackHidden("/ferry")).toBe(false);
    // Segment boundary, not startsWith: a future /printmakers listing must not
    // silently lose its feedback tab to the /print rule.
    expect(isFeedbackHidden("/printmakers")).toBe(false);
    expect(isFeedbackHidden("/administration")).toBe(false);
  });

  it("renders nothing at all on a hidden route", async () => {
    const FeedbackTab = await load();
    pathname.current = "/admin";
    render(<FeedbackTab />);
    expect(screen.queryByRole("button", { name: /give feedback/i })).not.toBeInTheDocument();
  });
});

describe("feedback tab — submission", () => {
  it("sends the rating, comment, and the path it was opened from", async () => {
    const user = userEvent.setup();
    const FeedbackTab = await load();
    render(<FeedbackTab />);

    await openAndRate(user, 4);
    await user.type(screen.getByRole("textbox"), "The lot map was out of date");
    await user.click(screen.getByRole("button", { name: /send feedback/i }));

    await waitFor(() => expect(submitOrQueue).toHaveBeenCalledTimes(1));
    expect(submitOrQueue).toHaveBeenCalledWith("/api/feedback", {
      rating: 4,
      comment: "The lot map was out of date",
      // The whole reason the widget is mounted site-wide rather than living on
      // one /feedback route.
      path: "/parking",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/thanks/i);
  });

  it("cannot submit without a rating", async () => {
    const user = userEvent.setup();
    const FeedbackTab = await load();
    render(<FeedbackTab />);

    await user.click(screen.getByRole("button", { name: /give feedback/i }));
    await user.type(screen.getByRole("textbox"), "words but no stars");
    expect(screen.getByRole("button", { name: /send feedback/i })).toBeDisabled();
    expect(submitOrQueue).not.toHaveBeenCalled();
  });

  it("omits an empty comment rather than sending blank text", async () => {
    const user = userEvent.setup();
    const FeedbackTab = await load();
    render(<FeedbackTab />);

    await openAndRate(user, 5);
    await user.type(screen.getByRole("textbox"), "   ");
    await user.click(screen.getByRole("button", { name: /send feedback/i }));

    await waitFor(() => expect(submitOrQueue).toHaveBeenCalled());
    expect(submitOrQueue.mock.calls[0][1]).toEqual({ rating: 5, path: "/parking" });
  });

  it("says SAVED, not sent, when the device is offline", async () => {
    submitOrQueue.mockResolvedValue({ status: "queued" });
    const user = userEvent.setup();
    const FeedbackTab = await load();
    render(<FeedbackTab />);

    await openAndRate(user, 3);
    await user.click(screen.getByRole("button", { name: /send feedback/i }));

    // A success state with honest wording: it is on the device and replays.
    expect(await screen.findByRole("status")).toHaveTextContent(/back online/i);
  });

  it("does NOT thank the visitor when the server rejected the submission", async () => {
    // The bug this whole branch exists to prevent: submitOrQueue reports
    // "sent" for a 429, the outbox has already dropped its copy, so nothing
    // retries — showing the thank-you here loses the visitor's words silently.
    submitOrQueue.mockResolvedValue({ status: "sent", httpStatus: 429 });
    const user = userEvent.setup();
    const FeedbackTab = await load();
    render(<FeedbackTab />);

    await openAndRate(user, 2);
    await user.type(screen.getByRole("textbox"), "worth keeping");
    await user.click(screen.getByRole("button", { name: /send feedback/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/few minutes/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // Their text is still in the box, so retrying is one tap and nothing is
    // retyped.
    expect(screen.getByRole("textbox")).toHaveValue("worth keeping");
    expect(screen.getByRole("button", { name: /send feedback/i })).toBeEnabled();
  });

  it("reports a server error without claiming the feedback landed", async () => {
    submitOrQueue.mockResolvedValue({ status: "sent", httpStatus: 500 });
    const user = userEvent.setup();
    const FeedbackTab = await load();
    render(<FeedbackTab />);

    await openAndRate(user, 1);
    await user.click(screen.getByRole("button", { name: /send feedback/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/try again/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("feedback tab — accessibility", () => {
  it("exposes the rating as one radio group, so the choice is announced and arrow-navigable", async () => {
    const user = userEvent.setup();
    const FeedbackTab = await load();
    render(<FeedbackTab />);
    await user.click(screen.getByRole("button", { name: /give feedback/i }));

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    // Each announces its full meaning — "3 stars", not a bare glyph.
    expect(screen.getByRole("radio", { name: "1 star" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "5 stars" })).toBeInTheDocument();
    // Selection state is real, which a row of <button>s would lose entirely.
    await user.click(screen.getByRole("radio", { name: "3 stars" }));
    expect(screen.getByRole("radio", { name: "3 stars" })).toBeChecked();
  });

  it("returns focus to the tab when the panel is closed with Escape", async () => {
    const user = userEvent.setup();
    const FeedbackTab = await load();
    render(<FeedbackTab />);

    const tab = screen.getByRole("button", { name: /give feedback/i });
    await user.click(tab);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Without this a keyboard user lands on <body> and re-tabs the whole page.
    expect(tab).toHaveFocus();
  });

  it("marks the tab's expanded state for screen readers", async () => {
    const user = userEvent.setup();
    const FeedbackTab = await load();
    render(<FeedbackTab />);

    const tab = screen.getByRole("button", { name: /give feedback/i });
    expect(tab).toHaveAttribute("aria-expanded", "false");
    await user.click(tab);
    expect(tab).toHaveAttribute("aria-expanded", "true");
  });
});
