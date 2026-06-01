-- Migration 0021: Partition audit_logs by month (RANGE on created_at).
--
-- Why now: the table is small (weeks old); the same conversion on a multi-GB
-- 7-year table would require a multi-hour maintenance window. Converting today
-- costs milliseconds and future-proofs the HIPAA 7-year retention requirement.
-- Decision rationale and trade-offs: ADR-009-audit-partitioning.md.
--
-- Design:
--   - Partition key: created_at (TIMESTAMP RANGE)
--   - PK: composite (id, created_at) — Postgres requires the partition column
--     in every UNIQUE/PRIMARY KEY constraint on a partitioned table.
--   - id remains auto-incrementing via a serial sequence; values are globally
--     unique across all partitions (one shared sequence on the parent).
--   - Pre-created monthly partitions: 2026-01 through 2036-12 (132 partitions)
--     covers the 7-year retention horizon + headroom. A DEFAULT partition
--     catches any out-of-range inserts so the table never errors.
--   - Runtime DDL constraint: medicore_app is NOSUPERUSER with DML-only grants
--     and cannot CREATE TABLE at runtime. All partitions are pre-created here
--     (run by the bootstrap owner via the migrate container). The worker only
--     monitors headroom and alerts when it drops below threshold.
--
-- Cutover procedure (documented here; runs inside a single migration txn so
-- api/worker are not up yet — migrate container runs before they start):
--   1. Create partitioned replacement table audit_logs_part.
--   2. Create monthly partitions + DEFAULT partition.
--   3. Re-apply RLS (migration 0015), FORCE, and CHECK (migration 0014).
--   4. Re-apply medicore_app DML grants (grants don't follow a rename).
--   5. Copy all rows from audit_logs → audit_logs_part (preserving IDs).
--   6. Advance the sequence to MAX(id)+1 to avoid PK conflicts.
--   7. Rename: audit_logs → audit_logs_legacy, audit_logs_part → audit_logs.
--   8. Rename sequences for clarity.
--   9. Verify row counts match (fails the migration if there is any discrepancy).
--  10. Drop audit_logs_legacy (safe — row count verified in step 9).
--  11. ALTER ROLE medicore_app to set GUC defaults for pooling safety.
--
-- Idempotency: the partition creation loop skips partitions that already exist
-- (using IF NOT EXISTS). The full cutover (rename + drop legacy) is not
-- idempotent — re-running after a partial apply requires manual cleanup.
-- The journal entry guards against double-apply via drizzle's migration runner.

-- ── Step 1: Create the partitioned replacement table ──────────────────────────
-- SERIAL on a partitioned table auto-creates the sequence audit_logs_part_id_seq
-- on the parent. All partitions share this one sequence, so id values are
-- globally unique across every monthly shard.

CREATE TABLE audit_logs_part (
  id           SERIAL         NOT NULL,
  clinic_id    INTEGER        NOT NULL DEFAULT 1,
  user_id      INTEGER,
  action       TEXT           NOT NULL,
  entity_type  TEXT           NOT NULL,
  entity_id    TEXT,
  ip_address   TEXT           NOT NULL,
  user_agent   TEXT,
  details      JSONB,
  before_state JSONB,
  after_state  JSONB,
  request_id   TEXT,
  created_at   TIMESTAMP      NOT NULL DEFAULT now(),
  -- Composite PK: Postgres requires the partition column in every UNIQUE/PK.
  -- id still uniquely identifies rows; created_at is added only to satisfy
  -- the Postgres partitioning constraint.
  PRIMARY KEY (id, created_at),
  CONSTRAINT audit_logs_clinic_id_check     CHECK (clinic_id > 0),
  CONSTRAINT audit_logs_part_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id),
  CONSTRAINT audit_logs_part_user_id_fkey   FOREIGN KEY (user_id)   REFERENCES users(id)
) PARTITION BY RANGE (created_at);

-- ── Step 2: Create monthly partitions 2026-01 → 2036-12 + DEFAULT ─────────────

DO $$
DECLARE
  y              INT;
  m              INT;
  start_date     DATE;
  end_date       DATE;
  partition_name TEXT;
BEGIN
  FOR y IN 2026..2036 LOOP
    FOR m IN 1..12 LOOP
      start_date     := make_date(y, m, 1);
      end_date       := (start_date + INTERVAL '1 month')::DATE;
      partition_name := format('audit_logs_part_%s_%s', y, LPAD(m::text, 2, '0'));

      -- Skip if the partition already exists (idempotent on re-run after failure).
      IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = partition_name
      ) THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF audit_logs_part
             FOR VALUES FROM (%L) TO (%L)',
          partition_name, start_date::text, end_date::text
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- DEFAULT partition: catches any row whose created_at falls outside the explicit
-- range (before 2026-01-01 or after 2036-12-31). Never causes an INSERT error.
CREATE TABLE IF NOT EXISTS audit_logs_part_default PARTITION OF audit_logs_part DEFAULT;

