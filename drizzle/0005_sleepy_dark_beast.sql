ALTER TABLE "users" ADD COLUMN "hide_followers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hide_following" boolean DEFAULT false NOT NULL;