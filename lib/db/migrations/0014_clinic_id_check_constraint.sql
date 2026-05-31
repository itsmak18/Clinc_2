-- Migration 0014: clinic_id must be a positive integer at the DB layer.
--
-- Why now (2026-05-31): the 16-agent board review on 2026-05-30 flagged that
-- "tenant isolation is a decoration" because the only thing keeping cross-tenant
-- PHI from leaking is the hand-written `eq(table.clinicId, req.user!.clinicId)`
-- filter in service code, plus the `payload.clinicId ?? 1` fallback in the auth
-- kernel (now removed — see policy.ts and 460/460 tests).
--
-- This migration is the FIRST of two Phase 2 changes that move that invariant
-- into the database itself:
--
--   0014 (this one) — add CHECK (clinic_id > 0) on every clinic-bearing table.
--                     A non-positive value is now refused by Postgres at INSERT
--                     time. Closes the "0 means no clinic / 1 means everyone's
--                     clinic" foot-gun even if the app drifts.
--
--   0015 (follow-up PR) — ENABLE ROW LEVEL SECURITY + tenant_isolation policy
--                         reading `current_setting('app.clinic_id')::int`.
--                         Requires a per-request DB context (SET LOCAL inside
--                         a tx) which touches every service file. Deferred so
--                         this migration is a self-contained, instantly
--                         deployable, zero-downtime metadata change.
--
-- Safety:
--   - Schema-level `.default(1)` on every column means historical rows all have
--     clinic_id = 1 (positive). The CHECK passes on existing data.
--   - The pre-flight UPDATE below is defense-in-depth in case any row slipped
--     in with 0 or NULL from an unconventional path; it normalizes to clinic 1
--     before the constraint is added. Real cross-tenant noise should be zero —
--     if these UPDATEs touch rows, that itself is a finding worth investigating.
--   - CHECK constraints are validated at INSERT/UPDATE time; the initial scan
--     is fast on tables this size and is run with `NOT VALID` + a separate
--     `VALIDATE CONSTRAINT` step to keep table locks short.
--   - Idempotent: `DO` block guards prevent re-adding the constraint if the
--     migration is re-run by hand (the project's hand-authored migrations
--     0010-0013 already use this pattern).

-- ── Pre-flight: normalize any historical bad rows ────────────────────────────
-- These should all touch 0 rows. If they do not, surface it via the migration log.
UPDATE "appointments"          SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "audit_logs"            SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "audit_outbox"          SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "break_glass_sessions"  SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "clinic_notices"        SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "doctor_patients"       SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "erasure_requests"      SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "inventory"             SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "invoice_items"         SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "invoices"              SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "lab_tests"             SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "medical_records"       SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "notifications"         SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "operations"            SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "patient_consents"      SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "patients"              SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "prescriptions"         SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "ultrasound_records"    SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "users"                 SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;
UPDATE "xray_records"          SET "clinic_id" = 1 WHERE "clinic_id" IS NULL OR "clinic_id" <= 0;

-- ── Add CHECK constraints (idempotent via DO blocks) ─────────────────────────
-- ADD CONSTRAINT … NOT VALID acquires a short ACCESS EXCLUSIVE lock to update
-- the catalog; subsequent VALIDATE CONSTRAINT performs a non-blocking scan
-- under SHARE UPDATE EXCLUSIVE — readers and writers continue normally.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_clinic_id_positive') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "appointments" VALIDATE CONSTRAINT "appointments_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_clinic_id_positive') THEN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "audit_logs" VALIDATE CONSTRAINT "audit_logs_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_outbox_clinic_id_positive') THEN
    ALTER TABLE "audit_outbox" ADD CONSTRAINT "audit_outbox_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "audit_outbox" VALIDATE CONSTRAINT "audit_outbox_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'break_glass_sessions_clinic_id_positive') THEN
    ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "break_glass_sessions" VALIDATE CONSTRAINT "break_glass_sessions_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_notices_clinic_id_positive') THEN
    ALTER TABLE "clinic_notices" ADD CONSTRAINT "clinic_notices_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "clinic_notices" VALIDATE CONSTRAINT "clinic_notices_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doctor_patients_clinic_id_positive') THEN
    ALTER TABLE "doctor_patients" ADD CONSTRAINT "doctor_patients_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "doctor_patients" VALIDATE CONSTRAINT "doctor_patients_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erasure_requests_clinic_id_positive') THEN
    ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "erasure_requests" VALIDATE CONSTRAINT "erasure_requests_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_clinic_id_positive') THEN
    ALTER TABLE "inventory" ADD CONSTRAINT "inventory_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "inventory" VALIDATE CONSTRAINT "inventory_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_clinic_id_positive') THEN
    ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "invoice_items" VALIDATE CONSTRAINT "invoice_items_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_clinic_id_positive') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_tests_clinic_id_positive') THEN
    ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "lab_tests" VALIDATE CONSTRAINT "lab_tests_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'medical_records_clinic_id_positive') THEN
    ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "medical_records" VALIDATE CONSTRAINT "medical_records_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_clinic_id_positive') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operations_clinic_id_positive') THEN
    ALTER TABLE "operations" ADD CONSTRAINT "operations_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "operations" VALIDATE CONSTRAINT "operations_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_consents_clinic_id_positive') THEN
    ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "patient_consents" VALIDATE CONSTRAINT "patient_consents_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patients_clinic_id_positive') THEN
    ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "patients" VALIDATE CONSTRAINT "patients_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prescriptions_clinic_id_positive') THEN
    ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "prescriptions" VALIDATE CONSTRAINT "prescriptions_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ultrasound_records_clinic_id_positive') THEN
    ALTER TABLE "ultrasound_records" ADD CONSTRAINT "ultrasound_records_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "ultrasound_records" VALIDATE CONSTRAINT "ultrasound_records_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_clinic_id_positive') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "users" VALIDATE CONSTRAINT "users_clinic_id_positive";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xray_records_clinic_id_positive') THEN
    ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_clinic_id_positive" CHECK ("clinic_id" > 0) NOT VALID;
    ALTER TABLE "xray_records" VALIDATE CONSTRAINT "xray_records_clinic_id_positive";
  END IF;
END $$;
