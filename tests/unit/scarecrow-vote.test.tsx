// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { ScarecrowVote } from "@/components/scarecrow-vote";

const votedKey = "scarecrow-crawl-2026-voted";
const scarecrows = [
  { id: "crow-1", title: "The Gardener", creator: "Maple School", notes: "Look by the gate" },
  { id: "crow-2", title: "The Astronaut" },
];
const mockedFetch = vi.fn<typeof fetch>();

function mount(phase: "before" | "open" | "closed" = "open") {
  return render(<ScarecrowVote phase={phase} scarecrows={scarecrows} />);
}

function response(status = 200, body: unknown = {}) {
  return Response.json(body, { status });
}

beforeEach(() => {
  localStorage.clear();
  mockedFetch.mockReset();
  vi.stubGlobal("fetch", mockedFetch);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ScarecrowVote", () => {
  it("shows the before and closed notices without a voting form", () => {
    const { rerender } = mount("before");
    expect(screen.getByText(/Voting opens on Saturday/)).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Cast my vote" })).not.toBeInTheDocument();

    rerender(<ScarecrowVote phase="closed" scarecrows={scarecrows} />);
    expect(screen.getByText(/Voting closed at 5pm/)).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Cast my vote" })).not.toBeInTheDocument();
  });

  it("requires a choice and provides labelled, touch-sized controls", () => {
    mount();
    const submit = screen.getByRole("button", { name: "Cast my vote" });
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText(/The Gardener/)).toBeInTheDocument();
    expect(screen.getByLabelText(/The Astronaut/)).toBeInTheDocument();
    expect(screen.getByLabelText("Add a photo (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText(/The Chamber may use my photo/)).toBeChecked();
    expect(submit.className).toContain("min-h-[44px]");
    expect(screen.getByLabelText(/The Gardener/).closest("label")?.className).toContain("min-h-[44px]");
    expect(screen.getByLabelText(/The Chamber may use my photo/).closest("label")?.className).toContain("min-h-[44px]");
  });

  it("posts explicit multipart choices and remembers a successful vote on this device", async () => {
    const user = userEvent.setup();
    mockedFetch.mockResolvedValue(response());
    mount();

    await user.click(screen.getByLabelText(/The Gardener/));
    await user.click(screen.getByLabelText(/The Chamber may use my photo/));
    await user.click(screen.getByRole("button", { name: "Cast my vote" }));

    await screen.findByText(/Thanks — your vote is in/);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe("/api/scarecrow/vote");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("scarecrowId")).toBe("crow-1");
    expect((init?.body as FormData).get("socialOk")).toBe("false");
    expect(localStorage.getItem(votedKey)).toBe("crow-1");

    cleanup();
    mount();
    expect(screen.getByText(/already voted from this device/)).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("shows a pending state and prevents duplicate submissions", async () => {
    const user = userEvent.setup();
    let resolve!: (value: Response) => void;
    mockedFetch.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container } = mount();
    await user.click(screen.getByLabelText(/The Astronaut/));
    const submit = screen.getByRole("button", { name: "Cast my vote" });
    await user.click(submit);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    resolve(response());
    await screen.findByText(/Thanks — your vote is in/);
  });

  it.each([
    [429, { error: "Please wait before voting again." }, "Please wait before voting again."],
    [500, {}, "Your vote did not go through. Try again in a moment."],
  ])("shows server rejection and permits retry (HTTP %i)", async (status, body, message) => {
    const user = userEvent.setup();
    mockedFetch.mockResolvedValueOnce(response(status, body)).mockResolvedValueOnce(response());
    mount();
    await user.click(screen.getByLabelText(/The Astronaut/));
    await user.click(screen.getByRole("button", { name: "Cast my vote" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(localStorage.getItem(votedKey)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Cast my vote" }));
    expect(await screen.findByText(/Thanks — your vote is in/)).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("surfaces network and non-JSON error responses without recording a vote", async () => {
    const user = userEvent.setup();
    mockedFetch.mockRejectedValueOnce(new TypeError("offline"));
    mount();
    await user.click(screen.getByLabelText(/The Gardener/));
    await user.click(screen.getByRole("button", { name: "Cast my vote" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No connection. Your vote did not send.");

    mockedFetch.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    }));
    await user.click(screen.getByRole("button", { name: "Cast my vote" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your vote did not go through. Try again in a moment.");
    expect(localStorage.getItem(votedKey)).toBeNull();
  });

  it("still accepts a vote when localStorage writes are blocked", async () => {
    const user = userEvent.setup();
    mockedFetch.mockResolvedValue(response());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked"); });
    mount();
    await user.click(screen.getByLabelText(/The Astronaut/));
    await user.click(screen.getByRole("button", { name: "Cast my vote" }));
    await waitFor(() => expect(screen.getByText(/Thanks — your vote is in/)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("still renders and accepts a vote when localStorage reads are blocked", async () => {
    const user = userEvent.setup();
    mockedFetch.mockResolvedValue(response());
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked"); });
    mount();
    await user.click(screen.getByLabelText(/The Astronaut/));
    await user.click(screen.getByRole("button", { name: "Cast my vote" }));
    await screen.findByText(/Thanks — your vote is in/);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
