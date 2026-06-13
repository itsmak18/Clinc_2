# Audit Plan — Phases 5–8 + Carried-Over Open Findings

**Created:** 2026-06-06
**Owner:** Mike
**Status:** ✅ COMPLETE (2026-06-07) — all of Phases 5–8 executed; findings in `AUDIT_FINDINGS_2026-06-{06_PHASE5,07_PHASE6,07_PHASE7,07_PHASE8}.md`; reconciled into `AUDIT_REPORT.md` §7. Phases 6 & 7 first-pass sign-offs were corrected (inert alert stack; non-existent parity test). Remaining: runtime-verifies at deploy + F-P8-1 `CLAUDE.md:437` one-liner + optional F-P7-3/4 tests.
**Predecessor:** `AUDIT_FINDINGS_2026-06-03_PHASE{1,2,3,4}.md` (Phases 1–4 complete, all findings fixed)
**Companion:** `AUDIT_REPORT.md` (2026-06-06 consolidated dimension report — a *report*, this is the *forward plan*)

> The original 8-phase pre-production audit completed Phases 1–4. Phases 5–8 were
> never executed. WS3 (Zod route validation) covered one slice of Phase 5 only.
> This document defines scope, method, evidence targets, and deliverables for the
> remainder, plus the open findings/decisions carried over from earlier phases.

---

## 0. Method (unchanged from Phases 1–4)

- **Evidence over claims.** Every finding cites `file:line` + the command/observation that proves it. No finding is recorded as PASS/FAIL without a reproducible check.
- **No massaged severities.** Severity is assigned against the rubric below before any fix is discussed. A control that *fails closed* but breaks function is a correctness bug, **not** downgraded-then-ignored — it is recorded as such.
- **Non-regressable fixes.** Every FAIL that gets fixed lands with a test (unit or integration-db) that fails before / passes after. RLS/grant behavior is validated on **real PostgreSQL 16** (`test:integration-db`), not mocks.
- **Diff-aware.** Re-verify against the working tree, not just committed state (Phases 1–4 carried uncommitted WIP; assume the same).

### Severity rubric

| Sev | Meaning |
|---|---|
| **CRITICAL** | Cross-tenant PHI leak, auth bypass, RCE, or unauth PHI read. Blocks launch. |
| **HIGH** | PHI exposure under realistic misconfig/abuse, privilege escalation within tenant, audit-trail defeat. Blocks launch. |
| **MEDIUM** | DoS, integrity gap, missing control with a mitigating layer present. Fix before real-PHI. |
| **LOW** | Hardening, parity, robustness. Track, fix opportunistically. |
| **INFO** | Policy decision or observation; no code defect. |

Finding ID scheme: `F-P{phase}-{n}` (e.g. `F-P5-1`).

---

## 1. Carried-over open findings & decisions (close these regardless of phase order)

| ID | Sev | Item | Action |
|---|---|---|---|
| **F-P3-3** | INFO | lab / xray / ultrasound *orders* do not gate on `treatment` consent (only records + prescriptions do). | **DECIDED 2026-06-06: leave ungated** (orders ≠ treatment). Action: document rationale in `SECURITY.md`. Closed as accepted. |
| **F-P2-2** | MEDIUM | `PHASE2_STRICT_PASSWORD_POLICY=true` set in local `.env` only. | **Reclassified (D2=pilot):** pre-real-PHI-cutover item, NOT a launch-blocker. Goes on the cutover checklist (Phase 6). |
| **F-P2-4** | INFO | `fph` fingerprint = SHA-256(UA + Accept-Language) — weak binding. | Accepted, no action. Record as accepted-risk in the executive summary. |
| **D1** | **DECIDED** | Deployment topology. | **2026-06-06: Single host, LAN/VPN only.** Public-internet hardening (DAST weight, origin/rate-limit emphasis) deprioritized; client↔server RBAC parity is the main Phase 7 concern. |
| **D2** | **DECIDED** | Real PHI at first launch? | **2026-06-06: No — synthetic/pilot first.** Real-PHI controls (secret rotation, F-P2-2, BAA) become **pre-cutover** items, not launch-blockers. |
| — | LOW | Billing "created by" picker: frontend sends `createdById`, server ignores it (uses `req.user`). Pre-existing UX bug. | Fix the frontend to drop the field; confirm server never trusts it. (Folds into Phase 7.) |
| — | LOW | Stale doc status: `F-P3-2` shows OPEN in `AUDIT_FINDINGS_2026-06-03_PHASE3.md` but is fixed (clinicId filter in `hasActiveConsent`). | Correct the status line. |
| — | LOW | New `audit_logs` partitions must re-run migration `0026` REVOKE (0020 default-privs re-grant UPDATE/DELETE to `medicore_app`). | ✅ RESOLVED 2026-06-07 — **migration 0028** adds a `ddl_command_end` event trigger (`audit_partition_append_only_trg`) that auto-REVOKEs on any new audit_logs partition; `audit-append-only.integration-db.test.ts` proves it on real PG16 (8 files/62 tests green). No longer a manual step. |
| — | DOC | Consolidated audit deliverable. | `AUDIT_REPORT.md` now exists (2026-06-06). Reconcile it with Phase 5–8 results at close; ensure it carries the HIPAA matrix + remediation roadmap from audit plan §7. |

