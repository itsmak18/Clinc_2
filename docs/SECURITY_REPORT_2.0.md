# Security Report 2.0

| | |
|---|---|
| **Date** | 2026-06-23 |
| **Branch** | `security/search-doctor-scope` |
| **Head commit** | `5fa3896` — *security: review remediation (F-1..F-5) + audit-campaign WIP checkpoint* |
| **Base** | `origin/main` (merge-base `5a98a0f`) |
| **Reviewer** | Claude Code (`/security-review`) |
| **System** | MediCore — internal-staff clinic management (HIPAA-eligible, multi-tenant) |
| **Overall score** | **8.5 / 10** |

---

## 1. Verdict

**No exploitable High/Critical vulnerability is introduced by this branch.**

The diff is a large WIP checkpoint (2 commits, **208 hand-written source files** across the API server, React SPA, and DB migrations 0031–0038) plus uncommitted working-tree changes. The headline work — doctor-scope enforcement on global search, CSP/search-input hardening, and the new imaging file-upload feature — is implemented to the security standard the rest of the codebase already sets.

Two real defects were found — both **operational / security-adjacent rather than exploitable vulnerabilities**, so they are reported without CVSS-style labels: a migration-safety issue (Issue 1) and a `SECURITY.md` documentation gap that can cause irreversible PHI loss during key rotation (Issue 2). Four low / defense-in-depth nits follow.

---

## 2. Scope & methodology

**In scope:** `git diff origin/main..HEAD` (committed) **and** the uncommitted working tree.

- **Deep-read** (line-by-line): crypto, file upload + storage, CSP/security-header wiring, auth core (JWT), tenant-isolation migrations, the search-scope service, frontend print/XSS sinks, and the new PHI services (vitals et al.).
- **Pattern-swept** (targeted greps, not full read): the ~45 shadcn UI primitives and mirror route files (e.g. `ultrasound.ts`, which mirrors the deep-read `xray.ts`).
- **Excluded:** generated artifacts (migration snapshot JSON, Orval API client/zod output), lockfiles.

**Checks performed:** SQL injection sinks, XSS sinks (`dangerouslySetInnerHTML`/`innerHTML`/`document.write`), SSRF/command-exec, raw-SQL parameterization, tenant-isolation (`clinic_id` + RLS) on every new table and service, crypto correctness, file-upload validation (type/size/path/IDOR/encryption), CSP strength, auth-core weakening, committed secrets, and compose hardening regressions. Documentation (`SECURITY.md`) claims — file references, the data-scoping invariant, and the field-encryption rotation column list — were cross-checked against the code (see Issue 2, L4).

---

## 3. Findings

### Issue 1 — Migration 0035 makes `services_catalog.clinic_id` NOT NULL with no backfill
**Class:** deploy-safety / data-migration · **Security-adjacent** · *not an exploitable vulnerability (reported without a severity label by design — there is no attacker path).*

**Evidence**
- `services_catalog` was created **global** (no `clinic_id`) in `lib/db/migrations/0000_rare_silver_fox.sql:262`, and is populated by the seed (`scripts/src/seed.ts:428`).
- `lib/db/migrations/0035_noisy_violations.sql:1` runs:
  ```sql
  ALTER TABLE "services_catalog" ADD COLUMN "clinic_id" integer NOT NULL;
  ```
  with **no `DEFAULT` and no `UPDATE` backfill**.

**Impact**
1. On any database that already holds catalog rows at upgrade time, the `ALTER` aborts: `column "clinic_id" contains null values`. Drizzle has no down-migrations, so a partially-applied deploy requires roll-forward-hotfix or restore-from-backup (RUNBOOK §10).
2. **The integration-db suite cannot catch this.** The harness applies migrations to a fresh, empty scratch DB *before* seeding, so `services_catalog` is empty when 0035 runs and the suite passes green. The green result is false confidence on this change.
3. **Security-adjacent failure mode.** The obvious "make the deploy succeed" hotfix is to add `DEFAULT 1` to the column — the exact anti-pattern migration 0027 deliberately removed, which reintroduces the silent cross-tenant default-leak class. Converting a global table to tenant-scoped also forces a real decision about which clinic the pre-existing rows belong to.

**Remediation**

Use the populated-table-safe sequence:
```sql
ALTER TABLE "services_catalog" ADD COLUMN "clinic_id" integer;          -- nullable first
UPDATE "services_catalog" SET "clinic_id" = <intended owner>;           -- deliberate ownership mapping
ALTER TABLE "services_catalog" ALTER COLUMN "clinic_id" SET NOT NULL;   -- enforce after backfill
```
Then add a regression test that **seeds `services_catalog` rows before** running the migration, so the harness exercises the non-empty path that production will hit.

---

