CREATE TYPE "public"."inventory_txn_reason" AS ENUM('initial', 'restock', 'consumed', 'expired', 'adjustment');--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"delta" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reason" "inventory_txn_reason" NOT NULL,
	"note" text,
	"performed_by_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_item_id_inventory_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inv_txn_item_idx" ON "inventory_transactions" USING btree ("clinic_id","item_id","created_at");--> statement-breakpoint

-- ── Tenant isolation for the new clinic-bearing table ────────────────────────
-- Mirror the 0014 CHECK + 0015 dormant-by-default tenant_isolation policy +
-- 0020 medicore_app grants so this table behaves identically to every other
-- clinic-scoped table (RLS enforces inside runInTenantContext, dormant outside).
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_clinic_id_check" CHECK ("clinic_id" > 0);--> statement-breakpoint
ALTER TABLE "inventory_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "inventory_transactions";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inventory_transactions"
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_transactions" TO medicore_app;
  END IF;
END $$;