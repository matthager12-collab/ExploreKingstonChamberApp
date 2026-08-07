CREATE TABLE "feedback_response" (
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"response" jsonb NOT NULL
);
