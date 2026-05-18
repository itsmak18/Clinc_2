# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Identity Protocol
- User: **Mike**
- Assistant: **Rose**

---

## Project Context

**MediCore** — internal-staff clinic management system. Bilingual (English + Arabic/RTL). No public-facing routes.

**Core architecture**: pnpm monorepo → React SPA + Express 5 REST API + PostgreSQL via Drizzle ORM. API contract is code-generated from an OpenAPI spec.

**Main modules**: Patients, Appointments (state machine), Triage (nurse kanban), Medical Records, Prescriptions, X-Ray, Ultrasound, Lab, Billing, Operations, Inventory, Reports, Notifications (SSE), Users, Audit Log, Per-role Dashboards (10 roles), Schedule.

**Runtime**: Node.js 24, TypeScript 5.9, React 19, Vite 7, Express 5, PostgreSQL 16, pnpm workspaces.

**Infrastructure**: Local-first development (PostgreSQL 16 on localhost, no Redis required in dev). Production target: Replit autoscale or any Node host. No Docker. CI pipeline: `.github/workflows/ci.yml` (typecheck → validate:errors → tests).

> **MFA status**: TOTP MFA was fully designed, implemented, and then **completely removed** to restore single-step login. No MFA columns exist on `users`, no `mfa_sessions` table exists, no `mfa.service.ts` exists, and no MFA routes exist on `/auth`. Do not reference, implement, or invoke any MFA functionality until it is explicitly re-scoped.

---

## Production Health Scorecard

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

### What moved the needle
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

### Remaining risks
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

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite 7, Wouter, TanStack Query v5, Radix UI, Tailwind CSS 4.1 |
| Backend | Express 5, Pino, Helmet, express-rate-limit |
| Auth | `jose` HS256 JWT + `jti` + `fph` fingerprint binding, HttpOnly cookie `clinic_token`, per-role TTL |
| Database | PostgreSQL 16, Drizzle ORM, drizzle-zod |
| Validation | Zod (shared via `@workspace/api-zod`, generated by Orval) — always `zod/v4` |
| Codegen | Orval from `lib/api-spec/openapi.yaml` |
| Forms | react-hook-form + Zod resolvers |
| Real-time | SSE via pluggable `EventBus` (in-memory dev / Redis Pub/Sub prod) |
| Session Store | Pluggable runtime (`lib/runtime/`) — in-memory by default; Redis (`ioredis`) when `SESSION_STORE=redis` |
| Build | esbuild (backend), Vite (frontend) |
| Logging | Pino (structured JSON), PHI fields auto-redacted |
| Metrics | Prometheus + Grafana |
| i18n | Custom context hook, 300+ keys, RTL toggle |

---

## Commands

```bash
# Install
pnpm install

# Dev (run both concurrently from their directories)
pnpm --filter @workspace/clinic run dev          # Frontend → localhost:5173 (Vite HMR)
pnpm --filter @workspace/api-server run dev      # Backend  → localhost:5000 (tsx watch — auto-restarts on save)
# Or launch both at once:
.\start-dev.ps1                                  # Opens two PowerShell windows

# Build (all packages)
pnpm run build

# Typecheck (all packages)
pnpm run typecheck

# Database schema push — uses drizzle-kit push (NOT versioned migrations)
pnpm --filter @workspace/db run push             # Safe push
pnpm --filter @workspace/db run push-force       # Force push (DESTRUCTIVE — drops columns)

# API codegen — run after editing lib/api-spec/openapi.yaml
pnpm --filter @workspace/api-spec run codegen

# Seed database
pnpm --filter @workspace/scripts run seed        # Truncates users, patients, appointments, inventory, notifications

# Run tests
pnpm --filter @workspace/api-server run test     # Vitest unit + integration suite (173 tests)

# Validate error codes (CI step — run before tests)
pnpm --filter @workspace/api-server run validate:errors

# Scripts
pnpm --filter @workspace/scripts run hello
```

---

## Monorepo Layout

```
artifacts/
  clinic/          # @workspace/clinic      — React SPA
  api-server/      # @workspace/api-server  — Express API
  mockup-sandbox/  # @workspace/mockup-sandbox — internal UI mockup tool (not production)
lib/
  api-spec/        # @workspace/api-spec    — openapi.yaml (source of truth)
  api-client-react/# @workspace/api-client-react — generated TanStack Query hooks ⛔ do not edit
  api-zod/         # @workspace/api-zod     — generated Zod schemas for backend ⛔ do not edit
  db/              # @workspace/db          — Drizzle schema + push config
scripts/           # @workspace/scripts     — seed, utilities (tsx)
```

---

## API Contract Flow

```
lib/api-spec/openapi.yaml
        ↓ pnpm codegen (Orval)
lib/api-client-react/src/generated/   ← frontend consumes
lib/api-zod/src/generated/            ← backend validates against
```

**Never edit generated files.** All API changes start in `openapi.yaml` → run codegen → commit generated output.

---

## Architecture Rules

**TypeScript** — strict-partial mode: `strictNullChecks`, `noImplicitAny`, `strictPropertyInitialization`, `alwaysStrict` are ON. `strictFunctionTypes` and `noUnusedLocals` are intentionally OFF. `isolatedModules` is ON.

