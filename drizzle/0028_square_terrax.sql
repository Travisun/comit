CREATE TABLE "one_time_challenges" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "absolute_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "one_time_challenges_expires_idx" ON "one_time_challenges" USING btree ("expires_at");