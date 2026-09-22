// @vitest-environment jsdom

// The 5K registration form is Zeffy's, embedded on /race (ADR-0008
// amendment 1). It loads only when the visitor asks for it: Zeffy's page
// carries its own analytics, session recording and ad cookies, and the
// privacy page promises "no third-party analytics or ad tech". A frame that
// loaded on page view would break that promise for every visitor, including
// the ones who never register. So: no frame until the button is pressed.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { RaceRegistration, isZeffyEmbed } from "@/app/(site)/race/registration";

afterEach(cleanup);

const EMBED = "https://www.zeffy.com/en-US/embed/ticketing/not-afraid-of-the-dark-5k-kingston-fun-run";
const LINK = "https://www.zeffy.com/en-US/ticketing/not-afraid-of-the-dark-5k-kingston-fun-run";

describe("RaceRegistration", () => {
  it("renders no frame until the visitor asks for the form", () => {
    const { container } = render(<RaceRegistration embedUrl={EMBED} linkUrl={LINK} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: /register/i })).toBeInTheDocument();
    // The escape hatch stays: some phones handle a full page better than a frame.
    expect(screen.getByRole("link", { name: /zeffy\.com/i })).toHaveAttribute("href", LINK);
  });

  it("loads Zeffy's form in place when the button is pressed", () => {
    const { container } = render(<RaceRegistration embedUrl={EMBED} linkUrl={LINK} />);
    fireEvent.click(screen.getByRole("button", { name: /register/i }));
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame).toHaveAttribute("src", EMBED);
    // A frame needs an accessible name; screen readers announce it.
    expect(frame!.getAttribute("title")).toMatch(/register/i);
    // Apple Pay / Google Pay inside the frame. Pairs with the
    // Permissions-Policy delegation in next.config.ts.
    expect(frame).toHaveAttribute("allow", "payment");
    expect(screen.queryByRole("button", { name: /register/i })).toBeNull();
  });

  it("never frames anything that is not Zeffy — a bad URL falls back to the link", () => {
    const { container } = render(
      <RaceRegistration embedUrl="https://evil.example.com/embed/x" linkUrl={LINK} />,
    );
    expect(screen.queryByRole("button", { name: /register/i })).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /zeffy\.com/i })).toHaveAttribute("href", LINK);
  });
});

describe("isZeffyEmbed", () => {
  it("accepts only an https URL on www.zeffy.com", () => {
    expect(isZeffyEmbed(EMBED)).toBe(true);
    for (const bad of [
      "http://www.zeffy.com/en-US/embed/ticketing/x",
      "https://zeffy.com.evil.example/embed",
      "https://evil.example/?u=https://www.zeffy.com",
      "https://www.zeffy.com@evil.example/embed",
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ]) {
      expect(isZeffyEmbed(bad), String(bad)).toBe(false);
    }
  });
});
