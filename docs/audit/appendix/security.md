# Appendix A — Security & Authentication

**Audit date:** 2026-07-01 | **Branch:** security/search-doctor-scope

## Summary
Security posture is **strong**. Auth kernel (`policy.ts`) correctly implements CSRF, fingerprint binding, revocation, RBAC, tenant isolation. `security/search-doctor-scope` branch closes a HIGH-severity doctor-scope gap in global search. No secrets found in git history (AUD-SEC-HIST: PASS).

## Key Findings

### AUD-SEC-01 — JWT Generation: PASS
EdDSA Ed25519 via jose. Tokens include `jti`, `fph`, per-clinic tz, role TTLs. Production enforces `fph`. `auth.ts:66-99`.

### AUD-SEC-02 — Token Verification: PASS
`jwtVerify()` with algorithm binding, 30s clock tolerance, expired-vs-invalid error discrimination. `policy.ts:51-67`.

### AUD-SEC-03 — Key Rotation (Low)
Manual only. `JWT_PREV_PUBLIC_KEY` overlap window supported. No automation. No key-age alert. Risk: compromise not detected until manual rotation. Recommendation: document quarterly rotation in RUNBOOK.

### AUD-SEC-04 — PHI Field Encryption: PASS
AES-256-GCM, 96-bit IV, 128-bit tag, kid versioning. Dev disables silently (by design); prod fails closed if key absent. `field-encryption.ts:34-107`.

### AUD-SEC-05 — Session Revocation: PASS
Bounded fail-open per ADR-010. `read` degrades within 30s grace; `write`/`privileged` always fail-closed. `policy.ts:193-220`.

### AUD-SEC-06 — Fingerprint Binding: PASS
SHA-256(UA+Accept-Language) checked every request. Grandfather window for deploys. Emergency bypass via `FINGERPRINT_BINDING=disabled`. Falsification: issue token Chrome → replay Firefox → verify 1004 rejection.

### AUD-SEC-07 — RBAC: PASS
`super_admin` bypasses all role checks (kernel-enforced, architectural invariant). All others require `allowedRoles` match. `policy.ts:260-266`.

### AUD-SEC-08 — Tenant Isolation: PASS
`SET LOCAL app.clinic_id` transaction-scoped, parameterized via `sql` template, validated >0 before tx. `dbUnsafe` callers are explicitly pre-auth. See AUD-SEAM-05 for runtime proof requirement.

### AUD-SEC-09 — Doctor Scope on Search: PASS (Branch Fix Verified)
`getDoctorListScope()` called at `search.service.ts:27`. `inArray(patientId, allowed)` on all 3 query branches. Break-glass IDs to `runInTenantContext`. Integration test `search-scope.integration-db.test.ts` gates with real Postgres.

### AUD-SEC-10 — Device Trust Phase 2: PASS (Dormant)
Flag-gated `PHASE2_DEVICE_TRUST_ENABLED`. Privileged roles blocked on new device pending email verification. Currently OFF — zero blast radius.

### AUD-SEC-11 — Rate Limiting: PASS
Two layers: DB-backed per-user+IP (5/15min → 30min lockout) + Redis/memory per-IP shield (20/15min). Atomic upsert prevents races. Login-shield adds 4KB Content-Length, Content-Type, empty-UA checks.

### AUD-SEC-12 — Password Hashing: PASS
bcrypt (rounds=12), timing-safe legacy HMAC-SHA256 migration. HIBP k-anonymity in strict mode (flag-OFF). `password.ts:23-59`.

### AUD-SEC-13 — CSRF: PASS
Double-submit with `timingSafeEqual`. Mutation methods + write/privileged scope only. Cookie cleared on logout. `policy.ts:141-161`.

### AUD-SEC-14 — Metrics Endpoint: PASS
Prod requires `METRICS_TOKEN`; missing → 404 (not 401); constant-time compare. `app.ts:111-129`.

### AUD-SEC-15 — JTI (ADR-007, Latent): PASS (deliberate)
JTI check exists for `privileged` scope. `markJtiUsed` never called in production. No window risk (see AUD-SEAM-02).

### AUD-SEC-16 — Git History Scan (AUD-SEC-HIST): PASS
`git log --all --full-history` over .env/secrets/backups paths → zero commits with real secrets or PHI. No history rewrite required.

### AUD-SEC-17 — Tenant Validation in Kernel: PASS
Tokens with missing, zero, or negative `clinicId` → `AUTH_TOKEN_INVALID`. `policy.ts:268-276`.

### AUD-SEC-18 — Config Centralization: PASS
All env reads through `config.ts`. One deliberate exception: `process.env.FINGERPRINT_BINDING` read directly for vitest env-mutation compatibility (documented).

### AUD-SEC-19 — Session TTLs: PASS
super_admin 15m, admin 1h, doctor/nurse/compliance 2h, billing/front_desk/xray/lab/pharmacist 4h. Consistent JWT TTL ↔ cookie maxAge.

### AUD-SEC-20 — Auth Decision Logging: PASS
All denials logged with request_id, error code, session state. Login events logged with IP+username. Success at DEBUG (optional improvement: lift to INFO for sec-ops visibility).

## Verified Security Controls

| Control | Status |
|---|---|
| EdDSA JWT + expiry | ✅ PASS |
| Fingerprint binding | ✅ PASS |
| RBAC (kernel) | ✅ PASS |
| Tenant isolation (RLS + app) | ✅ PASS |
| Doctor scope on search | ✅ PASS (branch fix verified) |
| PHI field encryption AES-256-GCM | ✅ PASS |
| CSRF timing-safe double-submit | ✅ PASS |
| Revocation bounded fail-open ADR-010 | ✅ PASS |
| Rate limiting (2 layers) | ✅ PASS |
| Bcrypt + timing-safe legacy | ✅ PASS |
| Metrics endpoint auth | ✅ PASS |
| Git history — no secrets/PHI | ✅ PASS |
| JWT key rotation | ⚠️ Manual only (Low) |
