// E08 worklist manager render test (node-env, no browser): every payload
// type — including the E16 sync_conflict and E11 privacy_request fixture
// shapes that have no producers yet — renders without runtime errors, and
// the destructive actions carry their confirm gate (data-confirm mirrors the
// window.confirm text, so the gate's existence is statically assertable).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  privacyRequestPayload,
  reportInaccuratePayload,
  stalenessPayload,
  syncConflictPayload,
} from "../../../../../tests/fixtures/worklist-fixtures";
import {
  WorklistManager,
  type WorklistCounts,
  type WorklistItemView,
} from "./manager";
import { WORKLIST_STATES, WORKLIST_TYPES } from "@/lib/schemas/worklist";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const counts = Object.fromEntries(
  WORKLIST_TYPES.map((t) => [t, Object.fromEntries(WORKLIST_STATES.map((s) => [s, 0]))]),
) as WorklistCounts;

let n = 0;
function view(over: Partial<WorklistItemView>): WorklistItemView {
  n += 1;
  return {
    id: `item-${n}`,
    type: "moderation",
    subjectStore: "restaurants",
    subjectId: "cafe",
    subjectLabel: "The Cafe",
    state: "open",
    assigneeUserId: null,
    dueAt: null,
    payload: {},
    resolution: null,
    resolutionNote: null,
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-19T10:00:00.000Z",
    createdBy: null,
    resolvedAt: null,
    resolvedBy: null,
    subject: null,
    ...over,
  };
}

const FIXTURES: WorklistItemView[] = [
  view({
    type: "moderation",
    payload: {
      kind: "edit",
      proposed: { id: "cafe", name: "The Cafe", description: "New blurb" },
    },
    subject: { id: "cafe", name: "The Cafe", description: "Old blurb", status: "live" },
  }),
  view({ type: "moderation", payload: { kind: "new" }, subject: { id: "x", title: "New Event", status: "pending" } }),
  view({ type: "report_inaccurate", payload: reportInaccuratePayload() }),
  view({ type: "staleness", payload: stalenessPayload() }),
  view({ type: "sync_conflict", payload: syncConflictPayload() }),
  view({ type: "privacy_request", payload: privacyRequestPayload(), subjectStore: "analytics" }),
];

function render(items: WorklistItemView[], openId?: string) {
  return renderToStaticMarkup(
    createElement(WorklistManager, {
      initialItems: items,
      initialCounts: counts,
      initialOpenId: openId ?? null,
    }),
  );
}

describe("WorklistManager", () => {
  it("renders every payload type collapsed without runtime errors", () => {
    const html = render(FIXTURES);
    expect(html).toContain("The Cafe");
    expect(html).toContain("Moderation");
    expect(html).toContain("Reports");
    expect(html).toContain("Re-verify");
    expect(html).toContain("Sync conflicts");
    expect(html).toContain("Privacy");
  });

  it("renders each detail panel (incl. the E16/E11 fixture shapes) without errors", () => {
    for (const item of FIXTURES) {
      const html = render(FIXTURES, item.id);
      expect(html.length).toBeGreaterThan(0);
    }
    // Moderation edit shows the before/after diff of changed fields only.
    const editOpen = render(FIXTURES, FIXTURES[0].id);
    expect(editOpen).toContain("Old blurb");
    expect(editOpen).toContain("New blurb");
    expect(editOpen).toContain("Proposed changes");
    // Sync conflict shows the local/remote table from the agreed E16 shape.
    const syncOpen = render(FIXTURES, FIXTURES[4].id);
    expect(syncOpen).toContain("360-555-0100");
    expect(syncOpen).toContain("360-555-0199");
    // Privacy request renders the agreed E11 shape.
    const privacyOpen = render(FIXTURES, FIXTURES[5].id);
    expect(privacyOpen).toContain("visitor@example.test");
  });

  it("privacy_request fulfillment controls render per kind (E11)", () => {
    // access → export button.
    const accessItem = view({
      type: "privacy_request",
      subjectStore: "privacy",
      payload: privacyRequestPayload({ requestKind: "access" }),
    });
    const accessHtml = render([accessItem], accessItem.id);
    expect(accessHtml).toContain("Run access export");

    // delete → delete + legal-hold controls, with the delete confirm gate.
    const deleteItem = view({
      type: "privacy_request",
      subjectStore: "privacy",
      payload: privacyRequestPayload({ requestKind: "delete" }),
    });
    const deleteHtml = render([deleteItem], deleteItem.id);
    expect(deleteHtml).toContain("Delete their data");
    expect(deleteHtml).toContain("Place legal hold");
    expect(deleteHtml).toContain("Clear hold");

    // records → human-fulfillment note, no automated delete button.
    const recordsItem = view({
      type: "privacy_request",
      subjectStore: "privacy",
      payload: privacyRequestPayload({ requestKind: "records" }),
    });
    const recordsHtml = render([recordsItem], recordsItem.id);
    expect(recordsHtml).toContain("Public-records request");
    expect(recordsHtml).not.toContain("Delete their data");
  });

  it("destructive actions are confirm-gated (AC10): approve/reject/takedown/dismiss carry data-confirm", () => {
    const html = render(FIXTURES, FIXTURES[0].id);
    expect(html).toContain('data-confirm="Approve and publish');
    expect(html).toContain("Reject");
    expect(html).toContain('data-confirm="Take ');
    expect(html).toContain('data-confirm="Dismiss ');
  });

  it("resolved items show the outcome instead of action buttons", () => {
    const resolved = view({
      type: "moderation",
      state: "resolved",
      resolution: "approved",
      resolutionNote: "Looks good",
      resolvedBy: "admin-1",
      payload: { kind: "new" },
    });
    const html = render([resolved], resolved.id);
    expect(html).toContain("approved");
    expect(html).toContain("Looks good");
    expect(html).not.toContain('data-confirm="Approve');
  });
});
