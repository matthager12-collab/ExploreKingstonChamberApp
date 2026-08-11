CREATE TABLE "claim_contact" (
	"subject_store" text NOT NULL,
	"subject_id" text NOT NULL,
	"email_lower" text NOT NULL,
	"source" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_signup" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_store" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_label" text NOT NULL,
	"name" text NOT NULL,
	"email_lower" text NOT NULL,
	"password_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_contact_subject_email_uniq" ON "claim_contact" USING btree ("subject_store","subject_id","email_lower");--> statement-breakpoint
CREATE INDEX "claim_signup_subject_idx" ON "claim_signup" USING btree ("subject_store","subject_id");