---

## 2. Phase 5 — Backend Logic & API Surface

**Goal:** prove every PHI path is tenant-scoped, every `dbUnsafe` is justified, and business-logic invariants (state machines, races, error propagation) hold.

**Scope inventory (from recon):** 32 service files. 21 use `runInTenantContext`; 25 reference `dbUnsafe`. WS3 validated mutation *bodies*; this phase covers the *queries* behind them.

### 5.1 Tenant-scope / `dbUnsafe` exhaustive sweep — **(carries the item flagged twice as not exhaustively done)**
- For **every** `dbUnsafe` call site (25 files): confirm a one-line justification comment AND that the table is legitimately non-tenant (or the query is a sanctioned cross-tenant governance/system path).
- For **every** clinic-bearing SELECT/INSERT/UPDATE/DELETE: confirm `eq(table.clinicId, req.user!.clinicId)` is present **or** the query runs inside `runInTenantContext` (RLS backstop).
- Evidence target: a table of `service → dbUnsafe sites → justification verdict`.
- Highest-risk first: `reports.service`, `search.service`, `analytics.service`, `dashboard.service` (aggregate/read-heavy, most likely to scan cross-tenant).

### 5.2 The 6 deep-read services
- `dashboard`, `schedule`, `analytics`, `reports`, `search`, `notifications`: trace each read end-to-end for (a) scope, (b) audit (`logRead`/`READ_LIST`), (c) cache-vs-PHI rule (no caching of audited/PHI reads).

### 5.3 Transactions & race conditions
- Booking path (`schedule-validator` + `appointments.service`): re-confirm F-P1-1 fix holds and check for TOCTOU between availability check and insert (concurrent double-book).
- Billing anti-fraud (same-user pay within 30s), invoice counter (`clinic_invoice_counters` — RLS added F-P1-3): check counter increment is atomic under concurrency.
- Erasure transaction: single-transaction guarantee across all clinical tables (already F-P3-1; re-verify no new PHI table escapes).

### 5.4 Error propagation consistency
- Every service error reaches the canonical envelope (asyncHandler / globalErrorHandler). Spot-check the 2 intentional raw shapes in `auth.ts` are still the only exceptions. No stack traces in 5xx (prod).

### 5.5 Authorization depth
- `authGate` scope correctness post-F-P2-5 (method-based read/write). Confirm no GET silently does a write, no mutation runs under `read` scope.

**Deliverable:** `AUDIT_FINDINGS_2026-06-XX_PHASE5.md` + the dbUnsafe verdict table.

---

## 3. Phase 6 — Deployment, DevOps & Observability

**Goal:** prove the pipeline and prod posture are launch-safe.

**Scope inventory (from recon):** workflows present — `ci.yml`, `audit-weekly.yml`, `codeql.yml`, `sbom.yml`, `security-dast.yml`, `security-scan.yml`.

### 6.1 CI gate completeness
- Trace `ci.yml` job graph: typecheck → lint → validate:errors → test → audit → secrets-scan → build → migration-drift → ci-gate. Confirm each is **blocking**, not `continue-on-error`.
- Confirm WS3's `validate()` and the integration-db suite are actually wired into CI (or documented as manual + why).
- Confirm CodeQL / DAST / SBOM / secrets-scan run on the right triggers and fail the build on new HIGH/CRITICAL.

### 6.2 Backup & restore
- `scripts/backup-verify.mjs --restore`: confirm it performs a **real** restore + `checkAuditIntegrity()` (not a dry-run). Run the quarterly drill once and record RTO.
- Confirm GPG/rsync offsite path + retention (30d) + `backup_last_success_timestamp_seconds` → `BackupStale` alert fires correctly.

### 6.3 Alerting sufficiency
- Map `prometheus-alerts.yml` against the failure modes that matter: audit integrity mismatch, partition exhaustion, backup stale, DB pool exhaustion, SSE cap, cert expiry. Identify gaps.

### 6.4 Rollback & migration safety
- Validate RUNBOOK §10 rollback (image pin → flip → `up -d --no-build`) and the roll-forward-only migration constraint (Drizzle has no down-migrations).

### 6.5 Staging + go-live checklist (gated by D1/D2)
- Stand up (or document the absence of) a staging environment for rehearsal — the single biggest "Deployment Safety" deduction in `AUDIT_REPORT.md`.
- Produce a **go-live checklist**: secret rotation (all dev creds + keys), `PHASE2_STRICT_PASSWORD_POLICY=true` (F-P2-2), `FIELD_ENCRYPTION_KEY` set, BAA (if D2 = real PHI), TLS, Grafana SSH-tunnel-only confirmed.