### Issue 2 — `SECURITY.md` field-encryption rotation list is incomplete → irreversible PHI loss
**Class:** documentation / operational-runbook · **Security-relevant (PHI data-loss)** · *not an exploitable vulnerability.*

`SECURITY.md` is otherwise accurate and detailed (all four `lib/*.ts` links resolve; the secret-management, JWT-rotation, HIBP fail-open, and consent-scope sections are correct), but its field-encryption key-rotation runbook has drifted behind the code this branch adds.

**Evidence**
- `SECURITY.md` §"Field-encryption key rotation" step 5 (migrate rows) and step 6 (retirement-verification query) enumerate **five** encrypted columns:
  `patients.allergies`, `patients.emergencyContact`, `medical_records.diagnosis`, `medical_records.vitals`, `prescriptions.medications`.
- The code encrypts **two more**, via the **same** key registry, both new on this branch:
  - `vitals.vitals` — `artifacts/api-server/src/services/vitals.service.ts:47` (`encryptJsonNullable`).
  - `imaging_attachments` file bytes — `artifacts/api-server/src/services/imaging-attachments.service.ts:121` (`encryptBuffer`; on-disk `.enc` files keyed by `encKid`).
- `encryptBuffer`/`decryptBuffer` share the field-helper kid registry (`artifacts/api-server/src/lib/field-encryption.ts:178`), and `decryptBuffer` throws when the kid is absent (`field-encryption.ts:194`).

**Impact**

An operator following the documented retirement checklist verifies only the five listed columns, gets a false "all clear," removes the old `field_encryption_key`, and **permanently orphans** every `vitals.vitals` row and imaging `.enc` file still written under the old kid — `decryptBuffer` then throws `kid="…" is not registered` and the PHI is unrecoverable. `SECURITY.md`'s own bolded warning ("Never delete `field_encryption_key` without first migrating all rows") is undercut by its own incomplete list.

**Remediation**
- Add `vitals.vitals` and `imaging_attachments` to the step-5 migration list and the step-6 retirement check. Note the imaging check differs in form — it verifies the `enc_kid` column on `imaging_attachments` (and re-encrypts the on-disk files), not a `LIKE 'enc:v…'` scan of a text column.
- Adopt a standing rule mirroring the existing erasure discipline ("new PHI table ⇒ extend `executeErasure`"): **new field-encrypted column or file ⇒ extend the `SECURITY.md` rotation + retirement list**.

**Status:** ✅ Fixed 2026-06-25 in `docs/SECURITY.md` — steps 5 & 6 and the secret-table descriptor now include `vitals.vitals` and `imaging_attachments` (with a per-class retirement check), and the standing rule is documented inline. *(Uncommitted.)*

---

### Low / informational (defense-in-depth — not vulnerabilities)

| ID | Location | Note |
|----|----------|------|
| **L1** | `artifacts/api-server/src/lib/csp.ts:23` | `imgSrc` still allows `https:`. Study images are now served same-origin via the authenticated download endpoint, so `https:` is no longer needed and can be dropped to shrink the exfil surface. Keep `data:` for inline. |
| **L2** | `artifacts/clinic/src/lib/print.ts:398` | `invoiceHtml` interpolates `${it.quantity}` (and `${i+1}`) without `escapeHtml`. Typed `number` + server-validated, so not exploitable, but it is the one dynamic value in the file not honoring its own "escape every dynamic value" contract. Wrap for consistency. |
| **L3** | `artifacts/api-server/src/services/imaging-attachments.service.ts:134` | `caption` is stored unbounded while `fileName` is capped at 120 chars. Cap `caption` length too. |
| **L4** ✅ | `docs/SECURITY.md:10` | Invariant #2 granted doctors access "(or if explicitly marked as global)" — `isGlobal`/`globalReason` were removed in migration 0011 (zero matches in schema/service), so it documented a removed scope-bypass. **Fixed 2026-06-25:** parenthetical removed and the doctor-scope list widened (records, prescriptions, lab, x-ray, ultrasound, vitals, appointments + read-only break-glass). *(Uncommitted.)* |

---

## 4. Controls verified to hold (evidence-based, not assumed)

