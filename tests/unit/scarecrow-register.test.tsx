// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LatePage from "@/app/(site)/scarecrow/register/page";

vi.mock("@/lib/page-visibility", () => ({ assertPageVisible: vi.fn().mockResolvedValue(false), HiddenPageBanner: () => null }));

import { ScarecrowRegister } from "@/components/scarecrow-register";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("ScarecrowRegister late mode", () => {
  it("posts to the explicit late endpoint and shows pending approval", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetcher);
    const { container } = render(<ScarecrowRegister late />);
    for (const [name, value] of Object.entries({title: "Late Fixture", creator: "Fixture Maker", notes: "Fixture window", submitterName: "Test Person", contact: "fixture@example.test"})) {
      fireEvent.change(container.querySelector(`[name="${name}"]`)!, { target: { value } });
    }
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[0][0]).toBe("/api/scarecrow/register/late");
    await waitFor(() => expect(screen.getByText(/Chamber.*check|once approved/i)).toBeTruthy());
  });

  it("renders hostile errors as plain text", async () => {
    const canary = '<script>canary</script><img src=x onerror="canary()">javascript:canary';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: canary }) }));
    const { container } = render(<ScarecrowRegister late />);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByText(canary)).toBeTruthy());
    expect(container.querySelector("script,img")).toBeNull();
  });
});


describe("late registration page", () => {
  it("renders the reused form during the real crawl and no form at closing time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T12:00:00-07:00"));
    const first = render(await LatePage());
    expect(first.container.querySelector("form")).toBeTruthy();
    expect(screen.getByText(/Submitting does not guarantee approval/)).toBeTruthy();
    cleanup();
    vi.setSystemTime(new Date("2026-10-31T17:00:00-07:00"));
    const closed = render(await LatePage());
    expect(closed.container.querySelector("form")).toBeNull();
    expect(screen.getByText(/Late registration is closed/)).toBeTruthy();
  });
});