**Deliverable:** `AUDIT_FINDINGS_2026-06-XX_PHASE6.md` + go-live checklist.

---

## 4. Phase 7 — Frontend & Client Security

**Goal:** prove the SPA cannot be turned into a PHI-exfil or CSRF vector, and that client-side access control matches the backend.

**Scope inventory (from recon):** 2 sanctioned `document.write` sinks (`lib/print.ts`, `components/DischargeSheet.tsx`); 2 hand `fetch(apiUrl(...))` calls (both GET: `GlobalSearch.tsx`, `DischargeSheet.tsx`).

### 7.1 XSS / DOM-injection sweep (extends F-01)
- Re-confirm only the 2 sanctioned `document.write` sinks exist (CI grep guard); every dynamic field in both passes through `escapeHtml()` / `safeUrl()`. Verify `print-xss.test.ts` covers the bilingual/Arabic fields added in Phase 6 features.
- Sweep for other injection sinks: `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, template injection in any report/print path.

### 7.2 CSRF coverage
- Confirm all mutations go through Orval `customFetch` (auto `X-CSRF-Token`). The 2 hand `fetch` calls are GET-only (no CSRF risk) — re-confirm, and migrate them when next touched per the CLAUDE.md note.

### 7.3 RBAC parity (client ↔ server) — **(gated partly by D1)**
- `lib/route-access.ts` (`canAccessRoute`) vs backend `authGate` role sets, route by route. Client guard is UX-only; the real test is that **no client route exposes data the backend would refuse**. Flag any client route that's more permissive than its API.
- Fold in the **billing `createdById`** UX bug here (frontend sends it, server ignores — drop it client-side).

### 7.4 Bilingual coverage (overlaps WS4 i18n)
- Confirm no hardcoded English in new pages; this dovetails with Track B WS4 if/when it runs.

**Deliverable:** `AUDIT_FINDINGS_2026-06-XX_PHASE7.md`.

---

## 5. Phase 8 — Architecture, Performance & Scale

**Goal:** prove the system survives the intended scale (single clinic now, multi-clinic later) without falling over or leaking under load.

### 8.1 DB pool math
- `DB_POOL_MAX=40` × (API + worker) vs Postgres `max_connections=100` and PgBouncer `default_pool_size=20` / `max_client_conn=200`. Confirm the math leaves headroom for a 2nd API replica (the documented PgBouncer trigger). Verify `statement_timeout` / `idle_in_transaction_session_timeout` are enforced via `ALTER ROLE` (pooling-safe), not pool client options.

### 8.2 N+1 / query efficiency
- Audit the deep-read services (dashboard, reports, analytics) for N+1 and missing composite indexes (`0018_performance_indexes.sql` exists — confirm coverage vs actual query shapes).

### 8.3 SSE bounds
- `SSE_MAX_CONNECTIONS=500` / `SSE_MAX_PER_USER=10` enforcement + graceful drain (503 + Retry-After) + per-user eviction. Confirm `addSSEClient()` return value is checked everywhere.

### 8.4 Cache correctness
- Re-confirm the no-PHI/no-audit caching rule: only `getDashboardSummary`/`getDepartmentLoad`/`getRecentActivity` are cached; `getPatientSummary`/billing daily summary intentionally uncached.

### 8.5 Frontend bundle / load
- Bundle size, lazy-route splitting, and a basic load test against the booking + dashboard paths.

**Deliverable:** `AUDIT_FINDINGS_2026-06-XX_PHASE8.md`.

---

## 6. Execution order (recommended)

1. **Decisions first (D1/D2, F-P3-3).** They gate scope of Phases 6 & 7 and launch-blocker classification. → `AskUserQuestion` / short decision memo.
2. **Phase 5** (backend) — highest residual-risk surface; the dbUnsafe/clinicId sweep is the one item explicitly flagged as not-yet-exhaustive.
3. **Phase 7** (frontend) — smaller, mostly confirmation + the billing UX fix.
4. **Phase 6** (DevOps) — needs the D1/D2 decisions; produces the go-live checklist.
5. **Phase 8** (perf/scale) — last; least likely to surface a launch-blocker for a single-clinic start.
6. **Close-out:** reconcile `AUDIT_REPORT.md`, fix the 3 LOW doc/ops items, update CHANGELOG / HEALTH_STATUS / ROADMAP per the Task Completion Rule.

## 7. Definition of done

- One `AUDIT_FINDINGS_*_PHASE{5,6,7,8}.md` per phase, each finding with `file:line` evidence + severity + fix + regression test.
- All CRITICAL/HIGH fixed and validated on real Postgres 16.
- D1/D2/F-P3-3 decided and recorded.
- Go-live checklist complete; `AUDIT_REPORT.md` reconciled with final scores.
- Carried-over LOW/DOC items cleared.