-- ── Step 3: Recreate indexes on the parent (propagate to all partitions) ───────

CREATE INDEX IF NOT EXISTS audit_entity_idx_part
  ON audit_logs_part (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_entity_time_idx_part
  ON audit_logs_part (entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS audit_user_idx_part
  ON audit_logs_part (user_id, created_at);
CREATE INDEX IF NOT EXISTS audit_created_at_idx_part
  ON audit_logs_part (created_at);
CREATE INDEX IF NOT EXISTS audit_clinic_idx_part
  ON audit_logs_part (clinic_id);

-- ── Step 4: Re-apply RLS (migration 0015) + FORCE ────────────────────────────
-- RLS policies are NOT inherited by a new table even if the source table had
-- them. Each table that needs RLS must have it explicitly applied.

ALTER TABLE audit_logs_part ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs_part FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON audit_logs_part;
CREATE POLICY tenant_isolation ON audit_logs_part
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

-- ── Step 5: Grant medicore_app DML on the new table ──────────────────────────
-- Grants do NOT follow a table rename to a different relation — must be
-- explicitly re-applied after the rename. We grant here (before rename) and
-- again after (belt-and-braces).

GRANT SELECT, INSERT, UPDATE, DELETE ON audit_logs_part TO medicore_app;
-- Also covers all partition child tables created in step 2.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO medicore_app;

-- ── Step 6: Copy existing data from audit_logs → audit_logs_part ─────────────
-- Explicit column list ensures we don't accidentally miss a column.
-- Existing IDs are preserved (no serial auto-increment during this INSERT).

INSERT INTO audit_logs_part
  (id, clinic_id, user_id, action, entity_type, entity_id,
   ip_address, user_agent, details, before_state, after_state,
   request_id, created_at)
SELECT
  id, clinic_id, user_id, action, entity_type, entity_id,
  ip_address, user_agent, details, before_state, after_state,
  request_id, created_at
FROM audit_logs;

-- ── Step 7: Advance the sequence past the max copied id ──────────────────────
-- The INSERT above used explicit id values, bypassing the sequence. Without
-- this, the next INSERT would generate id=1 and hit a PK conflict.

DO $$
DECLARE max_id BIGINT;
BEGIN
  SELECT COALESCE(MAX(id), 0) INTO max_id FROM audit_logs_part;
  PERFORM setval(pg_get_serial_sequence('audit_logs_part', 'id'), max_id + 1, false);
END $$;

-- ── Step 8: Atomic rename (cutover) ──────────────────────────────────────────
-- Both renames happen in the same transaction as the surrounding migration —
-- no intermediate state is visible to concurrent readers (and there are none
-- because api/worker have not started yet; migrate runs first via depends_on).

ALTER TABLE audit_logs      RENAME TO audit_logs_legacy;
ALTER TABLE audit_logs_part RENAME TO audit_logs;

-- Rename sequences for clarity now that the tables have their final names.
-- The sequence names change but the OID-based DEFAULT expressions are unaffected.
ALTER SEQUENCE IF EXISTS audit_logs_id_seq      RENAME TO audit_logs_legacy_id_seq;
ALTER SEQUENCE IF EXISTS audit_logs_part_id_seq RENAME TO audit_logs_id_seq;

-- ── Step 9: Grant medicore_app on the renamed table ───────────────────────────
-- Belt-and-braces: grants on audit_logs_part before rename are now on the
-- NEW audit_logs. Explicit re-grant ensures correctness after rename.

GRANT SELECT, INSERT, UPDATE, DELETE ON audit_logs TO medicore_app;

-- ── Step 10: Verify row counts then drop the legacy table ─────────────────────

DO $$
DECLARE
  old_count BIGINT;
  new_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO old_count FROM audit_logs_legacy;
  SELECT COUNT(*) INTO new_count FROM audit_logs;
  IF old_count <> new_count THEN
    RAISE EXCEPTION
      'audit_logs partition cutover: row count mismatch — legacy=% new=%. '
      'Migration rolled back. Investigate before re-running.',
      old_count, new_count;
  END IF;
END $$;

DROP TABLE audit_logs_legacy;

-- ── Step 11: Set role-level GUC defaults for pooling safety ──────────────────
-- statement_timeout was previously a pool-client option (SET on connect).
-- Under PgBouncer transaction pooling a session-level SET leaks across
-- connection borrowers. Moving it to ALTER ROLE makes it a per-backend default
-- that RESET ALL restores — not an application-visible state.
--
-- idle_in_transaction_session_timeout: prevents a transaction from holding a
-- pool slot open indefinitely if the client stalls mid-txn.

ALTER ROLE medicore_app SET statement_timeout                 = '30000ms';
ALTER ROLE medicore_app SET idle_in_transaction_session_timeout = '60000ms';
