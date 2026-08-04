CREATE TABLE "volunteer_signup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" text NOT NULL,
	"name" text,
	"contact" text,
	"contact_kind" text NOT NULL,
	"state" text DEFAULT 'signed_up' NOT NULL,
	"idempotency_key" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"checked_in_by" text,
	"reminder_2d_sent_at" timestamp with time zone,
	"reminder_2h_sent_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_signup_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "volunteer_signup_state_check" CHECK ("volunteer_signup"."state" in ('signed_up', 'cancelled', 'checked_in')),
	CONSTRAINT "volunteer_signup_contact_kind_check" CHECK ("volunteer_signup"."contact_kind" in ('email', 'phone'))
);
--> statement-breakpoint
CREATE INDEX "volunteer_signup_shift_state_idx" ON "volunteer_signup" USING btree ("shift_id","state");