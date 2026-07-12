# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Identity Protocol
- User: **Mike**
- Assistant: **Rose**

---

## Related Docs

- [Production Health Scorecard](../docs/HEALTH_STATUS.md) — scores, what moved the needle, remaining risks
- [Changelog](../docs/CHANGELOG.md) — implemented features
- [Roadmap](../docs/ROADMAP.md) — suggested future modules
- [Migration Notes](../docs/MIGRATION_NOTES.md) — lessons learned, deprecated approaches
- [Folder Structure](../docs/FOLDER_STRUCTURE.md) — detailed repo tree
- [Security Architecture](../docs/SECURITY_ARCHITECTURE.md) — CVE response policy, secrets scanning

---

## Project Context

**MediCore** — internal-staff clinic management system. Bilingual (English + Arabic/RTL). No public-facing routes.

**Core architecture**: pnpm monorepo → React SPA + Express 5 REST API + PostgreSQL via Drizzle ORM. API contract is code-generated from an OpenAPI spec.

**Main modules**: Patients, Appointments (state machine), Triage (nurse kanban), Medical Records, Prescriptions, X-Ray, Ultrasound, Lab, Billing, Operations, Inventory, Reports, Notifications (SSE), Users, Audit Log, Per-role Dashboards (10 roles), Schedule, Doctor Consult (tabbed EHR), Doctor Orders, Doctor Inbox, Nurse Vitals (rapid entry), Front-Desk Check-in.

**Runtime**: Node.js 24, TypeScript 5.9, React 19, Vite 7, Express 5, PostgreSQL 16, pnpm workspaces.

**Infrastructure**: Local-first development (PostgreSQL 16 on localhost, no Redis required in dev). Production target: Docker Compose (Postgres 16 + Redis 7 + api + clinic/nginx) deployable to any HIPAA-eligible host (AWS/GCP/Azure). CI pipeline: `.github/workflows/ci.yml` (typecheck → lint → validate:errors → test → audit → secrets-scan → build → migration-drift → ci-gate). Weekly `audit-weekly.yml` re-audits the locked dependency tree and opens a `security`-labeled issue on new HIGH/CRITICAL findings.

> **MFA status**: TOTP MFA was fully designed, implemented, and then **completely removed** to restore single-step login. No MFA columns exist on `users`, no `mfa_sessions` table exists, no `mfa.service.ts` exists, and no MFA routes exist on `/auth`. Do not reference, implement, or invoke any MFA functionality until it is explicitly re-scoped.

> **Bayan Design Port status — complete (2026-05-27)**: The frontend visual system was fully ported from Bayan Clinic OS. Tokens live in `artifacts/clinic/src/index.css` (mint/sage editorial palette, `[data-palette]` / `[data-voice]` / `[data-density]` variants, `[dir="rtl"]` Arabic font swap). UI uses Bayan CSS classes (`.page`, `.card`, `.card-pad`, `.btn`, `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.badge`, `.badge-teal|sage|sand|rose|blue|amber`). The shadcn primitives in `components/ui/**` are not touched — they continue to define the semantic Tailwind tokens (`bg-card`, `text-foreground`, etc.) which now resolve to Bayan vars via `@theme inline`. Application code MUST NOT import `PageHeader`, `Button`, or `Badge` from shadcn — use Bayan CSS classes on plain `<button>` / `<span>`. Doctor app gained five sub-routes — `/today`, `/consult`, `/orders`, `/inbox` plus `/checkin` (front_desk) and `/vitals` (nurse). `getLandingRoute` sends doctor → `/today`, front_desk → `/checkin`. `App.tsx` wraps the route block in `RouteErrorReset` keyed by `useLocation()` so errors clear on navigation. Global `:focus-visible` outline (2px teal-500) is in `index.css` — no need to add `focus-visible:*` Tailwind classes per element. Self-hosted fonts remain a deferred optimization (Google Fonts CDN with `display=swap` is current).

