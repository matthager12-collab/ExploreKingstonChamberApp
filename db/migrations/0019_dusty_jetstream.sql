CREATE TABLE "member_event_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"title" text NOT NULL,
	"start" text NOT NULL,
	"end" text,
	"venue" text,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_event_draft_status_check" CHECK ("member_event_draft"."status" in ('new', 'published', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "member_event_page" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_event_draft_owner_dedupe_uniq" ON "member_event_draft" USING btree ("owner_id","dedupe_key");