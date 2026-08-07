CREATE TABLE "feedback_response" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"response" jsonb NOT NULL
);
