CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"org_id" text,
	"new_org_name" text,
	"new_org_kind" text,
	"linked_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email" text,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"used_by" text,
	"used_at" timestamp with time zone,
	CONSTRAINT "invites_role_check" CHECK ("invites"."role" IN ('admin', 'moderator', 'org-editor', 'member-business', 'viewer')),
	CONSTRAINT "invites_kind_check" CHECK ("invites"."new_org_kind" IS NULL OR "invites"."new_org_kind" IN ('business', 'nonprofit')),
	CONSTRAINT "invites_admin_requires_email" CHECK ("invites"."role" <> 'admin' OR "invites"."email" IS NOT NULL),
	CONSTRAINT "invites_org_binding" CHECK (CASE WHEN "invites"."role" IN ('org-editor', 'member-business')
             THEN ("invites"."org_id" IS NOT NULL AND "invites"."new_org_name" IS NULL)
               OR ("invites"."org_id" IS NULL AND "invites"."new_org_name" IS NOT NULL AND "invites"."new_org_kind" IS NOT NULL)
             ELSE "invites"."org_id" IS NULL AND "invites"."new_org_name" IS NULL
           END)
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"linked_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entitlements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_kind_check" CHECK ("orgs"."kind" IN ('business', 'nonprofit'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"org_id" text,
	"password_hash" text NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('admin', 'moderator', 'org-editor', 'member-business', 'viewer')),
	CONSTRAINT "users_org_binding" CHECK (("users"."role" IN ('org-editor', 'member-business')) = ("users"."org_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));