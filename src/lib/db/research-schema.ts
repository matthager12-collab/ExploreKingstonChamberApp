import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ResearchPayload } from "@/lib/research/schema";

export const researchRequest = pgTable(
  "research_request",
  {
    id: uuid("id").primaryKey(),
    createdBy: text("created_by").notNull(),
    state: text("state").notNull().default("queued"),
    revision: integer("revision").notNull().default(1),
    payload: jsonb("payload").$type<ResearchPayload>().notNull(),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("research_request_queue_idx").on(t.state, t.createdAt)],
);
export type ResearchRow = typeof researchRequest.$inferSelect;
