# Roadmap

> As of 2026-05-29: backend remediation phases 0, 1, 3, 4, 5 complete; Phase 2 (Auth) code-landed flag-OFF; **Phase 2 OpenAPI sync complete** — all 8 routes in spec, codegen re-run, 24-test suite added. **Phase 2 flag-ON test suite** — 11 tests: fingerprint binding, token atomicity, role-branch, HIBP; 408/408 tests passing. **Bayan Design Port complete:** 2026-05-27. **Security hardening bundle (2026-05-27).** **M3 — EdDSA + JWKS (2026-05-28).** **M8 — Drop `invoices.items` JSONB (2026-05-28).** **P1-1 — Audit transactional outbox (2026-05-28).** **P1-9 — Erasure ↔ backup blackout (2026-05-28).** **P1-8 — SSE graceful drain (2026-05-28).** **P0-4 — clinic_id service-layer enforcement (2026-05-28): 398/398 tests passing.** **P2-3 — Additional Prometheus alerts (2026-05-29): 11 rules, 417/417 tests passing.** **Flow 2 — Materialized `doctor_patients` scope table (2026-05-29): O(1) scope lookup, 419/419 tests passing.** **P2-4 — OpenTelemetry distributed tracing (2026-05-29): `lib/tracer.ts`, HTTP spans, `withSpan()` helper, 428/428 tests passing.** **Audit-log hash chain (2026-05-29): nightly SHA-256 chain, `AuditIntegrityMismatch` alert, migration `0010_audit_integrity_chain.sql`, 441/441 tests passing.** **P2-2 — `style-src 'unsafe-inline'` removed (2026-05-29): chart.tsx `<style>` injector replaced with DOM-API inline styles; CSP regression guard added; 442/442 tests passing.** **P2-6 — `medical_records.isGlobal` modeling smell resolved (2026-05-29): `clinic_notices` table extracted; isGlobal/globalReason dropped from medical_records; `assertMedicalRecordInScope` simplified; 449/449 tests passing.** **P3-1 — `cookie-signature` dedup (2026-05-29): pnpm.overrides forces ^1.2.2.** **P3-2 — Service worker (2026-05-29): PHI-safe caching; nginx no-store on sw.js; 449/449 tests passing.**

## Bayan Design Port (complete 2026-05-27)

Full frontend visual overhaul — ports the Bayan Clinic OS hi-fi design into MediCore. Data layer unchanged (real API).

- ✅ **Phase 0 — Token foundation** — `index.css` fully replaced with Bayan mint/sage editorial system; `@theme inline` Tailwind 4 integration; palette/voice/density/RTL/dark mode variants.
- ✅ **Phase 1 — Shared primitives** — `Metric`, `Sparkline`, `MiniBars`, `SearchPicker`, `VitalChip`, `PatientHeaderStrip`, `LiveActivityFeed`, extended `StatusBadge` (shape-coded), 3 skeleton variants, 5 new hooks.
- ✅ **Phase 2 — App shell** — `Layout.tsx` (248px sidebar + 64px topbar), `CommandPalette.tsx` (⌘K), `TweaksPanel.tsx` (palette/voice/density), `Login.tsx` (split-screen + dev chips).
- ✅ **Phase 3 — RTL audit** — 15 pages/components updated to logical properties; 15 new i18n keys (EN + AR).
- ✅ **Phase 4 — Page rewrites + net-new pages** — All 28 existing pages reskinned to Bayan classes (zero legacy theme tokens left). 5 net-new pages: `DoctorConsult.tsx` (tabbed EHR with deep-link + dirty-state guard), `DoctorOrders.tsx`, `DoctorInbox.tsx`, `NurseVitals.tsx`, `FrontDeskCheckin.tsx`. 6 new routes wired with per-route `RouteErrorReset` boundary.
- ✅ **Phase 5 — A11y + i18n** — Global `:focus-visible` ring rule. ARIA on all new pages (`role="status"` on loading/empty, `aria-label` on icon-only). 60+ new i18n keys (EN + AR). Typecheck clean.

**Deferred:** Self-hosted fonts (currently Google Fonts CDN with `display=swap`) — tracked for offline clinic networks.

---

## Phase 2 — Auth & Security Hardening (code landed flag-OFF 2026-05-25; activation pending)

MFA replaced with **device-trust + email verification on new devices** as the compensating control. All code ships behind `PHASE2_DEVICE_TRUST_ENABLED` (default false).

