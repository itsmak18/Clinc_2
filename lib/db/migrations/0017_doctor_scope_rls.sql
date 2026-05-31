-- Migration 0017: Row Level Security for doctor scope.
--
-- Phase 2.3 of the 2026-05-30 remediation roadmap. Extends the dormant-by-
-- default RLS pattern (0015) to enforce the doctor-scope rule at the DB layer.
--
-- Today, doctor scope is enforced only by `assertPatientInScope()` in
-- scope.ts: a doctor's request for a patient outside their `doctor_patients`
-- materialized table throws ForbiddenError. That guarantee depends on every
-- service that touches PHI calling the assert at the right moment.
--
-- This migration adds a second policy `doctor_scope` to the five PHI tables
-- that are explicitly doctor-bounded by the CLAUDE.md doctor-scope rule:
--   medical_records, prescriptions, lab_tests, xray_records, ultrasound_records.
--
-- Policy expression (per table):
--   USING (
--     coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'   -- dormant when context absent
--     OR current_setting('app.role', true) IS DISTINCT FROM 'doctor'      -- non-doctors bypass
--     OR EXISTS (
--       SELECT 1 FROM doctor_patients dp
--       WHERE dp.doctor_id = nullif(current_setting('app.user_id', true), '')::int
--         AND dp.patient_id = <this_table>.patient_id
--     )
--   )
--
-- The tenant_isolation policy (from 0015) applies AND-wise with this one, so a
-- row must satisfy both clinic isolation AND (when applicable) doctor scope.
-- super_admin / admin / nurse / front_desk etc. bypass the doctor clause via
-- the role check and rely on tenant_isolation alone.
--
-- WITH CHECK: applied to INSERT and UPDATE so a doctor cannot fabricate a
-- record for a patient outside their scope.

DO $$
DECLARE
  tbl text;
  -- The five PHI tables that are doctor-bounded per CLAUDE.md "Doctor Scope Rule".
  tables text[] := ARRAY[
    'medical_records', 'prescriptions', 'lab_tests',
    'xray_records', 'ultrasound_records'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS doctor_scope ON %I', tbl);

    -- The two RLS policies on these tables are PERMISSIVE — Postgres takes the
    -- OR of permissive policies for a given command. We want AND semantics
    -- (must pass BOTH tenant_isolation and doctor_scope). Two approaches:
    --   (a) make one of them RESTRICTIVE, or
    --   (b) collapse both rules into a single permissive policy.
    -- We chose (a): mark doctor_scope as RESTRICTIVE so it intersects with the
    -- existing permissive tenant_isolation, producing the AND we want.
    EXECUTE format($p$
      CREATE POLICY doctor_scope ON %I
        AS RESTRICTIVE
        FOR ALL
        USING (
          coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
          OR current_setting('app.role', true) IS DISTINCT FROM 'doctor'
          OR EXISTS (
            SELECT 1 FROM doctor_patients dp
            WHERE dp.doctor_id = nullif(current_setting('app.user_id', true), '')::int
              AND dp.patient_id = %I.patient_id
          )
        )
        WITH CHECK (
          coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
          OR current_setting('app.role', true) IS DISTINCT FROM 'doctor'
          OR EXISTS (
            SELECT 1 FROM doctor_patients dp
            WHERE dp.doctor_id = nullif(current_setting('app.user_id', true), '')::int
              AND dp.patient_id = %I.patient_id
          )
        )
    $p$, tbl, tbl, tbl);
  END LOOP;
END $$;
