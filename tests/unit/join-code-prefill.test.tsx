// @vitest-environment jsdom

// E17 sub-minute claim: /portal/join?code=XYZ pre-fills the invite code in
// JoinForm, so the link the admin copies from /admin/accounts is one tap →
// three fields → account. The server page reads searchParams (a Promise in
// this Next version) and threads an initialCode prop; the input stays
// editable (defaultValue, not value) so a mistyped link is not a dead end.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import JoinPage from "@/app/(site)/portal/join/page";
import { JoinForm } from "@/app/(site)/portal/forms";

afterEach(cleanup);

describe("join-code prefill", () => {
  it("JoinForm pre-fills the code input from initialCode", () => {
    render(<JoinForm initialCode="OWN123" />);
    expect(screen.getByLabelText("Invite code")).toHaveValue("OWN123");
  });

  it("JoinForm without a code renders empty (unchanged default)", () => {
    render(<JoinForm />);
    expect(screen.getByLabelText("Invite code")).toHaveValue("");
  });

  it("the page threads ?code= through to the form, trimmed", async () => {
    render(await JoinPage({ searchParams: Promise.resolve({ code: "  OWN456  " }) }));
    expect(screen.getByLabelText("Invite code")).toHaveValue("OWN456");
  });

  it("an array (repeated ?code=) is ignored rather than mangled", async () => {
    render(
      await JoinPage({ searchParams: Promise.resolve({ code: ["A", "B"] }) }),
    );
    expect(screen.getByLabelText("Invite code")).toHaveValue("");
  });
});