- ✅ **Device trust** — `user_devices` table, HMAC fingerprint, `__Host-device_id` cookie, role-branched new-device dispatch.
- ✅ **Email verification** — 15-min single-use fingerprint-bound tokens via `device_verification_tokens`; Resend integration (console fallback).
- ✅ **Step-up re-auth** — `requireStepUp(action)` middleware for destructive actions (`PHASE2_STEP_UP_ENABLED`).
- ✅ **Password policy hardening** — 12-char + special-char + HIBP k-anon + dictionary blocklist (`PHASE2_STRICT_PASSWORD_POLICY`).
- ✅ **Self-service + admin password reset** — `password_reset_tokens` + `POST /auth/forgot-password` + `POST /auth/reset-password` + `POST /auth/admin-reset/:userId`.
- ✅ **Role-aware session timeout** — `useSessionTimeout` now consumes `jwtExpUnix`.
- ✅ **CSP report-uri** — `csp_reports` table + `POST /api/csp-report` (`PHASE2_CSP_REPORT_ENABLED`).
- ✅ **OpenAPI sync + codegen** — 8 routes declared in spec, Orval re-run, generated clients updated. `ResetPasswordBody` renamed to `UserPasswordResetBody` (dedup). csp-report path bug fixed. Route registration order fixed (Phase 2 routers before global-requireAuth catch-all).
- ✅ **Test coverage for Phase 2 (flag-OFF)** — 24-test `phase2.integration.test.ts` suite: enumeration prevention, token validation, privilege gating, 503 flag-off, device management auth, UUID validation, CSP path.
- ⏳ **Drizzle migration generation** — run `pnpm --filter @workspace/db db:generate` then `db:migrate` for `0002_harsh_monster_badoon.sql` (staging then prod).
- ✅ **Test coverage for Phase 2 (flag-ON)** — 11-test `phase2.flagON.integration.test.ts`: token atomicity, fingerprint binding, role-branched flow (202 vs 200), HIBP rejection (global fetch mocked). 408/408 passing.
- ⏳ **Login rate limiter → Redis** — `RateStore` is already pluggable (`SESSION_STORE=redis`); no code change required, only env flip and Redis provisioning.
- ⏳ **Flag-flip rehearsal** — verify zero "new device" emails for 50 grandfathered users on staging, then prod ramp.
- 🔒 **Phase 2.11 cleanup (post-stabilization, ~30 days after enablement)** — delete `isPhase2Enabled()` short-circuits and the off-path branches so the controls are unconditional. Scaffolding stays up too long becomes a liability.

## ✅ Phase 3 — Data Integrity & Background Jobs (complete 2026-05-25)

- ✅ **Cron state machine** — No-show cron now calls `validateTransition("no_show", "scheduled", "system")` before bulk-updating; uses `check.toStatus` instead of hardcoded string. "system" actor bypass added to state machine alongside `super_admin`.
- ✅ **Remove VACUUM from app layer** — Cron block deleted; configure PostgreSQL autovacuum instead.
- ✅ **Patient recall** — Dead-code cron deleted (was a no-op logger with commented-out insert).
- ✅ **`invoices.items` normalization** — `services_catalog` + `invoice_items` tables created. `createInvoice` now writes to `invoice_items` after inserting the invoice. JSONB column retained for backward compat; scheduled for removal in Phase 4 after versioned migrations are in place.
- ✅ **Zod-enforce clinical JSONB** — Already wired in Phase 1/prior: `medicationsSchema` in `prescriptions.service.ts`, `vitalsSchema` in `medical-records.service.ts`, `itemsSchema` in `billing.service.ts`.
- ✅ **Audit `before_state` / `after_state`** — Dedicated `before_state` / `after_state` JSONB columns added to `audit_logs`. `logAudit` accepts them as separate params. `UPDATE` paths in `appointments.service.ts` and `medical-records.service.ts` now pass before/after separately instead of embedding in `details`.

## ✅ Phase 4 — Infrastructure (complete 2026-05-25)

- ✅ **Dockerfile + docker-compose** — Multi-stage api-server build (esbuild → Node 24 Alpine, only bcrypt native addon at runtime). `Dockerfile.clinic` builds React SPA (Vite) and serves via nginx. `docker-compose.yml` orchestrates postgres:16, redis:7, api, clinic, and a one-shot `migrate` init container.
- ✅ **Versioned Drizzle migrations** — `drizzle-kit generate` + `drizzle-kit migrate` replace `drizzle-kit push` for staging/prod. Initial migration `0000_rare_silver_fox.sql` captures full schema (18 tables). CI `migration-drift` job blocks merges where schema changes have no migration file.
- ✅ **`ALLOWED_ORIGINS` CORS support** — `app.ts` reads `ALLOWED_ORIGINS` env var alongside `REPLIT_DOMAINS`, decoupling CORS from Replit-specific infrastructure.
- ✅ **nginx.conf** — SPA fallback, `/api` proxy with SSE buffering disabled, `/metrics` blocked at edge, 1-year cache on hashed assets.
- ✅ **.env.prod.example** — production secret template with BAA and secrets-manager guidance.
- **Migrate off Replit** — Remaining: AWS/GCP/Azure host selection, BAA signing, DNS cutover. Infrastructure code is ready; cloud provisioning is ops work.

## ✅ Phase 5 — Compliance / HIPAA / GDPR (complete 2026-05-25)