**Frontend patterns**
- All server state via TanStack Query hooks from `@workspace/api-client-react` — no raw fetch in components.
- All user-facing strings via `useI18n()` — never hardcode English text.
- Route guard: `canAccessRoute(href, role)` from `lib/route-access.ts` — applied via `Guard` component in `App.tsx`. (`super_admin` bypasses all route guards automatically inside `canAccessRoute`.)
- Auth token stored in an **HttpOnly cookie** (`clinic_token`) set by the server — never in `localStorage`. Session is restored on app load via `GET /api/auth/me` (cookie sent automatically by browser). A 401 triggers immediate logout via the interceptor in `App.tsx`.
- Session timeout: warn at 28 min, auto-logout at 30 min via `useSessionTimeout`. Note: `super_admin` JWT expires at 15 min — the 401 interceptor fires before the 28-min timer.
- Raw `fetch()` calls to mutation endpoints MUST include `X-CSRF-Token` read from `_csrf` cookie. Orval-generated `customFetch` does this automatically. Hand-written `fetch()` does not — always add the header manually.

**Backend patterns**
- Middleware order in `app.ts`: `correlationId → strip-x-session-state/x-security-flags → helmet(csp) → cors → pinoHttp → metricsMiddleware → express.json/urlencoded → cookieParser → [login-shield on POST /auth/login] → [globalMutationLimiter on all other mutations] → router`
- CSRF is not a separate middleware mount — it runs inside the v7 kernel (`lib/policy.ts`) for `write`/`privileged` scopes on mutation methods (POST, PUT, PATCH, DELETE).
- All routes under `/api`. Prefer `authGate(scope, allowedRoles?)` from `middlewares/auth-gate.ts` for new code. Legacy `requireAuth`/`requireRole` shims (in `middlewares/auth.ts`) delegate to `authGate("write", ...)` and remain for existing route files.
- Full role list: `super_admin | admin | doctor | nurse | front_desk | xray_staff | lab_staff | compliance_officer | billing_manager | pharmacist`
- `super_admin` bypasses all role checks inside `evaluate()` — never block them at the route or service layer.
- **Service layer**: Routes = HTTP only (parse params, call service, map errors). Services = business logic, DB queries, scope checks, audit calls. ESLint `no-restricted-imports` on `src/routes/**` prevents direct DB imports in routes.
- All mutations: `logAudit(req, action, entityType, entityId)` from service layer — non-blocking fire-and-forget. All PHI reads: `logRead`. Denied attempts: `logDenied`. All wrappers in `lib/audit.ts`.
- Validate all route integer params with `safeParseInt` or `validateParamInt` middleware from `lib/validators.ts`.
- Soft-delete: filter `isNull(table.deletedAt)` in all queries.
- Global mutation rate limit: `ipRateLimit(100, 15 * 60 * 1000)` applied to all POST/PUT/PATCH/DELETE routes except `/auth/login` (which gets the stricter login-shield). Do not add redundant per-route rate limiters for normal mutations.

**Database**
- All tables use `serial` PKs and `createdAt`/`updatedAt` timestamps.
- Soft-delete via `deletedAt` column on most domain tables.
- `vitals` on `medical_records` and `medications` on `prescriptions` are `jsonb`.
- `staffAssigned` on `operations` is `jsonb`, default `[]`.
- `medical_records` has `isGlobal boolean NOT NULL DEFAULT false` and `globalReason text` — when `isGlobal=true` any doctor can read the record regardless of patient assignment. Only `super_admin` can set this flag via `PATCH /medical-records/:id/global-flag` (body: `{ isGlobal, reason }`, reason ≥ 20 chars).
- Schema is managed via `drizzle-kit push` (not versioned migrations). Push is non-rollback-safe — always validate destructive changes before running `push-force`.

**SSE (real-time)**
- `emitToUser(userId, event, data)` in `lib/sse.ts` publishes via `runtime.eventBus` — in-memory (dev) or Redis Pub/Sub (prod).
- **SSE payloads must NOT contain PHI** — use IDs only. Frontend fetches full records via authenticated API hooks.
- Frontend `useNotificationsStream` auto-reconnects with 5s backoff. Successful notification invalidates the relevant React Query cache key.

---

## Security Architecture

