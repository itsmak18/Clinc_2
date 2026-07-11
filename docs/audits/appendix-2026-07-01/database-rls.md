# Appendix B — Database & RLS

**Audit date:** 2026-07-01 | **Branch:** security/search-doctor-scope

## AUD-DB-PGB Candidate: All 4 Code-Level Points VERIFIED

| Req | Status | Evidence |
|-----|--------|----------|
| (a) BEGIN…COMMIT wraps runInTenantContext | ✅ PASS | `tenant-context.ts:82` uses `db.transaction()` |
| (b) SET LOCAL, not session SET | ✅ PASS | `tenant-context.ts:91-94` uses `set_config(..., true)` (LOCAL) |
| (c) RLS fails closed when GUC absent | ✅ PASS | migration 0015:92 `nullif(...,'')::int` → NULL → no rows |
| (d) No session-level GUCs; DISCARD ALL confirmed | ✅ PASS | `pgbouncer.ini:47`; zero session-level SET in codebase |
| (e) Pooled connection cross-tenant runtime proof | ⚠️ PARTIAL | Code correct; no dedicated load test stressing connection reuse |

**Point (e) mandatory caveat:** Points (a)-(d) prove SET LOCAL is used correctly and the pool resets. They do NOT prove the negative end-to-end runtime case. This is reported as "consistent-with-fine on inspection" only — not "proven fine."

## Findings

### AUD-DB-01 through AUD-DB-04 — RLS/PgBouncer Mechanics: PASS
All four code-level correctness points verified. See table above.

### AUD-DB-05 — Runtime Cross-Tenant Isolation (PARTIAL)
**Severity:** Critical (requires runtime validation) | **Confidence:** M  
Code is correct. Dedicated test cycling two tenant contexts through the same PgBouncer connection does not exist. Existing integration tests verify RLS within single-tenant contexts but do not stress pool reuse. See AUD-SEAM-05 for test design.

### AUD-DB-06 — Appointment CAS: PASS
**Severity:** Info  
`appointments.service.ts:351-363` — UPDATE WHERE includes current `status`; 0 rows returned on concurrent change → 409 ConflictError. Applied to all three transition paths (cancel, checkin, transition). Memory claim "P0 CAS fixed" confirmed.

### AUD-DB-07 — Audit Append-Only: PASS
**Severity:** Info  
Migration 0026 REVOKEs UPDATE+DELETE on `audit_logs` from `medicore_app`. Migration 0028 event trigger auto-revokes on new partitions (prevents migration 0020 DEFAULT PRIVILEGES re-grant). Integration test `audit-append-only.integration-db.test.ts` gates this.

### AUD-DB-08 — Audit Integrity Daily Verification: PASS
**Severity:** Info  
`cron.ts:153-180` — daily 02:00 UTC: records SHA-256 hash, then re-verifies last 7 days (`verifyRecentIntegrity`), then walks prevHash chain (`verifyChainLinkage`). Mismatch → `audit_integrity_check_failures_total` metric + `AuditIntegrityMismatch` alert.

### AUD-DB-09 — Foreign Key Coverage: PASS
All clinic-bearing tables FK to `clinics`. New tables in 0034/0035 follow same pattern.

### AUD-DB-10 — CHECK Constraints: PASS
Migration 0014 adds `CHECK (clinic_id > 0)` to 19 tables. Migration 0027 dropped all `clinic_id DEFAULT 1` — missing clinicId now fails with NOT NULL violation, not silent mislabel.

### AUD-DB-11 — Migration Safety (0025–0039): PASS
No DROP TABLE, TRUNCATE, or bulk DELETE. All changes additive or metadata-only (REVOKE, ALTER ADD COLUMN, DROP DEFAULT).

### AUD-DB-12 — Break-Glass RLS Bypass (Read-Only): PASS
Migration 0024 adds break-glass bypass to USING clause only (reads). WITH CHECK clause unchanged — writes still blocked. Integration test `doctor-scope-rls.integration-db.test.ts:161-185` verifies read-permit + write-block.

### AUD-DB-13 — Break-Glass Session Validation: PASS
`break-glass.service.ts:39-102` wraps queries in `runInTenantContext`. Checks: not revoked, approved + not expired (or within grace). Exact (clinicId, userId, patientId) match.

### AUD-DB-14 — Input Validation Before Transaction: PASS
`tenant-context.ts:67-80` validates clinicId > 0, userId integer, role string before opening transaction. Throws clearly on invalid input.

### AUD-DB-16 — Doctor Scope Materialization: PASS
`doctor_patients` upserted on every appointment create/update. Cache invalidated (`invalidateDoctorScope`) on every mutation. Redis cache TTL=60s.

## Summary

All DB/RLS controls verified at code level. Single partial finding (AUD-DB-05) requires a runtime test to fully close. All other critical safety properties — tenant isolation, audit append-only, CAS on status writes, integrity verification — are correctly implemented and tested.
