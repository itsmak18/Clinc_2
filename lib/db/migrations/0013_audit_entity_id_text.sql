-- Migration: widen audit_logs.entity_id and audit_outbox.entity_id from integer to text.
--
-- Why: UUID v7 primary keys (introduced in 0012) cannot be stored as integers.
-- All existing integer entity_ids are preserved via USING entity_id::text ('12' → '12').
-- Postgres rebuilds the compound indexes on audit_logs automatically.
-- USING clause is safe even on empty tables or tables with NULLs.

ALTER TABLE "audit_logs"  ALTER COLUMN "entity_id" TYPE text USING "entity_id"::text;
ALTER TABLE "audit_outbox" ALTER COLUMN "entity_id" TYPE text USING "entity_id"::text;
