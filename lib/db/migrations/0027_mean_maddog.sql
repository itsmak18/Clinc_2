-- Migration 0027: drop the `clinic_id` DEFAULT 1 on every clinic-bearing table (F-P5-1 hardening).
--
-- Every clinic-bearing table declared `clinic_id integer NOT NULL DEFAULT 1`. The
-- default silently mislabeled any insert that omitted clinicId as clinic 1 — correct
-- by accident for the seed clinic, a cross-tenant data-integrity bug for any other
-- tenant (F-P5-1: invoice_items + notifications inserts had landed on clinic 1). The
-- Phase 5.1 audit fixed every call site to pass clinicId explicitly (incl. the auth
-- audit writes and the seed script); this migration removes the footgun at the schema
-- level so a future omission fails loudly (NOT NULL, SQLSTATE 23502) at write time
-- instead of mislabeling. The `clinic_id > 0` CHECK (0014) and NOT NULL remain.
--
-- DROP DEFAULT is metadata-only and idempotent (re-running is a no-op). audit_logs is
-- partitioned (0021): partition-routed inserts resolve the default from the parent, and
-- the app only ever inserts via the parent table, so dropping it on the parent suffices.
-- Tables that never had the default (doctor_schedules, schedule_overrides) and
-- clinic_invoice_counters (clinic_id is the PK) are intentionally not listed.
ALTER TABLE "users" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "medical_records" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "prescriptions" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "xray_records" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "lab_tests" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "operations" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "inventory" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invoice_items" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "patient_consents" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "erasure_requests" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "audit_outbox" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "doctor_patients" ALTER COLUMN "clinic_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "clinic_notices" ALTER COLUMN "clinic_id" DROP DEFAULT;