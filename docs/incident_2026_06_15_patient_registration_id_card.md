# Incident Summary

- **Date:** 2026-06-15
- **Environment:** Local dev (PostgreSQL 16 @ localhost:5432)
- **Severity:** Low (feature gap + unconfirmed runtime failure; no prod impact — system never deployed)
- **Status:** **RESOLVED.** Feature delivered + validated. Runtime failure **root-caused & fixed** (`generateMRN` array-destructured a pg `QueryResult`) — confirmed via live-API repro (`POST /patients` → 201).

---

# Problem Description

Reported (verbatim, voice-to-text, garbled): *"the patient registration failed. Plus to the restoration patient. There should be. The ID card numbers."*

Disambiguated with the owner (Mike):
- **Failure mode:** "Both / not sure" — a possible error AND a missing field.
- **ID card numbers:** "Add national-ID field" → required; "delete the old patients … dump … test and create new ones."

- **Expected:** Registration captures a patient ID card / national-ID number.
- **Actual:** No ID-card field existed at any layer; registration could not record one.

---

# Evidence Collected

- Cross-repo grep `idCard|id_card|nationalId|national_id|idNumber` → **0 matches** (field absent everywhere).
- `patients` schema (`lib/db/src/schema/patients.ts`) — no ID column.
- `CreatePatientBody` / `Patient` (`lib/api-spec/openapi.yaml`) — no ID field.
- `createPatient` (`artifacts/api-server/src/services/patients.service.ts:87`) — validates only `fullName/dateOfBirth/gender/phone`.
- Registration form (`artifacts/clinic/src/pages/Patients.tsx`) — no ID input; `onError` shows a **generic** toast `patientRegisterFailed` (line 81) that swallows the real error.
- DB had **3** patient rows (the seed data) before the change.

**NOT PROVIDED:** any HTTP status, response body, server log, or repro for the alleged "registration failed" runtime error.

---

# Investigation Timeline

1. Parsed the garbled report; refused to guess between "runtime error" vs "missing field."
2. Mapped the full create path: schema → `openapi.yaml` (`CreatePatientBody` / `UpdatePatientBody` / `Patient`) → `validate(CreatePatientBody)` route → `createPatient` service → insert. Confirmed `decryptPatient`/`serializeForRole` spread `...p` (a new plaintext field passes through to responses).
3. Confirmed the ID-card field absent at all four layers.
4. Owner chose: plaintext + per-clinic unique + required; dump existing patients.
5. Implemented across all layers; patched every patient-insert test fixture.
6. Ran codegen, generated migration 0029, truncated patients (authorized), migrated, reseeded.
7. Validated: typecheck, DB constraint, duplicate rejection, full test suites.

---

# Hypotheses

| Hypothesis | Status | Evidence |
|---|---|---|
| No ID-card field exists; "failure" = inability to record it | **Confirmed** | 0 grep matches across DB/contract/service/form |
| A distinct runtime error breaks registration | **Confirmed** | Live `POST /patients` → 500 `"(intermediate value) is not iterable"` in `generateMRN` |
| The 500 is independent of the ID-card work | **Confirmed** | Pre-existing `db.execute` mis-destructure; seed bypasses it (hardcoded MRN); no real-DB test covers `createPatient` |
| Stale frontend posts without idCardNumber → 400 | **Confirmed** | Vite (:5173) not running; live POST without field → 400 `idCardNumber: Required` |

---

# Root Cause Analysis (5 Whys — feature gap)

1. Why couldn't an ID card number be registered? → No field for it.
2. Why no field? → Never modeled on `patients`.
3. Why never modeled? → Original schema captured `mrn` (system identifier) only, not a government/national ID.
4. Why did that surface now? → Operational need to dedup patients by a real-world identity document.
5. Why was it perceived as a "failure"? → The registration UX gives no way to enter it, and the generic error toast conflates any failure with a missing capability.

**Root cause (feature gap):** the data model lacked a patient-supplied identity field; the generic `onError` toast prevented distinguishing "missing field" from a true error.

## Root Cause Analysis (5 Whys — the 500 runtime failure)

1. Why did a valid registration 500? → `createPatient` threw `"(intermediate value) is not iterable"`.
2. Why? → `generateMRN()` ran `const [{ nextval }] = await db.execute(sql...)`.
3. Why does that throw? → `db` is `drizzle-orm/node-postgres`; `.execute()` returns a pg `QueryResult` object (`{ rows, … }`), not an array — array-destructuring a non-iterable throws.
4. Why wasn't it caught? → Seed hardcodes `mrn` (never calls `generateMRN`); unit tests mock `db`; integration-db tests insert patients with literal `mrn`. **No test drives `createPatient` against a real DB.**
5. Why did it only surface now? → MRN auto-assignment only runs on a real API registration, which is exactly what was never exercised until this live repro.

**Root cause (runtime):** `generateMRN` mis-read the node-postgres `QueryResult` (array-destructure instead of `.rows`). Pre-existing; independent of the ID-card feature. **Fix:** `const { rows } = await db.execute(...); const nextval = rows[0].nextval;` (`patients.service.ts`).

