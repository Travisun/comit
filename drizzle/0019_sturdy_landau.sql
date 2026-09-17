ALTER TABLE "comments" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "solution_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "comments_post_pinned_idx" ON "comments" USING btree ("post_id","pinned_at");