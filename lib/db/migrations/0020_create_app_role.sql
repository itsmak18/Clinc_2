-- Migration 0020: Create the medicore_app role for runtime DB connections.
--
-- Root cause this closes (F-01 from the 2026-06-01 principal audit):
--   docker-compose.prod.yml was connecting api/worker as ${POSTGRES_USER},
--   the bootstrap superuser the official postgres image creates. Postgres
--   superusers unconditionally bypass RLS (FORCE ROW LEVEL SECURITY included).
--   Migration 0015's carefully crafted tenant_isolation policies were therefore
--   inert in production — cross-tenant isolation rested only on hand-written
--   eq(table.clinicId, …) filters in service code.
--
-- Fix:
--   1. This migration creates medicore_app as NOSUPERUSER NOBYPASSRLS.
--   2. docker-compose.prod.yml (migrate service) sets the password from
--      ./secrets/app_db_password and runs a smoke test after db:migrate.
--   3. api/worker switch their DATABASE_URL to medicore_app.
--   4. Services that bypass runInTenantContext are audited (see
--      ADR-008-app-db-role.md); remaining raw-db callers use dbUnsafe.
--
-- Ownership split after this migration:
--   ${POSTGRES_USER} (bootstrap superuser) → runs migrations (DDL rights)
--   medicore_app (NOSUPERUSER NOBYPASSRLS) → api + worker runtime (DML; RLS enforced)
--
-- Password: NOT set here. Set by the migrate container after migrations complete:
--   ALTER ROLE medicore_app LOGIN PASSWORD '$(cat /run/secrets/app_db_password)';
-- This keeps credentials out of committed SQL and the migration journal.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medicore_app') THEN
    CREATE ROLE medicore_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO medicore_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO medicore_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medicore_app;

-- Ensures future tables created by the bootstrap owner are also accessible.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO medicore_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO medicore_app;