- **Multi-tenant isolation** — every new clinic-bearing table (`inventory_transactions`, `services_catalog`, `vitals`, `imaging_attachments`) ships the **dormant** `tenant_isolation` RLS policy (correct `app.rls_enforce` gate + `nullif` guard — *not* the broken non-dormant 0022 pattern), `CHECK (clinic_id > 0)`, and the `medicore_app` grant. No `clinic_id` DEFAULT reintroduced. New services set `clinicId` on insert and run reads inside `runInTenantContext`; a forgotten `clinicId` now fails closed (NOT NULL, no default → 23502).
- **Search doctor-scope (headline)** — `services/search.service.ts` applies `getDoctorListScope` + `inArray(allowed)` + `eq(clinicId)` + RLS across all three result sets, escapes LIKE metacharacters, caps the term at 100 chars, and excludes the AES-GCM-encrypted `diagnosis` column.
- **Imaging upload/download** — magic-byte sniffing (client MIME ignored); server-generated UUID storage keys; path-traversal guard in `imaging-storage.ts`; AES-256-GCM at rest; download gated by clinic + modality + recordId + attId + RLS + doctor-scope; `Cache-Control: private, no-store`; `encodeURIComponent` filename (no header injection); helmet `nosniff` global. The orphan reconciler refuses to mass-delete on a suspicious empty live-set.
- **Crypto** (`lib/field-encryption.ts`) — random 96-bit IV per operation, GCM tag verified on decrypt, kid-based rotation, production fail-closed when no key registered, IV/tag length validation.
- **Injection** — no `sql.raw` in production code; the two raw `sql\`\`` sites (`reports.service.ts:463`, `middlewares/rateLimiter.ts:46`) are fully parameterized (bound `${...}`), and the reports query carries `clinic_id = ${clinicId}`.
- **XSS** — `print.ts` / report templates escape every field via `escapeHtml`/`safeUrl` (http/https allowlist); `DischargeSheet` serializes React-escaped DOM and sets the window title via the DOM `.title` API, not string interpolation; no `dangerouslySetInnerHTML` anywhere in the frontend. Uncommitted work is i18n + a JSX-rendered collapsible record view — no new sinks.
- **Auth core not weakened** — the only `lib/auth.ts` change is an additive optional `timezone?` claim; JWT verification, `fph` fingerprint binding, `jti`, `kid`, and revocation are untouched.
- **Headers / CORS / metrics** — CORS never falls back to wildcard; `/metrics` fails closed in production with a constant-time token compare; strong CSP with no `unsafe-inline` / `unsafe-eval`.
- **Secrets & infra** — no real `.env` tracked, no secret in `.env.example`, no secrets in `seed.ts`; the only `docker-compose.prod.yml` change adds the encrypted `imaging_data` volume to the backup set **read-only** (`:ro`). No `privileged`, no removed `read_only`, no new public ports.
- **Frontend RBAC** — `route-access.ts` changes are tightening (nurse removed from medical-records) plus new narrowly-scoped routes, backed by the existing `route-access.contract.test.ts` parity test. (Frontend nav is defense-in-depth; the backend `authGate`/`requireRole` remains the real gate.)

---

## 5. Coverage limitations

This review deep-read the high-risk surfaces and pattern-swept the remainder; it did **not** exhaustively read all 208 changed files. The ~45 shadcn UI primitives and mirror route files were checked by targeted grep rather than line-by-line. Nothing in the sweep contradicted the deep reads. As with any review, the next layer may surface additional low-severity items — the 8.5 score reflects that residual uncertainty, not a claim of perfection.

---

## 6. Score rationale (8.5 / 10)

Security engineering of the reviewed changes is ~9 — mature, defense-in-depth, fail-closed, with real RLS tenant isolation, correct AES-256-GCM, a hardened file-upload path, a strong CSP, parameterized SQL, escaped XSS sinks, and an append-only audit chain. The deliverable is pulled to **8.5** by Issue 1 (a real upgrade-breaking migration whose security-adjacent hotfix reintroduces a tenant-isolation footgun, *masked* by the test harness) and Issue 2 (a `SECURITY.md` rotation-runbook gap that can orphan PHI under a retired key), plus four low nits and honest coverage limits.

**Path to ~9.5:** fix 0035 with a backfill + a *seeded-before-migrate* upgrade test, correct the `SECURITY.md` rotation/retirement list (Issue 2), and close L1–L4.

---

## 7. Action checklist

- [ ] **Issue 1** — rewrite `0035_noisy_violations.sql` as nullable → backfill → `SET NOT NULL`; decide ownership of pre-existing global catalog rows.
- [ ] **Issue 1 (test)** — add an upgrade test that seeds `services_catalog` *before* migrating.
- [x] **Issue 2** — added `vitals.vitals` + `imaging_attachments` to `docs/SECURITY.md` rotation (step 5) and retirement-verification (step 6) lists + the standing rule. *(Fixed 2026-06-25, uncommitted.)*
- [ ] **L1** — drop `https:` from CSP `imgSrc`.
- [ ] **L2** — `escapeHtml` the numeric interpolations in `invoiceHtml`.
- [ ] **L3** — bound `caption` length in `uploadAttachment`.
- [x] **L4** — deleted the stale "(or if explicitly marked as global)" clause in `docs/SECURITY.md` invariant #2 and widened the doctor-scope list. *(Fixed 2026-06-25, uncommitted.)*

---

*Generated by `/security-review` against `security/search-doctor-scope` @ `5fa3896` on 2026-06-23.*
