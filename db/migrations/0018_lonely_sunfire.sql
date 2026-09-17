CREATE TABLE "race_checkin_link" (
	"race_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"minted_by" text NOT NULL,
	"minted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "race_registrant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" text NOT NULL,
	"item_id" text NOT NULL,
	"contact_id" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"rate_title" text NOT NULL,
	"shirt_note" text,
	"waiver_signed" boolean,
	"status" text DEFAULT 'active' NOT NULL,
	"needs_review_reason" text,
	"checked_in_at" timestamp with time zone,
	"checked_in_by" text,
	"registered_at" timestamp with time zone NOT NULL,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "race_registrant_status_check" CHECK ("race_registrant"."status" in ('active', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "race_registrant_payment_item_uniq" ON "race_registrant" USING btree ("payment_id","item_id");--> statement-breakpoint
CREATE INDEX "race_registrant_status_idx" ON "race_registrant" USING btree ("status");