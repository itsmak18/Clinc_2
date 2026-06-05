-- Migration 0022: Add clinic_id to doctor_schedules + schedule_overrides.
--
-- Why: these two tables were the only clinic-bearing tables without a clinic_id
-- column, which meant schedule data was keyed only by doctorId (doctor-scoping
-- provided isolation at the application layer, but no DB-layer backstop).
-- This migration adds clinic_id, backfills from the owning doctor's clinic_id,
-- adds the NOT NULL + CHECK constraints, the FK, and applies the same
-- tenant_isolation RLS policy already on every other clinical table.
--
-- Backfill: JOIN users.clinic_id via doctor_id. Safe for existing data.
-- If a row has a doctor_id that doesn't exist in users, the JOIN returns NULL
-- and the row is excluded — this should never happen (FK is enforced).
--
-- After this migration schedule.service.ts is updated to use runInTenantContext.

-- Step 1: add nullable column (allows backfill without constraint violation)
ALTER TABLE "doctor_schedules" ADD COLUMN "clinic_id" integer;
ALTER TABLE "schedule_overrides" ADD COLUMN "clinic_id" integer;

-- Step 2: backfill from the owning doctor's clinic
UPDATE "doctor_schedules" ds
  SET clinic_id = u.clinic_id
  FROM "users" u
  WHERE u.id = ds.doctor_id;

UPDATE "schedule_overrides" so
  SET clinic_id = u.clinic_id
  FROM "users" u
  WHERE u.id = so.doctor_id;

-- Step 3: apply constraints
ALTER TABLE "doctor_schedules"
  ALTER COLUMN "clinic_id" SET NOT NULL,
  ADD CONSTRAINT "doctor_schedules_clinic_id_check" CHECK (clinic_id > 0),
  ADD CONSTRAINT "doctor_schedules_clinic_id_clinics_id_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "schedule_overrides"
  ALTER COLUMN "clinic_id" SET NOT NULL,
  ADD CONSTRAINT "schedule_overrides_clinic_id_check" CHECK (clinic_id > 0),
  ADD CONSTRAINT "schedule_overrides_clinic_id_clinics_id_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Step 4: RLS — same pattern as migration 0015 applied to every other PHI table.
ALTER TABLE "doctor_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_schedules" FORCE ROW LEVEL SECURITY;

ALTER TABLE "schedule_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_overrides" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "doctor_schedules";
CREATE POLICY tenant_isolation ON "doctor_schedules"
  USING (clinic_id = current_setting('app.clinic_id', true)::integer);

DROP POLICY IF EXISTS tenant_isolation ON "schedule_overrides";
CREATE POLICY tenant_isolation ON "schedule_overrides"
  USING (clinic_id = current_setting('app.clinic_id', true)::integer);

-- Step 5: grant medicore_app DML (default privileges cover future tables, but
-- this table already existed, so we must grant explicitly).
GRANT SELECT, INSERT, UPDATE, DELETE ON "doctor_schedules" TO medicore_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_overrides" TO medicore_app;
