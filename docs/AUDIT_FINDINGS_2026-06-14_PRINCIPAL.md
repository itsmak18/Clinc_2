# Audit Findings — 2026-06-14 — Principal Zero-Trust Re-Audit

**Date:** 2026-06-14
**Auditor:** Claude (principal-architect orchestration over 10 specialist domains)
**Audit type:** Whole-system re-audit under a **Zero-Trust Documentation Policy** — source-of-truth priority: code > runtime > config > infra > tests > docs > comments. Documentation is never treated as evidence.
**Method:** 3 parallel read-only Explore agents → orchestrator **first-hand re-verification of ~12 load-bearing files** (every asserted claim was opened and read).
**Result:** **8.4 / 10 — production-grade engineering, pre-production operations. No open Critical code defects.**

> This is an *independent* re-audit. It corroborates the project's own honest scorecard (`HEALTH_STATUS.md`, 8.1 overall) and the 8-phase campaign (`AUDIT_REPORT.md`, `AUDIT_FINDINGS_2026-06-*_PHASE*.md`). Net-new actionable: **one unarmed security control (F-Z1)** + a short doc-truth list. Remediation plan: `HANDOFF.md` §4 and `~/.claude/plans/system-prompt-you-frolicking-llama.md`.

---

## 1. Executive Summary

The security architecture is real, not aspirational — it survives line-by-line reading. The auth kernel, multi-tenant RLS, PHI field encryption, and append-only hash-chained audit all verify against source at high confidence. There are **no open Critical code defects**; the prior Phase 1–8 campaign genuinely closed them (verified: migrations 0024–0028 exist and contain the claimed SQL; the daily integrity verification is wired into `cron.ts`, not just tests). The residual risk is **operational + breadth-of-coverage**, not architectural: never deployed, single-Postgres DR, deploy-gated alert delivery, and a real-DB test net that is deep on isolation but thin on business-logic services.

**One net-new finding with security weight:** the documented "jti Replay Defense" is **unarmed** — `isJtiUsed()` is checked but `markJtiUsed()` is never called in production, so it protects zero live routes (honestly disclosed as "latent" in ADR-007).

## 2. Dimension Scores

| Domain | Score | Basis (verified at source) |
|---|---|---|
| Architecture | 9.0 | ESLint route/service + raw-`db` boundary (`eslint.config.mjs:28-67`); batched audit outbox (`audit.ts:131-177`); RLS defense-in-depth |
| Code Quality | 8.0 | Pino discipline, justified catches; 359 `any`, 2 strict flags off (documented) |
| Security | 9.0 | Kernel, tenant isolation, encryption, audit chain all verified; caveat F-Z1 |
| DevOps | 8.5 | Hardened prod compose + 10-job CI gate; never deployed; deploy-gated alert delivery |
| Testing | 7.5 | Real-Postgres isolation suite excellent (8 files/62 tests); business-logic breadth thin |
| Database | 9.0 | Dormant RLS + `medicore_app` + CHECK + partitioning + pooling |
| Documentation | 8.0 | Exceptional breadth + honest scorecard; residual drift (F-Z2..Z6) |
| Local-First | 7.0 | Core 100% offline; Google Fonts CDN the one cosmetic blocker |
| **Overall** | **8.4** | top-decile build; gap to 9.5 is deploy hardening + DR + coverage breadth |

## 3. Zero-Trust Verification Matrix (first-hand)

