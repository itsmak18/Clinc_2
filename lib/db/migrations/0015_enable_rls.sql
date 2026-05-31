-- Migration 0015: Row Level Security as a DB-enforced tenant boundary.
--
-- Second of two Phase 2 changes from the 2026-05-30 board-review roadmap.
-- 0014 added CHECK (clinic_id > 0); this enables RLS on every clinic-bearing
-- table so a forgotten `eq(table.clinicId, …)` filter in service code returns
-- zero rows instead of leaking cross-tenant PHI.
--
-- Rollout model (DORMANT-BY-DEFAULT):
--   The `tenant_isolation` policy is gated by `current_setting('app.rls_enforce', true)`.
--   Outside an explicit tenant context (default state), `app.rls_enforce` is unset
--   → the policy returns TRUE → all rows visible (same as today, no behaviour change).
--
--   Inside `runInTenantContext(user, fn)` (lib/db/src/tenant-context.ts), we run:
--     BEGIN;
--     SET LOCAL app.rls_enforce = 'on';
--     SET LOCAL app.clinic_id   = <user.clinicId>;
--     SET LOCAL app.user_id     = <user.userId>;
--     SET LOCAL app.role        = '<user.role>';
--     -- service code here, queries are tenant-scoped by the DB
--     COMMIT;
--
--   With `app.rls_enforce = 'on'`, the policy enforces
--     clinic_id = current_setting('app.clinic_id')::int.
--
-- Why DB-enforced when the app already filters: defense in depth. Today the
-- only thing preventing cross-tenant PHI leakage is hand-written `eq(...,
-- clinicId)` in service code. Phase 0 closed three active leaks
-- (dashboard.service.ts / erasure.service.ts / audit.service.ts had no clinic
-- filter at all) — the next regression would not be caught by mocks. RLS
-- ensures the DB itself refuses the rows even if a service forgets.
--
-- The cross-tenant integration test in tests/cross-tenant.integration-db.test.ts
-- (Phase 1) verifies the app-layer filters today; the new RLS integration test
-- in tests/rls-tenant-context.integration-db.test.ts proves the DB-layer
-- backstop also works inside a tenant context.
--
-- Service rollout (Phase 2.1+): each service file converts from
--   `db.select().from(t).where(...)`
-- to
--   `runInTenantContext(req.user, async (tx) => tx.select().from(t).where(...))`.
-- Once every read+write goes through runInTenantContext, the existing
-- `eq(t.clinicId, req.user!.clinicId)` filters become belt-and-braces and can
-- be removed in a follow-up. Until then the two layers coexist safely.
--
-- Safety:
--   - Postgres superusers/owners bypass RLS by default. In production we will
--     create a non-superuser `medicore_app` role (Phase 2.2 / RUNBOOK) that the
--     API connects as. For dev + tests, the connecting user is the table owner
--     so RLS is bypassed UNLESS the policy is FORCED via `FORCE ROW LEVEL
--     SECURITY`. We FORCE it so the dev/test path matches prod behavior.
--   - The migration is idempotent via `IF NOT EXISTS` / `IF EXISTS` checks.

-- ── Helper: idempotent policy creation ───────────────────────────────────────
-- We write the policy expression once and apply it via a DO block. The USING
-- clause permits the row when EITHER:
--   (a) `app.rls_enforce` is unset or not 'on' (dormant — backward compatible)
--   (b) the row's clinic_id matches the requesting tenant's clinic_id
-- This is the rollout switch: until services start calling runInTenantContext,
-- queries see (a) and behave unchanged. Once a service is wrapped, queries see
-- (b) and the DB enforces isolation.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'appointments', 'audit_logs', 'audit_outbox', 'break_glass_sessions',
    'clinic_notices', 'doctor_patients', 'erasure_requests', 'inventory',
    'invoice_items', 'invoices', 'lab_tests', 'medical_records',
    'notifications', 'operations', 'patient_consents', 'patients',
    'prescriptions', 'ultrasound_records', 'users', 'xray_records'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Enable RLS on the table (idempotent — re-enabling is a no-op).
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    -- FORCE applies the policy to the table owner too (matches prod where the
    -- app role is non-owner). Without FORCE, table owners bypass RLS, which
    -- would make the dev/test path divergent from prod.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

    -- Drop the policy if it already exists so the migration is re-runnable
    -- and the expression below is the source of truth.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);

    -- Create the dormant-by-default tenant_isolation policy.
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
