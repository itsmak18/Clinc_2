# Detailed Folder Structure

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
│   │       │   ├── auth-constants.ts ← ROLE_TTL (jose strings) + COOKIE_TTL_MS (ms) + MAX_ROLE_TTL_SEC — single source; drift between JWT expiry and cookie maxAge impossible
│   │       │   ├── jwt-secret.ts     ← JWT_SECRET (TextEncoder of SESSION_SECRET); production guard; imported by auth.ts + policy.ts — never redeclare inline
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
│   │       └── tests/                ← Vitest unit + Supertest integration (count: see CI badge)
│   │           ├── appointment-state-machine.test.ts
│   │           ├── audit.failure.test.ts
│   │           ├── auth-flow.integration.test.ts  ← supertest: login exempt, logout CSRF, cookie clear, revocation
│   │           ├── csp.test.ts       ← 11 assertions guarding cspDirectives (script-src regression guard)
│   │           ├── customFetch.csrf.test.ts
│   │           ├── envelope.integration.test.ts
│   │           ├── health.test.ts
│   │           ├── jsonb-schemas.test.ts
│   │           ├── mfa-orphans.test.ts
│   │           ├── password.test.ts
│   │           ├── policy.unit.test.ts ← 25 tests covering every evaluate() branch (CSRF, token, revocation, jti, fingerprint, role)
│   │           ├── rateLimiter.test.ts
│   │           ├── routes.envelope.integration.test.ts
│   │           ├── scope.test.ts
│   │           └── validators.test.ts
│   └── clinic/
│       └── src/
│           ├── App.tsx               ← register ALL new routes here; 401 interceptor wires logout; root ErrorBoundary; all pages React.lazy() + Suspense (route-level code splitting)
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
│           ├── lib/
│           │   ├── api.ts                    ← customFetch mutator (attaches X-CSRF-Token, credentials: include)
│           │   ├── i18n.tsx                  ← (legacy stub — real i18n lives in hooks/i18n.tsx)
│           │   ├── print.ts                  ← print report utilities
│           │   ├── route-access.ts           ← canAccessRoute(href, role), getLandingRoute, navItems, navPinnedByRole — update when adding pages
│           │   └── utils.ts
│           └── test/                         ← Vitest + jsdom frontend test suite (added 2026-06-02, F-03)
│               ├── setup.ts                  ← imports @testing-library/jest-dom; clears localStorage before each test
│               ├── route-access.test.ts      ← 19 tests: super_admin bypass, 10-role access matrix, dashboard alias, prefix match, getLandingRoute, navPinnedByRole
│               ├── i18n.test.ts              ← 2 tests: EN↔AR key set-equality (bilingual parity guard)
│               └── Guard.test.tsx            ← 4 tests: denied/allowed render smoke, bilingual AccessDenied, super_admin bypass
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
