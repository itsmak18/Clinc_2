# Audit Findings — Phase 2: Authentication & Session Security

**Date:** 2026-06-03
**Baseline:** working tree (diff-aware) over `main @ 7014f95`. The break-glass-into-doctor-scope wiring (`lib/scope.ts`, `services/medical-records.service.ts`) is **uncommitted WIP**.
**Rating bar:** stricter (D2 "real PHI?" undecided → assume real PHI).

---

## Verified PASS (auth kernel is strong)

| Check | Evidence |
|---|---|
| `super_admin` cannot bypass tenancy | `policy.ts:255` skips only the *role* check for super_admin; the tenancy check (`:264-269`) runs unconditionally → positive `clinicId` always required. |
| CSRF token is cryptographically random | `csrf-cookie.ts:12` `randomBytes(24)` (192-bit), `httpOnly:false` (double-submit), `secure`(prod), `sameSite:strict`. Kernel compares with `timingSafeEqual` (`policy.ts:149`). |
| CSRF origin allowlist + double-submit | `policy.ts:135-153` — origin exact-match (proto+host+port) when present, plus header/cookie token equality, method-gated to mutations. |
| Single auth kernel — no legacy bypass | `middlewares/auth.ts` `requireAuth`/`requireRole` are thin shims over `authGate` → `evaluate()`. No surviving `verifyToken` path. |
| Inbound auth-header spoofing stripped | `auth-gate.ts:14-20` deletes client-sent `x-session-state` / `x-security-flags`; kernel throw → `INFRA_INTERNAL` fail-closed (`:22-25`). |
| Revocation bounded fail-open (ADR-010) | `policy.ts:186-212` — reads degrade only within `REVOCATION_READ_GRACE_MS` of last healthy contact; `write`/`privileged` always fail closed. |
| JWT verification | `policy.ts:51-57` EdDSA pinned (`algorithms:["EdDSA"]`), 30s clock tolerance, local JWKS. Keys required in prod (`jwt-secret.ts:85-97`), `SESSION_SECRET` required in prod (`:51-56`). |
| Password hashing | `password.ts` bcrypt rounds=12; legacy HMAC auto-migrates on login; HIBP k-anonymity correct (`:97-111`); strict policy adds special+dictionary+HIBP. |
| Cookies | `clinic_token` `httpOnly+secure(prod)+sameSite:strict`, per-role `maxAge` (`routes/auth.ts:81-87`); logout revokes + clears (`:101-117`). |
| Break-glass core | `break-glass.service.ts` — clinic-scoped, justification(≥30)+category gated, 5-min unapproved grace → 15-min on approval, self-approval forbidden, compliance SSE alert, every access audited. |

---

## Findings

### F-P2-1 — Break-glass grants demographics but NOT clinical PHI (emergency access non-functional for doctors)
**Severity: MEDIUM–HIGH (compliance/functional) · Confidence: HIGH · Blast: Record (fails closed) · Status: ✅ FIXED 2026-06-04**

> **Resolution (applied across all three layers):**
> - **DB layer (migration 0024):** Added `app.break_glass_patient_ids` GUC bypass to the `doctor_scope` RESTRICTIVE policy on all 5 clinical tables (`medical_records`, `prescriptions`, `lab_tests`, `xray_records`, `ultrasound_records`). USING clause permits READ when `patient_id = ANY(string_to_array(app.break_glass_patient_ids, ',')::int[])`. WITH CHECK intentionally NOT relaxed — break-glass is read-only.
> - **Tenant context (`tenant-context.ts`):** `runInTenantContext` now accepts `TenantContextOptions.breakGlassPatientIds` and sets the GUC when provided. Sanitizes to positive integers.
> - **App layer (`scope.ts`):** `getDoctorListScope` returns `breakGlassPatientIds` from `getActiveBreakGlassPatientIds()`, unions them with assigned patients, and audits the access. `assertMedicalRecordInScope` checks for an active break-glass session and returns `breakGlassPatientIds` so the caller can pass them to `runInTenantContext`.
> - **All 5 clinical services** (`medical-records`, `prescriptions`, `lab`, `xray`, `ultrasound`): list and get-by-id paths pass `{ breakGlassPatientIds }` to `runInTenantContext`, ensuring the DB policy permits the rows.
> - **Audit:** every break-glass access is logged (`BREAK_GLASS_ACCESS`) with session ID, entity type, and entity ID.

