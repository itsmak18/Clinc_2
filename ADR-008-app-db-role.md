# ADR-008: medicore_app DB Role — Owner Runs Migrations, App Runs As Non-Superuser

**Date:** 2026-06-02
**Status:** Accepted
**Deciders:** Mike (lead), Rose (AI)

---

## Context

Migration 0015 enables Row Level Security (RLS) on all 20 clinic-bearing tables with
`FORCE ROW LEVEL SECURITY`. The `tenant_isolation` policy activates inside
`runInTenantContext()` via `SET LOCAL app.rls_enforce='on'`.

However, `FORCE ROW LEVEL SECURITY` does NOT override Postgres superusers and roles with
`BYPASSRLS` — those bypass RLS unconditionally regardless of any `FORCE` directive.

`docker-compose.prod.yml` was connecting the api and worker containers as
`${POSTGRES_USER}`, the bootstrap role the official `postgres:16-alpine` image creates.
That role is a **superuser**. Result: in production, all RLS policies were inert.
Cross-tenant isolation rested only on hand-written `eq(table.clinicId, …)` filters —
a single-point-of-failure for PHI once a second clinic onboards.

This was finding **F-01** (HIGH, confidence 0.8) from the 2026-06-01 principal audit.

---

## Decision

**Owner/superuser runs migrations; app/worker run as a non-superuser role.**

1. **Migration 0020** creates `medicore_app` as `NOSUPERUSER NOBYPASSRLS NOCREATEDB
   NOCREATEROLE` and grants it `SELECT, INSERT, UPDATE, DELETE` on all current and
   future tables in the public schema.

2. **The migrate container** (which retains the bootstrap superuser URL) sets the
   `medicore_app` password from `./secrets/app_db_password` via `ALTER ROLE` after
   db:migrate completes. It then runs a pre-cutover smoke gate: connects as
   `medicore_app` and queries `pg_roles` to assert `rolsuper=false, rolbypassrls=false`
   and `SELECT 1 FROM patients LIMIT 1` to assert GRANT SELECT was applied. A failing
   smoke gate prevents api/worker from starting.

3. **The api and worker containers** switch their `DATABASE_URL` from
   `${POSTGRES_USER}:postgres_password` to `medicore_app:app_db_password`.

4. **Services that legitimately bypass tenant context** (pre-auth paths, non-tenant
   tables with no `clinicId` column) import `dbUnsafe` (an alias of `db`) instead of
   `db`. Each import carries a one-line justification comment. The ESLint rule in
   `eslint.config.mjs` blocks bare `db` imports in `src/services/**` and enforces this
   pattern going forward.

5. **The integration-db test harness** (`_helpers/realDb.ts`) mirrors this setup:
   applies migrations as the bootstrap superuser, creates `medicore_app` with the same
   grants, then switches `process.env.DATABASE_URL` to the `medicore_app` URI before
   `@workspace/db` is dynamically imported. This makes the RLS tenant-isolation tests
   meaningful — the STEP-0 PROBE assertion `rolsuper || rolbypassrls === false` now
   passes and guards against regression.

---

## Consequences

### Positive
- RLS now enforces in production for all service paths wrapped in `runInTenantContext`.
- The integration-db test suite proves prod safety, not just that RLS syntax is valid.
- The pre-cutover smoke gate in the migrate container provides a deployment safety net:
  a wrong GRANT fails fast at compose-up rather than causing a crash-loop in api.
- The ESLint guard prevents the hole from silently re-opening via a new service.

### Negative / Constraints
- Service paths that use `dbUnsafe` are still non-tenant-scoped. They rely on
  hand-written `eq(clinicId)` filters and doctor-scope helpers for isolation.
  This is acceptable for pre-auth paths and tables without `clinicId`.
- The `schedule.service.ts` uses `dbUnsafe` because `doctor_schedules` and
  `schedule_overrides` have no `clinicId` column. A follow-up PR should add
  `clinicId` to those tables and migrate the service to `runInTenantContext`.
- Rolling back past migration 0020 orphans the `medicore_app` grants. Document in
  RUNBOOK §10: rolling back requires `REVOKE ... FROM medicore_app` or restoring from
  backup before re-running 0020.

---

## Alternatives Considered

**Keep POSTGRES_USER, add BYPASSRLS=false via ALTER ROLE**: The bootstrap role is
created by the postgres image and is always a superuser. We cannot alter it to
NOSUPERUSER without breaking the DB's ability to manage itself.

**Use SET ROLE inside runInTenantContext**: Possible but would need the bootstrap role
to own all tables and switch to a limited role per transaction. The ownership split
(owner runs DDL, non-owner runs DML) is cleaner and standard practice.

**PgBouncer role mapping**: Can restrict at the connection pooler level but does not
help when the DB itself runs psql as the bootstrap role for other operations.

---

## Related

- Migration `0015_enable_rls.sql` — RLS policies
- Migration `0017_doctor_scope_rls.sql` — doctor-scope RESTRICTIVE policy
- Migration `0020_create_app_role.sql` — creates medicore_app
- `lib/db/src/tenant-context.ts` — `runInTenantContext` implementation
- `lib/db/src/index.ts` — `dbUnsafe` export
- `artifacts/api-server/eslint.config.mjs` — lint guard
- RUNBOOK §0 — DB role overview and rotation
- ADR-007 — jti replay defense (companion security control)