- ✅ **Patient consent framework** — `patient_consents` table (treatment, data_sharing, research, marketing). `treatment` consent required before `createMedicalRecord` or `createPrescription` — enforced at service layer. Grant/revoke/list routes with per-role RBAC.
- ✅ **Field-level encryption** — AES-256-GCM via `lib/field-encryption.ts`. Encrypts `diagnosis`, `vitals` (medical_records), `medications` (prescriptions), `allergies`, `emergencyContact` (patients). Envelope format `enc:v1:<iv>:<tag>:<data>`. `FIELD_ENCRYPTION_KEY` required in prod; dev bypass with warning. Backward-compatible (unencrypted legacy values pass through).
- ✅ **Right-to-erasure** — Three-step: request (compliance_officer) → approve (compliance_officer) → execute (super_admin). Execution runs in a DB transaction anonymizing patient demographics, medical records, and soft-deleting prescriptions. Irreversible (ADR-005 — hard deletion prohibited; audit linkage retained).
- ✅ **Break-glass access** — Any authenticated user can activate a 15-min emergency session for a patient. Immediate SSE alert to all `compliance_officer` users. Every PHI access during session logged with `BREAK_GLASS_ACCESS` audit action. Owner or compliance_officer can revoke early.
- ✅ **Data retention cron** — Monthly (1st @ 03:00). Reports overdue audit logs (>7yr), open erasure requests. Alerts compliance_officers via SSE if action needed.
- **Formal HIPAA gap analysis** — Required for US deployment. Still open — ops/legal work.

## ✅ Security Hardening Bundle (complete 2026-05-27)

- ✅ **Express trust proxy** — `app.set("trust proxy", "loopback, linklocal, uniquelocal")` in `app.ts`. Rate-limit keys, login-shield buckets, and audit IP fields now resolve to the real client IP behind Caddy. Regression tests in `trust-proxy.test.ts`.
- ✅ **Audit logs compound index** — `(entity_type, entity_id, created_at)` index on `audit_logs`. Migration `0004_sudden_spectrum.sql`.
- ✅ **Cursor pagination fully wired end-to-end** — All 12 frontend call sites migrated; `Appointments.tsx` + `DoctorDashboard.tsx` latent runtime bug fixed. OpenAPI spec aligned to backend. CI guard prevents regression.
- ✅ **Secrets file-mounted in prod** — `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `METRICS_TOKEN` removed from `environment:` block; read from `/run/secrets/*` by the entrypoint. `docker inspect` reveals nothing PHI-decryption-capable.
- ✅ **Route-access contract test** — 67 tests pin frontend navItems roles ↔ backend RBAC. Fixed active production bug: `pharmacist` was missing from `GET /prescriptions`.
- ✅ **CI security tooling** — CodeQL SAST, Trivy fs scan (HIGH/CRITICAL, `ignore-unfixed`, SARIF), and CycloneDX SBOM (Anchore Syft) added as GitHub Actions workflows.
- ✅ **Field-encryption KID envelope** — `enc:v2:<kid>:<iv>:<tag>:<data>` replaces `enc:v1:`. Key registry supports two concurrent keys during rotation. Rotation now operational — documented six-step procedure in `SECURITY.md`.

## Phase 6 — Scalability & Multi-Tenancy

- ✅ **Cursor pagination** — All 7 list endpoints (`patients`, `appointments`, `lab`, `xray`, `ultrasound`, `prescriptions`, `medical-records`). `?cursor=<id>` replaces `?offset`. Hard max 100. Response: `{ data, nextCursor }`. `ORDER BY id DESC`.
- ✅ **Redis doctor-scope cache** — `getDoctorPatientScope` caches `doctor_scope:<id>` at 60s TTL. `invalidateDoctorScope` on appointment create/cancel. Wired in `runtime.scopeCache`.
- ✅ **Frontend pagination update** — All 12 call sites (11 pages + `CommandPalette.tsx`) migrated to cursor. Latent runtime bug in `Appointments.tsx` + `DoctorDashboard.tsx` fixed (unwrap `.data` from `PaginatedAppointments`). OpenAPI spec is the single source of truth; generated clients regenerated.
- ✅ **`clinic_id` service-layer enforcement (2026-05-28)** — `clinicId` column added to `usersTable`, `operationsTable`, `inventoryTable`. JWT now carries `clinicId` claim. All 10 PHI service files filter by `AND clinic_id = req.user!.clinicId`. Migration `0008_acoustic_cassandra_nova.sql`. **Remaining gap:** Postgres row-level security policies and per-tenant field-encryption DEK (per-clinic kid) — open for full multi-tenant SaaS launch.
- **UUID v7 PKs** — Deferred. Prevent enumeration attacks; enable horizontal sharding.
- **Read replicas** — Separate analytics DB for reports; prevent report queries from degrading clinical workflows.

## Phase 7 — Product (post-launch)

- **Patient portal** — Self-booking, results viewing, secure messaging, separate auth domain.
- **WhatsApp/SMS reminders** — Twilio or local provider; no-show prevention.
- **Payment gateway** — Stripe / PayTabs integration.
- **Waiting-room Kanban** — Visual pipeline across the 10-state appointment workflow.
- **FIDO2/WebAuthn** — Phish-proof login for admin/doctor roles (after MFA is stable).
