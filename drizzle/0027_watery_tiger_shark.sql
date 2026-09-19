CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" uuid NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mentions_user_idx" ON "mentions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mentions_target_idx" ON "mentions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_display_name_key" ON "users" USING btree (lower("display_name"));