| # | Documented claim | Status | Evidence (file·symbol·line) | Conf |
|---|---|---|---|---|
| 1 | JWT verify EdDSA-only | VERIFIED | `policy.ts` `parseToken` `algorithms:["EdDSA"]` :53 | 99 |
| 2 | clinicId fail-closed, no `?? 1` | VERIFIED | `policy.ts` :259-263 → `E.AUTH_INVALID` | 99 |
| 3 | CSRF origin exact-match (proto+host+port) | VERIFIED | `policy.ts` `originAllowed` :94-104, gate :130-135 | 99 |
| 4 | CSRF double-submit, timing-safe, write/privileged+mutation only | VERIFIED | `policy.ts` :136-148 (`timingSafeEqual`) | 99 |
| 5 | Revocation fail-closed write / bounded fail-open read (ADR-010) | VERIFIED | `policy.ts` :182-207 | 97 |
| 6 | fph binding + `FINGERPRINT_BINDING=disabled` lever + grandfather | VERIFIED | `policy.ts` :222-246 | 98 |
| 7 | super_admin bypasses role check | VERIFIED | `policy.ts` :250 | 99 |
| 8 | Per-role TTL single source (cookie maxAge = `COOKIE_TTL_MS[role]`) | VERIFIED | `routes/auth.ts` :80-85 | 96 |
| 9 | PHI AES-256-GCM, v2 envelope, prod fail-closed at import | VERIFIED | `field-encryption.ts` :35,91,63-69 | 99 |
| 10 | `logAudit` → outbox (never direct), never blocks PHI op | VERIFIED | `audit.ts` :57-77 | 99 |
| 11 | Outbox drain batched (1 insert + 1 delete) w/ backoff fallback | VERIFIED | `audit.ts` :131,135,138-177 | 99 |
| 12 | Audit integrity verified **daily in cron** (not just tests) | VERIFIED | `cron.ts` :127-142 → `audit-integrity.ts` :150,184 | 98 |
| 13 | RLS dormant-by-default + FORCE on 20 tables | VERIFIED | `0015_enable_rls.sql` :65-98 | 99 |
| 14 | `medicore_app` = NOSUPERUSER NOBYPASSRLS, DML-only | VERIFIED | `0020_create_app_role.sql` :29-41 | 99 |
| 15 | Break-glass = read-only RLS bypass (USING only, not WITH CHECK) | VERIFIED | `0024_break_glass_rls_bypass.sql` :43-65 | 99 |
| 16 | `runInTenantContext` txn-local GUCs, parameterized, validates clinicId | VERIFIED | `tenant-context.ts` :82-105 | 98 |
| 17 | ESLint blocks DB in routes **and** raw `db` in services | VERIFIED | `eslint.config.mjs` :28-67 | 98 |
| 18 | Service: clinicId filter + tenant context + cursor + PHI decrypt | VERIFIED | `medical-records.service.ts` :29,55-79,83 | 96 |
| 19 | No-show cron writes `SYSTEM_NO_SHOW` audit | VERIFIED | `cron.ts` :185-192 | 97 |
| 20 | `minimumReleaseAge: 1440` enforced | VERIFIED | `pnpm-workspace.yaml` :28 | 99 |
| 21 | "jti Replay Defense" (security table) | **PARTIAL — UNARMED** | `isJtiUsed` `policy.ts:169`; `markJtiUsed` never called in prod (grep: stores+tests only). ADR-007 admits "latent". | 95 |
| 22 | "454/461/479/484 tests passing" | PARTIAL | 40 files / 423–431 `test`·`it` declarations (grep); exact pass-count needs `vitest run` | 80 |
| 23 | "All tables use serial PKs" (CLAUDE.md) | **CONTRADICTED (low-impact)** | mixed: `patients.ts` serial vs `clinic_notices.ts` `uuidV7()` | 95 |
| 24 | Login intentionally CSRF-exempt (bootstrap) | VERIFIED | `routes/auth.ts` `/auth/login` `asyncHandler`-only :31; logout/me `requireAuth` | 97 |
| — | Full-stack runtime; alert email/blackbox delivery; exact green run; Redis SSE fan-out across replicas | UNVERIFIED | never deployed; requires live SMTP/edge/DB + suite execution | n/a |

## 4. Anti-Bullshit Detection

