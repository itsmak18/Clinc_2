# Session Handoff — full uncommitted working tree (2026-06-15 → 2026-06-19)

> **Scope upgrade (2026-06-19):** this handoff previously covered only the *Inventory & Billing* slice. It now documents the **entire uncommitted working tree**, because the next session inherits all of it — not just those two modules. Per-entry detail lives in [`docs/CHANGELOG.md`](docs/CHANGELOG.md) (newest-first); this file is orientation + must-dos + gotchas.

## 0. Repo state at handoff — READ FIRST

- **Nothing here is committed.** `git log` shows the last real commit is an automated backup (`5a98a0f`, 2026-06-15 18:47). Everything below sits in the **working tree on `main`** (`git status`: ~50 modified, ~20 untracked). There is **no feature branch** and **nothing has been pushed**.
- **Migrations in the tree, applied to the DEV database only, NOT committed:** **0031, 0032, 0033, 0034, 0035** (0029/0030 are already committed). None have touched staging/prod. See §2.
- **Last reported validation (per-session, in `docs/CHANGELOG.md`):** `pnpm run typecheck` clean (4 projects + libs), frontend **45/45**, backend **492/492**, contract-routes green. **Re-run the full suite before committing** — the tree is large and the numbers were captured incrementally across several sessions, not in one pass. See §6.
- Recommended first action for the next session: decide commit strategy (one squashed commit vs. per-module), run §6, then §3.

---

## 1. What's in the tree (by module)

Concise; full rationale + "Verify" lines per item are in `docs/CHANGELOG.md`.

### Branding — MediCore → "Wateen Clinic" (WIP, **not yet in CHANGELOG**)
- `artifacts/clinic/index.html`: title → **Wateen Clinic**, favicon → `/favicon.png`.
- New assets: `public/favicon.png`, `public/wateen-full.png`, `public/wateen-mark.png`; `public/favicon.svg` deleted.
- `scripts/src/update-db.ts` (new): one-off script that rewrites existing `notifications.title/message` text from "MediCore" → "Wateen Clinic".
- ⚠️ **Incomplete rebrand:** code, docs (`CLAUDE.md`, `docs/*`, ADRs), email templates, and the Docker image name (`medicore-api`) still say "MediCore". Treat this as in-progress — see Gotchas.

### Patients
- **Required per-clinic-unique ID card number** (`idCardNumber`) — migration `0029` (committed) + frontend field/column/CSV. Backstopped by unique index `patient_clinic_idcard_uq`; service does a friendly 409 pre-check.
- **`mrn_seq` / `invoice_seq` are now real migrations** (`0030`, committed) — previously created only by the dev seed, so a fresh prod DB would have failed the first registration/invoice. `0030` is `CREATE SEQUENCE IF NOT EXISTS` (no-op where seeded).
- **Bug fix:** `generateMRN()` destructured `db.execute()` as an array — node-postgres returns `{ rows }`, so **every** `createPatient` 500'd. Fixed to read `.rows`. Regression test `registration.integration-db.test.ts`.
- **Bug fix:** CSRF origin check hardcoded `localhost:5173`; Vite on `:5174` got every browser mutation rejected. Non-prod now trusts any `localhost`/`127.0.0.1` port (prod still `ALLOWED_ORIGINS` only).

### Diagnostics — Lab / X-Ray / Ultrasound
- **Searchable patient picker** + **requester locked to signed-in user** across all three create dialogs.
- **Multiple images per study** (X-Ray + Ultrasound) — new `images` jsonb (`[{url, fileName?, caption?}]`), `imageUrl` kept as cover. New `components/ImageListEditor.tsx`; printed reports render an **Images (N)** gallery (http/https only). Migration **`0031`**.
- **Multi-add orders** (all three) — nullable `order_group_id` + `(clinic_id, order_group_id)` index (migration **`0031`**). One Save creates N rows sharing a client-generated id (`lib/ids.ts`); list shows a **Layers · N** badge. No new endpoint (client loops `mutateAsync`).
- **Blank prescription** print (no record created) — `blankPrescriptionHtml`.

