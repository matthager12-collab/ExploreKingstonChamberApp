// @vitest-environment jsdom

// The 5K registration form is Zeffy's, embedded on /race (ADR-0008
// amendment 1). It loads only when the visitor asks for it: Zeffy's page
// carries its own analytics, session recording and ad cookies, and the
// privacy page promises "no third-party analytics or ad tech". A frame that
// loaded on page view would break that promise for every visitor, including
// the ones who never register. So: no frame until the button is pressed.
//
// The embed address is DERIVED from the campaign link, never configured
// separately, so the frame and the zeffy.com link cannot point at two
// different campaigns (outside review, 2026-09-22).

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { RaceRegistration, zeffyEmbedFor } from "@/app/(site)/race/registration";

afterEach(cleanup);

const LINK = "https://www.zeffy.com/en-US/ticketing/not-afraid-of-the-dark-5k-kingston-fun-run";
const EMBED = "https://www.zeffy.com/en-US/embed/ticketing/not-afraid-of-the-dark-5k-kingston-fun-run";

describe("RaceRegistration", () => {
  it("renders no frame until the visitor asks for the form", () => {
    const { container } = render(<RaceRegistration linkUrl={LINK} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: /register/i })).toBeInTheDocument();
    // The escape hatch stays: some phones handle a full page better than a frame.
    expect(screen.getByRole("link", { name: /zeffy\.com/i })).toHaveAttribute("href", LINK);
    expect(screen.getByText(/session recording/i)).toBeInTheDocument();
  });

  it("loads Zeffy's form in place when the button is pressed", () => {
    const { container } = render(<RaceRegistration linkUrl={LINK} />);
    fireEvent.click(screen.getByRole("button", { name: /register/i }));
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    // Same campaign as the link, by construction.
    expect(frame).toHaveAttribute("src", EMBED);
    // A frame needs an accessible name; screen readers announce it.
    expect(frame!.getAttribute("title")).toMatch(/register/i);
    // Apple Pay / Google Pay inside the frame. Pairs with the
    // Permissions-Policy delegation in next.config.ts.
    expect(frame).toHaveAttribute("allow", "payment");
    expect(screen.queryByRole("button", { name: /register/i })).toBeNull();
  });

  it("keeps the Zeffy notice and the zeffy.com link on screen after the form opens", () => {
    render(<RaceRegistration linkUrl={LINK} />);
    fireEvent.click(screen.getByRole("button", { name: /register/i }));
    expect(screen.getByText(/session recording/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /zeffy\.com/i })).toHaveAttribute("href", LINK);
  });

  it("never frames anything that is not a Zeffy ticketing page — it falls back to the link", () => {
    const other = "https://tickets.example.com/5k";
    const { container } = render(<RaceRegistration linkUrl={other} />);
    expect(screen.queryByRole("button", { name: /register/i })).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /register/i })).toHaveAttribute("href", other);
  });

  it("says registration opens soon when there is no link at all", () => {
    const { container } = render(<RaceRegistration linkUrl={undefined} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText(/registration opens soon/i)).toBeInTheDocument();
  });
});

describe("zeffyEmbedFor", () => {
  it("turns a Zeffy ticketing link into its embed address", () => {
    expect(zeffyEmbedFor(LINK)).toBe(EMBED);
    // Already an embed address: passed through unchanged.
    expect(zeffyEmbedFor(EMBED)).toBe(EMBED);
  });

  it("refuses anything that is not https on www.zeffy.com with a ticketing path", () => {
    for (const bad of [
      // blob: URLs report their creator's origin, and this one even carries a
      // ticketing path — only the protocol check stops it.
      "blob:https://www.zeffy.com/en-US/ticketing/not-afraid-of-the-dark-5k-kingston-fun-run",
      "http://www.zeffy.com/en-US/ticketing/x",
      "https://zeffy.com.evil.example/en-US/ticketing/x",
      "https://evil.example/en-US/ticketing/x?u=https://www.zeffy.com",
      "https://www.zeffy.com@evil.example/en-US/ticketing/x",
      "https://www.zeffy.com/en-US/donation-form/x",
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ]) {
      expect(zeffyEmbedFor(bad), String(bad)).toBeUndefined();
    }
  });
});
