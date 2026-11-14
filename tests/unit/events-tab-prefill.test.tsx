// @vitest-environment jsdom

// "Edit before publishing": a suggested event opens in the EXISTING event
// editor, pre-filled; saving there posts to the normal events route and then
// retires the draft; Cancel leaves the draft alone.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import type { Restaurant } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { EventsTab } from "@/app/(portal)/portal/business/[id]/events-tab";
import type { PanelDraft } from "@/app/(portal)/portal/business/[id]/event-page-panel";

const REF = "draft-abc123/1700000000000-xyz789.png";
const restaurant = { id: "r1", name: "The Invented Pier Tavern" } as Restaurant;
const draft = (over: Partial<PanelDraft> = {}): PanelDraft => ({
  id: "d1",
  title: "Fiddle night",
  start: "2099-01-05T19:00",
  end: "2099-01-05T21:30",
  venue: null,
  description: "Live fiddle all night.",
  category: "music",
  rrule: null,
  ticketUrl: "https://tickets.example.com/fiddle",
  artworkRef: REF,
  timeMissing: false,
  ...over,
});

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];

function stubFetch(opts: { retireOk?: boolean } = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, method: init?.method ?? "GET", body });
      if (url.startsWith("/api/portal/events") && init?.method === "POST") {
        return Response.json({ ok: true, pending: true, event: { id: "fiddle-night-1", ...body } });
      }
      if (url.startsWith("/api/portal/event-page")) {
        return opts.retireOk === false
          ? Response.json({ error: "nope" }, { status: 500 })
          : Response.json({ ok: true });
      }
      return Response.json({ events: [] }); // deconfliction lookup
    }),
  );
}

function renderTab(drafts: PanelDraft[]) {
  return render(
    <EventsTab
      ownerId="r1"
      organizer={restaurant.name}
      initialPage={{ url: "https://venue.example.com/events", lastCheckedAt: null, lastError: null }}
      initialDrafts={drafts}
      events={[]}
      restaurant={restaurant}
    />,
  );
}

const eventPosts = () => calls.filter((c) => c.url === "/api/portal/events" && c.method === "POST");
const retirePosts = () => calls.filter((c) => c.url === "/api/portal/event-page" && c.body?.action === "published");

