# Audit Findings — Phase 3: HIPAA Security Rule Control Verification

**Date:** 2026-06-04
**Baseline:** working tree over `main @ 7014f95` + Phase 1/2 fixes + break-glass (0024) + erasure fix.
**Rating bar:** stricter (D2 undecided → assume real PHI).

> Scope: each §164.312 sub-requirement is mapped to the actual implementation and assigned PASS / PARTIAL / FAIL.

---

## §164.312(a) — Access Control

| Requirement | Verdict | Evidence |
|---|---|---|
| **Unique user identification** | ✅ PASS | `users.id` serial PK + `users.username` (unique). JWT carries `userId` claim. Every audit entry tags `userId`. |
| **Emergency access procedure** | ✅ PASS | `break-glass.service.ts` — full lifecycle. Migration 0024 wires DB-layer bypass for 5 doctor-scoped tables. `BREAK_GLASS_ACCESS` audited per-access. Compliance officer SSE alerts. Self-approval forbidden. |
| **Automatic logoff** | ✅ PASS | Per-role JWT TTL in `auth-constants.ts`: super_admin=15m → front_desk=4h. Cookie `maxAge` mirrors. No refresh-token extension. |
| **Encryption at rest (field-level)** | ⚠️ PARTIAL | AES-256-GCM for `diagnosis`+`vitals` on `medical_records`. Other PHI columns (patient demographics, prescriptions, labs) are plaintext. LUKS + GPG backups are the primary at-rest defense. |
| **Role-based access** | ✅ PASS | `policy.ts` → `authGate(scope, roles)` on every route. 10 roles. `super_admin` cannot bypass tenancy. |
| **Multi-tenant isolation** | ✅ PASS | RLS on all 22 clinic-bearing tables. `medicore_app` (NOSUPERUSER NOBYPASSRLS). Phase 1 verified. |

---

## §164.312(b) — Audit Controls

| Requirement | Verdict | Evidence |
|---|---|---|
| **Record PHI access/modification** | ✅ PASS | Outbox pattern: `logAudit()` → `audit_outbox` → `drainAuditOutbox()` → `audit_logs`. 29 `CREATE/UPDATE/DELETE` call sites. System cron writes `SYSTEM_NO_SHOW`. |
| **Tamper-evident trail** | ✅ PASS | Daily SHA-256 hash chain (`audit-integrity.ts`). `AuditIntegrityMismatch` Prometheus counter on divergence. |
| **Retention policy** | ✅ PASS by design | Monthly cron reports on >7yr audit_logs. No auto-delete (ADR-005). HIPAA requires minimum retention, not maximum. |
| **Audit trail completeness** | ✅ PASS | Exhausted outbox rows persist (not discarded). `AuditLogPermanentLoss` alert fires. No silent data loss. |

---

## §164.312(c) — Integrity Controls

