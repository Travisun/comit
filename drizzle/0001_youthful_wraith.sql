CREATE TABLE "verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"label" varchar(80) NOT NULL,
	"description" varchar(500) NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"reject_reason" varchar(300),
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "label" varchar(24) DEFAULT 'original' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "source_name" varchar(200);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tier" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verified" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" jsonb;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_user_idx" ON "verification_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_status_idx" ON "verification_requests" USING btree ("status","created_at");