- 🚩 **Unarmed security control (F-Z1):** jti replay defense — consume-side `markJtiUsed` never invoked in prod; `isJtiUsed` therefore always false. Honestly documented as latent. The only anti-pattern with security weight.
- ✅ **No production mocks:** mocked `@workspace/db` confined to `src/tests/**`; `mockup-sandbox` is a separate workspace pkg, not imported by `api`/`clinic`.
- ⚠️ **Coverage breadth, not fakery:** assertions are real, but the mocked-DB unit majority would pass a forgotten `eq(clinicId)` for the business-logic services the real-DB suite (8 files/62 tests, isolation/audit/erasure/append-only-focused) does not yet exercise.
- ✅ **Placeholders are honest dev-fallbacks:** email/SMS stubs return `ok:true, stubbed:true` and log; not silent fakes.
- 🚩 **Dead weight:** Expo / `@expo/ngrok-bin` / React-Native pins in a web-only repo; `mockup-sandbox` not in prod build.
- ℹ️ **Comment drift:** `tenant-context.ts:86` says values embedded "via sql.raw"; code uses parameterized `set_config` (safer). `SYSTEM_CLINIC_ID = 1` (`audit.ts:23`) attributes context-less audits to clinic 1 (documented tradeoff).

## 5. Findings Register (deduplicated vs the existing risk register)

**Net-new:**
- **F-Z1 — Security · Medium · Conf 95.** jti replay defense unarmed (see §3 #21 / §4). *Action:* arm `markJtiUsed` on the privileged single-use set (break-glass activate, step-up, admin-reset, erasure execute) — author **ADR-014** — or remove the latent check and document jti as deferred. Recommend: arm.

**Doc-truth (Low; code is correct, docs trail):**
- **F-Z2** — CLAUDE.md "All tables use serial PKs" → false; PKs are mixed serial + `uuidV7()`.
- **F-Z3** — Scattered test-count numbers (454/461/479/484) are stale snapshots; replace with a CI-derived badge.
- **F-Z4** — `pnpm-workspace.yaml` `minimumReleaseAgeExclude: []` is empty; CLAUDE.md's "except `@replit/*`" clause no longer applies.
- **F-Z5 (correction to prior roadmap)** — **REPLIT_DOMAINS removal is already code-complete.** `policy.ts:70-79` `ALLOWED_ORIGINS_SET` reads only `ALLOWED_ORIGINS` (+ localhost dev). ROADMAP "still read in policy.ts" (line 10) and CLAUDE.md CORS lines are stale → close the ⏳ item; remaining work is doc-only.
- **F-Z6** — `tenant-context.ts:86` comment ("via sql.raw") contradicts the safer parameterized `set_config` the code actually uses; fix the comment.

**Re-affirmed (already tracked; restated for completeness):**
- **H-1** Never deployed — all controls undrilled (CRITICAL operational, per existing register).
- **H-2** Postgres SPOF, RPO ≈ 24h, no warm standby (HIGH).
- **H-3** Alert/probe **delivery** deploy-gated — Alertmanager/Prometheus don't env-expand; config form fixed (F-P6-5/7), live delivery unverified until deploy (`amtool` test + blackbox probe).
- **H-4** Real-DB test breadth — business-logic services (billing SoD, appointments FSM, prescriptions/consent, imaging) lack real-Postgres tests; a forgotten tenant filter there passes the mocked suite.

## 6. Orchestrator integrity note (the policy proving itself)

Three claims that *trusted documentation or partial reads* were wrong and were caught only by reading source:
1. "`.npmrc` missing `minimumReleaseAge`" → it's in `pnpm-workspace.yaml:28` (pnpm 10 location). **VERIFIED present.**
2. "Audit-verification proven by `CLAUDE.md:246`" → real proof is `cron.ts:127-142`.
3. "REPLIT_DOMAINS still read in `policy.ts`" → already removed; code reads only `ALLOWED_ORIGINS` (F-Z5).

Trustworthy documentation is still not evidence.
