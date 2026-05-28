ALTER TABLE "users" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;