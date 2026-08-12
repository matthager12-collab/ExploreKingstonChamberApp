// @vitest-environment jsdom

// Focus management in the E17 claim-signup disclosure (<ClaimSignup/>) —
// the successor to claim-listing-focus.test.tsx, guarding the same contract
// on the new two-step form:
//
//   focus moves at exactly three moments — the disclosure EXPANDING (first
//   field), the CODE STEP appearing (code field), and DONE (the status
//   line). Mode toggles re-run the open effect (switching to the fallback
//   form lands on ITS first field). Nothing else may move focus: while a
//   request is in flight and when an error renders, the caret stays where
//   the user put it and the error is announced via role="alert".

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { ClaimSignup } from "@/components/claim-signup";

// No CopyProvider on purpose: useCopy falls back to the registry, so these
// are the same strings a visitor sees with no admin override in place.
const DISCLOSURE = "Own this business? Claim this listing";
const NAME = "Your name";
const EMAIL = "Business email";
const PASSWORD = "Choose a password";
const SUBMIT = "Create account & claim";
const SENDING = "Sending code…";
const CODE = "Verification code";
const VERIFY = "Verify & finish";
const FALLBACK = "No access to the business email? Ask the Chamber to call you instead.";

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

/** Open the disclosure and fill the three signup fields. */
async function openAndFill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: DISCLOSURE }));
  await user.type(screen.getByLabelText(NAME), "Pat Owner");
  await user.type(screen.getByLabelText(EMAIL), "pat@example.com");
  await user.type(screen.getByLabelText(PASSWORD), "s3cure-enough");
}

describe("<ClaimSignup/> focus management", () => {
  it("expanding the disclosure moves focus into the form", async () => {
    const user = userEvent.setup();
    render(<ClaimSignup store="restaurants" id="the-cafe" subject="The Cafe" />);

    // With a subject, the disclosure's accessible name is disambiguated —
    // many cards render this component on one page.
    await user.click(screen.getByRole("button", { name: `${DISCLOSURE} — The Cafe` }));
    await waitFor(() => expect(screen.getByLabelText(NAME)).toHaveFocus());
  });

  it("does NOT re-grab focus mid-request", async () => {
    const user = userEvent.setup();
    const settle = deferredFetch();
    render(<ClaimSignup store="restaurants" id="the-cafe" />);
    await openAndFill(user);

    const submit = screen.getByRole("button", { name: SUBMIT });
    await user.click(submit); // a real click focuses the button it hits

    await waitFor(() => expect(screen.getByRole("button", { name: SENDING })).toBeInTheDocument());
    expect(screen.getByLabelText(NAME)).not.toHaveFocus();

    settle(jsonResponse(200, { ok: true, mode: "code-sent", signupId: "abc", emailSent: true }));
    await waitFor(() => expect(screen.getByLabelText(CODE)).toBeInTheDocument());
  });

  it("does NOT steal focus when an error renders — it announces instead", async () => {
    const user = userEvent.setup();
    const settle = deferredFetch();
    render(<ClaimSignup store="restaurants" id="the-cafe" />);
    await openAndFill(user);

    await user.click(screen.getByRole("button", { name: SUBMIT }));
    settle(jsonResponse(429, { error: "too many requests, please try again later" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("too many requests, please try again later");
    expect(screen.getByLabelText(NAME)).not.toHaveFocus();
    expect(screen.getByRole("button", { name: SUBMIT })).toHaveFocus();
  });

  it("the code step appearing moves focus to the code field, and success to the status", async () => {
    const user = userEvent.setup();
    const settle = deferredFetch();
    render(<ClaimSignup store="restaurants" id="the-cafe" />);
    await openAndFill(user);

    await user.click(screen.getByRole("button", { name: SUBMIT }));
    settle(jsonResponse(200, { ok: true, mode: "code-sent", signupId: "abc", emailSent: true }));

    const codeField = await screen.findByLabelText(CODE);
    await waitFor(() => expect(codeField).toHaveFocus());

    const settleVerify = deferredFetch();
    await user.type(codeField, "123456");
    await user.click(screen.getByRole("button", { name: VERIFY }));
    settleVerify(jsonResponse(200, { ok: true, approved: true, role: "member-business" }));

    const done = await screen.findByRole("status");
    await waitFor(() => expect(done).toHaveFocus());
  });

  it("switching to the fallback request form lands on its first field", async () => {
    const user = userEvent.setup();
    render(<ClaimSignup store="restaurants" id="the-cafe" />);

    await user.click(screen.getByRole("button", { name: DISCLOSURE }));
    await waitFor(() => expect(screen.getByLabelText(NAME)).toHaveFocus());

    await user.click(screen.getByRole("button", { name: FALLBACK }));
    // The fallback form's own name field (same label, fresh input).
    await waitFor(() => expect(screen.getByLabelText(NAME)).toHaveFocus());
    // And it is the REQUEST form now: the phone-first contact field renders.
    expect(screen.getByLabelText("Phone number (or email)")).toBeInTheDocument();
  });

  it("re-opening after a cancel focuses the first field again", async () => {
    const user = userEvent.setup();
    render(<ClaimSignup store="restaurants" id="the-cafe" />);

    await user.click(screen.getByRole("button", { name: DISCLOSURE }));
    await waitFor(() => expect(screen.getByLabelText(NAME)).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(NAME)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: DISCLOSURE }));
    await waitFor(() => expect(screen.getByLabelText(NAME)).toHaveFocus());
  });
});