### Operations
- **Searchable patient + surgeon pickers; recorded surgical team** (`staffAssigned` = `[{userId, role?}]`). Contract fix: OpenAPI had `staffAssigned: integer[]`; added `StaffAssignedItem` to match the zod guard.
- **Approval gate:** new `requested` status (migration **`0032`**, enum value before `scheduled`) + `operations.requested_by_id` (migration **`0033`**, server-set FK). Doctor-created op → `requested` + notifies admins; admin-created → `scheduled`; **Approve** (admins only) → `scheduled` + notifies surgeon/team. Enforced server-side in `updateOperation` (doctor moving `requested`→`scheduled` = `ForbiddenError`, audited `APPROVE`).
- **Bug fix:** surgeon picker fetched via `/users` (403 for doctors → empty list). Now uses doctor-accessible `GET /users/doctors`; OR-team picker shown only to roles that can list staff.

### Prescriptions
- Searchable patient picker; **prescriber always locked to signed-in user** (even admin/super_admin).
- **Send-to-Pharmacy:** `POST /prescriptions/{id}/send-to-pharmacy` notifies every active clinic pharmacist (in-app + SSE IDs-only), audits `SEND_TO_PHARMACY`. Pharmacy chooser simplified to two buttons (External = print / In-Clinic = send).

### Medical Records
- **Consent banner** (blocks Save without active `treatment` consent; server enforces 422/3010), **allergy banner**, **structured + validated vitals** (split BP, RR, abnormal-range highlight, auto BMI, hard-bound to `vitalsSchema`).
- **Two latent bugs fixed:** (1) form sent `vitals.bloodPressure: "120/80"` (string) vs `.strict()` schema → every record with BP rejected 400; (2) `decryptJson` crashed on the already-parsed JSONB round-trip in dev (no encryption key). No medical record with vitals had ever saved before this.

### Schedule
- **New "Day" appointment dashboard** (`components/ScheduleDayView.tsx`) — date nav, doctor filter, hour-grouped timeline, overview sidebar (stats + doctor-load bars + emergency banner), click-to-expand cards. Default tab; weekly-template editor preserved behind a second tab and polished (shared `components/DoctorAvatar.tsx`, day cards).
- Backend (no contract change): `listAppointments` select widened to carry `patient.dateOfBirth/phone/insuranceProvider`, `doctor.specialty`, `bookingSource`, `triagePriority`.
- **Booking fix:** `doctor_schedules` was empty (0 rows) so every booking failed "No schedule for this day" — root cause was data, not logic; seed now creates full-week schedules for seeded doctors.

### Triage
- **Shelved behind a `ComingSoon` placeholder** (`components/ComingSoon.tsx`). The kanban impl is kept intact as `TriageWorkflow` (unrendered) — re-enable by exporting it as default. `/triage` route/nav unchanged.
- ⚠️ **Nurse still lands on `/triage`** (`getLandingRoute`), i.e. on the placeholder. The `triage`/`ready` state transitions themselves are unaffected (they fire via the API, NurseVitals, FrontDeskCheckin, Doctor dashboard, Schedule day view).

### Appointments — state-machine correctness (2026-06-20, this session)
From a patient-flow architecture review (`~/.claude/plans/clinic-patient-flow-wondrous-castle.md`). Three correctness defects in the transition path (`services/appointments.service.ts`); **no schema/migration change.**
- **Compare-and-swap on every status write** — `transitionAppointment` / `checkinAppointment` / `cancelAppointment` now append `eq(status, expectedFrom)` to the UPDATE; 0 rows ⇒ `ConflictError` 409. Stops concurrent-click lost updates (the validated source status is the CAS token — no `version` column).
- **Cancel routed through the state machine** — `DELETE /appointments/:id` previously bypassed `validateTransition`: it could flip a terminal `completed`/`no_show` back to `cancelled` and threw a raw `TypeError` (→ 500) on a missing/cross-tenant id. Now SELECT-first (→ 404) + `validateTransition("cancel", …)` (→ 409 on terminal) + before/after `auditSnapshot`.
- **Invalid transitions now 409/403, not 500 (latent, ALL transition endpoints)** — the failure path threw `Object.assign(new Error, { status })`, which `asyncHandler` does not map (it handles only `instanceof` domain errors) → 500 on *every* bad transition (e.g. triage a `scheduled` appt). New `transitionError()` helper (403 → `ForbiddenError`, 409 → `ConflictError`).
- **Test:** new `appointment-lifecycle.integration-db.test.ts` (6 tests, real Postgres). Backend **493/493** unit + this file green; typecheck clean. CHANGELOG entry dated 2026-06-20.
- **Open (P1, from the review, NOT built):** `reconsult` reversal (`awaiting_diagnostics → in_consultation`) for the doctor "send back / resume after results" loop; cross-role real-time (SSE currently fires on only 2 of 9 transitions, doctor-only → other boards poll every 30s).

