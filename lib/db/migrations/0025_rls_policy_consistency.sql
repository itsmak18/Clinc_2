-- Migration 0025: RLS policy consistency (audit findings F-P1-2 + F-P1-3).
--
-- Two clinic-bearing tables deviated from the dormant-by-default tenant_isolation
-- standard established by migration 0015. This migration brings both into line so
-- that EVERY clinic-bearing table uses the identical, well-tested policy shape:
--
--   USING / WITH CHECK (
--     coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'   -- dormant outside runInTenantContext
--     OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
--   )
--
-- The dormant gate keeps backward-compatible bare-`db`/`dbUnsafe` access working
-- (returns rows, app-layer eq(clinicId) filter still applies) while enforcing
-- isolation inside `runInTenantContext`. The `nullif(..., '')` guard prevents an
-- empty-string GUC from crashing the cast (`''::int`).
--
-- ── F-P1-2: doctor_schedules / schedule_overrides ────────────────────────────
-- Migration 0022 enabled FORCE RLS on these two tables but wrote a STRICT,
-- non-dormant policy (`clinic_id = current_setting('app.clinic_id', true)::integer`)
-- with no dormant gate, no nullif guard, and no WITH CHECK — despite a comment
-- claiming parity with 0015. That strict policy returned ZERO rows to any reader
-- outside a tenant context (the F-P1-1 booking break) and would throw on an empty
-- GUC. We replace it with the dormant standard. RLS stays ENABLED + FORCED
-- (set by 0022); we only swap the policy expression.
--
-- ── F-P1-3: clinic_invoice_counters ──────────────────────────────────────────
-- Migration 0023 created this per-clinic counter table (clinic_id PK) and granted
-- medicore_app DML, but never enabled RLS, added no policy, and no CHECK > 0 —
-- the only clinic-bearing table without the 0014+0015 backstop. (It was created
-- precisely to fix a cross-tenant leak — the global invoice_seq.) We add the
-- DORMANT policy here, NOT a strict one: billing.service.generateInvoiceNumber
-- reads/writes the counter via bare `db` (dbUnsafe), so a strict policy would
-- break invoice numbering exactly the way F-P1-1 broke booking. CHECK (clinic_id
-- > 0) matches migration 0014's constraint on every other clinic table.

-- ── F-P1-2 ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY['doctor_schedules', 'schedule_overrides'];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        AS PERMISSIVE
        FOR ALL
        USING (
          coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
          OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
        )
        WITH CHECK (
          coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
          OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
        )
    $p$, tbl);
  END LOOP;
END $$;

-- ── F-P1-3 ───────────────────────────────────────────────────────────────────
-- CHECK constraint (idempotent: skip if it already exists).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinic_invoice_counters_clinic_id_check'
  ) THEN
    ALTER TABLE "clinic_invoice_counters"
      ADD CONSTRAINT "clinic_invoice_counters_clinic_id_check" CHECK (clinic_id > 0);
  END IF;
END $$;

ALTER TABLE "clinic_invoice_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinic_invoice_counters" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "clinic_invoice_counters";
CREATE POLICY tenant_isolation ON "clinic_invoice_counters"
  AS PERMISSIVE
  FOR ALL
  USING (
    coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
    OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
  )
  WITH CHECK (
    coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
    OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
  );