| Layer | Implementation |
|---|---|
| Authentication | `jose` HS256 JWT + `jti` claim + `fph` fingerprint (SHA-256 of User-Agent + Accept-Language, first 16 hex chars) |
| MFA | **Removed.** Single-step login for all roles. No TOTP, no recovery codes, no `mfa_sessions`. Re-scope before implementing. |
| JWT TTL by role | `super_admin` 15m · `admin` 1h · `doctor`/`nurse`/`compliance_officer` 2h · `billing_manager`/`front_desk`/`xray_staff`/`lab_staff`/`pharmacist` 4h |
| Cookie | `clinic_token`: HttpOnly, Secure (prod), SameSite=Strict, `maxAge` = per-role TTL ms |
| Authorization | `evaluate()` kernel in `lib/policy.ts` — `super_admin` auto-bypasses role check |
| Session Revocation | Pluggable `RevocationStore` — `revoke(userId, nowUnix)` invalidates all tokens with `iat ≤ revokedAt`. `verifyToken` fail-closed: store error throws, not allows. |
| jti Replay Defense | `privileged` scope only — jti consumed on first use; replay blocked with error 1006 |
| CSRF | Origin exact-match + double-submit cookie (`X-CSRF-Token` vs `_csrf` cookie), method-gated on mutations inside `evaluate()`. No `CSRF_EXEMPT_PATHS`. |
| Rate Limiting | Login: `rateLimiter.ts` DB-backed (5/15 min, 30 min lockout) + login-shield IP layer (20/15 min). Mutations: global IP rate limit (100/15 min). Pluggable `RateStore` (memory dev / Redis prod). |
| Data Scoping | SQL-level doctor scope via `getDoctorPatientScope()` + `inArray()` |
| Fingerprint binding | `fph` claim checked on every request; mismatch → error 1004; `FINGERPRINT_BINDING=disabled` env var as emergency bypass |
| Logging | Pino — PHI fields (`fullName`, `vitals`, `phone`, `email`, etc.) → `[REDACTED]` |
| Audit Trail | `audit_logs` table — append-only, 7-year retention, immutable; every read logs `AUDIT_LOG_READ` |
| Billing SoD | `front_desk` creates invoices; `billing_manager`/admin pays/cancels; cancel requires reason ≥ 30 chars; anti-fraud gate blocks same-user pay within 30s of create |
| SSE Payloads | IDs only — no PHI |
| CORS | Dev: `localhost:*` + `127.0.0.1:*`. Prod: `REPLIT_DOMAINS` + optional `ALLOWED_ORIGINS` env var. No-origin requests (curl/Postman) are allowed through — CORS is not a CSRF substitute. |
| Error Handling | No stack traces in 5xx responses (production). Canonical error envelope: `{ success, error_code, error_name, session_state, message, request_id, timestamp }` — 20 stable codes in `src/errors.ts`. |

---

## Database Schema — Enums & State Machines

```
user_role:          super_admin | admin | doctor | nurse | front_desk | xray_staff | lab_staff
                    | compliance_officer | billing_manager | pharmacist
gender:             male | female
appointment_status: scheduled → checked_in → in_triage → ready_for_doctor → in_consultation
                    → awaiting_diagnostics → pending_payment → completed
                    (also: cancelled, no_show)
booking_source:     online | phone | walk_in          ← on appointments table, default walk_in
triage_priority:    normal | urgent | critical         ← on appointments table, default normal
xray_status:        pending → uploaded → reviewed
ultrasound_status:  pending → uploaded → reviewed
lab_test_status:    requested → in_progress → completed | cancelled
invoice_status:     pending → paid | cancelled
operation_status:   scheduled → in_progress → completed | cancelled
notification_type:  patient_arrived | lab_ready | xray_ready | ultrasound_ready | general
```

---

## Environment Variables

```
DATABASE_URL=postgresql://user:pass@host:5432/clinic_db
PORT=5000
NODE_ENV=development
SESSION_SECRET=<32-byte hex — required in production>
  # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
BCRYPT_ROUNDS=12
SESSION_STORE=memory          # "memory" (default) | "redis" — set to "redis" in production
REDIS_URL=redis://localhost:6379  # required when SESSION_STORE=redis
REPLIT_DOMAINS=               # comma-separated Replit host domains for CORS + allowed origins
ALLOWED_ORIGINS=              # optional comma-separated additional CORS origins (e.g. https://myapp.example.com)
FINGERPRINT_BINDING=          # set to "disabled" to bypass fph fingerprint checks (emergency lever only — RUNBOOK §5)
```

---

## Seed Credentials

| Username | Password | Role |
|---|---|---|
| superadmin | admin123 | super_admin |
| admin | admin123 | admin |
| dr_ahmed | doctor123 | doctor |
| dr_sara | doctor123 | doctor |
| nurse1 | nurse123 | nurse |
| receptionist | front123 | front_desk |
| xray_tech | xray123 | xray_staff |
| lab_tech | lab123 | lab_staff |
| compliance | comply123 | compliance_officer |
| billing_mgr | billing123 | billing_manager |
| pharmacist1 | pharma123 | pharmacist |

> These are development-only credentials. Never use in production. Run `pnpm --filter @workspace/scripts run seed` to reset.

---

## Engineering Constraints

Priority: **Correctness → Security → Performance → Maintainability → DX**

- Rate limiter (login): 5 attempts / 15 min window, 30 min lockout, keyed `ip:{ip}` + `user:{username}`. In `middlewares/rateLimiter.ts`, backed by `runtime.rateStore`.
- Rate limiter (login IP layer): 20 req / 15 min per IP in `middlewares/login-shield.ts`. Stacks with the DB-backed limiter.
- Rate limiter (global mutations): 100 req / 15 min per IP applied in `app.ts` to all non-login mutations.
- Password migration: legacy HMAC-SHA256 hashes auto-migrate to bcrypt on successful login — `password.ts` handles both paths. Do not add new HMAC logic.
- Supply chain: pnpm `minimumReleaseAge: 1440` (1 day) enforced for all packages except `@replit/*`.
- Only `pnpm` allowed — `preinstall` script rejects npm/yarn.

