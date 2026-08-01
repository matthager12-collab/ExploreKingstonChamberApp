CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"run_by" text NOT NULL,
	"stats" jsonb NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_alias" (
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"subject_store" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "worklist_item" DROP CONSTRAINT "worklist_item_type_check";--> statement-breakpoint
CREATE UNIQUE INDEX "listing_alias_source_external_uniq" ON "listing_alias" USING btree ("source","external_id");--> statement-breakpoint
ALTER TABLE "worklist_item" ADD CONSTRAINT "worklist_item_type_check" CHECK ("worklist_item"."type" IN ('moderation', 'sync_conflict', 'staleness', 'report_inaccurate', 'privacy_request', 'claim_request'));