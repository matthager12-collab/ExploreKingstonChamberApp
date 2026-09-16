CREATE TABLE "scarecrow_vote" (
	"id" text PRIMARY KEY NOT NULL,
	"scarecrow_id" text NOT NULL,
	"photo_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "scarecrow_vote_scarecrow_idx" ON "scarecrow_vote" USING btree ("scarecrow_id");--> statement-breakpoint
CREATE INDEX "scarecrow_vote_created_idx" ON "scarecrow_vote" USING btree ("created_at");