---

## Lessons Learned / Deprecated Approaches

- **JWT in localStorage (C-01, removed)**: Token was stored as `clinic_token` in `localStorage`, sent via `Authorization: Bearer`. Replaced with HttpOnly SameSite=Strict cookie set by `POST /auth/login`. Never reintroduce localStorage for auth. Cookie max-age matches per-role JWT TTL (15m–4h), NOT a flat 8h.

- **SSE auth via `?token=` query param (removed)**: SSE now uses `new EventSource(url, { withCredentials: true })` — the HttpOnly cookie is sent automatically.

- **Raw `fetch()` without CSRF header**: Orval-generated `customFetch` attaches `X-CSRF-Token` automatically. Any hand-written `fetch()` to a mutation endpoint must read `_csrf` from `document.cookie` and set `X-CSRF-Token`. Failure silently breaks server-side logout revocation (the server rejects with 403 which callers may swallow).

- **`app.use("/api", middleware)` path stripping**: Express strips the mount prefix from `req.path` inside the mounted middleware. So a middleware mounted at `/api` sees `/auth/login`, not `/api/auth/login`. The v7 kernel is method-gated (not path-gated) to avoid this pattern entirely — no `CSRF_EXEMPT_PATHS` list.

- **CSRF middleware → v7 kernel**: `middlewares/csrf.ts` is deleted. CSRF now runs inside `evaluate()` in `lib/policy.ts` for mutation methods. The unit test suite is `tests/policy.unit.test.ts` (25 tests covering every kernel branch including CSRF). There is no `csrf.test.ts`.

- **`verifyToken` fail-open (fixed)**: Catch block previously did `console.warn` + returned the token. Now throws `"Token verification unavailable"`. Revocation store errors are fail-closed.

- **`logout()` without server-side revocation (fixed)**: `POST /auth/logout` calls `revokeAllTokensForUser(userId)` before clearing the cookie. Without this, captured JWTs survive for the full role TTL after logout.

- **`LoginResponse` schema drift (fixed)**: After moving the JWT to a cookie, `openapi.yaml` still had `token: string` as required. Always update `openapi.yaml` first when migrating auth approaches, then run codegen and verify generated types.

- **Orval `api-zod` barrel export (Windows)**: Orval `split` mode writes an invalid barrel on Windows (git-bash interprets `\\n` literally). After codegen fails: `printf "export * from './generated/api';\n" > lib/api-zod/src/index.ts`, then run `pnpm -w run typecheck:libs` separately. The full codegen script will not succeed end-to-end on Windows.

- **MFA removed (2026-05-18)**: TOTP two-step login was fully implemented (otplib, AES-256-GCM encrypted secrets, recovery codes, mfa_sessions table, challenge routes) then **completely removed** to restore single-step login. The `users` table has no MFA columns. No `mfa_sessions` table exists. No MFA routes exist. The `/mfa-setup` reference in `route-access.ts` is dead code (safe to remove). Do not implement MFA features until explicitly re-scoped.

---

## Detailed Folder Structure

