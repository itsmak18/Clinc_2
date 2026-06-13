# Audit Findings — Phase 5: Backend Logic & API Surface

**Created:** 2026-06-06
**Auditor:** Rose (for Mike)
**Method:** `docs/AUDIT_PLAN_PHASE_5-8.md` §0 — evidence over claims (file:line + reproducible check), no massaged severities, non-regressable fixes validated on **real PostgreSQL 16** (`test:integration-db`).
**Predecessor:** `AUDIT_FINDINGS_2026-06-03_PHASE{1,2,3,4}.md`

> Scope of this pass: **5.1 — tenant-scope / `dbUnsafe` exhaustive sweep** (the item flagged twice as not-yet-exhaustive). 5.2–5.5 tracked at the bottom as not-yet-started.

---

## Summary

| ID | Sev | Title | Status |
|---|---|---|---|
| **F-P5-1** | MEDIUM | Raw inserts omit `clinicId` → child rows silently default to clinic 1 (invoice_items + notifications) | ✅ FIXED |
| **F-P5-2** | LOW | Billing cancel/pay `UPDATE` conditions omit `clinicId` (belt-and-braces gap) | ✅ FIXED |
| **F-P5-3** | INFO | `reports`/`search` services carried a misleading `dbUnsafe as db` import they never used | ✅ FIXED |
| **F-P5-4** | MEDIUM | `createPrescription` patient existence check missing `clinicId` filter (cross-tenant reference) | ✅ FIXED |
| **F-P5-5** | **HIGH** | Prescription creation broken end-to-end — service medication schema (`dose`/`route`) contradicts the API contract + every reader (`dosage`/`instructions`) | ✅ FIXED |

All fixes validated: typecheck clean, **484/484** unit, **54→57** integration-db tests green (7 files; +3 new regression tests). Each of F-P5-1/4/5 verified fails-before / passes-after.

---

## 5.1 Sweep method

Every service aliases `dbUnsafe as db` (RLS dormant outside `runInTenantContext`), so the real audit surface is every raw `db.<select|insert|update|delete>` call. Enumerated all such sites (`rg '\bdb\.(select|insert|update|delete|execute)'` over `src/services`) and classified each.

### Verdict table

| Service | Raw `db.` sites | Verdict |
|---|---|---|
| `analytics` | none (all `tx` + `eq(clinicId)`) | ✅ PASS |
| `reports`, `search` | none (all `tx`); dead `db` import | ✅ PASS (F-P5-3 cleanup) |
| `dashboard`, `operations`, `inventory`, `schedule` | none (all `tx`) | ✅ PASS |
| `notifications` | reads/updates all `tx` + `eq(clinicId)` | ✅ PASS |
| `billing` | counter (clinicId✓), createInvoice patient-check (clinicId✓), **invoice_items insert (clinicId✗ → F-P5-1)**, list/get/update `tx`+clinicId✓, **cancel/pay UPDATE (clinicId✗ → F-P5-2)** | ⚠️ fixed |
| `appointments` | patient+doctor existence checks (clinicId✓), insert (clinicId✓), **notif insert via `tx` clinicId✓** | ✅ PASS |
| `lab`, `xray`, `ultrasound` | insert (clinicId✓), update (clinicId✓), **notif insert (clinicId✗ → F-P5-1)** | ⚠️ fixed |
| `medical-records` | patient+doctor checks (clinicId✓), insert (clinicId✓), select/update (clinicId✓) | ✅ PASS |
| `patients` | `nextval('mrn_seq')` (non-tenant seq, ok), insert (clinicId✓), update/delete (clinicId✓) | ✅ PASS |
| `prescriptions` | **patient check (clinicId✗ → F-P5-4)**, insert (clinicId✓), get/void `tx`+clinicId✓ | ⚠️ fixed |
| `auth`, `audit`, `csp-report`, `device-trust`, `device-verification`, `password-reset` | raw `db` on **non-tenant** tables (users pre-auth, audit_logs/outbox, csp_reports, user_devices, *_tokens) | ✅ JUSTIFIED (comment present) |

---

## F-P5-1 — Raw inserts omit `clinicId`; rows default to clinic 1 (MEDIUM)

