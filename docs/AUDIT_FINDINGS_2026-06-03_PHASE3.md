# Audit Findings — Phase 3: HIPAA Control Verification

**Date:** 2026-06-04
**Baseline:** working tree over `main @ 7014f95` (post Phase 1/2 fixes).
**Rating bar:** stricter (D2 "real PHI?" undecided → assume real PHI).
**Method:** cross-reference each §164.312 technical safeguard against the implementing code; PASS / PARTIAL / FAIL with evidence.

---

## §164.312 control matrix

| Safeguard | Verdict | Evidence |
|---|---|---|
| **(a) Access Control** — unique ID, RBAC, encryption at rest, tenant isolation, emergency access | **PASS** | `policy.ts` kernel (unique `userId`/role/clinicId), RLS on all 22 clinic tables (0015/0017/0024/0025), AES-256-GCM field encryption (`field-encryption.ts`), break-glass now delivers clinical PHI (F-P2-1 fix). |
| **(b) Audit Controls** — record PHI access/mod, tamper-evident, completeness | **PASS** | Transactional outbox → `audit_logs` (`lib/audit.ts`); SHA-256 daily hash-chain (`audit-integrity.ts`); every PHI create/update/delete audited; appointment transitions audited at the route layer (`routes/appointments.ts:77-130`); no-show cron gap closed (F-P1-4). |
| **(c) Integrity** — PHI integrity, transmission integrity, audit integrity | **PASS** | GCM auth tag on encrypted fields; audit hash-chain + `AuditIntegrityMismatch` alert; TLS via Caddy + `Secure` cookie. |
| **(d) Person/Entity Authentication** — auth mechanism, lockout | **PASS** | bcrypt-12 + EdDSA JWT (Phase 2 verified); login lockout 5/15min + 30min; strict policy now uniform (F-P2-2). |
| **(e) Transmission Security** — encryption in transit, segmentation, cookie transport | **PASS** | Caddy TLS termination + HSTS; `backend`/`frontend` Docker networks; `clinic_token` httpOnly+secure+sameSite=strict. |
| **Data Lifecycle — Right to Erasure** | **PARTIAL / FAIL** | See **F-P3-1** — erasure leaves lab/imaging PHI (plaintext) and prescription medications (ciphertext) intact, and the audit log overstates coverage. |
| **Data Lifecycle — Retention** | **PASS (by design)** | `cron.ts` data-retention job reports 7-yr-overdue audit rows + soft-deleted patients; no auto-delete (ADR-005). Reporting control, intentional. |
| **Data Lifecycle — Backup encryption / key rotation** | **PASS (code)** | GPG-encrypted pg_dump + offsite rsync (Phase 4 compose); field-key v1→v2 envelope rotation; prod fail-closed if write kid unregistered (`field-encryption.ts:64-67`). |

---

## Findings

### F-P3-1 — Right-to-erasure is incomplete (PHI survives an executed erasure)
**Severity: MEDIUM–HIGH (compliance/correctness) · Confidence: HIGH · Blast: Record · Status: ✅ FIXED 2026-06-04 (working tree)**

> **Resolution:** `executeErasure` now scrubs PHI from **every** clinical table in the erasure transaction: prescriptions `medications` ciphertext overwritten to `[ERASED]` (not just soft-deleted); `lab_tests` (results/notes), `xray_records` + `ultrasound_records` (report/imageUrl/imageFileName/notes) nulled + soft-deleted; `appointments` free-text (reason→`[ERASED]`, notes/cancellationReason nulled) per your "scrub them" call; medical_records Arabic fields also nulled. `erasedEntities`/`erasedCounts` are now **derived from rows actually scrubbed** (accurate audit evidence) instead of a hard-coded list. Unit test updated; new `erasure.integration-db.test.ts` asserts no readable PHI remains in any clinical table after execution. 475 unit green, typecheck clean. _Integration-db not runtime-verified (no Docker) — run `test:integration-db`._

`executeErasure` (`services/erasure.service.ts:96-171`) claims to "anonymize **all** PHI for the patient" (comment, `:93`) and the audit log records `erasedEntities: ["patient", "medical_records", "prescriptions"]` (`:166`). In reality it:

1. **Scrubs** `patients` demographics (incl. the encrypted `allergies`/`emergencyContact` → `[ERASED]`/null) and `medical_records` (encrypted `diagnosis`/`vitals` → `[ERASED]`/null). ✓
2. **Only soft-deletes** `prescriptions` (`:146-149`) — sets `deletedAt`, but the encrypted **`medications` ciphertext is retained** in the row. So a patient's medication history is recoverable via direct DB access / a future key compromise.
3. **Never touches** `lab_tests`, `xray_records`, `ultrasound_records` — whose PHI (`results`, `report`, `imageUrl`, notes) is **not field-encrypted**, so it remains in **plaintext** after "erasure."

Net: after an executed erasure, the patient's lab results, X-ray/ultrasound reports (plaintext) and prescription medications (ciphertext) are still in the database, while the audit trail asserts the data was erased. That's a correctness gap and a compliance-claim gap (the control does less than it says, and the evidence record is wrong).

**Remediation:**
- Scrub `prescriptions.medications` (overwrite to a tombstone, not just soft-delete) in the same transaction.
- Extend the erasure transaction to anonymize `lab_tests` (`results`/`resultsAr`/`notes`), `xray_records` (`report`/`reportAr`/`imageUrl`/`notes`), `ultrasound_records` (same) for the patient.
- Make `erasedEntities` reflect exactly what was scrubbed (derive it, don't hard-code).
- Consider appointments `reason`/`notes` (free-text, can contain PHI) — decide scrub vs retain-for-audit and document.
- Add an integration test: after `executeErasure`, assert no plaintext PHI remains in lab/xray/ultrasound rows for the patient and `medications` is tombstoned.

### F-P3-2 — `hasActiveConsent` has no clinicId filter
**Severity: LOW (defense-in-depth) · Confidence: HIGH · Status: OPEN**

`consent.service.ts:24-38` queries `patient_consents` by `patientId` + `consentType` only, via bare `db` (dormant RLS, no tenant context). Safe **today** because every caller (`createMedicalRecord`, `createPrescription`) pre-validates that `patientId` belongs to the requester's clinic. But a future call path passing a foreign `patientId` would read another clinic's consent. Add `eq(clinicId)` (or pass the `tx` so RLS applies).

### F-P3-3 — Diagnostic orders don't gate on consent
**Severity: INFO · Confidence: HIGH · Status: OPEN (policy decision)**

Treatment consent is enforced before `createMedicalRecord` / `createPrescription`, but **not** before creating lab/xray/ultrasound orders. Whether ordering diagnostics requires treatment consent is a clinic-policy call, not clearly a bug — flagging for an explicit decision.

---

## Scorecard (Phase 3)

- **Compliance Readiness: 8.5/10** — the §164.312 technical safeguards (a)–(e) all verify PASS against the code; audit completeness is genuinely solid. The single substantive gap is **erasure (F-P3-1)**: a control that under-delivers vs its own claim and leaves real PHI (lab/imaging plaintext, prescription ciphertext) in the database.
- No new access-control or audit-integrity defects found. Retention is intentionally report-only (ADR-005), not a gap.