```
Clinic-Hub/
├── artifacts/
│   ├── api-server/
│   │   └── src/
│   │       ├── app.ts                ← Express app factory (middleware chain + router mount)
│   │       ├── index.ts              ← process entry point (listen, graceful shutdown)
│   │       ├── cron.ts               ← scheduled background jobs
│   │       ├── errors.ts             ← E constant map: 20 stable error codes (auth 1001–1006, CSRF 1020–1022, authz 1030, domain 3001–3005, infra 9001–9002)
│   │       ├── lib/
│   │       │   ├── appointment-state-machine.ts  ← valid status transitions + guard
│   │       │   ├── audit.ts          ← logAudit(req, action, entityType, entityId) + logRead + logDenied
│   │       │   ├── auth.ts           ← JWT sign/verify (per-role TTL + fph fingerprint), revokeAllTokensForUser, fingerprintRequest; re-exports MAX_ROLE_TTL_SEC
│   │       │   ├── auth-constants.ts ← MAX_ROLE_TTL_SEC = 4h (source of truth; avoids ESM circular dep with auth.ts)
│   │       │   ├── csp.ts            ← cspDirectives export (single source of truth for Helmet + meta tag)
│   │       │   ├── csrf-cookie.ts    ← setCsrfCookie(res) + clearCsrfCookie(res); 24-byte hex _csrf cookie
│   │       │   ├── dateUtils.ts      ← date helpers
│   │       │   ├── jsonb-schemas.ts  ← Zod schemas for jsonb columns (vitals, medications, staffAssigned)
│   │       │   ├── logger.ts         ← Pino instance with PHI redaction
│   │       │   ├── metrics.ts        ← Prometheus metric definitions + metricsMiddleware
│   │       │   ├── password.ts       ← bcrypt verify + legacy HMAC-SHA256 auto-migration
│   │       │   ├── policy.ts         ← v7 auth kernel: evaluate(req, scope, allowedRoles?) → Decision discriminated union
│   │       │   ├── redis.ts          ← ioredis client factory
│   │       │   ├── runtime/          ← pluggable stores (in-memory dev / Redis prod via SESSION_STORE=redis)
│   │       │   │   ├── index.ts      ← runtime singleton: { eventBus, rateStore, revocationStore }
│   │       │   │   ├── event-bus.ts  ← EventBus interface
│   │       │   │   ├── rate-store.ts ← RateStore interface
│   │       │   │   ├── revocation-store.ts ← RevocationStore interface (includes isJtiUsed + markJtiUsed)
│   │       │   │   ├── memory/       ← in-memory implementations (default)
│   │       │   │   └── redis/        ← Redis implementations (SESSION_STORE=redis)
│   │       │   ├── schedule-validator.ts ← doctor schedule conflict checks
│   │       │   ├── scope.ts          ← getDoctorPatientScope, assertPatientInScope (returns bool — caller must 403 on false), assertMedicalRecordInScope, isDoctorScoped
│   │       │   ├── sse.ts            ← emitToUser, addSSEClient
│   │       │   └── validators.ts     ← safeParseInt, validateParamInt
│   │       ├── services/             ← business logic layer (DB queries, scope, audit, rules) ⛔ no HTTP here
│   │       │   ├── errors.ts         ← NotFoundError, ForbiddenError, ConflictError, ValidationError, UnauthorizedError (each carries ErrorDef)
│   │       │   ├── auth.service.ts
│   │       │   ├── appointments.service.ts
│   │       │   ├── audit.service.ts
│   │       │   ├── billing.service.ts
│   │       │   ├── dashboard.service.ts
│   │       │   ├── health.service.ts
│   │       │   ├── inventory.service.ts
│   │       │   ├── lab.service.ts
│   │       │   ├── medical-records.service.ts
│   │       │   ├── notifications.service.ts
│   │       │   ├── operations.service.ts
│   │       │   ├── patients.service.ts
│   │       │   ├── prescriptions.service.ts
│   │       │   ├── reports.service.ts
│   │       │   ├── schedule.service.ts + schedule.slots.ts
│   │       │   ├── search.service.ts
│   │       │   ├── ultrasound.service.ts
│   │       │   ├── users.service.ts
│   │       │   └── xray.service.ts
│   │       ├── middlewares/
│   │       │   ├── asyncHandler.ts   ← wraps async routes; maps domain errors (NotFoundError etc.) to HTTP + canonical envelope
│   │       │   ├── auth.ts           ← LEGACY shims: requireAuth = authGate("write"); requireRole(...) = authGate("write", roles)
│   │       │   ├── auth-gate.ts      ← authGate(scope, allowedRoles?) — preferred entry point for new routes
│   │       │   ├── correlationId.ts  ← attaches X-Correlation-ID (req.id) to every request
│   │       │   ├── login-shield.ts   ← 4 KB body gate, Content-Type enforcement, empty-UA rejection (prod), 20 req/15 min IP rate layer
│   │       │   └── rateLimiter.ts    ← DB-backed login limiter (5/15 min, 30 min lockout) + ipRateLimit factory
│   │       ├── scripts/
│   │       │   └── validate-errors.ts ← CI guard: asserts every error_code literal in source is registered in E
│   │       ├── routes/
│   │       │   ├── index.ts          ← register ALL new routes here
│   │       │   ├── appointments.ts
│   │       │   ├── audit.ts
│   │       │   ├── auth.ts           ← login, logout, me, change-password (NO MFA routes)
│   │       │   ├── billing.ts
│   │       │   ├── dashboard.ts      ← summary (+yesterdayRevenue), department-load, recent-activity, compliance
│   │       │   ├── health.ts
│   │       │   ├── inventory.ts
│   │       │   ├── lab.ts
│   │       │   ├── medical_records.ts
│   │       │   ├── notifications.ts
│   │       │   ├── operations.ts
│   │       │   ├── patients.ts
│   │       │   ├── prescriptions.ts
│   │       │   ├── reports.ts
│   │       │   ├── schedule.ts
│   │       │   ├── search.ts
│   │       │   ├── ultrasound.ts
│   │       │   ├── users.ts
│   │       │   └── xray.ts
│   │       └── tests/
│   │           ├── appointment-state-machine.test.ts
│   │           ├── auth-flow.integration.test.ts  ← supertest: login exempt, logout CSRF, cookie clear, revocation
│   │           ├── csp.test.ts       ← 11 assertions guarding cspDirectives (script-src regression guard)
│   │           ├── health.test.ts
│   │           ├── jsonb-schemas.test.ts
│   │           ├── password.test.ts
│   │           ├── policy.unit.test.ts ← 25 tests covering every evaluate() branch (CSRF, token, revocation, jti, fingerprint, role)
│   │           ├── rateLimiter.test.ts
│   │           ├── scope.test.ts
│   │           └── validators.test.ts
│   └── clinic/
│       └── src/
│           ├── App.tsx               ← register ALL new routes here; 401 interceptor wires logout
│           ├── pages/
│           │   ├── AccessDenied.tsx
│           │   ├── Appointments.tsx
│           │   ├── AuditLog.tsx
│           │   ├── Billing.tsx
│           │   ├── BillingDashboard.tsx      ← billing_manager; revenue cards, 7-day area chart, recent payments/cancellations
│           │   ├── ComplianceDashboard.tsx   ← compliance_officer; audit event counts, 7-day trend, top entities/users, denied feed
│           │   ├── Dashboard.tsx             ← role switch → per-role dashboard; fallthrough to admin variant
│           │   ├── DoctorDashboard.tsx       ← doctor queue, stat cards, notifications, recent patients
│           │   ├── FrontDeskDashboard.tsx    ← front_desk; GlobalSearch, status/source bars, pending invoices
│           │   ├── ImagingDashboard.tsx      ← xray_staff (domain="xray") + lab_staff (domain="lab"); status bars, recent items
│           │   ├── NurseDashboard.tsx        ← nurse; triage kanban summary, vitals-pending list, priority breakdown
│           │   ├── PharmacistDashboard.tsx   ← pharmacist; Rx counts, recent prescriptions feed, low-stock items
│           │   ├── Inventory.tsx
│           │   ├── Lab.tsx
│           │   ├── Login.tsx                 ← single-step: username + password → session cookie
│           │   ├── MedicalRecords.tsx
│           │   ├── Notifications.tsx
│           │   ├── Operations.tsx
│           │   ├── PatientDetail.tsx
│           │   ├── Patients.tsx
│           │   ├── Prescriptions.tsx
│           │   ├── Reports.tsx
│           │   ├── Schedule.tsx              ← weekly template + 7-day calendar + overrides table
│           │   ├── Settings.tsx
│           │   ├── Triage.tsx                ← nurse kanban: priority pills, border-l-4 accent, quick vitals inline
│           │   ├── Ultrasound.tsx            ← examType select, inline expand, image preview, print
│           │   ├── Users.tsx
│           │   ├── XRay.tsx
│           │   └── not-found.tsx
│           ├── components/
│           │   ├── DataTable.tsx             ← expandedRow prop; density="comfortable"|"compact" prop
│           │   ├── EmptyState.tsx            ← icon/title/description/action slots; used in dashboards and tables
│           │   ├── DayScheduleView.tsx
│           │   ├── DischargeSheet.tsx
│           │   ├── GlobalSearch.tsx          ← cross-entity search bar
│           │   ├── Layout.tsx                ← navbar, sidebar, dark-mode toggle, 40px top bar
│           │   ├── PageHeader.tsx            ← subtitle: ReactNode (supports badge JSX)
│           │   ├── PatientTimeline.tsx
│           │   ├── StatusBadge.tsx
│           │   └── ui/                       ← shadcn/ui primitives ⛔ do not add other UI libraries
│           ├── hooks/
│           │   ├── auth.tsx                  ← useAuth(), AuthProvider, UserRole type
│           │   ├── i18n.tsx                  ← useI18n(), I18nProvider, 300+ keys, RTL toggle
│           │   ├── use-idle-timeout.ts
│           │   ├── use-mobile.tsx
│           │   ├── use-notifications-stream.ts  ← SSE client, withCredentials, 5s backoff reconnect
│           │   ├── use-toast.ts
│           │   └── useSessionTimeout.ts      ← warn 28 min, auto-logout 30 min
│           └── lib/
│               ├── api.ts                    ← customFetch mutator (attaches X-CSRF-Token, credentials: include)
│               ├── print.ts                  ← print report utilities
│               ├── route-access.ts           ← canAccessRoute(href, role), navItems — update when adding pages
│               └── utils.ts
└── lib/
    ├── db/
    │   └── src/
    │       └── schema/
    │           ├── index.ts              ← re-export ALL schema files here
    │           ├── appointments.ts
    │           ├── audit_logs.ts         ← includes requestId column (nullable text)
    │           ├── billing.ts
    │           ├── doctor_schedules.ts
    │           ├── inventory.ts
    │           ├── lab_tests.ts
    │           ├── login_attempts.ts     ← rate-limiter persistence (key, count, lockedUntil)
    │           ├── medical_records.ts    ← includes isGlobal + globalReason columns
    │           ├── notifications.ts
    │           ├── operations.ts
    │           ├── patients.ts
    │           ├── prescriptions.ts
    │           ├── ultrasound.ts
    │           ├── users.ts              ← NO MFA columns; role enum includes compliance_officer, billing_manager, pharmacist
    │           └── xray.ts
    ├── api-spec/
    │   └── openapi.yaml                  ← update after schema changes, then run codegen
    ├── api-client-react/
    │   └── src/
    │       ├── generated/                ← ⛔ do not edit (Orval output)
    │       └── custom-fetch.ts           ← hand-written mutator: X-CSRF-Token header, credentials: include
    ├── api-zod/
    │   └── src/
    │       └── generated/                ← ⛔ do not edit (Orval output)
    └── scripts/
        └── src/
            ├── seed.ts                   ← truncates users/patients/appointments/inventory/notifications, re-seeds
            └── hello.ts
```

