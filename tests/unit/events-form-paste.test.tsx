// @vitest-environment jsdom

// The paste panel in the business events form. These are the behaviours the
// browser run and the outside review found missing: a late reply must not
// overwrite a draft the member started, a failure must leave a way to carry on
// without losing the pasted words, a shaky reading must be announced, an old
// error must not outlive the text it was about, and focus must follow the member.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { EventsForm } from "@/app/(portal)/portal/business/[id]/events-form";
import type { Restaurant } from "@/lib/types";

const LISTING = { id: "test-cafe", name: "Test Cafe" } as unknown as Restaurant;

const CRAB = {
  title: "Kingston Crab Feed",
  start: "2026-10-17T17:00",
  end: "2026-10-17T20:00",
  venue: "Kingston Community Center",
  description: "Annual crab feed.",
  category: "community",
  url: "https://example.org/crab-feed",
  unsure: false,
  notes: "",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let extract: () => Promise<Response>;

beforeEach(() => {
  extract = async () => reply(200, { draft: CRAB });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/portal/events/extract")
        ? extract()
        : reply(200, { events: [] }), // the same-day lookup the form makes for any date
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openPanel() {
  const user = userEvent.setup();
  render(<EventsForm initial={LISTING} initialEvents={[]} />);
  await user.click(screen.getByRole("button", { name: "Paste from Facebook or Instagram" }));
  return user;
}

describe("paste panel", () => {
  it("puts focus in the box when it opens, and on the title when a post fills the form", async () => {
    const user = await openPanel();
    expect(screen.getByLabelText("The post")).toHaveFocus();
    await user.type(screen.getByLabelText("The post"), "Crab feed Saturday");
    await user.click(screen.getByRole("button", { name: "Read it" }));
    expect(await screen.findByLabelText("Title")).toHaveFocus();
    expect(screen.getByLabelText("Title")).toHaveValue("Kingston Crab Feed");
  });

  it("says Reading while it works, never Saving", async () => {
    let release!: (r: Response) => void;
    extract = () => new Promise<Response>((r) => (release = r));
    const user = await openPanel();
    await user.type(screen.getByLabelText("The post"), "Crab feed Saturday");
    await user.click(screen.getByRole("button", { name: "Read it" }));
    expect(screen.getByRole("button", { name: "Reading…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument();
    release(reply(200, { draft: CRAB }));
  });

  // Cancel used to leave the request running. If the reply landed after the
  // member had started a draft of their own, it filled the form over their work.
  it("ignores a reply that arrives after Cancel, so it cannot overwrite a draft the member started", async () => {
    let release!: (r: Response) => void;
    extract = () => new Promise<Response>((r) => (release = r));
    const user = await openPanel();
    await user.type(screen.getByLabelText("The post"), "Crab feed Saturday");
    await user.click(screen.getByRole("button", { name: "Read it" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "+ Add an event" }));
    await user.type(screen.getByLabelText("Title"), "My own event");
    release(reply(200, { draft: CRAB }));
    await new Promise((r) => setTimeout(r, 30)); // let the late reply land
    expect(screen.getByLabelText("Title")).toHaveValue("My own event");
  });

  // Three failure messages say to fill the form in by hand. The panel now has a
  // button that does it, and it keeps the pasted words so nothing is lost.
  it("offers Fill it in by hand, which keeps the pasted words in the description", async () => {
    const user = await openPanel();
    await user.type(screen.getByLabelText("The post"), "Some post text");
    await user.click(screen.getByRole("button", { name: "Fill it in by hand" }));
    expect(screen.queryByLabelText("The post")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("Some post text");
  });

  it("keeps at most 2,000 characters of the pasted words, the size the save route stores", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("The post"), { target: { value: "x".repeat(2500) } });
    fireEvent.click(screen.getByRole("button", { name: "Fill it in by hand" }));
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toHaveLength(2000);
  });

  it("announces a shaky reading as an alert", async () => {
    extract = async () =>
      reply(200, { draft: { ...CRAB, title: "Live music", start: "", end: "", unsure: true, notes: "No date in the post; check the day." } });
    const user = await openPanel();
    await user.type(screen.getByLabelText("The post"), "Live music this Saturday");
    await user.click(screen.getByRole("button", { name: "Read it" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Check this one before you save");
    expect(alert).toHaveTextContent("No date in the post; check the day.");
  });

  it("clears an old error as soon as the member edits the text", async () => {
    extract = async () => reply(422, { error: "That doesn't look like an event post — fill the form in by hand." });
    const user = await openPanel();
    await user.type(screen.getByLabelText("The post"), "thanks");
    await user.click(screen.getByRole("button", { name: "Read it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't look like an event post");
    await user.type(screen.getByLabelText("The post"), " more");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
