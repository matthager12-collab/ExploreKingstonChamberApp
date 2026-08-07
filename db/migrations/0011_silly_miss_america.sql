CREATE TABLE "event_going" (
	"event_id" text NOT NULL,
	"zip" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_going_event_id_zip_pk" PRIMARY KEY("event_id","zip")
);
--> statement-breakpoint
CREATE INDEX "event_going_event_idx" ON "event_going" USING btree ("event_id");