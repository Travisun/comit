ALTER TABLE "users" ADD COLUMN "followers_visibility" varchar(12) DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "following_visibility" varchar(12) DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bookmarks_visibility" varchar(12) DEFAULT 'private' NOT NULL;