---

## Adding a New Page (Frontend)

1. Create `artifacts/clinic/src/pages/NewPage.tsx`
2. Import it in `App.tsx`
3. Add `<Route path="/new-path"><Guard ...><NewPage /></Guard></Route>`
4. Add the path + allowed roles to `lib/route-access.ts` (`navItems` array)
5. Add nav item to `Layout.tsx` sidebar with role visibility condition

## Adding a New Route (Backend)

1. Create `artifacts/api-server/src/services/new_module.service.ts` — owns DB queries, scope checks, audit calls, business rules. No Express types here.
2. Create `artifacts/api-server/src/routes/new_module.ts` — HTTP only: parse params, call service, return response. No DB imports.
3. Import and register the router in `artifacts/api-server/src/routes/index.ts`
4. Wrap all async handlers with `asyncHandler()` from `middlewares/asyncHandler.ts`
5. Use `authGate(scope, allowedRoles?)` from `middlewares/auth-gate.ts` for auth on new routes.
6. If the endpoint returns patient data and doctors can access it, add doctor scope filtering (see Doctor Scope Rule below).

---

## Doctor Scope Rule (CRITICAL) ✅ Enforced

Doctors can ONLY access patients who have at least one appointment where `doctorId = doctor's user ID`.

**Helpers in `artifacts/api-server/src/lib/scope.ts`:**
- `isDoctorScoped(role)` — returns `true` only for `"doctor"` role
- `getDoctorPatientScope(doctorId)` — returns authorized patient IDs from appointments table (no cache — fresh on each call)
- `assertPatientInScope(req, patientId, entityType?)` — returns `Promise<boolean>`; **caller must send 403 when `false`**; logs `logDenied` audit on failure
- `assertMedicalRecordInScope(req, recordId)` — Rule 1: `isGlobal=true` → allow; Rule 2: `doctorId=current user` → allow; Rule 3: deny + `logDenied`