beforeEach(() => stubFetch());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Edit a suggested event", () => {
  it("opens the event editor pre-filled, saves through the events route, then retires the draft", async () => {
    const user = userEvent.setup();
    renderTab([draft()]);
    await user.click(screen.getByRole("button", { name: "Edit Fiddle night before publishing" }));

    expect(screen.getByText("New event")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Fiddle night");
    expect(screen.getByLabelText("Starts")).toHaveValue("2099-01-05T19:00");
    expect(screen.getByLabelText("Ends")).toHaveValue("2099-01-05T21:30");
    expect(screen.getByLabelText("Venue")).toHaveValue("The Invented Pier Tavern"); // draft had none
    expect(screen.getByLabelText("Description")).toHaveValue("Live fiddle all night.");
    expect(screen.getByLabelText("Category")).toHaveValue("music");
    expect(screen.getByDisplayValue("https://tickets.example.com/fiddle")).toBeInTheDocument(); // the editor's Link field
    expect(screen.getByLabelText("Title")).toHaveFocus();

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Fiddle night (edited)");
    await user.click(screen.getByRole("button", { name: "Add event" }));

    await waitFor(() => expect(retirePosts()).toHaveLength(1));
    expect(eventPosts()).toHaveLength(1);
    expect(eventPosts()[0].body).toMatchObject({
      ownerId: "r1",
      title: "Fiddle night (edited)",
      start: "2099-01-05T19:00",
      end: "2099-01-05T21:30",
      venue: "The Invented Pier Tavern",
      description: "Live fiddle all night.",
      category: "music",
      url: "https://tickets.example.com/fiddle",
      attachments: [REF],
    });
    expect(eventPosts()[0].body).not.toHaveProperty("id"); // a NEW event, not an edit
    expect(retirePosts()[0].body).toMatchObject({ ownerId: "r1", draftId: "d1" });
    // retired AFTER the event saved
    expect(calls.indexOf(eventPosts()[0])).toBeLessThan(calls.indexOf(retirePosts()[0]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Dismiss Fiddle night" })).not.toBeInTheDocument());
  });

  it("while the editor is open, Publish, Dismiss and Edit are off; Cancel turns them back on", async () => {
    const user = userEvent.setup();
    renderTab([draft()]);
    await user.click(screen.getByRole("button", { name: "Edit Fiddle night before publishing" }));
    for (const name of ["Publish Fiddle night", "Dismiss Fiddle night", "Edit Fiddle night before publishing"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    for (const name of ["Publish Fiddle night", "Dismiss Fiddle night", "Edit Fiddle night before publishing"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  it("Cancel leaves the draft and sends nothing", async () => {
    const user = userEvent.setup();
    renderTab([draft()]);
    await user.click(screen.getByRole("button", { name: "Edit Fiddle night before publishing" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("New event")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss Fiddle night" })).toBeInTheDocument();
    expect(eventPosts()).toHaveLength(0);
    expect(retirePosts()).toHaveLength(0);
    // …and it can be opened again
    await user.click(screen.getByRole("button", { name: "Edit Fiddle night before publishing" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Fiddle night");
  });

  it("an untimed draft opens with the start empty, a note, and the form's own validation blocks saving", async () => {
    const user = userEvent.setup();
    renderTab([draft({ timeMissing: true, start: "2099-01-05T00:00", end: null })]);
    await user.click(screen.getByRole("button", { name: "Edit Fiddle night before publishing" }));
    expect(screen.getByLabelText("Starts")).toHaveValue("");
    expect(screen.getByText(/no start time/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add event" }));
    expect(eventPosts()).toHaveLength(0);
    expect(screen.getByLabelText("Starts")).toBeInvalid();
  });

  it("a repeating draft carries its rule into the save", async () => {
    const user = userEvent.setup();
    renderTab([draft({ rrule: "FREQ=WEEKLY;BYDAY=TH", start: "2099-01-01T19:00", end: null })]);
    await user.click(screen.getByRole("button", { name: "Edit Fiddle night before publishing" }));
    await user.click(screen.getByRole("button", { name: "Add event" }));
    await waitFor(() => expect(eventPosts()).toHaveLength(1));
    expect(eventPosts()[0].body).toMatchObject({ rrule: "FREQ=WEEKLY;BYDAY=TH" });
  });

  it("'Include artwork' off: the editor save carries no attachment", async () => {
    const user = userEvent.setup();
    renderTab([draft()]);
    const row = screen.getByRole("button", { name: "Dismiss Fiddle night" }).closest("li") as HTMLElement;
    expect(within(row).getByRole("img", { name: "Fiddle night" })).toBeInTheDocument();
    const box = within(row).getByRole("checkbox", { name: /Include artwork/ });
    expect(box).toBeChecked(); // default on
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Edit Fiddle night before publishing" }));
    await user.click(screen.getByRole("button", { name: "Add event" }));
    await waitFor(() => expect(eventPosts()).toHaveLength(1));
    expect(eventPosts()[0].body?.attachments).toBeUndefined();
  });

  it("a normal event saved with the editor never retires a suggestion", async () => {
    const user = userEvent.setup();
    renderTab([draft()]);
    await user.click(screen.getByRole("button", { name: "Edit Fiddle night before publishing" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "+ Add an event" }));
    await user.type(screen.getByLabelText("Title"), "Other");
    await user.type(screen.getByLabelText("Starts"), "2099-02-02T10:00");
    await user.click(screen.getByRole("button", { name: "Add event" }));
    await waitFor(() => expect(eventPosts()).toHaveLength(1));
    expect(retirePosts()).toHaveLength(0);
  });

  it("if retiring fails the event is still saved, the draft stays, and the member is told", async () => {
    stubFetch({ retireOk: false });
    const user = userEvent.setup();
    renderTab([draft()]);
    await user.click(screen.getByRole("button", { name: "Edit Fiddle night before publishing" }));
    await user.click(screen.getByRole("button", { name: "Add event" }));
    expect(await screen.findByText(/its suggestion is still listed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss Fiddle night" })).toBeInTheDocument();
  });
});
