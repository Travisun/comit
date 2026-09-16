ALTER TABLE "users" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ext_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;