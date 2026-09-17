DROP INDEX "bookmarks_user_idx";--> statement-breakpoint
DROP INDEX "comments_post_pinned_idx";--> statement-breakpoint
DROP INDEX "poll_votes_poll_idx";--> statement-breakpoint
DROP INDEX "posts_author_status_idx";--> statement-breakpoint
DROP INDEX "posts_published_idx";--> statement-breakpoint
DROP INDEX "posts_status_idx";--> statement-breakpoint
CREATE INDEX "bookmarks_user_created_idx" ON "bookmarks" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_user_a_idx" ON "conversations" USING btree ("user_a_id");--> statement-breakpoint
CREATE INDEX "conversations_user_b_idx" ON "conversations" USING btree ("user_b_id");--> statement-breakpoint
CREATE INDEX "export_jobs_user_idx" ON "export_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_unread_idx" ON "messages" USING btree ("conversation_id") WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "posts_feed_idx" ON "posts" USING btree ("status","visibility","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_author_feed_idx" ON "posts" USING btree ("author_id","status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "reposts_post_idx" ON "reposts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_idx" ON "webhook_deliveries" USING btree ("created_at");