-- Migration 0026: make audit_logs append-only at the grant layer (F-P4-3).
--
-- Migration 0020 (ALTER DEFAULT PRIVILEGES) and 0021 both granted
-- SELECT, INSERT, UPDATE, DELETE on audit_logs (+ partitions) to medicore_app.
-- The threat model (§1.3) requires audit_logs to be append-only with no DELETE
-- grants, and nothing in the app code path UPDATEs or DELETEs audit_logs:
--   - the outbox drain only INSERTs (lib/audit.ts)
--   - integrity recording/verification touch audit_integrity_checks, not audit_logs
-- A compromised API process holding DELETE on audit_logs could erase the audit
-- trail — and (pre-0026) that deletion would be detected only when the integrity
-- chain is re-verified. Revoke DELETE + UPDATE so the table is genuinely
-- append-only for the runtime role. medicore_app keeps SELECT + INSERT.
--
-- Partition maintenance (creating/detaching/dropping partitions) is DDL performed
-- by the bootstrap owner, not the app role, so removing DELETE does not affect it.

REVOKE UPDATE, DELETE ON audit_logs FROM medicore_app;

-- Revoke on every existing partition too (privileges on partitions are independent
-- of the parent for direct access).
DO $$
DECLARE
  part text;
BEGIN
  FOR part IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON c.oid = i.inhrelid
    JOIN pg_class p ON i.inhparent = p.oid
    WHERE p.relname = 'audit_logs'
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM medicore_app', part);
  END LOOP;
END $$;

-- NOTE (future partitions): migration 0020's ALTER DEFAULT PRIVILEGES grants
-- medicore_app INSERT/UPDATE/DELETE on tables created later by the owner, so a
-- newly-created audit_logs partition will re-acquire UPDATE/DELETE. When adding
-- partitions (per the AuditPartitionLow runbook step), re-run the REVOKE above on
-- the new partition. See RUNBOOK audit-partition procedure.
