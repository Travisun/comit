ALTER TYPE "public"."post_status" ADD VALUE 'deleted';--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "pre_delete_status" varchar(24);