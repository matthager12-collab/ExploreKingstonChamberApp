// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { ClaimSignup } from "@/components/claim-signup";
import { FeedbackTab } from "@/components/feedback-tab";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const DISCLOSURE = "Own this business? Claim this listing";
const NAME = "Your name";
const EMAIL = "Business email";
const PASSWORD = "Choose a password";
const SUBMIT = "Create account & claim";
const CODE = "Verification code";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function openAndFill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: DISCLOSURE }));
  await user.type(screen.getByLabelText(NAME), "Pat Owner");
  await user.type(screen.getByLabelText(EMAIL), "pat@example.com");
  await user.type(screen.getByLabelText(PASSWORD), "s3cure-enough");
}

describe("<ClaimSignup/> fixes", () => {
  it("uses the prominent disclosure style only when requested", () => {
    const { rerender } = render(<ClaimSignup store="restaurants" id="the-cafe" prominent />);
    expect(screen.getByRole("button", { name: DISCLOSURE }).className).toContain("bg-sound");
    rerender(<ClaimSignup store="restaurants" id="the-cafe" />);
    expect(screen.getByRole("button", { name: DISCLOSURE }).className).not.toContain("bg-sound");
  });

  it("announces signup rate limits with wait time and Chamber phone", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(429, { error: "too many requests, please try again later" }, { "Retry-After": "1200" }))));
    render(<ClaimSignup store="restaurants" id="the-cafe" />);
    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: SUBMIT }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Try again in 20 minutes");
    expect(alert).toHaveTextContent("360-860-2239");
  });

  it("shows the email, resends the same signup body, and returns to email", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { signupId: "first", emailSent: true }))
      .mockResolvedValueOnce(jsonResponse(200, { signupId: "second", emailSent: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClaimSignup store="restaurants" id="the-cafe" />);
    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: SUBMIT }));
    await screen.findByLabelText(CODE);
    expect(screen.getByText("We sent a code to pat@example.com.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send a new code" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual(
      JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("New code sent.");
    await user.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText(NAME)).toHaveValue("Pat Owner");
    await waitFor(() => expect(screen.getByLabelText(EMAIL)).toHaveFocus());
  });

  it("validates a short password inline without posting", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ClaimSignup store="restaurants" id="the-cafe" />);
    await user.click(screen.getByRole("button", { name: DISCLOSURE }));
    await user.type(screen.getByLabelText(NAME), "Pat Owner");
    await user.type(screen.getByLabelText(EMAIL), "pat@example.com");
    await user.type(screen.getByLabelText(PASSWORD), "short");
    const password = screen.getByLabelText(PASSWORD);
    const hintId = password.getAttribute("aria-describedby");
    await user.click(screen.getByRole("button", { name: SUBMIT }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 8 characters.");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password.getAttribute("aria-describedby")).toContain(hintId);
    expect(password.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  });

  it("uses text-sm labels", async () => {
    const user = userEvent.setup();
    render(<ClaimSignup store="restaurants" id="the-cafe" />);
    await user.click(screen.getByRole("button", { name: DISCLOSURE }));
    const label = screen.getByText(NAME, { selector: "label" });
    expect(label.className).toContain("text-sm");
    expect(label.className).not.toContain("text-xs");
  });
});

describe("<FeedbackTab/> mobile placement", () => {
  it("uses a bottom mobile position and keeps the desktop midpoint", () => {
    render(<FeedbackTab />);
    const tab = screen.getByRole("button", { name: /feedback/i });
    expect(tab.className).toMatch(/\bbottom-/);
    expect(tab.className).toContain("sm:top-1/2");
  });
});
