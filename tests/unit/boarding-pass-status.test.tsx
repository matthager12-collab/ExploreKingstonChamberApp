// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BoardingPassStatusCard } from "@/components/boarding-pass-status";
import type { BoardingPassStatus } from "@/lib/wsf";
import { ferryLineNavUrl } from "@/lib/ferry-line";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = "2026-10-14T03:00:00.000Z";
function show(pass: BoardingPassStatus | null, checkedAt = at, currentAt = at) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(currentAt));
  return render(<BoardingPassStatusCard initial={pass} checkedAt={checkedAt} side="kingston" />);
}
function response(pass: BoardingPassStatus, headers?: Record<string, string>, waitEstimate?: string) {
  return new Response(JSON.stringify({ boardingPass: pass, generatedAt: at, terminals: { kingston: { waitEstimate } } }), { headers });
}
const off: BoardingPassStatus = { active: false, source: "override", reason: "Staff set OFF" };

describe("boarding-pass status clarity", () => {
  it.each([
    [true, "override", "Required now"], [false, "override", "Not required now"],
    [true, "estimate", "Likely required now"], [false, "estimate", "Usually not required now"],
  ] as const)("labels %s/%s honestly", (active, source, headline) => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    show({ active, source, reason: "Existing verdict" });
    expect(screen.getByRole("heading", { name: headline })).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/Kingston departures/)).toBeInTheDocument();
    expect(screen.getByText(/Tue, Oct 13, 8:00 PM Pacific/)).toBeInTheDocument();
    expect(screen.getByText(source === "override" ? /Set by Chamber staff/ : /not a live confirmation/)).toBeInTheDocument();
  });

  it("shows an actionable unknown status on failure and recovers without losing focus", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(response(off));
    vi.stubGlobal("fetch", fetch);
    show(off);
    await screen.findByRole("heading", { name: "Current status unavailable" });
    expect(screen.getByRole("link", { name: "See the ferry-line map" })).toHaveAttribute("href", "/ferry#ferry-line-map");
    const button = screen.getByRole("button", { name: "Refresh status" });
    button.focus(); fireEvent.click(button);
    await screen.findByRole("heading", { name: "Not required now" });
    expect(button).toHaveFocus();
    expect(fetch).toHaveBeenCalledWith("/api/ferry/status", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("updates directions with the same live verdict, including the existing long-line approach", async () => {
    const on = { ...off, active: true };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(on, undefined, "Three hour wait for drivers")));
    show(off);
    expect(screen.getByRole("link", { name: "Navigate to the ferry" }).getAttribute("href")).toContain("Kingston%20Ferry%20Terminal");
    await screen.findByRole("heading", { name: "Required now" });
    expect(screen.getByRole("link", { name: "Get in the vehicle ferry line" })).toHaveAttribute("href", ferryLineNavUrl(true));
    expect(screen.queryByRole("link", { name: "Navigate to the ferry" })).not.toBeInTheDocument();
  });

  it("does not present a saved service-worker response as current", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(off, { "X-SW-Fetched-At": at })));
    show(off);
    await screen.findByRole("heading", { name: "Current status unavailable" });
  });

  it("keeps the refresh control focusable and prevents duplicate requests while checking", async () => {
    let settle!: (res: Response) => void;
    const pending = new Promise<Response>((resolve) => { settle = resolve; });
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockReturnValue(pending);
    vi.stubGlobal("fetch", fetch); show(off);
    await screen.findByRole("heading", { name: "Current status unavailable" });
    const button = screen.getByRole("button", { name: "Refresh status" });
    button.focus(); fireEvent.click(button);
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(2);
    settle(response(off));
    await screen.findByRole("heading", { name: "Not required now" });
    expect(button).toHaveFocus();
  });

  it("does not trust a response missing its verdict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ generatedAt: at }))));
    show(off);
    await screen.findByRole("heading", { name: "Current status unavailable" });
  });

  it("does not carry yesterday's staff override past Pacific midnight", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    show(off, "2026-10-14T06:59:59.000Z", "2026-10-14T07:00:01.000Z");
    await screen.findByRole("heading", { name: "Current status unavailable" });
    expect(screen.queryByRole("heading", { name: "Not required now" })).not.toBeInTheDocument();
  });

  it("marks a three-minute-old snapshot uncertain while a refresh is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    show(off, "2026-10-14T02:57:00.000Z");
    await screen.findByRole("heading", { name: "Current status unavailable" });
  });

  it("scopes the pass to Kingston rather than Edmonds departures", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<BoardingPassStatusCard initial={{ ...off, active: true }} checkedAt={at} side="edmonds" />);
    expect(screen.getByRole("heading", { name: "Not needed at Edmonds" })).toBeInTheDocument();
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });
});