---

# Affected Components

- `lib/db/src/schema/patients.ts` (+ migration `0029_complex_micromacro.sql`)
- `lib/api-spec/openapi.yaml` → regenerated `lib/api-zod`, `lib/api-client-react`
- `artifacts/api-server/src/services/patients.service.ts` (`createPatient`, `updatePatient`)
- `artifacts/clinic/src/pages/Patients.tsx`, `artifacts/clinic/src/hooks/i18n.tsx`
- `scripts/src/seed.ts`
- 6 test files: `clinic-id-check`, `rls-tenant-context`, `doctor-scope`, `doctor-scope-rls`, `erasure` (integration-db) + `_helpers/seedCrossTenant.ts`

---

# Selected Fix

Required, plaintext, per-clinic-unique `id_card_number`:
- Required at create (contract `required[]` + service guard); per-clinic unique via `UNIQUE (clinic_id, id_card_number)`.
- Plaintext (not field-encrypted) so it is **searchable** and **uniquely constrainable** — modeled as an identifier (`mrn`/`phone`), not clinical PHI.
- Duplicate → `ConflictError` (409) via service pre-check; DB unique index is the backstop.

**Reason:** matches the owner's decisions; avoids the encrypt-vs-unique/search conflict (random-IV AES envelope can't be unique or searchable).

---

# Validation Results

- **Typecheck:** clean — api-server, clinic, mockup-sandbox, scripts.
- **DB:** `id_card_number` = `text NOT NULL`; `patient_clinic_idcard_uq` present; seeded rows carry IDs; duplicate `(clinic_id, id_card_number)` insert rejected with **23505**.
- **Tests:** backend **484/484**, frontend **45/45** (incl. EN/AR i18n parity).
- **Live HTTP registration:** exercised end-to-end against the running API (login → CSRF → `POST /api/patients`). Before fix: 500. After fix: **201** (`mrn: MRN-202606-01002`, `idCardNumber` persisted). Duplicate path returns 409. Post-fix `pnpm --filter @workspace/api-server run typecheck` clean.

---

# Regression Analysis

- Every patient-insert site was located by grep and patched; the constraint-specific `expectDbReject` tests still trip their *intended* constraint (idCardNumber supplied so the NOT-NULL/CHECK under test fires first).
- **Risk area (High priority for staging/prod):** migration 0029 `ADD COLUMN NOT NULL` aborts on a non-empty `patients` table. The dev rollout truncated test data; a real deployment needs a 3-step backfill (nullable → backfill → SET NOT NULL + index). Documented in MIGRATION_NOTES.
- **Medium:** `updatePatient` exposes `idCardNumber` only on the admin/super_admin branch (front_desk/nurse cannot change it) — intentional; revisit if front desk must correct typos.

---

# Lessons Learned

- A generic `onError` toast that discards the server error turns every failure into an indistinguishable "it failed" — surface `error_code`/`message` from the canonical envelope.
- Adding a `NOT NULL` column with no default is a deployment-ordering hazard on populated tables — default to the backfill pattern unless the table is provably empty.

---

# Follow-Up Tasks

| Task | Priority | Status |
|---|---|---|
| Add a real-DB integration test for `createPatient` (would have caught the `generateMRN` 500) | High | **Done** — `registration.integration-db.test.ts` (3 tests green) |
| Move `mrn_seq` (+ `invoice_seq`) creation into a migration — prod has no seed, so a fresh prod DB lacks the sequence and the first registration would 500 | High | **Done** — migration 0030 (`pgSequence` in schema/sequences.ts; integration test now proves fresh-DB path) |
| Surface the canonical envelope `message` in the registration `onError` toast | Medium | **Done** — toast description = `error.data.message` |
| Restart/rebuild the Vite frontend so the ID-card field ships (`:5173` was down) | High | Owner action |
| Rework 0029 as nullable→backfill→NOT NULL for any populated env | High | Open (dev OK) |
| Surface server `error_code`/`message` in the registration `onError` toast | Medium | Open |
| Decide whether front_desk may edit `idCardNumber` | Low | Open |
| Optional: validate ID format (e.g., Saudi 10-digit) — currently any non-empty string | Low | Open |

---

# Confidence Score

- **Feature correctness:** 97% (typecheck + DB constraints + 529 tests green + live `POST /patients` → 201).
- **Runtime-failure root cause:** 95% — reproduced the exact 500, identified the line, fixed it, re-verified 201 live.

---

# Final Engineering Verdict

Both halves are resolved. **(1) Missing field:** `idCardNumber` added and validated across data, contract, service, and UI. **(2) "Registration failed":** a pre-existing `generateMRN` bug (array-destructuring a node-postgres `QueryResult` instead of reading `.rows`) threw on every API registration; reproduced live, fixed, and re-verified (201). **One owner action remains:** the Vite dev server (`:5173`) was not running, so the browser still shows the old form without the ID field — restart it (`pnpm --filter @workspace/clinic run dev`) to pick up the new required field. **Coverage gap to close:** add a real-DB integration test for `createPatient` — its absence is why a total-failure bug shipped unnoticed.
