// Member event pages: a business saves ONE url of its own events page, and a
// daily check turns that page into DRAFT events the member confirms.
// Re-exported from schema.ts (the drizzle-kit source of truth).
//
// Drafts are NOT events. They never appear publicly and are never read by the
// calendar; "Publish" sends the draft through POST /api/portal/events, so the
// moderation floor applies unchanged (docs/adr/ADR-0009).
//
// No personal data: a page url the business chose to publish, and event facts
// extracted from that public page.

import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const MEMBER_EVENT_DRAFT_STATUSES = ["new", "published", "dismissed"] as const;
export type MemberEventDraftStatus = (typeof MEMBER_EVENT_DRAFT_STATUSES)[number];

export const memberEventPage = pgTable("member_event_page", {
  /** The listing id (same id the portal passes as ownerId). One page each. */
  ownerId: text("owner_id").primaryKey(),
  url: text("url").notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  /** Short, member-safe message — never raw error text. */
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberEventDraft = pgTable(
  "member_event_draft",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    /** See draftDedupeKey. With the unique index below, a dismissed or
     *  published draft is never re-created by a re-scrape. */
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("new"),
    title: text("title").notNull(),
    /** Naive Pacific wall time, YYYY-MM-DDTHH:MM. */
    start: text("start").notNull(),
    end: text("end"),
    venue: text("venue"),
    description: text("description").notNull().default(""),
    category: text("category").notNull(),
    /** Preset RRULE for a repeating series; `start` is then its first occurrence. */
    rrule: text("rrule"),
    /** A link taken from the page and verified against the page's own links. */
    ticketUrl: text("ticket_url"),
    /** Stored artwork (an attachment ref, see events/attachment-store) pulled from
     *  the member's own page. Handed to the event on publish, deleted on dismiss. */
    artworkRef: text("artwork_ref"),
    /** No time on the page; `start` carries T00:00 and the member must set one. */
    timeMissing: boolean("time_missing").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("member_event_draft_owner_dedupe_uniq").on(t.ownerId, t.dedupeKey),
    check("member_event_draft_status_check", sql`${t.status} in ('new', 'published', 'dismissed')`),
  ],
);