> **Phase 2 — Auth Hardening status (code-landed flag-OFF; full test suite complete 2026-05-28)**: The compensating control for the removed MFA is **device-trust + email verification on new devices**, gated behind `PHASE2_DEVICE_TRUST_ENABLED` (default false). With the flag off the entire system is dormant and login behavior is byte-identical to Phase 1. Sub-flags: `PHASE2_EMAIL_VERIFY_ENABLED`, `PHASE2_STEP_UP_ENABLED`, `PHASE2_STRICT_PASSWORD_POLICY`, `PHASE2_CSP_REPORT_ENABLED` (all auto-false when the master is false). New tables: `user_devices`, `device_verification_tokens`, `password_reset_tokens`, `csp_reports` (migration `0002_harsh_monster_badoon.sql` — apply to staging/prod with `pnpm --filter @workspace/db run db:migrate`). New routes: `POST /auth/verify-device`, `POST /auth/wasnt-me`, `GET/DELETE /account/devices/:id`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/admin-reset/:userId`, `POST /api/csp-report`. All 8 routes declared in `lib/api-spec/openapi.yaml`; Orval re-run; 24-test `phase2.integration.test.ts` (flag-OFF) + 11-test `phase2.flagON.integration.test.ts` (flag-ON: fingerprint binding, token atomicity, role-branch 202 vs 200, HIBP) — **454/454 tests passing** (9 from `metrics.test.ts`, see P2-3; 9 from `tracer.test.ts`, see P2-4; 13 from `audit-integrity.test.ts`; 1 from `csp.test.ts` P2-2; 9 from `clinic-notices.service.test.ts` P2-6; 5 from `uuid-v7.test.ts`). `audit_logs.entity_id` and `audit_outbox.entity_id` are `text` columns (migration `0013_audit_entity_id_text.sql`) — UUID entity IDs pass directly as `entityId` in `logAudit` calls. New middlewares: `denyIfDeviceUnverified()`, `requireStepUp(action)`. Pending before flag-flip: `RESEND_API_KEY` + domain verification; flag-ON test coverage (token atomicity, fingerprint binding, role-branched flow, HIBP rejection); staging flag-flip rehearsal. ASN/country are **not** part of the device fingerprint (cellular handoff would flip them on every login) — they live on `user_devices` as risk signals only. **Route registration order (critical)**: Phase 2 anonymous routes (`devicesRouter`, `passwordResetRouter`, `cspReportRouter`) are registered in `routes/index.ts` BEFORE `usersRouter` and all other domain routers. Domain routers have a global `router.use(requireAuth)` catch-all that intercepts ALL requests; any public route registered after them gets 403 instead of its intended response.

> **Phase 2 — Architecture Corrections status — complete (2026-05-31); F-01 RLS-in-production fix landed 2026-06-02; F-03 frontend tests landed 2026-06-02**: The 4 audit-identified architectural gaps are fully closed: (1) RLS rollout is 100% complete and fully verified across all 17 clinical and operational services, (2) Performance composite DB indexes are generated (`0018_performance_indexes.sql`) and physically applied, (3) Audit outbox draining is batched (single batch `insert` + single batch `delete`) reducing DB round-trips from 200 to 2, and (4) Background crons and outbox draining are decoupled from the Express process to a dedicated background worker (`worker.ts` -> `dist/worker.mjs`) running with identical hardened security profiles in dev and production compose files. 2026-06-02 (F-01): Migration 0020 creates the `medicore_app` role (NOSUPERUSER NOBYPASSRLS); api/worker connect as this role in production so RLS actually enforces. Services use `runInTenantContext` (tenant-scoped) or `dbUnsafe` (legitimately non-tenant, justified). ESLint blocks bare `db` imports in `src/services/**`. Integration-db test harness connects as medicore_app so RLS isolation tests prove prod safety. See docs/adr/ADR-008-app-db-role.md. 2026-06-02 (F-03): Frontend test harness live — vitest+jsdom in `@workspace/clinic`, 25/25 green (`route-access.test.ts` 19 tests, `i18n.test.ts` 2 tests, `Guard.test.tsx` 4 tests), `frontend-test` CI job blocking. All 461/461 backend tests green, 25/25 frontend tests green, monorepo typechecks and builds clean.

> **Phase 3 — Scaling & Ops Hardening status — complete (2026-06-02)**: Three streams shipped. (3a) **PgBouncer**: `pgbouncer` service added to `docker-compose.prod.yml` (transaction pooling, `default_pool_size=20`→Postgres, `max_client_conn=200`←app); api/worker `DATABASE_URL` routed through `pgbouncer:6432`; `statement_timeout` + `idle_in_transaction_session_timeout` moved from pool client option to `ALTER ROLE medicore_app SET ...` (migration 0021) for pooling-safe enforcement; `DISCARD ALL` server_reset_query prevents GUC bleed; pool math in RUNBOOK §11.6; unblocks 2nd API replica. Config template at `pgbouncer/pgbouncer.ini`. (3b) **audit_logs partitioning**: migration 0021 converts `audit_logs` to `PARTITION BY RANGE (created_at)`, monthly partitions 2026-01→2036-12 + DEFAULT, composite PK (id, created_at), RLS re-applied, grants re-applied, row count verified, legacy table dropped. `audit_partition_months_remaining` Prometheus gauge emitted monthly by cron; `AuditPartitionLow` alert at < 24 months. docs/adr/ADR-009-audit-partitioning.md. (3c) **Restore drill**: `backup-verify.mjs --restore` now calls `checkAuditIntegrity()` (fails drill if any `audit_integrity_checks.status='mismatch'`); RUNBOOK §12 documents quarterly drill procedure with RTO tracking. `PGBOUNCER_IMAGE` env var required in `.env` for `docker-compose.prod.yml up`.

> **Phase 6 — Strategic Features status — complete (2026-05-31)**: Two work streams fully landed. (1) **Multi-language clinical content**: migration `0019_old_makkari.sql` adds `locale`/`timezone` to `clinics` and Arabic text columns to all five clinical tables + `services_catalog`. All five clinical services accept/return Arabic fields. Frontend forms (`MedicalRecords`, `Lab`, `XRay`, `Ultrasound`, `Prescriptions`) have a collapsible "ع Arabic / العربية" section. Print templates (`prescriptionHtml`, `labReportHtml`, `xrayReportHtml`, `ultrasoundReportHtml`) render bilingual when Arabic populated. 34 new i18n keys (EN + AR). (2) **Doctor performance analytics**: `analytics.service.ts` + `routes/analytics.ts` fully implement per-doctor KPIs (patient volume, no-show rate, avg consult time, revenue, lab/X-ray order rate, cancellation rate), clinic-wide peer benchmarking, and 6-month monthly trend. New `DoctorAnalytics.tsx` page with doctor view (KPI cards + delta chips + LineChart trend) and admin view (clinic-aggregate cards + leaderboard). Route `/analytics` (roles: super_admin, admin, doctor). 461/461 tests passing, typecheck clean.

> **Phase 4 — Operational Hardening status — complete (2026-05-31)**: The four "blind in production" gaps are closed inside `docker-compose.prod.yml`. (1) **Monitoring stack live**: `prometheus` (v2.53.0, scrapes api+worker `/metrics` with Bearer auth via the `metrics_token` secret, loads `prometheus-alerts.yml`, 30d/5GB TSDB), `alertmanager` (v0.27.0, **email receiver** with SMTP env-interpolated, separate `critical` route `repeat_interval: 1h`), `grafana` (11.1.0, **SSH-tunnel-only on `127.0.0.1:3000`** — no Caddy route, no `frontend` network attachment; access via `ssh -L 3000:localhost:3000 deploy@host`; 13-panel `MediCore Overview` dashboard provisioned from [monitoring/grafana/dashboards/medicore-overview.json](../monitoring/grafana/dashboards/medicore-overview.json)). (2) **Automated DB backups**: `backup` service runs `scripts/backup-verify.mjs` daily at 02:00 UTC inside an idempotent in-container loop (last-run-day guard), 30d retention, **rsync over SSH** to `BACKUP_RSYNC_TARGET` using the new `backup_ssh_key` secret with `StrictHostKeyChecking=accept-new`; `monitoring/backup-metrics.sh` writes `backup_last_success_timestamp_seconds` for the new `BackupStale` (>26h critical) / `BackupMissingTextfile` (>6h warning) alerts. GPG public key for `BACKUP_GPG_RECIPIENT` mounted read-only from `${GNUPG_HOME:-/root/.gnupg}` — private key stays on the restore host only. (3) **Rollback procedure**: `api` and `worker` services switched to `image: ${API_IMAGE:-medicore-api:latest}` (worker also falls back to `WORKER_IMAGE`) with `build:` as fallback; CI's `build` job emits a copy-pasteable `API_IMAGE=registry/medicore-api:<short-sha>` to the GitHub Actions step summary on main; [RUNBOOK §10](../docs/RUNBOOK.md) documents env-snapshot → flip → `up -d --no-build`, and the migration-direction check (Drizzle has no down migrations — destructive migrations require roll-forward-hotfix or restore-from-backup). [RUNBOOK §11](../docs/RUNBOOK.md) covers SSH-tunnel Grafana, ad-hoc Prometheus via `docker compose exec`, `amtool` silences, per-alert playbooks, and the emergency manual backup recipe. (4) **Redis health check**: `checkReadiness()` performs a Redis SET+GET roundtrip via `runtime.scopeCache`; reports `checks.redis = { status, latencyMs, store }`; memory-mode dev reports `{ store: "memory", status: "ok" }` without I/O. **New required `.env` vars** (compose rejects on missing `:?` placeholders): `API_IMAGE`, `SMTP_SMARTHOST`, `SMTP_FROM`, `SMTP_AUTH_USER`, `SMTP_AUTH_PASS`, `ALERT_EMAIL_TO`, `BACKUP_GPG_RECIPIENT`, `BACKUP_RSYNC_TARGET`. **New required secrets**: `./secrets/grafana_password`, `./secrets/backup_ssh_key`. Footprint ≈ +1.3 GB RAM (prometheus 512m + alertmanager 256m + grafana 512m). All 461/461 tests green post-landing.

> **Production-audit campaign — Phases 1–4 complete (2026-06-03→05); all fixes in working tree, UNCOMMITTED**: A diff-aware re-audit (the tree carried in-progress WIP: migrations 0022/0023, a schedule.service rewrite, break-glass→doctor-scope wiring). Findings + resolutions in `docs/AUDIT_FINDINGS_2026-06-03_PHASE{1,2,3,4}.md`; CHANGELOG has per-fix entries. **New migrations 0024/0025/0026 + new env `AUDIT_VERIFY_WINDOW_DAYS`.** Summary:
> - **P1 cross-tenant (F-P1-1..4):** F-P1-1 (CRITICAL) — migration 0022 put **FORCE-RLS + a non-dormant policy** on `doctor_schedules`/`schedule_overrides`, and `schedule-validator.ts` read them via `dbUnsafe` → every booking failed "No schedule for this day". Fixed: `checkDoctorAvailability(actor, doctorId, scheduledDate, existingTx?)` runs inside `runInTenantContext`. Migration **0025** realigns 0022 to the dormant 0015 policy (F-P1-2) and adds RLS+`CHECK(clinic_id>0)` to `clinic_invoice_counters` (F-P1-3). No-show cron now writes a `SYSTEM_NO_SHOW` audit (F-P1-4).
> - **P2 auth (F-P2-1..5):** kernel verified strong. F-P2-1 — break-glass granted demographics but **not clinical PHI**; migration **0024** adds a patient-scoped read-only `app.break_glass_patient_ids` bypass to the 0017 doctor_scope policy; `runInTenantContext(user, fn, { breakGlassPatientIds })`; all 5 clinical services + `scope.ts` (`getDoctorListScope`, break-glass-aware `assertMedicalRecordInScope`) wired. F-P2-2 strict password policy now uniform; F-P2-3 timing-safe legacy compare; F-P2-5 `requireAuth`/`requireRole` scope is method-based (read for GET → ADR-010 bounded fail-open).
> - **P3 HIPAA §164.312 (F-P3-1):** (a)–(e) all PASS. `executeErasure` now scrubs **every** clinical table (was patients+records only; prescriptions ciphertext retained, lab/xray/ultrasound plaintext untouched); `erasedCounts` derived from actual rows. New PHI table ⇒ extend `executeErasure`.
> - **P4 audit chain (F-P4-1..3):** integrity hash-chain was **recorded daily but verified never** (`verifyIntegrity` ran only in tests). Daily cron now runs `verifyRecentIntegrity` (window `AUDIT_VERIFY_WINDOW_DAYS`) + `verifyChainLinkage`. Migration **0026** revokes UPDATE/DELETE on `audit_logs` from `medicore_app` (append-only); migration **0028** auto-revokes on new partitions via a `ddl_command_end` event trigger.
> - **Validation:** 479/479 unit, typecheck + lint clean. Migrations 0024/0025/0026 + RLS/grant behavior validated on **real PostgreSQL 16**. **The full integration-db suite now passes end-to-end: 6 files / 54 tests, exit 0** — the first time it has ever run green (it had never executed: no Docker locally, and the config + latent test bugs would have failed it under Docker too). Includes the booking F-P1-1 regression, break-glass read+read-only (F-P2-1), erasure scrub (F-P3-1), `clinic_invoice_counters` RLS (F-P1-3), and cross-tenant/doctor-scope isolation. Stabilization landed (see CHANGELOG 2026-06-05): dynamic `@workspace/db` imports, `_helpers/expectDbError.ts` (match PG error `.cause`, not just drizzle's wrapper message), one-harness-per-file (folded the STEP-0 probe in), CSRF on the cross-tenant WRITE tests, and **process-per-file isolation** in `vitest.config.integration.ts` (the `@workspace/db` pool is an eager process-singleton — a shared fork pins it to the first file's DB).

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite 7, Wouter, TanStack Query v5, Radix UI, Tailwind CSS 4.1 |
| Backend | Express 5, Pino, Helmet, express-rate-limit |
| Auth | `jose` **EdDSA (Ed25519)** JWT + `kid` header + `jti` + `fph` fingerprint binding, HttpOnly cookie `clinic_token`, per-role TTL. JWKS at `GET /.well-known/jwks.json`. Phase 2 (flag-OFF): `__Host-device_id` cookie + HMAC device fingerprint + email-verified trust + `dvu` claim for unverified devices. |
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

# Database migrations — versioned (drizzle-kit generate + migrate)
pnpm --filter @workspace/db run db:generate      # Generate migration SQL from schema diff
pnpm --filter @workspace/db run db:migrate       # Apply pending migrations to the DB
pnpm --filter @workspace/db run db:push          # Dev-only: push schema directly (no migration file)
pnpm --filter @workspace/db run db:push-force    # Force push (DESTRUCTIVE — drops columns)
# Workflow: edit schema → db:generate → commit migration file → db:migrate (staging then prod)

# API codegen — run after editing lib/api-spec/openapi.yaml
pnpm --filter @workspace/api-spec run codegen

# Seed database
pnpm --filter @workspace/scripts run seed        # Truncates users, patients, appointments, inventory, notifications

# Run tests
pnpm --filter @workspace/api-server run test     # Vitest unit + integration suite
pnpm --filter @workspace/api-server run test:integration-db   # Real-Postgres suite (*.integration-db.test.ts) — count via CI / vitest run
  # Default: spins up a postgres:16-alpine Testcontainer per file (needs Docker).
  # No Docker? Point it at a LOCAL Postgres superuser — the harness creates a
  # throwaway scratch DB per file, applies migrations, sets up medicore_app, and
  # drops it on teardown:
  #   $env:INTEGRATION_PG_ADMIN_URL="postgresql://postgres:<pw>@localhost:5432/postgres"
  #   pnpm --filter @workspace/api-server run test:integration-db
  # GOTCHA for new integration tests: import @workspace/db DYNAMICALLY in beforeAll
  # (after startRealDb sets DATABASE_URL) — a static top-level import throws at
  # collection; and each file gets ONE process (config), so use ONE harness per file.
  # Assert DB-constraint rejections with expectDbReject() (matches PG error .cause),
  # not .rejects.toThrow(/check constraint/) (drizzle wraps the message).
pnpm --filter @workspace/clinic run test         # Frontend Vitest suite (route-access, i18n, Guard, XSS, CSRF — count via CI / vitest run)
pnpm --filter @workspace/clinic run test:watch   # Frontend Vitest watch mode

# Validate error codes (CI step — run before tests)
pnpm --filter @workspace/api-server run validate:errors

# Lint route files — enforces no-restricted-imports (DB/Drizzle out of routes)
pnpm --filter @workspace/api-server run lint

# Scripts
pnpm --filter @workspace/scripts run hello
```

---

## Monorepo Layout

```
artifacts/
  clinic/          # @workspace/clinic      — React SPA
  api-server/      # @workspace/api-server  — Express API.
                   #   Backend is feature-module-organized: src/modules/<feature>/{<feature>.routes.ts,
                   #   <feature>.service.ts, index.ts barrel}. src/routes/ = index.ts only;
                   #   src/services/ = shared infra (errors/email/sms); cross-cutting kernel in src/lib/.
lib/
  api-spec/        # @workspace/api-spec    — openapi.yaml (source of truth)
  api-client-react/# @workspace/api-client-react — generated TanStack Query hooks ⛔ do not edit
  api-zod/         # @workspace/api-zod     — generated Zod schemas for backend ⛔ do not edit
  db/              # @workspace/db          — Drizzle schema + push config
scripts/           # @workspace/scripts     — seed, utilities (tsx)
```

Full tree: see [docs/FOLDER_STRUCTURE.md](../docs/FOLDER_STRUCTURE.md).

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
- Raw `fetch()` calls to mutation endpoints MUST include `X-CSRF-Token` read from `_csrf` cookie. Orval-generated `customFetch` does this automatically — **always use the generated hook or the underlying generated function** (e.g. `useStartTriage()` / `listPatients()`) for anything under `/api/*`. Hand-written `fetch("/api/...")` in `pages/**` is blocked by a CI grep guard in `.github/workflows/ci.yml` (lint job). Two read-only legacy `fetch(apiUrl(...))` paths in `components/GlobalSearch.tsx` and `components/DischargeSheet.tsx` hit GET endpoints — no CSRF risk, but migrate when next touched.
- **Print/report rendering (DOM-XSS, audit F-01)**: client-side print uses `document.write()` into a same-origin window, which parses its argument as raw HTML. Every dynamic (staff-entered/PHI) value interpolated into that HTML MUST be passed through `escapeHtml()` from `lib/print.ts`; URLs in `href` context go through `safeUrl()` (http/https allowlist). The only sanctioned `document.write` sinks are `openPrintWindow()` in `lib/print.ts` and `components/DischargeSheet.tsx` (which sets the title via `win.document.title`, not string interpolation) — a CI grep guard in `ci.yml` (lint job) blocks `document.write(` anywhere else under `clinic/src`. New sink ⇒ escape every field first, then allowlist it. Regression test: `src/test/print-xss.test.ts`.

**Backend patterns**
- Middleware order in `app.ts`: **`trust proxy (loopback,linklocal,uniquelocal)` →** `correlationId → strip-x-session-state/x-security-flags → helmet(csp) → cors → pinoHttp → metricsMiddleware → express.json/urlencoded → cookieParser → [login-shield on POST /auth/login] → [globalMutationLimiter on all other mutations] → router`. Trust proxy MUST be first so `req.ip` resolves correctly behind Caddy.
- CSRF is not a separate middleware mount — it runs inside the v7 kernel (`lib/policy.ts`) for `write`/`privileged` scopes on mutation methods (POST, PUT, PATCH, DELETE).
- All routes under `/api`. Prefer `authGate(scope, allowedRoles?)` from `middlewares/auth-gate.ts` for new code. Legacy `requireAuth`/`requireRole` shims (in `middlewares/auth.ts`) delegate to `authGate(scope, ...)` where scope is **method-based** (since F-P2-5, 2026-06-04): `read` for GET/HEAD (gets ADR-010 bounded fail-open), `write` for POST/PUT/PATCH/DELETE (CSRF + fail-closed revocation). They remain for existing route files.
- Full role list: `super_admin | admin | doctor | nurse | front_desk | xray_staff | lab_staff | compliance_officer | billing_manager | pharmacist`
- `super_admin` bypasses all role checks inside `evaluate()` — never block them at the route or service layer.
- **Service layer**: Route files (`*.routes.ts`) = HTTP only (parse params, call service, map errors). Service files (`*.service.ts`) = business logic, DB queries, scope checks, audit calls. ESLint `no-restricted-imports` (in `artifacts/api-server/eslint.config.mjs`) blocks `@workspace/db`/`drizzle-orm` in **route** files — glob `src/routes/**` **and** `src/modules/**/*.routes.ts` — and blocks the raw `db` named export in **service** files — glob `src/services/**` **and** `src/modules/**/*.service.ts` (use `dbUnsafe` for non-tenant tables). The `lint` script is `eslint src/routes src/modules` (so it scans the modules too — pre-migration it only scanned `src/routes`). Enforced by the `lint` CI job (blocking).
- **Error envelope**: Every error response shares the canonical shape `{ success: false, error_code, error_name, session_state, message, request_id, timestamp }`. Three exit paths emit it: `middlewares/asyncHandler.ts` for domain errors thrown from services (`NotFoundError`, `ValidationError`, `ForbiddenError`, `ConflictError`, `UnauthorizedError` from `services/errors.ts`); `middlewares/envelope.ts::notFoundHandler` for unmatched routes; `middlewares/envelope.ts::globalErrorHandler` for Postgres errors (23505 → CONFLICT, 23503 → VALIDATION) and unrecognised errors. Two intentional non-envelope shapes remain in `routes/auth.ts` (429 rate-limit returns `retryAfterSecs`; 401 invalid-creds returns `attemptsRemaining`) because the Login page reads those fields — promoting them would require extending the envelope. Documented inline.
- All mutations: `logAudit(req, action, entityType, entityId)` from service layer. All PHI reads: `logRead` (single-record) or `logAudit(req, "READ_LIST", ...)` (list endpoints). Denied attempts: `logDenied`. All wrappers in `lib/audit.ts`.
- **Change-history (before→after).** `logAudit(req, action, entityType, entityId, details?, beforeState?, afterState?)` — for `UPDATE`/`DELETE`/void mutations, capture a pre-mutation row and pass `beforeState`/`afterState`. **Always wrap raw DB rows in `auditSnapshot(row)`** (from `lib/audit-snapshot.ts`, re-exported by `lib/audit.ts`) — NEVER pass a raw row. `auditSnapshot` redacts the five field-encrypted columns (`diagnosis`, `vitals`, `medications`, `allergies`, `emergencyContact`) to `"[redacted]"` (no second cleartext-PHI store; no rotating-IV ciphertext noise) and drops noise columns (`createdAt`/`updatedAt`/`deletedAt`/`clinicId`/`searchVector`/`password*`). Put changed *field names* in `details.fields` (use the patch keys, not a ciphertext compare). The change-history surfaces via `GET /audit-logs/entity/{entityType}/{entityId}` (super_admin/compliance_officer) → frontend `components/ChangeHistory.tsx` + `lib/auditDiff.ts`. Compliance UIs: `PatientConsentCard`, `BreakGlassButton`/`BreakGlassQueue`, `ErasurePanel` — all gate actions by exact role; the break-glass/erasure panels live on both `ComplianceDashboard` and the admin `Dashboard` (`isAdminRole`) because super_admin/admin don't see ComplianceDashboard.
- **Multi-tenant isolation (CRITICAL)**: Every PHI service query — SELECT, INSERT, UPDATE, DELETE — MUST include `eq(table.clinicId, req.user!.clinicId)` in its conditions array. Missing this filter allows cross-tenant data leakage the moment a second clinic onboards. The policy kernel fail-closes on tokens without a positive-integer `clinicId` (returns `AUTH_TOKEN_INVALID` / 401) — the previous `?? 1` fallback was removed 2026-05-30. `req.user!.clinicId` is always a populated positive integer downstream of auth; if you see code that defaults it, that is a bug — fix the mint path. For `INSERT` statements, set `clinicId: req.user!.clinicId` in `.values({...})`. For `UPDATE`/`DELETE`, add `eq(table.clinicId, req.user!.clinicId)` alongside any other conditions. **`clinic_id` has NO column default (migration 0027 dropped the old `DEFAULT 1`)** — it is a required field in Drizzle's insert type, so a forgotten `clinicId` is a compile error and, at runtime, a NOT NULL violation (23502) rather than a silent mislabel to clinic 1. Never re-add a default to a `clinic_id` column; for genuinely tenant-less system/audit writes pass the explicit `SYSTEM_CLINIC_ID` sentinel from `lib/audit.ts`. Cross-tenant governance views (audit / erasure for super_admin) must be opt-in via an explicit endpoint, not the default scope. **DB-layer backstop (2026-05-31, migration 0014 + 0015; production-activated 2026-06-02, migration 0020 + ADR-008)**: every clinic-bearing table has `CHECK (clinic_id > 0)` and an RLS `tenant_isolation` policy that activates inside `runInTenantContext(req.user!, async (tx) => …)` from `@workspace/db`. The policy is dormant outside that wrapper. **Critical:** RLS only enforces when the connecting role is NOT a superuser and NOT BYPASSRLS. Migration 0020 creates the `medicore_app` role (NOSUPERUSER NOBYPASSRLS) and api/worker now connect as that role in production — RLS is active for all services wrapped in `runInTenantContext()`. Services that bypass tenant context for legitimately non-tenant tables import `dbUnsafe` (an alias of `db`) with a one-line justification comment. The ESLint rule in `eslint.config.mjs` blocks bare `db` imports in `src/services/**` to prevent regression.
- **Audit write path = transactional outbox.** `logAudit()` inserts into `audit_outbox` (unindexed, no FK constraints — fast writes). The PHI operation never blocks on audit-DB health. A 5-second `setInterval` drain worker (`drainAuditOutbox()`) transfers rows to `audit_logs` with exponential backoff (5 s/30 s/2 min/10 min) and up to 5 attempts. Exhausted rows (all 5 attempts failed) are counted in `audit_log_write_failures_total` and logged `audit_outbox_row_exhausted`. Outbox write failures (outbox INSERT itself fails) log `audit_outbox_write_failed`. Never block a read on audit-DB health; never write directly to `audit_logs` from `logAudit()` — the outbox is the only sanctioned write path. Test mocks of `@workspace/db` that cover any route triggering `logAudit()` must include `auditOutboxTable: {}` in the mock.
- Validate all route integer params with `safeParseInt` or `validateParamInt` middleware from `lib/validators.ts`.
- **Pagination**: All list endpoints use cursor pagination (`?cursor=<id>&limit=<n>`). Hard max 100 rows. `ORDER BY id DESC`. Response: `{ data, nextCursor }` (nextCursor is the last id, or null on final page). Never use `?offset` — offset pagination drifts on insert-heavy tables. `params.patientId`, `params.doctorId` etc. from `req.query` are strings — always `parseInt()` before passing to Drizzle integer columns.
- Soft-delete: filter `isNull(table.deletedAt)` in all queries.
- Global mutation rate limit: `ipRateLimit(100, 15 * 60 * 1000)` applied to all POST/PUT/PATCH/DELETE routes except `/auth/login` (which gets the stricter login-shield). Do not add redundant per-route rate limiters for normal mutations.

**Database**
- Most tables use `serial` integer PKs and `createdAt`/`updatedAt` timestamps. **Exceptions:** `clinic_notices` uses a `uuidV7` PK; `login_attempts` a `text` natural key; `clinic_invoice_counters` an `integer` (`clinic_id`) natural key; `doctor_patients` and `user_devices` use composite PKs. **New tables: prefer `uuid("id").$defaultFn(uuidV7).primaryKey()`** (see Feature Checklist).
- Soft-delete via `deletedAt` column on most domain tables.
- JSONB columns and their guard schemas (in `artifacts/api-server/src/lib/jsonb-schemas.ts`): `medical_records.vitals` → `vitalsSchema`; `prescriptions.medications` → `medicationsSchema`; `operations.staffAssigned` → `staffAssignedSchema` (default `[]`). `audit_logs.details` is intentionally unconstrained. **Never `db.insert` / `db.update` a JSONB column without `safeParse` against the matching schema** — services are the only callers, never bypass. `itemsSchema` (in `jsonb-schemas.ts`) is retained for input validation in `billing.service.ts` `createInvoice()` — the `invoices.items` JSONB column was dropped in migration `0005_charming_psynapse.sql`; `invoice_items` is now the sole source of truth for line-items.
- `medical_records` — `isGlobal` and `globalReason` columns removed (migration `0011_clinic_notices.sql`). Clinic-wide advisories live in the separate `clinic_notices` table (`GET/POST/DELETE /clinic-notices`). `PATCH /medical-records/:id/global-flag` route removed.
- Schema is managed via versioned Drizzle migrations (`db:generate` → `db:migrate`). `drizzle-kit push` / `push-force` are reserved for local dev only — never run against staging or prod. The CI `migration-drift` job enforces that every schema change has a committed migration file.

**SSE (real-time)**
- `emitToUser(userId, event, data)` in `lib/sse.ts` publishes via `runtime.eventBus` — in-memory (dev) or Redis Pub/Sub (prod).
- **SSE payloads must NOT contain PHI** — use IDs only. Frontend fetches full records via authenticated API hooks.
- **Graceful drain (P1-8)**: `GET /notifications/stream` returns `503 + Retry-After: 10` when `isShuttingDown()` is true — new connections refused. `closeAllSSEClients()` sends per-connection jittered `retry: <5000–15000ms>` + `event: reconnect\ndata: {retryAfter}` before `res.end()`. Shutdown sequence holds connections for `SSE_DRAIN_MS` (default 10s, 0 in tests) before calling `closeAllSSEClients()`. Docker compose `stop_grace_period: 35s` ensures Docker does not SIGKILL mid-drain.
- **Connection caps (Phase 3, 2026-05-31)**: per-process cap `SSE_MAX_CONNECTIONS` (default 500) — over-cap returns `503 + Retry-After: 30` *before* SSE headers flush. Per-user cap `SSE_MAX_PER_USER` (default 10) — at the limit the oldest connection for that user is evicted (handles browser tab-leaks). `addSSEClient()` returns `boolean` — routes must check the return value and bail with 503 on `false`. `sse_active_connections` gauge tracks live count.
- Frontend `useNotificationsStream` handles `reconnect` event using `data.retryAfter` delay (server-supplied jitter). Falls back to fixed 5s on `onerror` (network failure). Successful notification invalidates the relevant React Query cache key.

**Cache layer (Phase 3, 2026-05-31)**
- `runtime.cache: CacheService` is always defined (Redis when `SESSION_STORE=redis`, in-memory fallback otherwise). Interface: `getOrSet(key, ttlSec, fetcher)`, `del(key)`, `invalidatePattern(pattern)`. Redis path is best-effort — cache failures log and fall through to the fetcher; they never break a request.
- Key convention: `cache:{clinicId}:{entity}:{variant}` (the `keyPrefix` parser uses `parts[2]` as the metric label).
- Currently cached read paths (all non-PHI, non-audit-emitting): `getDashboardSummary` (30 s), `getDepartmentLoad` (30 s), `getRecentActivity` (15 s). TTLs hardcoded with a `TODO: move to env vars if patient portal is added` comment in `dashboard.service.ts`.
- **Do NOT cache PHI reads or anything that calls `logRead`/`logAudit`** — caching skips audit on hits (HIPAA gap) and would persist decrypted PHI in Redis. `getPatientSummary` and `billing.getDailySummary` are intentionally uncached for this reason.
- No proactive `invalidatePattern()` at mutation sites — the 15–30 s TTL is acceptable staleness for internal-staff dashboards. Add invalidation only if freshness becomes a real complaint.
- Metrics: `cache_hit_total{key_prefix}`, `cache_miss_total{key_prefix}`.

---

## Security Architecture

| Layer | Implementation |
|---|---|
| Authentication | `jose` **EdDSA (Ed25519)** JWT + `kid` header + `jti` claim + `fph` fingerprint (SHA-256 of User-Agent + Accept-Language, first 16 hex chars). Public keys at `GET /api/.well-known/jwks.json`. `SESSION_SECRET` is HMAC key for device fingerprinting only (no longer JWT signing). |
| MFA | **Removed.** Single-step login for all roles. No TOTP, no recovery codes, no `mfa_sessions`. Re-scope before implementing. |
| Phase 2 device trust | Code-landed flag-OFF (2026-05-26). When `PHASE2_DEVICE_TRUST_ENABLED=true`: HMAC fingerprint matches an existing `user_devices` row → trusted; otherwise privileged roles (super_admin/admin/compliance_officer/doctor) get blocked with `pending_verification` until the email link is clicked, non-privileged roles get an `allow_unverified` session with `dvu=true` claim. First-ever login auto-trusts; subsequent logins after flag-flip auto-trust with `trust_source='grandfathered'`. Email-link tokens 15-min TTL, single-use, fingerprint-bound (different-device clicks fail closed). Helper: `isPhase2Enabled()` in `lib/auth-constants.ts`. |
| Phase 2 step-up | Code-landed flag-OFF. `requireStepUp(action)` middleware in `middlewares/step-up.ts` — re-verifies password via `X-Step-Up` header for destructive actions (delete user, void invoice, role escalation, bulk export). Audits `STEP_UP_OK` / `STEP_UP_FAILED`. Gated by `PHASE2_STEP_UP_ENABLED`. |
| Phase 2 password policy | Code-landed flag-OFF. Strict mode (`PHASE2_STRICT_PASSWORD_POLICY=true`) requires 12 chars + special + dictionary blocklist + HIBP k-anonymity. Sync helper `validatePasswordStrength()` for length/composition; async `validatePasswordStrictAsync()` adds HIBP. Falls open on HIBP outage (network error → allow). |
| Phase 2 CSP report | Code-landed flag-OFF. `helmet` emits `report-uri /api/csp-report` when `PHASE2_CSP_REPORT_ENABLED=true`. Reports persisted to `csp_reports` table (90-day retention recommended; not enforced yet). |
| JWT TTL by role | `super_admin` 15m · `admin` 1h · `doctor`/`nurse`/`compliance_officer` 2h · `billing_manager`/`front_desk`/`xray_staff`/`lab_staff`/`pharmacist` 4h |
| Cookie | `clinic_token`: HttpOnly, Secure (prod), SameSite=Strict, `maxAge` = per-role TTL ms |
| Authorization | `evaluate()` kernel in `lib/policy.ts` — `super_admin` auto-bypasses role check |
| Session Revocation | Pluggable `RevocationStore` — `revoke(userId, nowUnix)` invalidates all tokens with `iat ≤ revokedAt`. `verifyToken` fail-closed: store error throws, not allows. |
| jti Replay Defense | `privileged` scope only — jti consumed on first use; replay blocked with error 1006. Fail-closed on store error (1003). Latent-but-ready: no production route calls `markJtiUsed` yet. See ADR-007. |
| CSRF | Origin exact-match + double-submit cookie (`X-CSRF-Token` vs `_csrf` cookie), method-gated on mutations inside `evaluate()`. No `CSRF_EXEMPT_PATHS`. |
| Rate Limiting | Login: `rateLimiter.ts` DB-backed (5/15 min, 30 min lockout) + login-shield IP layer (20/15 min). Mutations: global IP rate limit (100/15 min). Pluggable `RateStore` (memory dev / Redis prod). |
| Data Scoping | SQL-level doctor scope via `getDoctorPatientScope()` + `inArray()` |
| Multi-tenant isolation | Every PHI service query filters by `eq(table.clinicId, req.user!.clinicId)`. `AuthUser.clinicId` is always a positive integer downstream of auth — the policy kernel fail-closes (`AUTH_TOKEN_INVALID` / 401) on tokens missing `clinicId` or with non-positive values. Postgres RLS policies enforce inside `runInTenantContext()` (migration 0015) and are production-effective as of 2026-06-02 (migration 0020 + ADR-008): api/worker connect as `medicore_app` (NOSUPERUSER NOBYPASSRLS) so the DB-layer backstop is real, not nominal. |
| Fingerprint binding | `fph` claim checked on every request; mismatch → error 1004; `FINGERPRINT_BINDING=disabled` env var as emergency bypass. **The two levers (`FINGERPRINT_BINDING`, `FPH_GRANDFATHER_UNTIL`) are centralized in `lib/fingerprint-lever.ts` (AUD-SEC-07)** — both `policy.ts` (kernel) and `auth.ts` (legacy verifier) call it, never re-read env inline. In production the `disabled` bypass requires `FINGERPRINT_BINDING_EXPIRES_AT` and self-expires (fail-secure on no/expired TTL); engaged state is loud-logged (throttled) + exposed via the `fingerprint_binding_disabled` gauge → `FingerprintBindingDisabled` critical alert. |
| Logging | Pino — PHI fields (`fullName`, `vitals`, `phone`, `email`, etc.) → `[REDACTED]` |
| Audit Trail | `audit_logs` table — append-only, 7-year retention, immutable; every read logs `AUDIT_LOG_READ`. Writes go via `audit_outbox` (unindexed, no FK) → drained every 5 s to `audit_logs` with exponential backoff (5 s/30 s/2 min/10 min, max 5 attempts). Exhausted rows counted in `audit_log_write_failures_total` + logged `audit_outbox_row_exhausted`. `auditOutboxDepthGauge` Prometheus gauge sampled at each drain tick. Final drain flush on graceful shutdown before `pool.end()`. **Hash chain**: nightly cron (`"0 2 * * *"`) (1) records a SHA-256 chain over each day's rows in `audit_integrity_checks` (`recordDailyIntegrity`, migration `0010`), then (2) **verifies** it (F-P4-1, 2026-06-05): `verifyRecentIntegrity()` re-derives + compares the last `AUDIT_VERIFY_WINDOW_DAYS` days (default 7), and `verifyChainLinkage()` asserts each `prevHash` == the prior calendar day's `rootHash`. Any divergence sets `status=mismatch` + increments `audit_integrity_check_failures_total` → `AuditIntegrityMismatch` alert (`for: 0m`). Recording alone never set `mismatch`; verification is what actually runs the check. `audit_logs` is append-only for `medicore_app` — UPDATE/DELETE revoked (migration `0026`). New partitions are auto-revoked by migration `0028`'s `audit_partition_append_only_trg` event trigger (so 0020's default-privs re-grant can no longer silently re-open them); proven by `audit-append-only.integration-db.test.ts`. |
| Billing SoD | `front_desk` creates manual invoices; `billing_manager`/admin pays/cancels; **`front_desk` may also PAY `order_basket` invoices only** (clearance-gate desk flow, ADR-011 — baskets are system-created by the ordering clinician so creator≠payer holds); cancel requires reason ≥ 30 chars; anti-fraud gate blocks same-user pay within 30s of create; emergency clearance override = doctor/nurse/admin, reason ≥ 30 chars, audited + surfaced in reconciliation `overridesOutstanding` |
| PHI Field Encryption | AES-256-GCM via `lib/field-encryption.ts`. Fields: `diagnosis`, `vitals`, `medications`, `allergies`, `emergencyContact`. Current envelope: `enc:v2:<kid>:<iv>:<tag>:<data>`. Legacy `enc:v1:` envelopes still decrypt via kid="1". Key registry: `FIELD_ENCRYPTION_KEY` (kid=1), optional `FIELD_ENCRYPTION_KEY_NEXT` (kid=2 during rotation). `FIELD_ENCRYPTION_KEY_WRITE_KID` (default "1") controls active write kid. Prod fail-closed if write kid has no registered key. Rotation procedure in `docs/SECURITY.md`. |
| Patient Consent | `patient_consents` table. `treatment` consent required before `createMedicalRecord` / `createPrescription` (service-layer check via `hasActiveConsent`). Throws `ConsentRequiredError` (HTTP 422, code 3010). |
| Break-Glass Access | `break_glass_sessions` table. 15-min TTL. **Activate is gated to clinical roles** (`super_admin`, `admin`, `doctor`, `nurse` — front_desk / billing / pharmacy / lab / xray are not eligible). Request body requires both `justification` (≥30 chars) AND `reasonCategory` (enum: `life_threatening_emergency` \| `patient_unconscious` \| `code_blue_response` \| `covering_attending_unavailable` \| `regulatory_audit_request`). Immediate SSE alert to all same-clinic `compliance_officer` users; payload contains IDs + `reasonCategory` only (no PHI). Every PHI access during session logs `BREAK_GLASS_ACCESS`. Owner or compliance_officer can revoke early. Sessions, the patient lookup, and the officer fan-out are all clinic-scoped. **Clinical-PHI read bypass (F-P2-1, 2026-06-04):** an active session lets the activating doctor READ the patient's 5 doctor-bound clinical tables — enforced at the DB layer by migration 0024's `app.break_glass_patient_ids` clause on the `doctor_scope` RLS policy (read-only; `WITH CHECK` unchanged). Wired via `getActiveBreakGlassPatientIds()` → `runInTenantContext(..., { breakGlassPatientIds })`; see Doctor Scope Rule. |
| Right-to-Erasure | `erasure_requests` table. Three-step: request → approve → execute (super_admin only). Execution anonymizes PHI across **all** clinical tables in one transaction (F-P3-1, 2026-06-04): patients demographics, medical_records (incl. encrypted diagnosis/vitals + Arabic fields), prescriptions (`medications` ciphertext → `[ERASED]` + soft-delete), lab_tests / xray_records / ultrasound_records (results/report/imageUrl/notes nulled + soft-delete), appointments (reason → `[ERASED]`, notes/cancellationReason nulled). `erasedCounts` in the `ERASURE_EXECUTED` audit is derived from rows actually scrubbed. Irreversible (ADR-005). When adding a new PHI-bearing table, extend `executeErasure`. |
| SSE Payloads | IDs only — no PHI |
| CORS | Dev: `localhost:*` + `127.0.0.1:*`. Prod: `ALLOWED_ORIGINS` env var only (parsed once into `policy.ts` `ALLOWED_ORIGINS_SET`; `REPLIT_DOMAINS` was removed). No-origin requests (curl/Postman) are allowed through — CORS is not a CSRF substitute. |
| Error Handling | No stack traces in 5xx responses (production). Canonical error envelope: `{ success, error_code, error_name, session_state, message, request_id, timestamp }` — 20 stable codes in `src/errors.ts`. 404 + global 5xx emit the envelope via `middlewares/envelope.ts`; domain errors via `middlewares/asyncHandler.ts`. The 2 raw shapes in `routes/auth.ts` (429/401 with `retryAfterSecs` / `attemptsRemaining`) are intentional. |

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
xray_status:        requested → in_progress → completed | cancelled  ← renamed 0038; cancelled added 0041
ultrasound_status:  requested → in_progress → completed | cancelled  ← renamed 0038; cancelled added 0041
lab_test_status:    requested → in_progress → completed | cancelled
invoice_status:     pending → paid | cancelled
invoice_kind:       manual | order_basket                 ← order_basket = system-created per-patient
                                                            basket of clinical-order auto-charges (ADR-011);
                                                            at most ONE open per patient (invoice_open_basket_uq)
clearance_status:   pending → cleared | overridden | expired  ← ORTHOGONAL financial state on lab_tests/
                                                            xray_records/ultrasound_records (ADR-011, default
                                                            'cleared'). Gate ON: orders start 'pending' with an
                                                            auto-charge on the basket; workflow progress
                                                            (in_progress/completed) is 409/3020-blocked until
                                                            paid ('cleared') or clinically overridden.
                                                            Department rows expose `charge:{amountCents}|null` —
                                                            the order's OWN line only, NEVER invoice/basket
                                                            totals (ADR-011 §10, owner rule). List filter
                                                            `clearanceStatus` takes a comma list; bad value 400.
operation_status:   scheduled → in_progress → completed | cancelled
notification_type:  patient_arrived | lab_ready | xray_ready | ultrasound_ready | general
```

---

## Environment Variables

```
DATABASE_URL=postgresql://user:pass@host:5432/clinic_db
PORT=5000
NODE_ENV=development
SESSION_SECRET=<32-byte hex>
  # HMAC key for device fingerprinting (Phase 2 device-trust). NO LONGER used for JWT signing.
  # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  # PRODUCTION: mounted from ./secrets/session_secret — do NOT put in environment: block.
JWT_PRIVATE_KEY=<PKCS8 PEM Ed25519 private key>  # Signs all JWTs. Required in production.
  # Generate pair atomically — see secrets/README.md. PRODUCTION: mounted from ./secrets/jwt_private_key.
JWT_PUBLIC_KEY=<SPKI PEM Ed25519 public key>      # Advertised via /.well-known/jwks.json.
  # PRODUCTION: mounted from ./secrets/jwt_public_key. Must match JWT_PRIVATE_KEY.
JWT_KID=1                            # kid string for current signing key. Default "1". Increment on rotation.
JWT_PREV_PUBLIC_KEY=                 # Previous public key (SPKI PEM) for rotation overlap window. Optional.
JWT_PREV_KID=                        # kid of JWT_PREV_PUBLIC_KEY. Optional.
BCRYPT_ROUNDS=12
SESSION_STORE=memory          # "memory" (default) | "redis" — set to "redis" in production
REDIS_URL=redis://localhost:6379  # required when SESSION_STORE=redis

# ── DB pool (Phase 3, 2026-05-31) ──────────────────────────────────────────────
DB_POOL_MAX=40                # Max pool connections per process (default 40).
                              #   Watch: API + worker each open this many. Postgres
                              #   max_connections=100 default → leaves no headroom for
                              #   a 2nd API replica. That's the PgBouncer trigger.
DB_POOL_MIN=2                 # Warm connections kept open — kills cold-start latency.
DB_POOL_IDLE_TIMEOUT=30000    # ms before an idle conn is closed.
DB_POOL_CONNECT_TIMEOUT=5000  # ms client will wait for a free conn.
DB_STATEMENT_TIMEOUT=30000    # ms Postgres-side cap on a single statement —
                              #   prevents runaway queries from hogging pool slots.

# ── SSE caps (Phase 3, 2026-05-31) ─────────────────────────────────────────────
SSE_MAX_CONNECTIONS=500       # Per-process cap. Over-cap → 503 + Retry-After: 30.
SSE_MAX_PER_USER=10           # Per-user cap; oldest connection evicted at the limit.

# ── Financial clearance gate (Phase A, ADR-011) ────────────────────────────────
CLEARANCE_GATE_ENABLED=false   # CONTROL-PLANE switch, default OFF (byte-identical off). ON:
                              #   lab/xray/ultrasound orders are created clearance_status=
                              #   'pending' with an auto-charge line on the patient's
                              #   order_basket invoice (priced from services_catalog codes
                              #   LAB_DEFAULT/XRAY_DEFAULT/US_DEFAULT — PRICE THEM before
                              #   flipping ON, zero-price lines warn-log, codes UNIQUE per
                              #   clinic since 0043); workflow progress blocks (409/3020)
                              #   until the basket is paid or clinically overridden. The
                              #   DATA PLANE (settle-on-pay, expiry sweep) runs regardless
                              #   of the flag — safe rollback, no orphaned baskets (ADR-011 §8).
CLEARANCE_TTL_HOURS=48         # Hourly cron expires orders still pending-clearance past
                              #   this window, withdraws their basket lines, auto-cancels
                              #   emptied baskets (SYSTEM_CLEARANCE_EXPIRED audit per clinic).

# ── Audit integrity verification (F-P4-1, 2026-06-05) ──────────────────────────
AUDIT_VERIFY_WINDOW_DAYS=7     # Daily integrity cron re-derives + compares the last
                              #   N days of audit_logs hashes (verifyRecentIntegrity)
                              #   so tampering is caught daily, not just at the
                              #   quarterly restore drill. Plus verifyChainLinkage
                              #   walks prevHash==prior rootHash. Default 7.
IMAGING_STORAGE_DIR=          # Where uploaded X-ray/ultrasound image files are written
                              #   (AES-256-GCM encrypted at rest via FIELD_ENCRYPTION_KEY).
                              #   Default ./storage/imaging (dev, gitignored). Prod = the
                              #   imaging_data Docker volume (/data/imaging), mounted into
                              #   api+worker and read-only into backup. MUST join the backup
                              #   set. Never served via express.static — only the authenticated
                              #   GET /{xray|ultrasound}/:id/images/:attId endpoint reads it.
REVOCATION_READ_GRACE_MS=30000 # ADR-010: read-scope revocation bounded fail-open window.
                              #   Reads degrade only within this window of last healthy
                              #   store contact; sustained outage fails closed. 0 = always
                              #   fail closed. write/privileged always fail closed.
ALLOWED_ORIGINS=              # comma-separated CORS origins for production (e.g. https://medicore.example.com). Sole CORS origin source — REPLIT_DOMAINS removed.
FINGERPRINT_BINDING=          # set to "disabled" to bypass fph fingerprint checks (emergency lever only — RUNBOOK §5)
FINGERPRINT_BINDING_EXPIRES_AT=  # unix secs (AUD-SEC-07). In PRODUCTION, FINGERPRINT_BINDING=disabled is
                              #   honored ONLY while now < this value — no/expired TTL ⇒ the bypass is
                              #   refused and fph re-enforces (fail-secure). Ignored in dev/test. The
                              #   `fingerprint_binding_disabled` gauge reads 1 while active → FingerprintBindingDisabled alert.
FIELD_ENCRYPTION_KEY=         # 64 hex chars (32 bytes) for AES-256-GCM PHI field encryption — kid="1"
  # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  # Required in production — server refuses to start without it. Dev: omit to run unencrypted (warning logged).
  # Encrypts: diagnosis, vitals (medical_records); medications (prescriptions); allergies, emergencyContact (patients).
  # PRODUCTION: mounted from ./secrets/field_encryption_key — do NOT put in environment: block.
FIELD_ENCRYPTION_KEY_NEXT=    # Optional. 64 hex chars. kid="2". Present only during key rotation overlap.
FIELD_ENCRYPTION_KEY_WRITE_KID=  # Which kid new writes use. Default "1". Set to "2" to promote next key.

# ─── Phase 2: Auth Hardening (all default OFF) ──────────────────────────────
PHASE2_DEVICE_TRUST_ENABLED=false
  # MASTER SWITCH. When false the entire Phase 2 system is dormant and login
  # behavior is byte-identical to Phase 1. Flip to "true" to activate device
  # trust + new-device email verification + step-up + strict password policy.
  # All sub-flags below are auto-false when this is false.
PHASE2_EMAIL_VERIFY_ENABLED=false   # §2.2 — new-device email link flow
PHASE2_STEP_UP_ENABLED=false        # §2.7 — re-prompt password on destructive actions
PHASE2_STRICT_PASSWORD_POLICY=false # §2.8 — 12-char + special + HIBP k-anon + dictionary
PHASE2_CSP_REPORT_ENABLED=false     # §2.8 — CSP report-uri + /api/csp-report ingestion

# Phase 2 — transactional email (required when PHASE2_EMAIL_VERIFY_ENABLED=true)
RESEND_API_KEY=                # Resend bearer token. Omit to console-log emails in dev.
EMAIL_FROM_ADDRESS=MediCore <no-reply@medicore.local>

# Phase 2 — SMS fallback for privileged-role verification (optional)
SMS_PROVIDER=                  # "twilio" or empty (stub)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# Phase 2 — public URL used in email verification + reset links
APP_PUBLIC_URL=                # e.g. https://medicore.example.com (no trailing slash)

# ─── Phase 4: Operational Hardening (prod-only, required for compose up) ───
API_IMAGE=                     # e.g. registry/medicore-api:abc1234 — pin to a CI-tagged build for rollback.
                               # Falls back to local build when unset (dev).
WORKER_IMAGE=                  # Optional. Defaults to ${API_IMAGE} (single artifact, separate entrypoint).
SMTP_SMARTHOST=                # Alertmanager email — e.g. smtp.gmail.com:587
SMTP_FROM=                     # e.g. medicore-alerts@yourdomain
SMTP_AUTH_USER=                # SMTP username
SMTP_AUTH_PASS=                # SMTP password / app token. NOTE: visible to `docker inspect alertmanager` — use app-specific token.
ALERT_EMAIL_TO=                # Destination, e.g. ops@yourdomain
BACKUP_GPG_RECIPIENT=          # GPG key id/email of the backup encryption key. Public key only on backup container.
BACKUP_RSYNC_TARGET=           # Offsite rsync target, e.g. user@offsite.example.com:/srv/backups/medicore/
GRAFANA_ADMIN_USER=admin       # Optional. Password is FILE-mounted from ./secrets/grafana_password.
GNUPG_HOME=                    # Optional. Host path to mount as the backup container's /root/.gnupg. Default /root/.gnupg.
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
- Supply chain: pnpm `minimumReleaseAge: 1440` (1 day) enforced for all packages — `minimumReleaseAgeExclude: []` in `pnpm-workspace.yaml` (no packages currently excluded).
- Only `pnpm` allowed — `preinstall` script rejects npm/yarn.

---

## Adding a New Page (Frontend)

1. Create `artifacts/clinic/src/pages/NewPage.tsx`. Use Bayan CSS classes on the root (`<div className="page">`), `.card` / `.card-pad` for sections, plain `<button className="btn btn-primary btn-sm">` for buttons, `<span className="badge badge-teal text-xs">` for badges. Do NOT import `PageHeader`, `Button`, or `Badge` from `@/components/ui/*` in application code.
2. All user-facing strings via `useI18n()` — add EN + AR keys to **both** `hooks/locales/en.ts` and `hooks/locales/ar.ts` (split 2026-06-29). `hooks/i18n.tsx` imports from those files and re-exports `translations = { en, ar }`. The `i18n.test.ts` EN/AR parity guard fails CI if any key exists in one locale file but not the other.
3. Import the page lazily in `App.tsx`: `const NewPage = lazy(() => import("@/pages/NewPage"));`
4. Add `<Route path="/new-path"><Guard path="/new-path" role={role}><NewPage /></Guard></Route>` inside the existing `Switch`. The route block is already wrapped in `RouteErrorReset` so per-route error resets are automatic.
5. Add the path + allowed roles to `lib/route-access.ts` (`navItems` array); pin to a role's quick-nav by editing `navPinnedByRole`.
6. The `Layout.tsx` sidebar reads `navItems` and `navPinnedByRole` directly — no manual sidebar edit needed.

## Adding a New Route (Backend)

> **Layout (since the 2026-06-29 feature-module migration):** backend code is organized by **feature module** under `artifacts/api-server/src/modules/<feature>/`, NOT the old `routes/` + `services/` split. `src/routes/` now holds only `index.ts`; `src/services/` holds only shared infra (`errors.ts`, `email.service.ts`, `sms.service.ts`). DB schema stays in `lib/db/src/schema/` (shared package). The cross-cutting kernel stays in `lib/` (policy, audit-write, RLS/tenant-context, encryption, runtime, scope, sse).

1. Pick the owning module under `artifacts/api-server/src/modules/<feature>/` (e.g. `clinical`, `billing`, `identity`, `compliance`, `imaging`, `reporting`, `audit`, `operations`, `notifications`, `search`, `inventory`, `health`) — or create a new `modules/<feature>/` folder. Add `<feature>.service.ts` — owns DB queries, scope checks, audit calls, business rules. No Express types here.
2. Add `<feature>.routes.ts` in the same folder — HTTP only: parse params, call service, return response. No DB imports.
3. Export the router from the module's `index.ts` **barrel**, then in `artifacts/api-server/src/routes/index.ts` import it from the barrel (`../modules/<feature>`) and mount it — **keep the anonymous-before-authed `router.use()` order**. Cross-module calls import another module ONLY through its `index.ts` barrel, never a deep `modules/x/x.service` path.
4. Wrap all async handlers with `asyncHandler()` from `middlewares/asyncHandler.ts`
5. Use `authGate(scope, allowedRoles?)` from `middlewares/auth-gate.ts` for auth on new routes.
6. **Validate the request body** (WS3, 2026-06-06): add `validate(SchemaBody)` from `middlewares/validate.ts` as middleware on POST/PUT/PATCH routes, AFTER the auth/role middleware and BEFORE `asyncHandler`. Import the schema from `@workspace/api-zod` (Orval-generated from `openapi.yaml` — `CreateXBody`, `UpdateXBody`, etc.); never hand-write it. `validate()` **only validates** — it does NOT mutate `req.body` (no coercion/stripping leaks to the service), and emits the canonical 400 envelope. With it in place, drop the pure `if (!field) throw ValidationError("Missing…")` presence checks from the service, but KEEP business rules (role checks, consent, JSONB guards, date-parse). **Caveat:** confirm the generated schema models *client input*, not server-set/computed fields. Billing's `CreateInvoiceBody` originally required `createdById` (server-set from `req.user`) and `items[].total` (computed) — wiring it would have rejected valid creates. Fixed by adding `InvoiceItemInput` (request items, no `total`) and dropping `createdById` in `openapi.yaml`, then regen. When a request schema is wrong, fix `lib/api-spec/openapi.yaml` + regen — never hand-edit the generated files.
7. If the endpoint returns patient data and doctors can access it, add doctor scope filtering (see Doctor Scope Rule below).

---

## Doctor Scope Rule (CRITICAL) ✅ Enforced

Doctors can ONLY access patients who have at least one appointment where `doctorId = doctor's user ID`.

**Helpers in `artifacts/api-server/src/lib/scope.ts`:**
- `isDoctorScoped(role)` — returns `true` only for `"doctor"` role
- `getDoctorPatientScope(doctorId)` — returns authorized patient IDs from the `doctor_patients` materialized scope table. **Redis-cached** under `doctor_scope:<doctorId>` for `SCOPE_CACHE_TTL_SEC` (60s) when `SESSION_STORE=redis` (in-memory dev has no `scopeCache` → fresh each call). `invalidateDoctorScope(doctorId)` deletes the key and is called on appointment mutations (`appointments.service.ts`). Corrected 2026-06-07 (F-P8-1): was documented "no cache — fresh on each call." Any NEW path that changes a doctor↔patient assignment must call `invalidateDoctorScope` or accept ≤60s staleness.
- `assertPatientInScope(req, patientId, entityType?)` — resolves silently when allowed; **throws `ForbiddenError`** on deny (logs `logAudit("ACCESS_DENIED_OUT_OF_SCOPE", …)` first). The throw routes through `asyncHandler` to the canonical error envelope. Do not wrap the call in `if (!await …)` — the bool-returning shape was removed 2026-05-30 because forgetting the check silently granted access. **Break-glass:** if an active break-glass session exists for the patient, allow + `logBreakGlassAccess`.
- `assertMedicalRecordInScope(req, recordId)` → **returns `{ breakGlassPatientIds: number[] }`** (since 2026-06-04, F-P2-1). Rule 1: `doctorId=current user` → allow (`{ breakGlassPatientIds: [] }`); Rule 2: active break-glass session for the record's patient → allow + `logBreakGlassAccess`, returns `{ breakGlassPatientIds: [patientId] }`; Rule 3: deny → `logDenied("record_not_owned")` + throws `ForbiddenError`. Record-not-found returns `{ breakGlassPatientIds: [] }` so the caller handles 404. **Caller MUST pass the returned `breakGlassPatientIds` to `runInTenantContext(..., { breakGlassPatientIds })`** or the doctor_scope RLS (0017+0024) hides the row.
- `getDoctorListScope(req, entityType)` — for the 5 doctor-bound clinical **list** endpoints. Returns `{ allowed, breakGlassPatientIds }`: `allowed` = assigned patients ∪ active break-glass patients (use in `inArray(table.patientId, allowed)`); pass `breakGlassPatientIds` to `runInTenantContext(..., { breakGlassPatientIds })`. Audits `BREAK_GLASS_ACCESS` once when break-glass patients are surfaced. (Replaced the bare `getDoctorPatientScope` call in list paths.)
- **Break-glass + doctor_scope RLS (F-P2-1, 2026-06-04):** break-glass is a **read-only** emergency bypass of doctor scope. DB layer: migration 0024 adds `OR patient_id = ANY(app.break_glass_patient_ids)` to the 0017 `doctor_scope` `USING` clause (not `WITH CHECK` — no writes). The GUC is set by `runInTenantContext`'s optional `{ breakGlassPatientIds }`, populated by `break-glass.service.getActiveBreakGlassPatientIds()`. Every doctor read of a break-glass patient logs `BREAK_GLASS_ACCESS`.

**Enforced on ALL these backend routes when `role === "doctor"`:**
- `GET /patients` — list filtered to assigned patients only
- `GET /patients/:id` — 403 if out of scope
- `GET /patients/:id/summary` — 403 if out of scope
- `GET /medical-records` — filtered to assigned patients (SQL `inArray`)
- `GET /medical-records/:id` — `assertMedicalRecordInScope` (doctorId ownership, or active break-glass)
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

## Obsidian as Primary Memory

The **Obsidian vault** is the single source of truth for project knowledge, decisions, and history. Before starting any non-trivial task:

- Search the vault for existing notes, decision records, or architecture docs related to the task
- Prefer vault context over recalling from conversation history when the two conflict

After every task, update the vault (see Task Completion Rule below).

The vault path is: `C:\Users\xxmoh\OneDrive\Documents\Obsidian Vault\MediCore\`

---

## Task Completion Rule

**After every completed task**, update the following before closing out:

1. **[docs/CHANGELOG.md](../docs/CHANGELOG.md)** — add an entry describing what was done (feature, fix, refactor, etc.)
2. **[docs/HEALTH_STATUS.md](../docs/HEALTH_STATUS.md)** — update scores or notes if the task affects production health
3. **[docs/ROADMAP.md](../docs/ROADMAP.md)** — mark completed items, add newly surfaced items
4. **[docs/MIGRATION_NOTES.md](../docs/MIGRATION_NOTES.md)** — record any breaking changes, deprecated patterns, or lessons learned
5. **This file (CLAUDE.md)** — update any rules, constraints, architecture notes, or checklists that changed as a result of the task
6. **Obsidian vault** — add or update the relevant note (feature log, decision record, architecture note, or daily log) to keep the vault in sync with the codebase

> Skip docs that are genuinely unaffected by the task — but when in doubt, update.

---

## Feature Checklist

Every time you add a feature:

- [ ] New DB table? → create `lib/db/src/schema/new_table.ts`, export in `schema/index.ts`, run `pnpm --filter @workspace/db run db:generate`, commit the migration file, then run `pnpm --filter @workspace/db run db:migrate`. **PK**: use `uuid("id").$defaultFn(uuidV7).primaryKey()` (import `uuidV7` from `"../uuid-v7"`). **Audit**: pass the UUID string directly as `entityId` — `audit_logs.entity_id` is `text`, UUID strings work natively.
- [ ] New API route? → in `modules/<feature>/`: create `<feature>.service.ts` (business logic + DB) + `<feature>.routes.ts` (HTTP only), export the router from the module `index.ts` barrel, mount it in `routes/index.ts` (anonymous-before-authed order)
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
- Never import `PageHeader`, `Button` from `@/components/ui/button`, or `Badge` from `@/components/ui/badge` in application code (pages, components outside `components/ui/`). Use Bayan CSS classes on plain `<button>` / `<span>`: `.btn .btn-primary .btn-sm`, `.badge .badge-teal`, etc. The shadcn primitive files themselves stay untouched.
- Never use directional Tailwind classes in application code: NO `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`, `border-l-*`, `border-r-*`. Always logical: `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`, `border-s-*`, `border-e-*`. RTL relies on this.
- Never use old shadcn theme tokens in application code: NO `text-muted-foreground`, `bg-card`, `border-border`, `text-foreground`, `bg-primary`, `text-primary`, `text-destructive`, `bg-muted`. Always Bayan CSS vars: `text-[var(--ink-muted)]`, `bg-[var(--surface)]`, `border-[var(--line)]`, `text-[var(--ink)]`, `text-[var(--teal-600)]`, `text-[var(--rose-500)]`, `bg-[var(--surface-2)]`.
- Never use `import { z } from "zod"` — always use `"zod/v4"`
- Never use `react-router` — the router is `wouter`
- Never hardcode UI strings or colors
- Never block `super_admin` from any action
- Never guess file paths — check the folder structure above first
- Never write a DB migration manually — use `drizzle-kit generate` to produce migration SQL, then `drizzle-kit migrate` to apply it. `drizzle-kit push` is dev-only (no file generated, not safe for staging/prod).
- Never edit generated files in `api-client-react/src/generated/` or `api-zod/src/generated/` — but `lib/api-client-react/src/custom-fetch.ts` IS editable
- **Never import `@workspace/db` or `drizzle-orm` directly in route files** — DB access belongs in the service layer
- **Never read `process.env` directly outside `artifacts/api-server/src/lib/config.ts`** — all env vars go through the typed config module. The ESLint `no-restricted-properties` rule enforces this as an error; adding a raw read is a blocking CI lint failure. Exception: `auth-constants.ts` Phase 2 helpers read `process.env.PHASE2_*` dynamically (not via config) so that vitest `beforeAll` env mutations affect them after module collection — this is intentional, see MIGRATION_NOTES.
- Never call `requireAuth` + `requireRole` together on the same route — use a single `authGate(scope, allowedRoles?)` instead
- Never introduce MFA code (`otplib`, TOTP, recovery codes, `mfa_sessions`) until MFA is explicitly re-scoped as a feature
- Never check `process.env.PHASE2_*` directly in code — always go through the helpers in `lib/auth-constants.ts` (`isPhase2Enabled()`, `isEmailVerifyEnabled()`, etc.). The helpers compose the master switch correctly; raw env checks bypass that.
- Never treat the Phase 2 kill-switch as permanent architecture. It is scaffolding — schedule deletion ~30 days after `PHASE2_DEVICE_TRUST_ENABLED=true` lands in prod (ROADMAP Phase 2.11). Until then, CI must run the suite with the flag both on AND off or the off-path bit-rots.
- **Never put `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, or `METRICS_TOKEN` in the `environment:` block of `docker-compose.prod.yml`.** These are file-mounted via Docker secrets since 2026-05-27. Adding them back to `environment:` exposes them to `docker inspect`. **Alertmanager SMTP (corrected F-P6-5, 2026-06-07)**: Alertmanager does **NOT** env-expand its config file (the earlier `${VAR}` form was inert — no alert email was ever delivered). The SMTP password is now a Docker secret read via `smtp_auth_password_file: /run/secrets/smtp_auth_password` in `monitoring/alertmanager/alertmanager.yml`; the non-secret SMTP fields (smarthost/from/to/user) are hardcoded in that file (operator-edited per deployment). There is **no** `environment:` block on the alertmanager service. Same rule applies to Prometheus: `prometheus.yml` is not env-expanded, so the blackbox target is hardcoded, not `${BLACKBOX_TARGET}`. Use an app-specific SMTP token, never a reusable password.
- **Never expose Grafana via Caddy.** It binds `127.0.0.1:3000` and lives on the `backend` network only (Phase 4, 2026-05-31). Access is `ssh -L 3000:localhost:3000 deploy@host`. Adding a `handle_path /grafana/*` in `caddy/Caddyfile` or flipping the port to `3000:3000` puts an admin tool on the internet without TLS+auth — explicit operator decision against it.
- **Never add `apk add` or `npm install` to the api/worker runtime images** to "fix" a missing command. The runtime image is minimal on purpose. If you need a CLI in production, either (a) add it to the `backup` container entrypoint (which already does this for `gnupg`/`openssh-client`/`rsync`), or (b) run it via `docker compose exec` from the build stage.
- Never remove `app.set("trust proxy", "loopback, linklocal, uniquelocal")` from `app.ts`. Without it, `req.ip` resolves to the upstream proxy container IP — all rate-limit and audit entries collapse to one identity.
- **Never wrap a service in `runtime.cache.getOrSet()` if it calls `logRead` / `logAudit` or returns PHI.** Cache hits skip the audit log (HIPAA gap) and Redis would persist decrypted PHI in cleartext. Currently safe paths: clinic-aggregate dashboard counts only (`getDashboardSummary`, `getDepartmentLoad`, `getRecentActivity`). Move audit calls *above* the cache wrapper if you must cache the data fan-out below them.

---

## Bayan Design System ✅ Complete (2026-05-27)

Tokens live in `artifacts/clinic/src/index.css`. Class palette:

- **Layout:** `.page` (page root, padding + max-width), `.card` (surface + border + radius), `.card-pad` (default card padding), `.card-pad-lg`
- **Buttons:** `.btn` (base), `.btn-primary` (teal-600), `.btn-outline` (transparent + line border), `.btn-ghost` (transparent + transparent border, hover bg), `.btn-danger` (rose-500), `.btn-sm` (h:28 px:10 text:12), `.btn-lg`, `.btn-icon`. Pending state: add `data-pending="true"` for a centered spinner.
- **Badges:** `.badge` (base), `.badge-teal`, `.badge-sage`, `.badge-sand`, `.badge-rose`, `.badge-blue`, `.badge-amber`
- **Nav items:** `.nav-item` + `.is-active` for sidebar entries
- **CSS vars (use these — never `text-foreground` etc.):** `--ink`, `--ink-soft`, `--ink-muted`, `--ink-faint`, `--bg`, `--surface`, `--surface-2`, `--line`, `--teal-50…800`, `--sage-*`, `--sand-*`, `--rose-*`, `--amber-*`, `--blue-*`
- **Voice/density/palette:** `<html data-palette="mint|sage|plum|indigo" data-voice="editorial|modern|classical" data-density="compact|comfortable|spacious">`. Switch via the gear icon in the sidebar footer (Tweaks panel) — persists to `localStorage.clinic.*`.
- **Focus rings:** Global `:focus-visible` rule in `index.css` covers `a`, `button`, `input`, `select`, `textarea`, `[role=button|tab|menuitem]`, `[tabindex]`. Do not duplicate via Tailwind `focus-visible:*` classes.

`PageHeader`, `Button`, `Badge` shadcn primitives are NOT used in application code anymore. Dialog, Input, Label, Select, Tabs, Switch, Textarea, Tooltip from `components/ui/*` are still used.

---

## Schedule System ✅ Implemented

Tables: `doctor_schedules` (weekly recurring slots) + `schedule_overrides` (date-specific day-off or custom hours).

- Backend: full CRUD in `artifacts/api-server/src/routes/schedule.ts` + `services/schedule.service.ts`
- Frontend: `artifacts/clinic/src/pages/Schedule.tsx` — interactive weekly template + 7-day calendar + overrides table
- RBAC: `front_desk` + `admin` can create/edit. Doctors can VIEW their own schedule only.
- **RLS (migrations 0022 → 0025; F-P1-1/F-P1-2):** `doctor_schedules` and `schedule_overrides` carry `FORCE ROW LEVEL SECURITY`. Migration 0022 shipped a **strict, non-dormant** `tenant_isolation` policy (`clinic_id = current_setting('app.clinic_id')::int`, no `app.rls_enforce` gate, no `nullif` guard) — which returned **zero rows** to any reader outside a tenant context and broke booking (F-P1-1). Migration **0025** realigned both tables to the **dormant** 0015 standard (gate + `nullif` + `WITH CHECK`), so bare-`db`/`dbUnsafe` reads work again and `runInTenantContext` enforces. `lib/schedule-validator.ts` still runs its reads inside `runInTenantContext` (`checkDoctorAvailability(actor, doctorId, scheduledDate, existingTx?)`) — correct regardless. **General rule:** all clinic-bearing tables use the dormant 0015 policy; a non-dormant RLS policy makes every `dbUnsafe` reader silently return zero rows, so don't write one.

---

**Operational state** (scorecard, changelog, roadmap, lessons learned, full folder tree) lives in [docs/](../docs/). This file is for *how to build here*.
