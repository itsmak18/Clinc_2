CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'transfer', 'adjustment');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"received_by_id" integer NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"external_ref" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_id_users_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_clinic_idx" ON "payments" USING btree ("clinic_id");--> statement-breakpoint

-- ── Hand-added: RLS, integrity constraints, append-only grants ────────────────
-- drizzle-kit does not emit RLS policies or grants; these mirror the established
-- patterns (tenant_isolation = migration 0015 dormant standard; append-only =
-- migration 0026 audit_logs).

-- CHECK (clinic_id > 0): matches every clinic-bearing table (migration 0014).
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinic_id_check" CHECK (clinic_id > 0);--> statement-breakpoint
-- A zero-amount payment is meaningless. Positive = received, negative = refund/adjustment.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_cents_nonzero_check" CHECK (amount_cents <> 0);--> statement-breakpoint

-- Dormant-by-default tenant_isolation (enforced only inside runInTenantContext).
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payments"
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

-- Append-only for the runtime role (mirrors audit_logs / migration 0026): the
-- payments ledger is the financial record of truth, so corrections are new
-- negative rows, never edits. medicore_app keeps SELECT + INSERT. Migration 0020's
-- ALTER DEFAULT PRIVILEGES grants UPDATE/DELETE on new tables to medicore_app, so
-- this revoke is required to close them. Guarded for dev clusters without the role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medicore_app') THEN
    GRANT SELECT, INSERT ON "payments" TO medicore_app;
    REVOKE UPDATE, DELETE ON "payments" FROM medicore_app;
  END IF;
END $$;