**Evidence.** Every clinic-bearing table declares `clinic_id integer NOT NULL DEFAULT 1` (e.g. `lib/db/src/schema/invoice_items.ts:10`, `notifications.ts:17`). These raw `dbUnsafe` inserts omitted `clinicId`, so rows silently took **clinic 1**:
- `billing.service.ts:138` — `invoice_items` insert
- `lab.service.ts:134`, `xray.service.ts:133`, `ultrasound.service.ts:135` — `notifications` insert

**Impact.** For the seed clinic (id 1) it's correct by accident. For **any other tenant**, the parent row carries the right `clinicId` but the children land on clinic 1. The read paths filter `eq(clinicId, req.user.clinicId)` (`billing.fetchInvoiceItems` `:52`; `notifications.listNotifications` `:15`), so:
- non-clinic-1 invoices return **zero line items**;
- non-clinic-1 users never see their lab/xray/ultrasound-ready notifications.

A latent multi-tenant data-integrity break that triggers the moment a 2nd clinic onboards (D1/D2 = single clinic first, so impact today is nil — but exactly the class of bug the `clinicId`-everywhere rule exists to prevent). The `.default(1)` is the trap that converts a forgotten `clinicId` into silent mislabeling instead of a NOT-NULL error.

**Fix.** Set `clinicId: req.user!.clinicId` explicitly at all four insert sites. (`appointments.service.ts` already did this for its notif inserts — used as the reference.)

**Regression test.** `tests/clinic-id-default-leak.integration-db.test.ts` (real PG) — drives the API as a non-default clinic (Clinic B) and asserts `invoice_items`/`notifications` rows carry Clinic B's id and the read paths return them. Verified fails-before (`leaked to clinic 1: expected 1 to be 2`), passes-after.

**Residual — RESOLVED (2026-06-07).** The `.default(1)` on all clinic columns was the footgun behind this finding. Eradicated: removed `.default(1)` from all **20** clinic-bearing schema files and dropped it at the DB layer via **migration 0027** (`0027_mean_maddog.sql`). The compiler-driven sweep (clinicId became a required insert field) surfaced the complete blast radius — exactly **9** sites, all bootstrap/system, none in PHI service paths:
- `auth.service.ts` (×3) — pre-tenant session audit writes → `SYSTEM_CLINIC_ID` (LOGIN*/LOGOUT, `TODO(multi-clinic)`) and real `user.clinicId` (CHANGE_PASSWORD).
- `scripts/seed.ts` (×6) — bootstrap rows → captured `clinic.id` from `.returning()`.

This confirms F-P5-1 was the only real leak: every production PHI insert already set `clinicId`. `lib/audit.ts` never relied on the default. A future omission now fails loudly (`NOT NULL`, SQLSTATE 23502) instead of mislabeling. Regression coverage added in `clinic-id-check.integration-db.test.ts`: NOT-NULL rejection on `patients`/`notifications` inserts that omit `clinic_id`, plus a symmetry test asserting no clinic-bearing table carries a `clinic_id` default. Tables that never had the default (`doctor_schedules`, `schedule_overrides`) and `clinic_invoice_counters` (clinic_id is PK) are unaffected.

---

## F-P5-2 — Billing cancel/pay `UPDATE` omit `clinicId` (LOW)

**Evidence.** `billing.service.ts` `cancelInvoice`/`payInvoice` built their UPDATE `where` as `[eq(id), eq(status,"pending")]` with no `clinicId` (`:186`, `:220`).

**Impact.** Not exploitable today: each is preceded by a clinic-scoped `SELECT` (`:179`, `:200`) that 404s a foreign invoice before the UPDATE, and `id` is a global PK. But it relied solely on the prior read, not on the statement's own scoping or RLS — a defense-in-depth gap inconsistent with every other UPDATE.

**Fix.** Added `eq(invoicesTable.clinicId, req.user!.clinicId)` to both update condition arrays. Covered by the existing cross-tenant billing tests (still green).

---

## F-P5-3 — Misleading `dbUnsafe` import in pure-tenant services (INFO)

**Evidence.** `reports.service.ts` / `search.service.ts` imported `dbUnsafe as db` + a 3-line "remaining raw db calls have explicit eq(clinicId)" comment, but use **only** `runInTenantContext`. The import was dead and the comment described call sites that don't exist.