### F-P2-2 — Default password policy is weak (8-char letter+number, no breach check)
**Severity: LOW · Confidence: HIGH · Status: ✅ PARTIALLY FIXED 2026-06-04 (code side; flag flip is your ops call)**

> **Resolution (code):** the three sync call sites now use `validatePasswordStrictAsync` so the strict policy (incl. HIBP) applies **uniformly** the moment the flag is flipped — previously only password-reset did, while change-password (`auth.service.ts:232`), create-user (`users.service.ts:107`) and admin-reset (`:251`) silently skipped HIBP even under strict mode. **No default-behavior change:** with `PHASE2_STRICT_PASSWORD_POLICY=false` the async validator returns the identical sync result. **Still your decision:** flipping `PHASE2_STRICT_PASSWORD_POLICY=true` (12-char + special + dictionary + HIBP) before real-PHI launch is an ops/env action, not a code change.

`password.ts:66-87` — with `PHASE2_STRICT_PASSWORD_POLICY=false` (default), the minimum is 8 chars + one letter + one number; special-char, dictionary blocklist, and HIBP all require strict mode.

### F-P2-3 — Legacy password compare is not timing-safe
**Severity: LOW (INFO) · Confidence: HIGH · Status: ✅ FIXED 2026-06-04**

> **Resolution:** `verifyLegacyPassword` now compares the computed vs stored HMAC with `crypto.timingSafeEqual` (length-guarded). Behavior-identical result; existing legacy-path tests (`password.test.ts:50-61`) still pass.

`password.ts:49-55` `verifyLegacyPassword` previously used `===` string comparison (bcrypt path was already constant-time). Migration-only and low value (HMAC of an attacker-unknown salt).

### F-P2-4 — `fph` token binding is weak against theft
**Severity: INFO · Confidence: HIGH · Status: known/accepted**

The `fph` claim binds only User-Agent + Accept-Language — both attacker-observable and trivially replayed from the victim's headers, and not IP-bound. With `FINGERPRINT_BINDING=disabled` (emergency lever) it's skipped entirely. Useful as defense-in-depth, not as an anti-theft control. No action beyond awareness.

### F-P2-5 — Legacy `requireAuth` GET routes miss the bounded fail-open
**Severity: INFO/LOW · Confidence: HIGH · Status: ✅ FIXED 2026-06-04**

> **Resolution:** `requireAuth` and `requireRole` now pick the kernel scope by HTTP method — `read` for GET/HEAD, `write` for mutations (`middlewares/auth.ts`). So GET routes get ADR-010's bounded fail-open on a revocation-store blip while mutations keep CSRF + fail-closed. Central one-line change (no 23-file route sweep); safe because CSRF is method-gated in the kernel, so a GET under `write` never enforced CSRF anyway. 475 unit tests still green.

`middlewares/auth.ts` previously mapped `requireAuth` to `authGate("write")` unconditionally.

### Note — Replit origin still in the auth kernel
`policy.ts:75-83` still reads `REPLIT_DOMAINS` into `ALLOWED_ORIGINS_SET`. Covered by the Replit-removal scope (audit §6); remove when that cleanup lands.

---

## Scorecard (Phase 2 — post-fix)

- **Authentication & Session: 9/10** — kernel is genuinely strong (pinned EdDSA, fail-closed revocation/jti, spoofed-header stripping, single source of truth, no super_admin tenancy bypass). All actionable findings fixed: password validation unified (F-P2-2), timing-safe legacy compare (F-P2-3), method-based fail-open (F-P2-5). Remaining 0.5 deduction: default password policy is still 8-char (flip is an ops decision), `fph` binding is weak (accepted).
- **Compliance Readiness (emergency access): fully functional** — break-glass now delivers clinical PHI to doctors via migration 0024 + tenant-context GUC + all 5 service wiring. §164.312(a)(2)(ii) gap closed.
- No session-hijack or privilege-escalation path found. No breach vector identified.
