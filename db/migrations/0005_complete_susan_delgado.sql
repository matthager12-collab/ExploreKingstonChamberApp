CREATE TABLE "analytics_area_rollup" (
	"month" text NOT NULL,
	"area" text NOT NULL,
	"pings" integer NOT NULL,
	"sessions" integer NOT NULL,
	CONSTRAINT "analytics_area_rollup_month_area_pk" PRIMARY KEY("month","area")
);
--> statement-breakpoint
CREATE TABLE "legal_hold" (
	"store" text NOT NULL,
	"record_id" text NOT NULL,
	"reason" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_hold_store_record_id_pk" PRIMARY KEY("store","record_id")
);
