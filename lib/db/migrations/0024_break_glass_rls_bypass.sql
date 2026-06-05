-- Migration 0024: break-glass READ bypass for the doctor_scope RLS policy.
--
-- Audit finding F-P2-1: break-glass emergency access (break_glass_sessions +
-- the scope.ts override) granted access at the application layer, but migration
-- 0017's RESTRICTIVE `doctor_scope` policy still required `doctor_patients`
-- membership at the DB layer. Inside `runInTenantContext` as role='doctor', the
-- five doctor-bound clinical tables therefore returned ZERO rows for a patient
-- the doctor had broken glass on — so emergency access surfaced demographics but
-- no diagnosis / medications / labs / imaging. The control was non-functional
-- for its HIPAA §164.312(a)(2)(ii) purpose.
--
-- Fix: add a patient-scoped READ bypass to the USING clause. When
-- `app.break_glass_patient_ids` (a CSV of patient IDs the acting doctor holds an
-- active, audited break-glass session for — set by runInTenantContext only after
-- break-glass.service confirms a live session) contains the row's patient_id,
-- doctor_scope permits the row. This is least-privilege: the bypass is scoped to
-- exactly the break-glass patient(s), not "doctor_scope off".
--
-- WITH CHECK is intentionally NOT relaxed: break-glass is read-only. A doctor
-- cannot INSERT/UPDATE rows for a non-scoped patient under break-glass. (Current
-- write paths use dbUnsafe/dormant-RLS anyway; this keeps the DB backstop strict
-- for any future tenant-context writes.)
--
-- Mirrors the 0017 policy text exactly, plus the break-glass OR clause. The
-- tenant_isolation policy (0015) still applies AND-wise, so the clinic boundary
-- is unaffected. Idempotent (DROP POLICY IF EXISTS + recreate).

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'medical_records', 'prescriptions', 'lab_tests',
    'xray_records', 'ultrasound_records'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS doctor_scope ON %I', tbl);

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
          OR %I.patient_id = ANY (
            string_to_array(
              nullif(current_setting('app.break_glass_patient_ids', true), ''), ','
            )::int[]
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
    $p$, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;