**Fix.** Removed the dead import; replaced the comment with an accurate one. Typecheck + lint clean.

---

## F-P5-4 — `createPrescription` patient check missing `clinicId` (MEDIUM)

**Evidence.** `prescriptions.service.ts:85-86` existence-checked the patient with `eq(id)` + `isNull(deletedAt)` only — **no `clinicId`** — unlike the sibling `createMedicalRecord` (`medical-records.service.ts:109-110`, which has it).

**Impact.** A clinic-A user could reference clinic-B's `patientId`; the prescription would persist with `clinicId=A` pointing at a foreign patient. Today it's *incidentally* blocked by the consent gate (`hasActiveConsent(pid,…,clinicId=A)` returns false → 422), but that's accidental, fragile (any consent-logic change reopens it), and returns a misleading 422 instead of 404. The cross-tenant write suite covered invoice/appointment but **not** prescriptions — the gap that let it through.

**Fix.** Added `eq(patientsTable.clinicId, req.user!.clinicId)` to the check → foreign patient now 404s before consent.

**Regression test.** New case in `tests/cross-tenant.integration-db.test.ts` (WRITE block): "Clinic A doctor cannot create prescription referencing Clinic B's patient → 404". Verified fails-before, passes-after.

---

## F-P5-5 — Prescription creation broken end-to-end (HIGH)

**Evidence.** Contract drift on the medication item shape:
- Frontend (`Prescriptions.tsx:16,224`) and OpenAPI (`CreatePrescriptionBody`, generated `api.ts:2361`) use **`dosage` / `instructions`** (+ required `duration`).
- Every reader agrees: `print.ts:106,109`, `DischargeSheet.tsx:225,228`, `DoctorConsult.tsx:305` read `m.dosage` / `m.instructions`.
- But the backend guard `medicationItemSchema` (`jsonb-schemas.ts`) was `.strict()` with **`dose` / `route`**.

Because WS3's `validate()` does not transform `req.body`, a real create flows: `validate(CreatePrescriptionBody)` accepts `dosage`/`instructions` → service `medicationsSchema.safeParse` (strict) sees unknown `dosage`/`instructions` + missing `dose` → **422 "Invalid medications format"**. So **no prescription could be created through the real UI**. The bug hid behind unit tests that themselves asserted the wrong `dose`/`route` shape (`jsonb-schemas.test.ts`) — green tests locking in a broken contract.

**Severity.** HIGH — a core clinical workflow is entirely non-functional. (Not CRITICAL: no PHI leak/auth bypass; pilot/synthetic stage per D2.)

**Fix.** Aligned `medicationItemSchema` to the contract: `name, dosage, frequency, duration?, instructions?` (kept `.strict()`). No migration — JSONB column, and no valid `dose`-shaped rows can exist (creation was broken).

**Regression tests.**
- `jsonb-schemas.test.ts` — rewritten to the real shape; added "accepts the exact frontend/OpenAPI shape" + "rejects the legacy dose/route shape (regression guard)".
- The F-P5-4 cross-tenant HTTP test transitively proves the medications parse now succeeds (it reaches the patient check → 404 instead of a 422 medications error).

---

## Correction to the 5.1 sweep — wrapped `db.` calls (2026-06-07)

The original 5.1 grep used a single-line regex (`\bdb\.(select|insert|...)`), which **missed call sites where the method wraps to the next line** (`await db\n  .select(...)`). Re-ran the sweep multiline-aware (`rg -U '\bdb\s*\.\s*(select|insert|update|delete|execute)'`). Newly-surfaced raw reads, all **verified clinic-scoped**:
- `schedule.service.ts:20, 69, 156, 213` — doctor/user lookups + slot-availability scans, every one with `eq(clinicId)`. (Added the missing `dbUnsafe` justification comment to this file.)
- `audit.service.ts:66, 84, 111` — audit list/entity/export reads, each with `eq(auditLogsTable.clinicId, req.user!.clinicId)`. Corrected the file's header comment (it claimed super_admin reads span clinics; the code correctly filters by clinicId — confirmed by the cross-tenant test).