**Enforced on ALL these backend routes when `role === "doctor"`:**
- `GET /patients` — list filtered to assigned patients only
- `GET /patients/:id` — 403 if out of scope
- `GET /patients/:id/summary` — 403 if out of scope
- `GET /medical-records` — filtered to assigned patients (SQL `inArray`)
- `GET /medical-records/:id` — `assertMedicalRecordInScope` (isGlobal override)
- `GET /prescriptions` — filtered to assigned patients
- `GET /lab/tests` — filtered to assigned patients (SQL `inArray`)
- `GET /lab/tests/:id` — patient scope check
- `GET /xray` — filtered to assigned patients (SQL `inArray`)
- `GET /xray/:id` — patient scope check
- `GET /ultrasound` — filtered to assigned patients (SQL `inArray`)
- `GET /ultrasound/:id` — patient scope check
- `GET /appointments` — filtered to doctor's own appointments

**Audit**: Out-of-scope attempts log `ACCESS_DENIED_OUT_OF_SCOPE` or `DENIED` via `logDenied`.

**Frontend**: `PatientDetail.tsx` shows a 403 access-restricted panel (bilingual) with a back button.

Roles NOT scoped: `super_admin`, `admin`, `nurse`, `front_desk`, `xray_staff`, `lab_staff`

`super_admin` must ALWAYS bypass all role checks — never block them at any layer.

---

## Validation Rules

- ALWAYS use `drizzle-zod` (`createInsertSchema`) for DB-related validation.
- Import zod from `"zod/v4"` — NOT `"zod"`.
- Never write manual Zod schemas for tables that already have Drizzle schemas.

```typescript
// ✅ Correct
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
export const insertThingSchema = createInsertSchema(thingsTable).omit({ id: true, createdAt: true });

// ❌ Wrong
import { z } from "zod";
const schema = z.object({ name: z.string() });
```

---

## Feature Checklist

Every time you add a feature:

- [ ] New DB table? → create `lib/db/src/schema/new_table.ts`, export in `schema/index.ts`, run `pnpm --filter @workspace/db run push`
- [ ] New API route? → create `services/new_module.service.ts` (business logic + DB), then `routes/new_module.ts` (HTTP only), register in `routes/index.ts`
- [ ] New page? → create `pages/NewPage.tsx`, add to `App.tsx`, add to `route-access.ts` (`navItems`), add to `Layout.tsx` sidebar
- [ ] New OpenAPI endpoint? → update `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`
- [ ] New error code? → register in `src/errors.ts` (`E` map) before using; `validate:errors` CI step will catch orphans
- [ ] Doctor scope? → add scope filter if route returns patient data
- [ ] Bilingual? → add EN + AR strings for all new UI text via `useI18n()`
- [ ] Dark mode? → verify all new components use semantic Tailwind classes (no hardcoded colors)
- [ ] Rate limiting? → global mutation limiter already covers all mutations; add a tighter per-route limiter only for high-risk endpoints

---

## Never Do This

