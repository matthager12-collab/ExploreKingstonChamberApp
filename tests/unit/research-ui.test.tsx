// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Assistant } from "@/app/(portal)/portal/assistant/assistant";
vi.mock("@/app/(portal)/portal/assistant/map-preview", () => ({
  DraftMapPreview: () => null,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const choices = {
  views: [{ id: "trails", name: "Trails" }],
  categories: [{ key: "kayak", label: "Kayak" }],
};
describe("portal research interface", () => {
  it("accepts a plain request and link and shows saved status", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        async (_url, options) =>
          new Response(
            JSON.stringify(
              options?.method === "POST"
                ? { request: { id: "saved" } }
                : { requests: [], workerConfigured: true },
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<Assistant {...choices} />);
    await screen.findByText(
      "No requests yet. Start with a link or an idea above.",
    );
    fireEvent.change(screen.getByLabelText("Your request"), {
      target: { value: "Find kayak launches" },
    });
    fireEvent.change(screen.getByLabelText("Links (optional, one per line)"), {
      target: { value: "https://example.org/launch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Research & draft" }));
    await screen.findByText(
      "Request saved. You can leave this page while research runs.",
    );
    const post = fetcher.mock.calls.find(
      ([, options]) => options?.method === "POST",
    );
    expect(JSON.parse(post![1].body)).toMatchObject({
      prompt: "Find kayak launches",
      links: ["https://example.org/launch"],
    });
  });
  it("shows uncertainty and disables publishing until resolved", async () => {
    const job = {
      id: "one",
      state: "review",
      revision: 3,
      createdAt: new Date().toISOString(),
      payload: {
        prompt: "Find a launch",
        links: [],
        summary: "Check entrance",
        feedback: [],
        drafts: [
          {
            id: "draft",
            kind: "map",
            title: "Launch",
            body: "Description",
            sources: [{ url: "https://example.org", title: "Source" }],
            questions: ["Confirm entrance"],
            targetId: "",
            data: { kind: "marker", views: ["trails"] },
            before: null,
            state: "draft",
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ requests: [job], workerConfigured: true }),
          ),
        ),
    );
    render(<Assistant {...choices} />);
    await screen.findByText("Confirm entrance");
    expect(
      (
        screen.getByRole("button", {
          name: "Approve & publish",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Unresolved questions")).toBeTruthy(),
    );
  });
});
