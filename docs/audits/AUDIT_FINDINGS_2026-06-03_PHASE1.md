# Audit Findings — Phase 1: Cross-Tenant Isolation & PHI Boundaries

**Date:** 2026-06-03
**Baseline:** working tree (diff-aware) over `main @ 7014f95` — migrations `0022`/`0023`, `clinic_invoice_counters` schema, and the `schedule.service.ts` rewrite are **uncommitted**. These findings concern WIP not yet shipped.
**Rating bar:** stricter (D2 "real PHI?" undecided → assume real PHI).

> Scope: Phase 1 only (the "if this fails, nothing else matters" tier). Auth/session, audit-chain, API surface, frontend, and deployment phases are not covered here.

---

## Verified PASS

| Check                                              | Evidence                                                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runInTenantContext` GUC scoping is PgBouncer-safe | `lib/db/src/tenant-context.ts:66-79` — `set_config(..., true)` (txn-local) inside `db.transaction()`; reset on COMMIT + PgBouncer `DISCARD ALL`. No GUC bleed across pooled connections. |
| `medicore_app` is RLS-bound                        | `0020_create_app_role.sql:29` `NOSUPERUSER NOBYPASSRLS`; migrations run as bootstrap superuser → role is **non-owner** → `FORCE ROW LEVEL SECURITY` applies.                             |
| 0015 (20 tables) + 0017 doctor-scope policies      | Dormant gate + `nullif(...,'')` guard + `WITH CHECK`; 0017 uses `RESTRICTIVE` for correct AND-semantics. Dormant-by-default is load-bearing (login reads `users` unscoped).              |
| App-layer `clinicId` filter on new invoice counter | `services/billing.service.ts:19`.                                                                                                                                                        |

---

## Findings

### F-P1-1 — Booking globally broken once migration 0022 is applied

**Severity: CRITICAL (functional, P0) · Confidence: HIGH · Blast: Operational, all clinics · Status: ✅ FIXED 2026-06-04 (working tree)**

> **Resolution:** `lib/schedule-validator.ts` now runs its schedule/conflict reads inside `runInTenantContext`. Signature is `checkDoctorAvailability(actor, doctorId, scheduledDate, existingTx?)`; `updateAppointment` passes its outer `tx` to avoid a nested transaction. Callers updated (`appointments.service.ts:108`, `:268`). Regression test added to `cross-tenant.integration-db.test.ts` (`[BOOKING]` block): same-clinic booking succeeds with a seeded schedule; a no-schedule day still returns 409. Unit suite 475 green, monorepo typecheck + lint clean. **Not runtime-verified** — integration-db tests need Docker (unavailable in the fix session); run `pnpm --filter @workspace/api-server run test:integration-db` before merge.

Two uncommitted changes are individually plausible but lethal together:

- `lib/db/migrations/0022_heavy_drax.sql:47-59` — `FORCE ROW LEVEL SECURITY` + a **strict, non-dormant** policy on `doctor_schedules` / `schedule_overrides`:
  ```sql
  USING (clinic_id = current_setting('app.clinic_id', true)::integer)
  ```
- `artifacts/api-server/src/lib/schedule-validator.ts:1` reads those tables via **`dbUnsafe`** (no tenant context → `app.clinic_id` unset → `current_setting(...)` is `NULL` → `clinic_id = NULL` → **zero rows**).

`checkDoctorAvailability` then falls to `!template` and returns `"No schedule for this day"` → `ConflictError` at `services/appointments.service.ts:109` (create) and `:269` (reschedule). Because RLS is **FORCED**, this breaks in **dev (table owner) and prod (`medicore_app`) identically**.

The function's comment (`schedule-validator.ts:5-10`) justifies skipping `clinicId`/using `dbUnsafe` on the premise "doctorId is implicitly clinic-scoped" — 0022's FORCE RLS hides the rows entirely from an unscoped connection, invalidating that premise.

**Not caught by tests.** `checkDoctorAvailability` has zero coverage; the +48 new lines in `tests/cross-tenant.integration-db.test.ts` only assert cross-tenant **404s** (which fire at the patient/doctor check, `appointments.service.ts:105`, _before_ availability runs). No same-clinic happy-path booking test exists → CI stays green.

**Remediation (choose one):**

1. **(preferred)** Thread the caller's `tx` into `checkDoctorAvailability` and call it inside `runInTenantContext`, so the GUC is set and RLS resolves.
2. Rewrite the 0022 policy to the 0015 dormant pattern (dormant gate + `nullif(...,'')` + `WITH CHECK`) so `dbUnsafe` reads still return rows.

**Add regression test:** same-clinic create/reschedule happy path against a migrated DB (0022 applied) connected as `medicore_app`.

---

### F-P1-2 — 0022 policy silently diverges from the 0015 standard

**Severity: MEDIUM · Confidence: HIGH · Blast: Operational · Status: ✅ FIXED 2026-06-04 (working tree)**

> **Resolution:** migration `0025_rls_policy_consistency.sql` drops 0022's strict `tenant_isolation` policy on `doctor_schedules` / `schedule_overrides` and recreates it with the **dormant 0015 standard** (dormant gate + `nullif(...,'')` guard + explicit `WITH CHECK`). RLS stays `ENABLE`/`FORCE` (from 0022); only the policy expression changes. Empty-string GUC no longer crashes; bare-`db` reads work; the false "same pattern" comment is gone. Journal entry idx 25. _Not runtime-verified (no Docker) — run `test:integration-db`._

Beyond F-P1-1, `0022` omits the `nullif(current_setting('app.clinic_id', true), '')` guard present in 0015/0017. If `app.clinic_id` is ever set to the empty string, `''::integer` **throws** (`invalid input syntax for integer: ""`) rather than failing closed. The migration comment claims "same pattern as migration 0015" — it is materially different (no dormant gate, no `nullif`, no explicit `WITH CHECK`).

**Remediation:** align 0022 with the 0015/0017 policy text; correct the comment.

---

### F-P1-3 — `clinic_invoice_counters` has no RLS and no CHECK

**Severity: MEDIUM (defense-in-depth) · Confidence: HIGH · Blast: Tenant (non-PHI) · Status: ✅ FIXED 2026-06-04 (working tree)**

> **Resolution:** migration `0025` adds `ENABLE`/`FORCE ROW LEVEL SECURITY` + the **dormant** 0015 `tenant_isolation` policy + `CHECK (clinic_id > 0)` to `clinic_invoice_counters`. **Dormant (not strict) is deliberate:** `billing.service.generateInvoiceNumber` reads/writes the counter via bare `db` (`billing.service.ts:16`), so a strict policy would have broken invoice numbering the same way F-P1-1 broke booking. Integration test added to `rls-tenant-context.integration-db.test.ts` (dormant outside, isolated inside, WITH CHECK rejects cross-tenant insert). _Not runtime-verified (no Docker)._

`0023_charming_sharon_carter.sql:17-23` creates the table with `clinic_id` PK and **grants DML to `medicore_app`** (`:47`) but never enables RLS, adds no policy, and adds no `CHECK (clinic_id > 0)`. It is the only clinic-bearing table without the 0014+0015 backstop — and it was created specifically to fix a cross-tenant leak (the global `invoice_seq` leaked business volume, `:5-6`). App-layer filter holds today (`billing.service.ts:19`), so this is defense-in-depth, not a live leak.

**Remediation:** add `ENABLE`/`FORCE ROW LEVEL SECURITY` + the 0015 dormant `tenant_isolation` policy + `CHECK (clinic_id > 0)`.

---

### F-P1-4 — No-show cron is an unaudited cross-tenant write

**Severity: LOW–MEDIUM · Confidence: HIGH · Blast: Tenant write (no leak) · Status: ✅ FIXED 2026-06-04 (working tree)**

> **Resolution:** the cron now writes a system-actor audit entry after the bulk transition (`cron.ts`). It uses the existing `logAudit` no-`req` fallback (`SYSTEM_USER_ID` / `SYSTEM_CLINIC_ID`) with a synthetic system request, emitting one summary `SYSTEM_NO_SHOW` entry per run with `details = { count, appointments: [{id, clinicId}] }` (added `clinicId` to the `.returning()`). The cross-tenant write itself is left as-is (intended, tenant-uniform rule). Closes the §164.312(b) completeness gap.

`artifacts/api-server/src/cron.ts:150-158` runs `db.update(appointmentsTable)` filtered only by `status` + `scheduledAt` — no `clinicId`, no `runInTenantContext`. Because the 0015 policy is permissive-when-dormant, this writes across **all clinics** even as `medicore_app`. Not a leak (the rule is tenant-uniform: stale `scheduled` → `no_show`), but the bulk transition writes **no `logAudit`**, leaving patient-appointment status changes off the audit trail (§164.312(b) completeness gap). `cron.ts` also imports bare `db`, which the `services/**` ESLint guard does not cover.

**Remediation:** emit an audit record for the bulk transition (e.g. a `SYSTEM_NO_SHOW` batch entry per affected appointment or a summarized system-actor entry); consider running per-clinic inside tenant context if/when the rule becomes clinic-specific.

---

## Scorecard (Phase 1 only)

- **PHI Protection: 7/10** — no provable cross-tenant PHI leak; RLS architecture sound where correctly applied (0015/0017). Deductions for the missing backstop on `clinic_invoice_counters` and the no-show audit gap.
- **Headline risk is correctness, not breach:** F-P1-1 makes a core feature 100% non-functional and is invisible to CI. It is a launch-blocker for the in-flight schedule/billing work — do not commit 0022 + the schedule refactor without the fix and a happy-path test.
