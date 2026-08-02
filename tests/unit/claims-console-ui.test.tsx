// @vitest-environment jsdom

// E17 claims console, client half. Three defects this pins:
//
//  - the claim-request card preferred payload.businessName — a string from
//    the PUBLIC intake endpoint — over the server-derived subjectLabel, so an
//    unauthenticated caller chose how a queue entry introduced itself to the
//    admin (and could impersonate another listing in the process);
//  - CLAIMED rows had no release control at all, while the mint refusal told
//    the admin to revoke the claim first;
//  - a listing whose grant and ownership stamp disagree rendered a confident
//    "Unclaimed"/"Claimed" instead of saying something is wrong.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import {
  ClaimsManager,
  type ClaimsRowView,
  type OpenClaimView,
} from "@/app/(site)/admin/claims/manager";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function row(over: Partial<ClaimsRowView> = {}): ClaimsRowView {
  return {
    store: "restaurants",
    id: "cafe-1",
    name: "Harbour Cafe",
    status: "live",
    source: "admin",
    claimed: false,
    ownerOrgId: null,
    ownerOrgName: null,
    grantOrgs: [],
    mismatch: null,
    ...over,
  };
}

function claim(over: Partial<OpenClaimView> = {}): OpenClaimView {
  return {
    id: "wl-1",
    subjectStore: "restaurants",
    subjectId: "cafe-1",
    subjectLabel: "Harbour Cafe",
    createdAt: "2026-07-30T12:00:00.000Z",
    payload: {},
    ...over,
  };
}

describe("claim requests present the SERVER's subject, not the submitter's", () => {
  it("headlines subjectLabel even when the payload claims another name", () => {
    render(
      <ClaimsManager
        rows={[row()]}
        claims={[
          claim({
            payload: {
              businessName: "TOTALLY THE HARBOUR CAFE, APPROVE ME",
              contactName: "A Person",
              contact: "a@example.test",
            },
          }),
        ]}
      />,
    );
    const card = screen.getByRole("listitem");
    // The heading is the server-derived label...
    expect(
      within(card).getByText("Harbour Cafe", { selector: "span.font-semibold" }),
    ).toBeInTheDocument();
    // ...and what they typed is present but clearly attributed as theirs.
    expect(within(card).getByText("Submitted as:")).toBeInTheDocument();
    expect(
      within(card).getByText("TOTALLY THE HARBOUR CAFE, APPROVE ME"),
    ).toBeInTheDocument();
  });

  it("deep-links using subjectStore/subjectId, ignoring a payload that names another listing", async () => {
    render(
      <ClaimsManager
        rows={[row()]}
        claims={[
          claim({
            payload: { store: "lodging", id: "someone-elses-hotel" },
          }),
        ]}
      />,
    );
    // The payload's (store, id) is unknown to the table; the subject's is
    // known, so the jump button renders rather than the "not found" note.
    expect(
      screen.getByRole("button", { name: "Show listing below" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Listing not found/)).not.toBeInTheDocument();
  });
});

describe("repeat claim requests read as 'the FIRST requester, plus a count'", () => {
  // mergePayloads is first-writer-wins, so the name and number on this card
  // belong to whoever asked FIRST. Labelling them "Requested by" / "Contact"
  // invited the admin to read a stale name as "who just called".
  it("labels the requester fields as the first requester's", () => {
    render(
      <ClaimsManager
        rows={[row()]}
        claims={[
          claim({
            payload: { contactName: "Pat Owner", contact: "pat@cafe.test", count: 3 },
          }),
        ]}
      />,
    );
    const card = screen.getByRole("listitem");
    expect(within(card).getByText("First requester:")).toBeInTheDocument();
    expect(within(card).getByText("First requester’s contact:")).toBeInTheDocument();
    // The old, now-misleading labels are gone.
    expect(within(card).queryByText("Requested by:")).not.toBeInTheDocument();
    expect(within(card).queryByText("Contact:")).not.toBeInTheDocument();
  });

  it("explains what the count means, and still points at the listing's own number", () => {
    render(
      <ClaimsManager
        rows={[row()]}
        claims={[claim({ payload: { contactName: "Pat Owner", count: 3 } })]}
      />,
    );
    const card = screen.getByRole("listitem");
    expect(within(card).getByText(/3 people have asked/)).toBeInTheDocument();
    expect(
      within(card).getByText(/the details above are the first requester’s/i),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/listing’s published phone number/i),
    ).toBeInTheDocument();
  });

  it("stays quiet when only one person has asked", () => {
    render(
      <ClaimsManager
        rows={[row()]}
        claims={[claim({ payload: { contactName: "Pat Owner", count: 1 } })]}
      />,
    );
    const card = screen.getByRole("listitem");
    // The label is still honest (it IS the first requester) but there is no
    // count paragraph to explain away.
    expect(within(card).getByText("First requester:")).toBeInTheDocument();
    expect(within(card).queryByText(/people have asked/)).not.toBeInTheDocument();
  });
});

