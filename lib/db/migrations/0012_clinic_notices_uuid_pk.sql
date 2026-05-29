-- Migration: change clinic_notices.id from serial (integer) to uuid (v7)
--
-- Safe conditions:
--   - Table was just created in 0011; no other table has a FK referencing clinic_notices.id
--   - Any existing rows get gen_random_uuid() (v4) for the migration only;
--     future inserts from the application use uuidV7()
--
-- The DEFAULT gen_random_uuid() is intentionally left in place so raw SQL
-- inserts (e.g. seed scripts or manual ops) still work without an explicit id.
-- Application code uses Drizzle's $defaultFn(uuidV7) which takes precedence.

ALTER TABLE "clinic_notices" DROP CONSTRAINT "clinic_notices_pkey";
ALTER TABLE "clinic_notices" DROP COLUMN "id";
ALTER TABLE "clinic_notices" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE "clinic_notices" ADD CONSTRAINT "clinic_notices_pkey" PRIMARY KEY ("id");
