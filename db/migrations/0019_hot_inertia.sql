CREATE TABLE "research_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "research_request_queue_idx" ON "research_request" USING btree ("state","created_at");