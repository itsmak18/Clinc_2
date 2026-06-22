CREATE TABLE "vitals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"appointment_id" integer,
	"recorded_by_id" integer NOT NULL,
	"vitals" jsonb,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vitals_patient_idx" ON "vitals" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "vitals_appointment_idx" ON "vitals" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "vitals_clinic_patient_created_idx" ON "vitals" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint

-- ── Tenant isolation for the new clinic-bearing table ────────────────────────
-- Mirror the 0014 CHECK + 0015 dormant-by-default tenant_isolation policy +
-- 0020 medicore_app grants so this table behaves identically to every other
-- clinic-scoped table (RLS enforces inside runInTenantContext, dormant outside).
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_clinic_id_check" CHECK ("clinic_id" > 0);--> statement-breakpoint
ALTER TABLE "vitals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vitals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "vitals";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "vitals"
  AS PERMISSIVE
  FOR ALL
  USING (
    coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
    OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
  )
  WITH CHECK (
    coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
    OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
  );--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medicore_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "vitals" TO medicore_app;
  END IF;
END $$;