| Requirement | Verdict | Evidence |
|---|---|---|
| **PHI integrity mechanism** | ✅ PASS | AES-256-GCM auth tag (16 bytes). Bit-flip → `decipher.final()` throws. |
| **Transmission integrity** | ✅ PASS | Caddy TLS (auto Let's Encrypt). `secure:true`, `sameSite:strict`. HSTS. |
| **Audit integrity** | ✅ PASS | Hash-chain. |

---

## §164.312(d) — Person/Entity Authentication

| Requirement | Verdict | Evidence |
|---|---|---|
| **Authentication mechanism** | ✅ PASS | bcrypt (rounds=12), EdDSA JWT (pinned `algorithms:["EdDSA"]`), legacy HMAC auto-migration. |
| **Multi-factor / device trust** | ⚠️ PARTIAL | Architecture exists but gated behind `PHASE2_DEVICE_TRUST_ENABLED=false`. Must enable before real PHI. |
| **Account lockout** | ✅ PASS | 5 attempts / 15min, 30min lockout. Per-IP rate limiting. |

---

## §164.312(e) — Transmission Security

| Requirement | Verdict | Evidence |
|---|---|---|
| **Encryption in transit** | ✅ PASS | Caddy auto TLS. Ports 80+443. HSTS. |
| **Network segmentation** | ✅ PASS | `backend` + `frontend` Docker networks. Postgres/Redis: backend only (no published ports). |
| **Cookie transport** | ✅ PASS | `httpOnly`, `secure` (prod), `sameSite:strict`. |

---

## Data Lifecycle

| Requirement | Verdict | Evidence |
|---|---|---|
| **Right to erasure** | ✅ PASS (post-fix) | Full coverage: patients (demographics + insurance), medical_records, prescriptions (medications scrubbed, not just soft-deleted), lab_tests, xray_records, ultrasound_records, appointments (reason/notes). `erasedEntities` derived from actual row counts. Insurance fields (§164.514(e)(2)) included. |
| **Soft-delete lifecycle** | ✅ PASS | Monthly cron reports. No auto-purge (ADR-005). |
| **Backup encryption** | ⚠️ PARTIAL | GPG + rsync offsite. Restore drill not automated (file existence only). |
| **Key rotation** | ✅ PASS | v2 envelope with KID. `FIELD_ENCRYPTION_KEY_WRITE_KID` controls active key. Lazy re-encryption. |

---

## Findings

### F-P3-1 — Right-to-erasure was incomplete
**Severity: MEDIUM–HIGH · Confidence: HIGH · Blast: Compliance (evidence gap) · Status: ✅ FIXED 2026-06-04**

`executeErasure` previously only scrubbed `patients` + `medical_records` and soft-deleted prescriptions (leaving encrypted `medications` ciphertext intact). `lab_tests`, `xray_records`, `ultrasound_records` were never touched. The audit log hard-coded `erasedEntities: ["patient", "medical_records", "prescriptions"]` regardless of what was actually erased.

> **Resolution:**
> - Prescriptions: `medications` overwritten to `[ERASED]`, notes nulled, then soft-deleted.
> - Lab tests: `results`/`notes` nulled, soft-deleted.
> - X-ray records: `report`/`imageUrl`/`imageFileName`/`notes` nulled, soft-deleted.
> - Ultrasound records: same pattern as x-ray.
> - Appointments: `reason`/`notes`/`cancellationReason` scrubbed to `[ERASED]`/null (workflow shell kept).
> - Patient insurance fields: `insuranceProvider`/`insurancePolicyNum`/`insuranceMemberId`/`insuranceGroupNum`/`insuranceExpiry` nulled (§164.514(e)(2) named identifiers).
> - `erasedEntities` derived from actual `RETURNING` counts — audit record now reflects what was actually scrubbed.

### F-P3-2 — `hasActiveConsent` missing clinicId filter
**Severity: LOW · Confidence: HIGH · Status: OPEN**

`consent.service.ts:24-37` — `hasActiveConsent` filters by `patientId` + `consentType` but not `clinicId`. Safe today because RLS (dormant mode) and patient IDs are clinic-unique in practice, but lacks the belt-and-braces `clinicId` filter present in every other service query.

### F-P3-3 — Backup restore drill not automated
**Severity: LOW · Confidence: MEDIUM · Status: OPEN**

`backup-verify.mjs` validates file existence, not restorability.

---

## Scorecard (Phase 3 — post-fix)

| Dimension | Score | Rationale |
|---|---|---|
| **Compliance Readiness** | **8.5/10** | All §164.312 controls present. Erasure now covers all PHI tables with accurate evidence. Deductions: field encryption covers only 2 columns (LUKS compensates), device trust disabled by default, backup restore untested. |

### HIPAA Control Matrix Summary

| Section | Sub-Requirements | PASS | PARTIAL | FAIL |
|---|---|---|---|---|
| §164.312(a) Access Control | 6 | 5 | 1 | 0 |
| §164.312(b) Audit Controls | 4 | 4 | 0 | 0 |
| §164.312(c) Integrity | 3 | 3 | 0 | 0 |
| §164.312(d) Authentication | 3 | 2 | 1 | 0 |
| §164.312(e) Transmission | 3 | 3 | 0 | 0 |
| Data Lifecycle | 4 | 3 | 1 | 0 |
| **Total** | **23** | **20** | **3** | **0** |