- Never install new UI libraries (no MUI, Ant Design, Chakra, etc.) — use shadcn/ui only
- Never use `import { z } from "zod"` — always use `"zod/v4"`
- Never use `react-router` — the router is `wouter`
- Never hardcode UI strings or colors
- Never block `super_admin` from any action
- Never guess file paths — check the folder structure above first
- Never write a DB migration manually — use `drizzle-kit push` (or plan a migration to versioned migrations)
- Never edit generated files in `api-client-react/src/generated/` or `api-zod/src/generated/` — but `lib/api-client-react/src/custom-fetch.ts` IS editable
- **Never import `@workspace/db` or `drizzle-orm` directly in route files** — DB access belongs in the service layer
- Never call `requireAuth` + `requireRole` together on the same route — use a single `authGate(scope, allowedRoles?)` instead
- Never introduce MFA code (`otplib`, TOTP, recovery codes, `mfa_sessions`) until MFA is explicitly re-scoped as a feature

---

## Schedule System ✅ Implemented

Tables: `doctor_schedules` (weekly recurring slots) + `schedule_overrides` (date-specific day-off or custom hours).

- Backend: full CRUD in `artifacts/api-server/src/routes/schedule.ts` + `services/schedule.service.ts`
- Frontend: `artifacts/clinic/src/pages/Schedule.tsx` — interactive weekly template + 7-day calendar + overrides table
- RBAC: `front_desk` + `admin` can create/edit. Doctors can VIEW their own schedule only.

---

## Implemented Features (State as of 2026-05-18)

| Feature | Status | Key Files |
|---|---|---|
| HttpOnly cookie auth (C-01) | ✅ | `routes/auth.ts`, `lib/auth.ts`, per-role cookie TTL |
| Per-role JWT TTL + fingerprint | ✅ | `lib/auth.ts` ROLE_TTL, `fph` claim in `signToken` |
| v7 auth kernel | ✅ | `lib/policy.ts`, `middlewares/auth-gate.ts` |
| Login shield (WAF-equivalent) | ✅ | `middlewares/login-shield.ts` |
| Service layer extraction | ✅ | `services/` — 19 domain services |
| Canonical error envelope | ✅ | `errors.ts` E map, `middlewares/asyncHandler.ts` |
| CI guard (validate:errors) | ✅ | `scripts/validate-errors.ts`, `ci.yml` |
| Billing SoD | ✅ | `services/billing.service.ts` |
| Audit trail (PHI coverage) | ✅ | `lib/audit.ts`, `logRead`/`logAudit`/`logDenied` |
| Doctor scope (SQL-level) | ✅ | `lib/scope.ts` |
| RBAC (10 roles) | ✅ | `lib/db/src/schema/users.ts` |
| CSP (SPA + meta tag + regression guard) | ✅ | `lib/csp.ts`, `vite.config.ts`, `tests/csp.test.ts` |
| Prometheus + Grafana | ✅ | `lib/metrics.ts` |
| SSE (pluggable EventBus) | ✅ | `lib/sse.ts`, `lib/runtime/` |
| Session revocation (fail-closed) | ✅ | `RevocationStore`, `verifyToken` throw on store error |
| jti replay defense (privileged) | ✅ | `isJtiUsed`/`markJtiUsed` in `RevocationStore` |
| Compliance Dashboard | ✅ | `routes/dashboard.ts`, `pages/ComplianceDashboard.tsx` |
| Per-role dashboards (all 10 roles) | ✅ | 7 new endpoints in `dashboard.service.ts` + `routes/dashboard.ts`; 7 new pages; all in OpenAPI + codegen |
| Per-role navigation (Layer 2) | ✅ | `getLandingRoute()` + `navPinnedByRole` in `route-access.ts`; `RoleQuickActions` + `RoleContextLine` in `Layout.tsx` |
| Page chrome (Layer 3) | ✅ | `EmptyState.tsx`; `DataTable` density prop; status palette deduped + WCAG-differentiated; welcome-bar context line |
| Schedule system | ✅ | `routes/schedule.ts`, `services/schedule.service.ts` |
| Ultrasound module | ✅ | `routes/ultrasound.ts`, `pages/Ultrasound.tsx` |
| Dark mode toggle | ✅ | `Layout.tsx` — `.dark` on `<html>`, localStorage `theme` |
| Per-role UI improvements | ✅ | Triage kanban, Lab/XRay inline expand, nurse quick vitals |
| MFA (TOTP) | ❌ REMOVED | Completely removed — no files, no schema, no routes |

---

## Suggested Future Modules

1. **MFA (TOTP re-implementation)** — Design enrolment UX, mandatory gate for privileged roles, recovery flow (Phase 15)
2. **WhatsApp/SMS reminders** — via Twilio (Phase 14)
3. **Insurance billing** — extend billing table with EDI/HIPAA 837P fields (Phase 14)
4. **Patient portal** — self-booking and result viewing, separate auth domain (Phase 14)
5. **FIDO2/WebAuthn** — phish-proof login for admin/doctor roles (Phase 14)
6. **Read replicas** — separate analytics DB for reports (Phase 14)
7. **UUID PKs** — prevent business intelligence leakage, enable sharding (v3.0)
8. **Versioned Drizzle migrations** — replace `push` with `drizzle-kit migrate` for rollback-safe schema changes (v3.0)
9. **Formal HIPAA gap analysis** — if US deployment (v3.0)
