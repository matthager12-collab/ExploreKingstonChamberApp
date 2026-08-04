// @vitest-environment jsdom

// E20 — the offline-enqueue proxy (charter step 11 / AC 17's mechanical
// half): when the FIRST fetch throws (transport failure), the component
// queues the IDENTICAL request through the E13 outbox with THE SAME
// idempotency key it just used — never a fresh key, never a body-field key.
// Replay delivery semantics are the route suite's job; this pins the
// client-side handoff.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VolunteerSignup } from "@/components/volunteer-signup";

const enqueueRequest = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/outbox", () => ({ enqueueRequest }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  enqueueRequest.mockClear();
});

function openForm() {
  render(<VolunteerSignup shiftId="shift-x" fallbackHref="mailto:org@example.test" />);
  fireEvent.click(screen.getByRole("button", { name: "I can help" }));
  fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Nancy" } });
  fireEvent.change(screen.getByLabelText(/email or phone/i), {
    target: { value: "nancy@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign me up/i }));
}

describe("VolunteerSignup offline handoff", () => {
  it("on network error, enqueues the identical payload with the SAME header key", async () => {
    let attemptedKey: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        attemptedKey = (init?.headers as Record<string, string>)["X-Idempotency-Key"];
        throw new TypeError("network down");
      }),
    );

    openForm();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/back online/i),
    );
    expect(enqueueRequest).toHaveBeenCalledTimes(1);
    const [url, payload, key] = enqueueRequest.mock.calls[0] as unknown as [
      string,
      { shiftId: string; name: string; contact: string },
      string,
    ];
    expect(url).toBe("/api/volunteer/signup");
    expect(payload).toEqual({ shiftId: "shift-x", name: "Nancy", contact: "nancy@example.test" });
    expect(attemptedKey).toBeTruthy();
    expect(key).toBe(attemptedKey); // the whole point
  });

  it("an HTTP response — even 409 — never queues (E13 contract)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, reason: "full", spotsLeft: 0 }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    openForm();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/filled up/i),
    );
    expect(enqueueRequest).not.toHaveBeenCalled();
    // The honest fallback: the pre-E20 mailto path.
    expect(screen.getByRole("link", { name: /email the organizer/i })).toHaveProperty(
      "href",
      expect.stringContaining("mailto:"),
    );
  });

  it("a success shows the email-specific confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, signupId: "s-1", spotsLeft: 3 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    openForm();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/in your email/i),
    );
    expect(enqueueRequest).not.toHaveBeenCalled();
  });
});
