# Production Health Scorecard

> Last assessed: **2026-05-18**. Re-score after each major release.

| Dimension | Score | Verdict |
|---|---|---|
| **Architectural Quality** | **9.0**/10 | Monorepo + OpenAPI contract + Orval codegen. Single-function `evaluate()` kernel owns CSRF + identity + revocation + role; legacy split-middleware design retired. |
| **Production Readiness** | **8.5**/10 | CI chain green (typecheck → validate:errors → 173 tests). Login-shield WAF-equivalent middleware active. |
| **Scalability** | **7.0**/10 | SSE on pluggable EventBus (Redis Pub/Sub in prod). Rate limiting pluggable (Redis in prod). Serial PKs remain. |
| **Maintainability** | **9.0**/10 | CLAUDE.md governance, ADRs, RBAC_GOVERNANCE.md, LOCAL_DEV.md current. Full service layer — all 19 route domains. Auth surface: 3 files (policy.ts, auth-gate.ts, auth.ts). |
| **Operational Resilience** | **7.0**/10 | Prometheus + Grafana, alerting rules, RUNBOOK.md, DR backup script, POST_LAUNCH_PROCESS.md. |
| **Security Posture** | **7.5**/10 | v7 auth kernel: CSRF inside evaluate(), per-role JWT TTL + fingerprint, jti replay defense, fail-closed revocation. Login-shield middleware. MFA removed — single-step login for all roles. Pen test + WAF pending. |
| **Technical Debt** | **7.5**/10 | Drizzle `push` (not versioned migrations — schema drift risk). Legacy `requireAuth`/`requireRole` shims in 19 route files. Legacy HMAC password migration active. Serial PKs. |

## What moved the needle

- 🔴→🟢 **Auth**: Hand-rolled crypto → `jose` HS256 + `jti` revocation
- 🔴→🟢 **Monitoring**: Zero → Prometheus/Grafana + alert rules
- 🔴→🟢 **Backups**: None → `pg_dump` script + weekly verification
- 🔴→🟢 **Audit**: Partial → 100% PHI coverage (`logRead`/`logAudit`/`logDenied`); `admin` removed from audit access
- 🔴→🟢 **CSP**: API-only → real SPA coverage via Vite plugin + `<meta>` tag; Vitest regression guard
- 🔴→🟢 **ESM runtime**: `require()` → `await import()` + top-level await in `runtime/index.ts`
- 🔴→🟢 **Revocation fail-closed**: `verifyToken` throws on store error (was `console.warn` + allow)
- 🟡→🟢 **Testing**: No tests → Vitest unit + Supertest integration suite (173 passing)
- 🟡→🟢 **Auth kernel (v7)**: Single `evaluate(req, scope, allowedRoles?)` kernel — CSRF, identity, revocation, jti, fingerprint, role. Returns a `Decision` discriminated union. 25-test unit suite covers every branch.
- 🟡→🟢 **JWT TTL**: Flat 8h → per-role (super_admin 15m, admin 1h, clinical 2h, operational 4h). Cookie `maxAge` aligned to per-role TTL.
- 🟡→🟢 **Billing SoD**: front_desk creates; `billing_manager` pays/cancels; cancel requires reason ≥ 30 chars; anti-fraud gate blocks same-user pay within 30s of create
- 🟡→🟢 **Privileged scope**: `PATCH/DELETE /users/:id`, `POST /users/:id/reset-password` use `authGate("privileged")` — jti consumed on use
- 🟡→🟢 **TTL constants**: `MAX_ROLE_TTL_SEC` in `lib/auth-constants.ts` (re-exported from `lib/auth.ts`), imported by revocation stores to avoid ESM circular dependencies
- 🟡→🟢 **Login shield**: `middlewares/login-shield.ts` — 4 KB body gate, Content-Type enforcement, empty UA rejection in prod, 20 req/15 min IP layer
- 🟡→🟢 **CI pipeline**: `.github/workflows/ci.yml` — typecheck, validate:errors, api-server tests
- 🟡→🟢 **Compliance Dashboard**: `GET /dashboard/compliance` + `ComplianceDashboard.tsx` — audit event counts, 7-day trend, top entities/users, denied events feed
- 🟡→🟢 **Per-role UI/UX redesign (2026-05-18)**: All 10 roles now land on a dedicated workspace. 7 new dashboard endpoints + pages (Billing, Pharmacist, Nurse, FrontDesk, Imaging×2, Compliance). `getLandingRoute(role)` in `route-access.ts` drives post-login redirect. `navPinnedByRole` elevates each role's primary section in the sidebar. `RoleQuickActions` and `RoleContextLine` in the 40px top bar. `EmptyState` component. `DataTable` density prop. Status palette deduplicated + differentiated (scheduled→slate, requested→sky, in_consultation→violet, paid→emerald). Full EN+AR i18n for all new strings.
- 🟢→🔴 **MFA removed**: TOTP, recovery codes, `mfa_sessions`, two-step gate — fully removed. Single-step login for all roles.

## Remaining risks

| Risk | Severity | Mitigation Path |
|---|---|---|
| No penetration test | HIGH | Schedule external pen-test before public launch |
| No WAF | MEDIUM | Enable Cloudflare or Replit WAF (login-shield covers server-side) |
| No MFA on login | HIGH | Re-scope as a dedicated feature track with proper enrolment UX |
| `style-src 'unsafe-inline'` | LOW | Replace React `style={{}}` + Recharts inline styles with CSS modules + nonce |
| Serial integer PKs | LOW | UUID migration in v3.0 |
| Legacy HMAC hashes | LOW | `password.ts` auto-migrates on next login |
| No formal HIPAA gap analysis | HIGH if US | Engage compliance officer before US deployment |
| Drizzle push (no migration files) | MEDIUM | Evaluate migration to `drizzle-kit migrate` for versioned, rollback-safe schema changes |
