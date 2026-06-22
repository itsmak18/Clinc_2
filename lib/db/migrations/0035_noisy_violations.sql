ALTER TABLE "services_catalog" ADD COLUMN "clinic_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "services_catalog" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "services_catalog" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "services_catalog" ADD CONSTRAINT "services_catalog_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_catalog_clinic_idx" ON "services_catalog" USING btree ("clinic_id");--> statement-breakpoint

-- ── Tenant isolation (services_catalog was global before; now clinic-scoped) ──
-- It was NOT in the 0015 RLS set (it had no clinic_id). Apply the 0014 CHECK +
-- 0015 dormant tenant_isolation policy + 0020 medicore_app grant now.
ALTER TABLE "services_catalog" ADD CONSTRAINT "services_catalog_clinic_id_check" CHECK ("clinic_id" > 0);--> statement-breakpoint
ALTER TABLE "services_catalog" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "services_catalog" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "services_catalog";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "services_catalog"
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "services_catalog" TO medicore_app;
  END IF;
END $$;