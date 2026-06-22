-- Migration 0038: imaging_attachments table + imaging status rename.
--
-- NOTE (hand-corrected SQL, see CLAUDE.md "Never write a DB migration manually"
-- exception): drizzle-kit generated a DESTRUCTIVE enum change for the status
-- rename (ALTER COLUMN … TYPE text → DROP TYPE → CREATE TYPE → re-cast). That
-- re-cast fails on any DB holding existing 'pending'/'uploaded'/'reviewed' rows
-- because those labels are absent from the new enum. Postgres expresses an
-- in-place rename with `ALTER TYPE … RENAME VALUE`, which drizzle-kit cannot
-- emit — so the generated SQL body is replaced below with RENAME VALUE
-- statements (rows + column defaults migrate transparently). The drizzle-
-- produced meta snapshot (0038_snapshot.json) already records the final enum
-- values and is left untouched so future diffs stay clean.

CREATE TABLE "imaging_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" integer NOT NULL,
	"modality" text NOT NULL,
	"record_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"uploaded_by_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"enc_kid" text,
	"enc_iv" text,
	"enc_tag" text,
	"caption" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Imaging status rename (in place — preserves existing rows + column defaults).
ALTER TYPE "public"."xray_status" RENAME VALUE 'pending' TO 'requested';--> statement-breakpoint
ALTER TYPE "public"."xray_status" RENAME VALUE 'uploaded' TO 'in_progress';--> statement-breakpoint
ALTER TYPE "public"."xray_status" RENAME VALUE 'reviewed' TO 'completed';--> statement-breakpoint
ALTER TYPE "public"."ultrasound_status" RENAME VALUE 'pending' TO 'requested';--> statement-breakpoint
ALTER TYPE "public"."ultrasound_status" RENAME VALUE 'uploaded' TO 'in_progress';--> statement-breakpoint
ALTER TYPE "public"."ultrasound_status" RENAME VALUE 'reviewed' TO 'completed';--> statement-breakpoint
ALTER TABLE "imaging_attachments" ADD CONSTRAINT "imaging_attachments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_attachments" ADD CONSTRAINT "imaging_attachments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_attachments" ADD CONSTRAINT "imaging_attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imaging_attach_clinic_idx" ON "imaging_attachments" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "imaging_attach_record_idx" ON "imaging_attachments" USING btree ("clinic_id","modality","record_id");--> statement-breakpoint
CREATE INDEX "imaging_attach_patient_idx" ON "imaging_attachments" USING btree ("clinic_id","patient_id");--> statement-breakpoint
-- Multi-tenant DB backstop: clinic_id sanity check (mirrors migration 0014).
ALTER TABLE "imaging_attachments" ADD CONSTRAINT "imaging_attachments_clinic_id_check" CHECK ("clinic_id" > 0);--> statement-breakpoint
-- Dormant-by-default tenant_isolation RLS policy (mirrors migration 0015).
ALTER TABLE "imaging_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "imaging_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "imaging_attachments";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "imaging_attachments"
	AS PERMISSIVE FOR ALL
	USING (
		coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
		OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
	)
	WITH CHECK (
		coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
		OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
	);--> statement-breakpoint
-- Runtime DML grant for the medicore_app role (default privileges from 0020 also
-- cover this; explicit + guarded for environments that grant before the role).
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medicore_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "imaging_attachments" TO medicore_app;
	END IF;
END $$;
