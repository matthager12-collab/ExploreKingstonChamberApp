// E08 worklist fixture factories. sync_conflict and privacy_request have NO
// producers until E16/E11 — these factories are the agreed payload shapes
// those epics will emit, and the store/UI tests prove the queue accepts and
// renders them today. Override any field via the partial argument.

import type { CreateWorklistInput } from "@/lib/stores/worklist-store";

export function moderationPayload(over: Record<string, unknown> = {}) {
  return {
    kind: "edit",
    proposed: { id: "the-grub-hut", name: "The Grub Hut", description: "New blurb" },
    submitterUserId: "user-1",
    ...over,
  };
}

export function syncConflictPayload(over: Record<string, unknown> = {}) {
  return {
    fields: [{ name: "phone", localValue: "360-555-0100", remoteValue: "360-555-0199" }],
    remoteFetchedAt: "2026-07-19T10:00:00Z",
    ...over,
  };
}

export function stalenessPayload(over: Record<string, unknown> = {}) {
  return { lastVerifiedAt: null, intervalDays: 90, ...over };
}

export function reportInaccuratePayload(over: Record<string, unknown> = {}) {
  return {
    messages: [{ message: "Hours are wrong — closed Mondays now", at: "2026-07-19T10:00:00Z" }],
    count: 1,
    ...over,
  };
}

export function privacyRequestPayload(over: Record<string, unknown> = {}) {
  return { requestKind: "access", contact: "visitor@example.test", ...over };
}

export function syncConflictItem(over: Partial<CreateWorklistInput> = {}): CreateWorklistInput {
  return {
    type: "sync_conflict",
    subjectStore: "restaurants",
    subjectId: "the-grub-hut",
    subjectLabel: "The Grub Hut",
    payload: syncConflictPayload(),
    ...over,
  };
}

export function privacyRequestItem(over: Partial<CreateWorklistInput> = {}): CreateWorklistInput {
  return {
    type: "privacy_request",
    subjectStore: "analytics",
    subjectId: "request-2026-07-19-a",
    subjectLabel: "Access request (visitor@example.test)",
    payload: privacyRequestPayload(),
    ...over,
  };
}
