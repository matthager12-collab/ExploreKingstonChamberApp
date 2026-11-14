// App-facing delegate for the member event pages store (drizzle handles stay
// in src/lib/db — same pattern as volunteer-signup-store.ts).

export {
  claimCheck,
  clearEventPage,
  getEventPage,
  insertDrafts,
  listNewDrafts,
  listPagesDue,
  ownerHasDraftArtwork,
  recordCheck,
  saveEventPage,
  setDraftArtwork,
  setDraftStatus,
  type MemberEventDraftRow,
  type MemberEventPageRow,
  type NewDraft,
} from "@/lib/db/member-event-pages";
