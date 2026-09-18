ALTER TYPE "public"."post_visibility" ADD VALUE 'private';--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "visibility" varchar(8) DEFAULT 'public' NOT NULL;