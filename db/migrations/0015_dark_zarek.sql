CREATE TABLE "member_meta" (
	"subject_store" text NOT NULL,
	"subject_id" text NOT NULL,
	"member_status" text NOT NULL,
	"level_name" text,
	"dues_amount" numeric(10, 2),
	"source" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_meta_subject_uniq" ON "member_meta" USING btree ("subject_store","subject_id");