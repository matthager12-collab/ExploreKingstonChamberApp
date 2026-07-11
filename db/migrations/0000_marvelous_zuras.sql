CREATE TABLE "analytics_event" (
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"event" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"store" text NOT NULL,
	"record_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ferry_observation" (
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"obs" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarantine" (
	"store" text,
	"id" text,
	"doc" jsonb,
	"errors" jsonb NOT NULL,
	"quarantined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "quarantine_store_id_pk" PRIMARY KEY("store","id")
);
--> statement-breakpoint
CREATE TABLE "record" (
	"store" text NOT NULL,
	"id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"external_id" text,
	"owner_org_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "record_store_id_pk" PRIMARY KEY("store","id"),
	CONSTRAINT "record_status_check" CHECK ("record"."status" IN ('draft', 'pending', 'live', 'rejected', 'hidden')),
	CONSTRAINT "record_source_check" CHECK ("record"."source" IN ('seed', 'import', 'admin', 'portal', 'public', 'sync'))
);
--> statement-breakpoint
CREATE TABLE "survey_response" (
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"response" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "record_store_status_idx" ON "record" USING btree ("store","status");