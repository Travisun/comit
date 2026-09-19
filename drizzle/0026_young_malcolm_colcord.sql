CREATE TABLE "ext_badge_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"badge_id" uuid NOT NULL,
	"granted_by" uuid,
	"note" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_badge_wear" (
	"user_id" uuid NOT NULL,
	"badge_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ext_badge_wear_user_id_badge_id_pk" PRIMARY KEY("user_id","badge_id")
);
--> statement-breakpoint
CREATE TABLE "ext_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" varchar(40) NOT NULL,
	"text" varchar(24) NOT NULL,
	"icon" varchar(24) DEFAULT 'medal' NOT NULL,
	"style" varchar(24) DEFAULT 'slate' NOT NULL,
	"description" varchar(200),
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ext_badge_grants" ADD CONSTRAINT "ext_badge_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_badge_grants" ADD CONSTRAINT "ext_badge_grants_badge_id_ext_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."ext_badges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_badge_grants" ADD CONSTRAINT "ext_badge_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_badge_wear" ADD CONSTRAINT "ext_badge_wear_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_badge_wear" ADD CONSTRAINT "ext_badge_wear_badge_id_ext_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."ext_badges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ext_badge_grants_user_badge_key" ON "ext_badge_grants" USING btree ("user_id","badge_id");--> statement-breakpoint
CREATE INDEX "ext_badge_grants_user_idx" ON "ext_badge_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ext_badge_wear_user_idx" ON "ext_badge_wear" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_badges_key_key" ON "ext_badges" USING btree ("key");