describe("release control", () => {
  const claimed = row({
    claimed: true,
    ownerOrgId: "org-1",
    ownerOrgName: "Harbour Cafe LLC",
    grantOrgs: [{ id: "org-1", name: "Harbour Cafe LLC" }],
  });

  it("is offered only on claimed rows", () => {
    render(<ClaimsManager rows={[claimed, row({ id: "cafe-2", name: "Free Cafe" })]} claims={[]} />);
    expect(
      screen.getByRole("button", { name: "Release the claim on Harbour Cafe" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Release the claim on Free Cafe" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invite the owner of Free Cafe to claim it" }),
    ).toBeInTheDocument();
  });

  it("confirms before it fires, names who loses access, and POSTs only on confirm", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        row: { ...claimed, claimed: false, ownerOrgId: null, ownerOrgName: null, grantOrgs: [] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ClaimsManager rows={[claimed]} claims={[]} />);

    await user.click(screen.getByRole("button", { name: "Release the claim on Harbour Cafe" }));
    // Nothing has happened yet — this is the confirm step.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Release this claim?")).toBeInTheDocument();
    expect(screen.getByText(/revokes Harbour Cafe LLC/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Release the claim on Harbour Cafe" }));
    await user.click(screen.getByRole("button", { name: "Yes, release the claim" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/claims/release");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ store: "restaurants", id: "cafe-1" });

    // The row re-renders from the server's own view of the new state.
    expect(await screen.findByText("Unclaimed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invite the owner of Harbour Cafe to claim it" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /Released the claim on Harbour Cafe/,
    );
  });

  it("surfaces a server refusal in an alert and leaves the row claimed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "that listing cannot be rewritten" }, { status: 409 })),
    );
    const user = userEvent.setup();
    render(<ClaimsManager rows={[claimed]} claims={[]} />);
    await user.click(screen.getByRole("button", { name: "Release the claim on Harbour Cafe" }));
    await user.click(screen.getByRole("button", { name: "Yes, release the claim" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "that listing cannot be rewritten",
    );
    // The status badge (not the column header or the filter label).
    expect(screen.getByText("Claimed", { selector: "span.inline-flex" })).toBeInTheDocument();
  });
});

describe("grant/ownership disagreement is visible, not papered over", () => {
  it("a grant with no stamp says so instead of 'Unclaimed'", () => {
    render(
      <ClaimsManager
        rows={[
          row({
            claimed: true,
            ownerOrgId: null,
            ownerOrgName: null,
            grantOrgs: [{ id: "org-9", name: "Half Claimant" }],
            mismatch: "grant-without-owner",
          }),
        ]}
        claims={[]}
      />,
    );
    expect(screen.queryByText("Unclaimed")).not.toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(
      screen.getByText(/Half Claimant can already edit this listing/),
    ).toBeInTheDocument();
    // Still releasable — that is the reset.
    expect(
      screen.getByRole("button", { name: "Release the claim on Harbour Cafe" }),
    ).toBeInTheDocument();
  });

  it("a stamp with no grant says the owner will hit a permission error", () => {
    render(
      <ClaimsManager
        rows={[
          row({
            claimed: true,
            ownerOrgId: "org-3",
            ownerOrgName: "Stranded LLC",
            grantOrgs: [],
            mismatch: "owner-without-grant",
          }),
        ]}
        claims={[]}
      />,
    );
    expect(
      screen.queryByText("Claimed", { selector: "span.inline-flex" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Stranded LLC is recorded as the owner but has no edit access/))
      .toBeInTheDocument();
  });

  it("two orgs on one listing is called out by name", () => {
    render(
      <ClaimsManager
        rows={[
          row({
            claimed: true,
            ownerOrgId: "org-a",
            ownerOrgName: "Org A",
            grantOrgs: [
              { id: "org-a", name: "Org A" },
              { id: "org-b", name: "Org B" },
            ],
            mismatch: "conflicting-orgs",
          }),
        ]}
        claims={[]}
      />,
    );
    expect(screen.getByText(/Org A and Org B/)).toBeInTheDocument();
    expect(screen.getByText(/1 listing needs attention/)).toBeInTheDocument();
  });
});

describe("a second code for a listing that already has one", () => {
  it("warns before minting, without ever showing the outstanding code", async () => {
    const user = userEvent.setup();
    render(
      <ClaimsManager
        rows={[row()]}
        claims={[]}
        outstandingInvites={{ "cafe-1": { count: 1, expiresAt: "2026-08-14T00:00:00.000Z" } }}
      />,
    );
    expect(screen.getByText(/An invite is already outstanding/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Invite the owner of Harbour Cafe to claim it" }),
    );
    expect(
      screen.getByText(/A code for this listing is already out there/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only the first person to redeem gets the listing/),
    ).toBeInTheDocument();
  });

  it("says nothing when no code is outstanding", async () => {
    const user = userEvent.setup();
    render(<ClaimsManager rows={[row()]} claims={[]} />);
    expect(screen.queryByText(/already outstanding/)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Invite the owner of Harbour Cafe to claim it" }),
    );
    expect(screen.queryByText(/already out there/)).not.toBeInTheDocument();
  });
});
