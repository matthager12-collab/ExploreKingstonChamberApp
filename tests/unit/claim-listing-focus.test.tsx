// @vitest-environment jsdom

// Focus management in the E17 claim disclosure (<ClaimListing/>).
//
// The bug these tests pin: the focus effect depended on [open, phase], and
// `phase` cycles idle → busy → idle on every submit. So the effect re-fired
// MID-REQUEST and again when an error rendered, ripping the caret off the
// submit button the user had just pressed and dropping it back in the name
// field — exactly when a screen-reader user needed to hear the error. The
// effect must fire on the OPEN transition only.
//
// The deliberate intent the file documents is kept, and asserted here too:
// expanding the disclosure DOES move focus into the form, and success DOES
// move focus to the confirmation. Errors are announced (role="alert"), never
// grabbed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { ClaimListing } from "@/components/claim-listing";

// No CopyProvider on purpose: useCopy falls back to the registry, so these
// are the same strings a visitor sees with no admin override in place.
const DISCLOSURE = "Own this business? Claim this listing";
const NAME = "Your name";
const CONTACT = "Phone number (or email)";
const SUBMIT = "Send claim request";
const SENDING = "Sending…";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A fetch we hold open, so "mid-request" is an assertable moment. */
function deferredFetch() {
  let settle!: (res: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    settle = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => pending),
  );
  return settle;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Open the disclosure and fill the two required fields. */
async function openAndFill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: DISCLOSURE }));
  await user.type(screen.getByLabelText(NAME), "Pat Owner");
  await user.type(screen.getByLabelText(CONTACT), "360-555-0100");
}

describe("<ClaimListing/> focus management", () => {
  it("expanding the disclosure moves focus into the form (the intended behavior, kept)", async () => {
    const user = userEvent.setup();
    render(<ClaimListing store="restaurants" id="the-cafe" subject="The Cafe" />);

    // With a subject, the disclosure's accessible name is disambiguated —
    // many cards render this component on one page.
    await user.click(screen.getByRole("button", { name: `${DISCLOSURE} — The Cafe` }));
    await waitFor(() => expect(screen.getByLabelText(NAME)).toHaveFocus());
  });

  it("does NOT re-grab focus mid-request when the phase flips to busy", async () => {
    const user = userEvent.setup();
    const settle = deferredFetch();
    render(<ClaimListing store="restaurants" id="the-cafe" />);
    await openAndFill(user);

    const submit = screen.getByRole("button", { name: SUBMIT });
    await user.click(submit); // a real click focuses the button it hits

    // In flight: the button says so, and focus has not been yanked backwards.
    await waitFor(() => expect(screen.getByRole("button", { name: SENDING })).toBeInTheDocument());
    expect(screen.getByLabelText(NAME)).not.toHaveFocus();
    expect(document.activeElement).not.toBe(screen.getByLabelText(CONTACT));

    settle(jsonResponse(200, { ok: true, pending: true }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });

  it("does NOT steal focus when an error renders — it announces instead", async () => {
    const user = userEvent.setup();
    const settle = deferredFetch();
    render(<ClaimListing store="restaurants" id="the-cafe" />);
    await openAndFill(user);

    const submit = screen.getByRole("button", { name: SUBMIT });
    await user.click(submit);
    settle(jsonResponse(429, { error: "too many requests, please try again later" }));

    // The error is announced through the live region…
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("too many requests, please try again later");

    // …and the caret stayed on the control the user pressed. Before the fix,
    // phase busy → idle re-fired the effect and focus landed in the name
    // field, silently scrolling the just-announced error out from under a
    // screen-reader user's cursor.
    expect(screen.getByLabelText(NAME)).not.toHaveFocus();
    expect(screen.getByRole("button", { name: SUBMIT })).toHaveFocus();
  });

  it("success moves focus to the confirmation (the other intended behavior, kept)", async () => {
    const user = userEvent.setup();
    const settle = deferredFetch();
    render(<ClaimListing store="restaurants" id="the-cafe" />);
    await openAndFill(user);

    await user.click(screen.getByRole("button", { name: SUBMIT }));
    settle(jsonResponse(200, { ok: true, pending: true }));

    const done = await screen.findByRole("status");
    await waitFor(() => expect(done).toHaveFocus());
  });

  it("re-opening after a cancel focuses the first field again (open transition, every time)", async () => {
    const user = userEvent.setup();
    render(<ClaimListing store="restaurants" id="the-cafe" />);

    await user.click(screen.getByRole("button", { name: DISCLOSURE }));
    await waitFor(() => expect(screen.getByLabelText(NAME)).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(NAME)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: DISCLOSURE }));
    await waitFor(() => expect(screen.getByLabelText(NAME)).toHaveFocus());
  });
});