### Inventory
- **Full admin management** — `DELETE /inventory/:itemId` (soft-delete); `updateInventoryItem` writes before→after change-history. UI: edit dialog, delete confirm, quick −/+ stock steppers, category + low-stock filters, summary stat chips, active/inactive toggle.
- **Stock-movement ledger** — new table **`inventory_transactions`** (migration **`0034`**, UUID-v7 PK, full tenant RLS). Every change writes signed `delta` + `quantityAfter` + `reason` (`initial|restock|consumed|expired|adjustment`) + `note` + `performedById`. New endpoints `POST /inventory/:id/adjust` (atomic, rejects result < 0) and `GET /inventory/:id/transactions`. UI: per-item "Stock Movements" dialog; the −/+ steppers now post real ledger movements.
- **Expiry early-warning** — items within **30 days** show an amber "Expiring soon" status + a 4th stat chip (Total / Low / Expiring soon / Expired).

### Billing
- **Daily reconciliation / Z-report** — `GET /billing/reconciliation` (super_admin only). Two lenses on a day: money **collected** (by `paidAt`) and invoices **created**. New page `/reconciliation`, summary cards, CSV, Print. Audited `RECONCILIATION_VIEW`.
- **Service price book** (auto-charge **step 1**) — `services_catalog` made tenant-correct (migration **`0035`**: `clinic_id` NOT NULL FK, `code`, `deleted_at`, CHECK + dormant RLS + `medicore_app` grant — it was NOT in the 0015 RLS set). Full CRUD (`/services-catalog`) + admin page `/service-prices`. **`POST /services-catalog/seed-defaults`** ("Add common services") inserts ~30 bilingual starter services at price 0 (incl. `*_DEFAULT` coded rows for the future charge engine).
- **Service picker on invoice lines** (auto-fills description + admin price; free-text custom lines still work); **bilingual service names** (`nameAr` in AR); **searchable patient** field; **print prompt after create**.
- **Point-of-sale immediate payment** — `CreateInvoiceBody.markPaid`; Save button is "Save & Pay" → invoice `status=paid`, `paidAt=now`. Audited `CREATE` + `PAY (atCreation)`. Intentionally bypasses the pending-flow SoD/anti-fraud gate (owner wants counter collection); the pending → pay-later + per-row "Pay Now" path still exists for deferred/insurance.
- **BUG FIX — invoice Save always failed** "Invalid items format": form sent `{description, quantity, unitPrice, total}` but `invoiceItemSchema` is `.strict()` (first three only). Fix: send only allowed fields, drop blank lines, add pre-submit guards. **Pre-existing latent bug — invoice creation had been broken.**

### Audit Log
- **Page overhaul** — action/entity filters union a curated list with whatever's in the data (new actions can't hide), tones per action, free-text search (user/username/entity-id/IP), a "Hide reads" toggle, split security-events + break-glass-events banner.

