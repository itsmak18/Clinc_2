CREATE TABLE IF NOT EXISTS "clinic_notices" (
  "id" serial PRIMARY KEY NOT NULL,
  "clinic_id" integer NOT NULL DEFAULT 1,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "created_by" integer NOT NULL,
  "reason" text NOT NULL,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cn_clinic_idx" ON "clinic_notices" ("clinic_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cn_created_idx" ON "clinic_notices" ("created_at");
--> statement-breakpoint
-- Migrate existing global records to clinic_notices before dropping the column
INSERT INTO "clinic_notices" ("clinic_id", "title", "content", "created_by", "reason", "created_at", "updated_at")
SELECT
  "clinic_id",
  'Notice from medical record #' || "id",
  COALESCE("global_reason", 'Migrated from global medical record'),
  "doctor_id",
  COALESCE("global_reason", 'Migrated from global medical record'),
  "created_at",
  now()
FROM "medical_records"
WHERE "is_global" = true AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "medical_records" DROP COLUMN IF EXISTS "is_global";
--> statement-breakpoint
ALTER TABLE "medical_records" DROP COLUMN IF EXISTS "global_reason";
