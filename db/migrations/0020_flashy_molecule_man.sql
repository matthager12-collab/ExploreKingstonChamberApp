ALTER TABLE "member_event_draft" ADD COLUMN "rrule" text;--> statement-breakpoint
ALTER TABLE "member_event_draft" ADD COLUMN "ticket_url" text;--> statement-breakpoint
ALTER TABLE "member_event_draft" ADD COLUMN "time_missing" boolean DEFAULT false NOT NULL;