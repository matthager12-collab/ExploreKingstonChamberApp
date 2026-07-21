CREATE TABLE "idempotency_keys" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