### Security
- **HIGH: `GET /search` leaked PHI across doctor scope** — `globalSearch` filtered only by `clinicId`, so any doctor could enumerate every clinic patient + appointment. Now calls `getDoctorListScope(req, "search")` and `inArray(..., allowed)` on all three branches (passes `breakGlassPatientIds` to `runInTenantContext`). `GET /search` added to the CLAUDE.md Doctor Scope Rule enforced-route list.
- **LIKE-injection hardening** — new `escapeLike()` (`lib/validators.ts`) escapes `% _ \` in search + patients services; search term capped at 100 chars; `clinic_notices` content/reason given max lengths.
- New test `search-scope.integration-db.test.ts` (real Postgres, RLS active).

### Cross-cutting
- **CRITICAL spec↔route fix:** 9 update operations were declared `put:` in `openapi.yaml` while every Express route is `patch:` — the generated client issued `PUT` → 404 on **every** edit form. Flipped all 9 to `patch:`, regen'd. Guard added: `contract-routes.test.ts` statically asserts every OpenAPI op has a matching Express route+method.
- **Per-user profile page** (`pages/UserProfile.tsx`, `/users/:userId`, admin/super_admin) with an inline doctor working-hours editor.
- **Admin sidebar visibility** — `super_admin/admin` see a *grouped* menu driven by the hardcoded `ADMIN_SECTIONS` array in `components/Layout.tsx`; new pages (`reconciliation`, `service-prices`) were invisible until their keys were added there. **Recurring footgun — see Gotchas.**

---

## 2. Migrations in the tree

| # | Tag | What | State |
|---|---|---|---|
| 0029 | `complex_micromacro` | `patients.id_card_number` NOT NULL + unique `(clinic_id, id_card_number)` | **committed**, dev-applied |
| 0030 | `unknown_the_leader` | `mrn_seq` / `invoice_seq` as `CREATE SEQUENCE IF NOT EXISTS` | **committed**, dev-applied |
| **0031** | `overrated_johnny_storm` | imaging `images` jsonb + `order_group_id` (xray/ultrasound/lab) + indexes | **uncommitted**, dev-applied |
| **0032** | `tense_trish_tilby` | `operation_status` enum gains `requested` (before `scheduled`) | **uncommitted**, dev-applied |
| **0033** | `left_rhodey` | `operations.requested_by_id` nullable FK → users | **uncommitted**, dev-applied |
| **0034** | `overrated_hercules` | `inventory_transactions` table + enum + full tenant RLS | **uncommitted**, dev-applied |
| **0035** | `noisy_violations` | `services_catalog` clinic-scoped (`clinic_id`/`code`/`deleted_at`) + RLS | **uncommitted**, dev-applied |

All five uncommitted migrations are **additive**. `0035` adds `clinic_id NOT NULL` to `services_catalog`, safe only because that table was empty/unused — if any environment has rows, backfill `clinic_id` first.

---

## 3. ⚠️ Must-do before commit / staging / prod

1. **Commit the tree.** Decide one squashed commit vs. per-module; include the 5 untracked migrations + their `meta/*_snapshot.json` + the `_journal.json` change, or the migrator desyncs.
2. **Re-run the full validation suite** (§6) on the assembled tree before pushing — numbers in §0 were captured incrementally.
3. **Apply migrations 0031–0035** to staging then prod: `pnpm --filter @workspace/db run db:migrate`. (0029/0030 too, if not yet on those envs.)
4. **Seed the price book per clinic** — no price data exists yet. App: **Service Prices → "Add common services"**, then set prices (per-clinic, via the authenticated endpoint).
5. **Re-run codegen on pull** if generated files conflict: `pnpm --filter @workspace/api-spec run codegen`.
6. **Decide the rebrand scope** before shipping the Wateen title/favicon — either finish it (code strings, docs, email templates, image names) or hold it back so the app isn't half "MediCore", half "Wateen". `scripts/src/update-db.ts` is a one-shot data fixup; run it intentionally, not as part of normal migration.

---

## 4. Gotchas / decisions to remember

- **Sidebar (`ADMIN_SECTIONS`):** new nav items are invisible to **super_admin/admin** until their `key` is added to `ADMIN_SECTIONS` in `components/Layout.tsx`. `CLAUDE.md`'s "Adding a New Page" step 6 is **wrong** about this (says no sidebar edit needed) — an attempted CLAUDE.md fix was auto-blocked as self-modification; **update step 6 manually.**
- **`invoiceItemSchema` is `.strict()`** — any line-item with extra keys (e.g. `total`) is rejected. Send only `{description, quantity, unitPrice}`.
- **Point-of-sale `markPaid` bypasses SoD/anti-fraud on purpose** (counter collection). The pending → pay-later flow + per-row "Pay Now" still exist for deferred/insurance. Deliberate policy, not a gap.
- **`services_catalog` is now clinic-scoped** (no longer global). Reads go through `runInTenantContext`.
- **Z-report "collected by"** shows the invoice **creator**, not the cashier — there is no `paidById` column yet.
- **New clinic-bearing tables** must replicate the tenant-isolation block (CHECK + dormant RLS + `medicore_app` grant) **by hand-appending to the generated migration** — `db:generate` only emits the table/FKs/index. See `0034`/`0035` for the pattern, and `docs/MIGRATION_NOTES.md`.
- **Multi-add orders use no new endpoint** — the client loops `mutateAsync` with a shared `orderGroupId`. If you ever need atomicity across the group, that's a backend change.
- **Operation approval is logistics, not medicine** — the surgeon owns the clinical decision; admin approval only confirms room/slot/resources. Don't lock the surgeon to the requester.
- **Rebrand is half-done** — see §1 Branding and §3.6.

---

## 5. Open / suggested next steps

**Directly teed up — Auto-charge engine (step 2):** price book (step 1) is done; the engine is NOT built. Locked decisions: manual **"Generate charges"** button + managed per-item price book. Plan:
1. Migration: add nullable `billedInvoiceId` (FK invoices) to `appointments`, `lab_tests`, `xray_records`, `ultrasound_records`, `operations`.
2. `GET /billing/billable-items?patientId` — scan completed-and-unbilled events; resolve price from `services_catalog` (specific name match → `*_DEFAULT` code fallback → 0 for manual fill). `*_DEFAULT` rows already exist in the seed.
3. `POST /billing/invoices/from-charges` — one tx: create invoice + items, stamp each source row's `billedInvoiceId` (re-check inside the tx to prevent double-billing).
4. "Generate charges" button on Billing that drafts the lines for review.

**Offered, awaiting decision:**
- Fully **remove the pending concept from Billing UI** vs keep for deferred/insurance.
- **Bilingual invoice print** — `invoiceHtml` is English-only; other clinical templates are bilingual.
- **Print receipt after payment** (same prompt pattern as print-after-create).
- Add **`paidById`** so the Z-report is a true per-cashier drawer report.
- **Re-enable Triage** once its workflow is finalized (one-line switch to export `TriageWorkflow` as default).
- **Finish or revert the Wateen rebrand.**

**Earlier module suggestions (not started):** critical-result acknowledgement loops (lab/x-ray), lab reference ranges + auto-flagging, OR scheduling conflict detection, pre-op checklist + consent gate, post-op auto stock consumption (ties into the new ledger), partial payments / insurance pre-auth, drug-interaction/allergy checks, in-clinic-pharmacy → ledger link.

---

## 6. Validation commands

```bash
pnpm run typecheck                                   # 4 projects + libs
pnpm --filter @workspace/clinic run test             # frontend (45/45) — incl. i18n EN/AR parity + RBAC-parity contract
pnpm --filter @workspace/api-server run test         # backend (492/492) — incl. contract-routes
pnpm --filter @workspace/api-server run test:integration-db   # real-Postgres suite (incl. search-scope, registration, appointment-lifecycle)
# ^ no Docker locally? point the harness at the dev Postgres SUPERUSER — it makes a throwaway scratch DB and drops it on teardown (never touches clinic_db):
#   $env:INTEGRATION_PG_ADMIN_URL="postgresql://postgres:<pw>@localhost:5432/postgres"   (verified working 2026-06-20)
pnpm --filter @workspace/api-spec run codegen        # after any openapi.yaml edit
# migrations (set DATABASE_URL from .env first):
pnpm --filter @workspace/db run db:generate
pnpm --filter @workspace/db run db:migrate
```
