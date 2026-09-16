// @vitest-environment jsdom

// ExternalLink is the shared sink for store-fed outbound hrefs (event.url,
// place.website, booking links). The load-bearing property: a stored string
// that isn't plainly http(s) must never become an href attribute — it
// degrades to inert text, keeping the label legible and the page unchanged
// otherwise.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalLink } from "@/components/ui";

afterEach(cleanup);

describe("ExternalLink scheme floor", () => {
  it("renders a web URL as a link", () => {
    render(<ExternalLink href="https://example.com/menu">Menu</ExternalLink>);
    const link = screen.getByRole("link", { name: "Menu" });
    expect(link.getAttribute("href")).toBe("https://example.com/menu");
  });

  it("renders a non-web scheme as text, with no anchor at all", () => {
    // eslint-disable-next-line no-script-url -- the rejected input under test
    render(<ExternalLink href="javascript:alert(1)">Menu</ExternalLink>);
    expect(screen.queryByRole("link")).toBeNull();
    // getByText throws when absent — reaching here proves the label survived.
    expect(screen.getByText("Menu")).toBeTruthy();
  });
});