No new defects — every wrapped site was already scoped. **Bonus from migration 0027:** with the `clinic_id` default gone, every clinic-bearing *insert* is now compiler-guaranteed to set `clinicId` (omission = type error), so the insert half of the sweep is enforced by `tsc` going forward; only reads need manual review.

---

## 5.2 — 6 deep-read services trace (✅ PASS)

Traced `dashboard`, `schedule`, `analytics`, `reports`, `search`, `notifications` (+ `audit`) end-to-end for scope / audit / cache-vs-PHI:

| Service | Scope | Audit | Cache |
|---|---|---|---|
| dashboard | all `tx` + `eq(clinicId)` | aggregates → no `logRead` (by design) | only `getDashboardSummary`/`getDepartmentLoad`/`getRecentActivity` (non-PHI aggregates) — rule-compliant |
| schedule | `tx` + raw reads, all `eq(clinicId)` | `logRead` on `getDoctorSchedule`; availability = slot times (no PHI) | none |
| analytics | `tx` + `eq(clinicId)` | `logRead("ANALYTICS")` | none (correct — audited) |
| reports | `tx` + `eq(clinicId)` | `logRead("REPORT")` | none |
| search | `tx` + `eq(clinicId)` | `logRead("SEARCH")` | none |
| notifications | `tx` + `eq(userId)`+`eq(clinicId)` | own-notifications read, no `logRead` (not a PHI access) | none |
| audit | raw + `eq(clinicId)` | `logAudit("AUDIT_LOG_READ"/"_EXPORT")` | none |

No PHI-or-audited read is cached. **Cleanup:** removed an unused `dbUnsafe as db` dead import from `dashboard.service.ts` (F-P5-3 class; it uses only `tx`).

## 5.3 — Transactions & race conditions (✅ PASS)

- **Booking double-book** — check-then-insert has a TOCTOU window, but a **partial unique index** `appt_no_double_book_idx` on `(doctor_id, scheduled_at) WHERE status NOT IN ('cancelled','no_show')` (schema `appointments.ts:49`) closes it: a concurrent second insert gets `23505`, which `createAppointment` maps to `ConflictError "Doctor already has an appointment at this time"` (`appointments.service.ts:121-124`). Correct optimistic-concurrency pattern; `checkDoctorAvailability` is advisory UX.
- **Invoice counter** — `generateInvoiceNumber` uses atomic `UPDATE … RETURNING` + `onConflictDoUpdate` (`billing.service.ts:16-34`). No SELECT-FOR-UPDATE needed.
- **Pay / cancel** — status-guarded `UPDATE … WHERE status='pending' RETURNING`; `!updated` → `ConflictError "…by a concurrent request"` (`billing.service.ts:188-193, 222-227`).
- **Erasure** — single transaction across all clinical tables (F-P3-1), covered by `erasure.integration-db.test.ts`.

## 5.4 — Error-propagation consistency (✅ PASS)

`globalErrorHandler` (`middlewares/envelope.ts`) logs the stack server-side but returns the canonical 7-field envelope with a generic `"Internal server error"` in prod — stack/message only under `NODE_ENV==="development"`. Postgres `23505→CONFLICT`, `23503→VALIDATION`. Domain errors route via `asyncHandler`; unmatched routes via `notFoundHandler`. The 2 raw shapes in `routes/auth.ts` (429 `retryAfterSecs` / 401 `attemptsRemaining`) remain the only documented exceptions.

## 5.5 — Authorization depth (✅ PASS)

`requireAuth`/`requireRole` derive the kernel scope purely from HTTP method (`middlewares/auth.ts` `scopeForMethod`: GET/HEAD→`read`, POST/PUT/PATCH/DELETE→`write`). By construction a GET always runs `read` and a mutation always `write`, so a scope inversion (GET-does-write, or mutation under read) is not structurally possible; CSRF is method-gated in the kernel. Matches F-P2-5 + ADR-010 (read = bounded fail-open, write = fail-closed).

---

**Deliverable status:** Phase 5 (5.1–5.5) complete. Findings: F-P5-1..5 (5.1) fixed + the `.default(1)` eradication (migration 0027); 5.2–5.5 PASS with cleanups noted above. Next: Phase 6 (DevOps/observability) — gated on D1/D2 (both decided).
