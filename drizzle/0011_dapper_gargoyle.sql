CREATE TABLE "poll_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"mode" varchar(12) DEFAULT 'single' NOT NULL,
	"options" jsonb NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_unique" ON "poll_votes" USING btree ("poll_id","user_id","option_index");--> statement-breakpoint
CREATE INDEX "poll_votes_poll_idx" ON "poll_votes" USING btree ("poll_id");--> statement-breakpoint
CREATE UNIQUE INDEX "polls_post_id_key" ON "polls" USING btree ("post_id");