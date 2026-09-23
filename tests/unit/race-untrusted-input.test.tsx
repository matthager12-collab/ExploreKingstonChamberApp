// @vitest-environment jsdom

// Security negatives for the 5K roster (application-security gate,
// 2026-09-22). Two things reach the roster from outside: Zeffy's API answers,
// and whatever a registrant typed into the free-text shirt question. Zeffy's
// answers must fail closed when malformed; the typed text must render as text.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { CheckinClient } from "@/app/(site)/checkin/client";
import { createZeffyClient } from "@/lib/race/zeffy-client";

afterEach(cleanup);

function answering(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

describe("Zeffy's campaign answer", () => {
  it("throws on a malformed price list instead of guessing", async () => {
    for (const body of [
      { id: "c1", rates: "r-shirt" },
      { id: "c1", rates: [{ id: 7, is_add_on: true }] },
      { id: "c1", rates: [{ id: "r-shirt", is_add_on: "yes" }] },
    ]) {
      await expect(createZeffyClient("k", answering(body)).getCampaignRates("c1"), JSON.stringify(body)).rejects.toThrow();
    }
  });

  it("reads a well-formed one", async () => {
    const rates = await createZeffyClient("k", answering({ id: "c1", rates: [{ id: "r-shirt", title: "Shirt", is_add_on: true }] })).getCampaignRates("c1");
    expect(rates).toEqual([{ id: "r-shirt", title: "Shirt", is_add_on: true }]);
  });
});

describe("the check-in list", () => {
  it("shows a script-shaped shirt answer as text", () => {
    const canary = `<img src=x onerror="window.__xss=1">"><script>window.__xss=1</script>`;
    const { container } = render(
      <CheckinClient
        hasWaiverQuestion={false}
        rows={[
          {
            id: "r1", firstName: "Ann", lastName: "Runner", rateTitle: "Early Bird", shirtNote: canary,
            waiverSigned: null, needsReviewReason: null, checkedInAt: null,
          },
        ]}
      />,
    );
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getByText(canary, { exact: false })).toBeInTheDocument();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });
});
