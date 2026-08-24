# Audit Findings — Phase 4: Data Integrity & Audit Chain

**Date:** 2026-06-05
**Baseline:** working tree over `main @ 7014f95` (post Phase 1/2/3 fixes).
**Rating bar:** stricter (D2 "real PHI?" undecided → assume real PHI).

---

## Verified PASS

| Check | Evidence |
|---|---|
| **Audit outbox — write→drain→retry→permanent** | `lib/audit.ts` — `logAudit` inserts to `audit_outbox` (PHI op never blocks on audit-DB). Drain (5s) batch-transfers to `audit_logs`; per-row fallback with exponential backoff (5s/30s/2m/10m), max 5 attempts. **Exhausted rows are NOT discarded** — they remain in `audit_outbox` (attempts=5, no longer selected), recoverable; `audit_log_write_failures_total` increments → `AuditLogPermanentLoss` alert fires (`prometheus-alerts.yml:47`, `for: 0m`). |
| **Snapshot redaction** | `lib/audit-snapshot.ts` — `beforeState`/`afterState` redact the canonical `ENCRYPTED_PHI_FIELDS` to `"[redacted]"`, omit `passwordHash`/noise; CI drift guard fails if a newly-encrypted column is missing from the list. No PHI leaks into `audit_logs`. |
| **Partitioning + headroom** | `0021_audit_logs_partition.sql` monthly RANGE partitions 2026→2036 + DEFAULT; `audit_partition_months_remaining` gauge set by the monthly cron; `AuditPartitionLow` alert < 24 months. |
| **Hash computation** | `computeHashFromRows` is deterministic SHA-256 over `prevHash + sorted rows`; `recordDailyIntegrity` chains each day to the prior day's `rootHash` (or `"genesis"`). |

---

## Findings

### F-P4-1 — Audit integrity hash-chain is recorded but NEVER verified in production
**Severity: MEDIUM–HIGH (compliance — tamper-evidence) · Confidence: HIGH · Blast: Compliance/Legal · Status: ✅ FIXED 2026-06-05 (working tree)**

> **Resolution:** the daily 02:00 integrity cron now, after `recordDailyIntegrity`, calls **`verifyRecentIntegrity()`** (re-derives + compares the last `AUDIT_VERIFY_WINDOW_DAYS` days, default 7) and **`verifyChainLinkage()`** (F-P4-2). Any row tampering or chain break now increments `audit_integrity_check_failures_total` → the `AuditIntegrityMismatch` alert fires within a day, instead of never. New unit tests in `audit-integrity.test.ts`. 479 unit green.

The tamper-evidence control for the audit trail (§164.312(b)) is effectively **dormant**:

- The daily 02:00 cron (`cron.ts`) calls **`recordDailyIntegrity`** only — it stores each day's `rootHash` with `status` `'ok'`/`'empty'`. It never re-derives or compares.
- **`verifyIntegrity`** — the only function that re-computes a stored date's hash, sets `status='mismatch'`, and increments `auditIntegrityMismatchTotal` (the metric behind `AuditIntegrityMismatch`) — is called **only by tests** (`audit-integrity.test.ts`). Nothing schedules it.
- The restore-drill `checkAuditIntegrity` (`backup-verify.mjs:359-389`) only runs `SELECT COUNT(*) ... WHERE status='mismatch'` (it explicitly does **not** recompute, comment `:354-357`). Since `verifyIntegrity` never runs, `status` is never `'mismatch'`, so this always reports 0.

**Net:** a tampered or deleted `audit_logs` row is never detected by any automated process; the `AuditIntegrityMismatch` alert can never fire in production. This is a "documented-active but inert" control — the same class as the prior audit's F-02/F-06, and more dangerous than a known gap because SECURITY.md presents the hash-chain as live tamper-evidence.

**Remediation:** schedule verification — e.g. extend the daily integrity cron to call `verifyIntegrity(yesterday)` immediately after `recordDailyIntegrity`, and/or a job that re-verifies a rolling window of recent days. Pair with F-P4-2.

### F-P4-2 — `verifyIntegrity` validates rows-vs-stored-hash but not the chain linkage
**Severity: MEDIUM · Confidence: HIGH · Status: ✅ FIXED 2026-06-05 (working tree)**

> **Resolution:** new `verifyChainLinkage()` walks the stored daily records in date order and asserts each `prevHash` == the immediately-prior calendar day's `rootHash` (calendar gaps skipped, since `prevHash` is genesis-based after a missing day). A break increments the mismatch counter and sets `status='mismatch'`. Wired into the daily cron. Catches the "rewrite a historical `rootHash` without cascading" case. Unit tests cover intact / broken / gap.

`verifyIntegrity` (`audit-integrity.ts:113-117`) recomputes using the **stored** `prevHash`, not the actual prior day's current `rootHash` (comment acknowledges this). So an attacker who can write **both** `audit_logs` **and** `audit_integrity_checks` can modify rows, recompute the day's `rootHash`, and overwrite the stored value — and verification passes. The chain (each day's `prevHash` == prior day's `rootHash`) is what defeats this, but nothing walks/validates that linkage. Combined with F-P4-1 (never run) and F-P4-3 (app role can delete `audit_logs`), the tamper-evidence is weak. **Remediation:** add a chain-walk that asserts `record[N].prevHash == record[N-1].rootHash` across the stored series; treat a break as a mismatch.

### F-P4-3 — `medicore_app` has DELETE on `audit_logs` (append-only violation)
**Severity: LOW–MEDIUM (defense-in-depth) · Confidence: HIGH · Status: ✅ FIXED 2026-06-05 (working tree)**

> **Resolution:** migration `0026_audit_logs_append_only.sql` `REVOKE UPDATE, DELETE ON audit_logs FROM medicore_app` (parent + all existing partitions via a `pg_inherits` loop). App keeps SELECT + INSERT (the only operations the code does). Documented the future-partition caveat (0020's `ALTER DEFAULT PRIVILEGES` re-grants on new partitions → re-run the REVOKE when adding partitions). Journal idx 26.

`0021_audit_logs_partition.sql:141,187` grants `SELECT, INSERT, UPDATE, DELETE` on `audit_logs`(`_part`) to `medicore_app`. The threat model (§1.3) claims "no DELETE grants" on `audit_logs`; the app role does not need DELETE on an append-only audit table (partition maintenance is DDL, done by the owner, not row DELETE). A compromised API process could delete audit rows — and, per F-P4-1, undetected. **Remediation:** `REVOKE DELETE (and UPDATE) ON audit_logs FROM medicore_app` so the table is genuinely append-only at the grant layer.

---

## Scorecard (Phase 4)

- **Operational Resilience / Integrity: 7/10** — the outbox (no silent loss, permanent-loss alerting), snapshot redaction, and partitioning are genuinely solid. The deduction is the audit **integrity** chain: the hashes are computed and stored every day, but **nothing verifies them in production**, so the tamper-evidence guarantee the system advertises does not actually hold. F-P4-1 is the actionable headline; F-P4-2/3 harden the same control.
