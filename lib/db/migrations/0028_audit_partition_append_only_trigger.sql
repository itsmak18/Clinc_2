-- Migration 0028: keep audit_logs partitions append-only AUTOMATICALLY (F-P4-3 op follow-up).
--
-- Migration 0026 revoked UPDATE/DELETE on audit_logs + its existing partitions from
-- medicore_app. But migration 0020's `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
-- ... UPDATE, DELETE ON TABLES TO medicore_app` re-grants those on ANY table the owner
-- creates later — including a newly-created audit_logs monthly partition. So every
-- future partition silently became writable/deletable by the runtime role, re-opening
-- the audit-tampering hole 0026 closed. Previously this was guarded only by a RUNBOOK
-- note ("re-run the REVOKE on the new partition") — a one-time, human-dependent fix.
--
-- This makes it self-healing: a `ddl_command_end` event trigger detects any newly
-- created partition whose parent is `audit_logs` and immediately REVOKEs UPDATE/DELETE
-- from medicore_app — regardless of how the partition was created (migration, helper,
-- or manual psql). The function is a strict no-op for every other CREATE TABLE, and a
-- no-op when the medicore_app role does not exist (e.g. dev clusters without 0020).
--
-- SECURITY DEFINER so the REVOKE always runs with the function owner's (the bootstrap
-- superuser's) privileges, independent of who issued the DDL. Event triggers require
-- superuser to create; migrations run as the bootstrap superuser.

CREATE OR REPLACE FUNCTION audit_partition_append_only()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $fn$
DECLARE
  obj record;
BEGIN
  -- Nothing to enforce if the runtime role is absent.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medicore_app') THEN
    RETURN;
  END IF;

  FOR obj IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag = 'CREATE TABLE'
  LOOP
    -- Act only when the new relation is a partition whose parent is audit_logs.
    IF EXISTS (
      SELECT 1
      FROM pg_inherits i
      JOIN pg_class p ON p.oid = i.inhparent
      WHERE i.inhrelid = obj.objid
        AND p.relname = 'audit_logs'
    ) THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON %s FROM medicore_app', obj.object_identity);
      RAISE NOTICE 'audit_partition_append_only: revoked UPDATE/DELETE on % from medicore_app', obj.object_identity;
    END IF;
  END LOOP;
END;
$fn$;

DROP EVENT TRIGGER IF EXISTS audit_partition_append_only_trg;
CREATE EVENT TRIGGER audit_partition_append_only_trg
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION audit_partition_append_only();

-- Backstop: re-assert the revoke on all CURRENT audit_logs partitions. Idempotent;
-- covers any partition that may have been added between 0026 and now without the revoke.
DO $bk$
DECLARE part text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medicore_app') THEN
    FOR part IN
      SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      WHERE p.relname = 'audit_logs'
    LOOP
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM medicore_app', part);
    END LOOP;
  END IF;
END;
$bk$;
