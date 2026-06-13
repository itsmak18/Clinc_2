# Roadmap

> As of 2026-06-05: **Production-audit campaign Phases 1–4 — all findings fixed (working tree, uncommitted).** Diff-aware re-audit; findings + resolutions in `docs/AUDIT_FINDINGS_2026-06-03_PHASE{1,2,3,4}.md`. New migrations **0024** (break-glass read-bypass GUC), **0025** (RLS policy consistency: dormant 0022 tables + `clinic_invoice_counters` RLS/CHECK), **0026** (`audit_logs` append-only). New env `AUDIT_VERIFY_WINDOW_DAYS` (default 7). Highlights: fixed a CRITICAL booking break (0022 FORCE-RLS × `dbUnsafe` reader, F-P1-1); made break-glass actually deliver clinical PHI (F-P2-1); completed right-to-erasure across all clinical tables (F-P3-1); activated audit-integrity verification that was recorded-but-never-run (F-P4-1/2). 479/479 unit tests, typecheck + lint clean; migrations validated on real PG16. **Still open / next:**
> - ⏳ **Run the integration-db suite once under Docker** (`pnpm --filter @workspace/api-server run test:integration-db`) to validate the new app-service-level tests (booking happy-path, erasure scrub, break-glass reads) — the DB layer is already PG16-validated, this exercises the service code.
> - ⏳ **Commit the batch** (0024–0026 + service/test changes) — currently all uncommitted in the working tree alongside pre-existing WIP.
> - ✅ **Phase 1 sweep / Phase 5 (backend logic & API surface) — COMPLETE (2026-06-07)**: exhaustive `dbUnsafe`/`clinicId` sweep (multiline-verified), 6 deep-read service traces, transaction/race review, error-envelope + authGate scope. Findings F-P5-1..5 fixed (incl. HIGH: prescription creation was broken by a `dose`/`dosage` contract drift) + eradicated the `clinic_id DEFAULT 1` footgun (migration **0027**). See `.claude/AUDIT_FINDINGS_2026-06-06_PHASE5.md`. 484 unit / 60 integration-db green.
> - 🟢 **Phase 6 (deployment, DevOps & observability) — audited; all findings fixed, runtime-verify pending (2026-06-07)**: First pass did CI-gate review, backup/restore portability fixes (ESM & Windows), an SSE alert, and a go-live checklist — but marked "complete" while the alert stack was **inert**. Second pass fixed it: `ServiceDown` (`up==0`) process-down alert (F-P6-6); Alertmanager SMTP delivery via `smtp_auth_password_file` (F-P6-5 — `${VAR}` is never expanded → no email was ever sent); blackbox `${BLACKBOX_TARGET}` hardcoded + `EdgeProbeDown` (F-P6-7); restore drill now re-provisions `medicore_app` + proves it can read a tenant table (F-P6-8 — was superuser-only); blocking `monitoring-config` CI job (`promtool check rules`). F-P6-9 FIXED — `scripts/load-test.js` rewritten as a real k6 booking+dashboard load test (runtime-verify with `k6 run`). **Runtime-verify at deploy:** live SMTP delivery (`amtool`), promtool, blackbox target, next quarterly restore drill. See [AUDIT_FINDINGS_2026-06-07_PHASE6.md](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/docs/AUDIT_FINDINGS_2026-06-07_PHASE6.md).
> - 🟢 **Phase 7 (frontend & client security) — re-audited; security sound, sign-off corrected, parity test written (2026-06-07)**: First pass claimed PASS on XSS/CSRF/RBAC with **inaccurate evidence**. Verified second pass: RBAC parity spot-checked on the sensitive routes — **no authz gap** (backend is the real gate; analytics is service-layer-gated). Corrected the false claims: "zero innerHTML" (`DischargeSheet.tsx:98`, safe via React escaping — F-P7-3), "only two GET-only manual fetches" (four; logout is a POST that correctly attaches CSRF — F-P7-4). **F-P7-2 FIXED:** wrote the real `route-access.contract.test.ts` (the file the first pass falsely cited) — asserts client roles ⊆ backend roles across all 24 routes; **43/43 frontend tests green**, CI-gated via `frontend-test`. F-P7-1 (Billing `createdById`) verified fixed. Follow-ups ✅ done: DischargeSheet-escaping + logout-CSRF regression tests (F-P7-3/4, 45/45 green) and a route-layer `requireRole` gate on `/analytics`. See [AUDIT_FINDINGS_2026-06-07_PHASE7.md](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/docs/AUDIT_FINDINGS_2026-06-07_PHASE7.md).
> - ✅ **Phase 8 (architecture, performance & scale) — re-verified accurate (2026-06-07)**: Independently re-checked the first-pass "all passed" against config (after 6/7 were rubber-stamped). **Phase 8's claims hold**: pool math (`pgbouncer.ini` pool_size=20/reserve=5/max_client_conn=200 ≪ Postgres 100), SSE caps (`notifications.ts:29-31` → 503), non-PHI caching incl. the real `doctor_scope:<id>` Redis cache (`scope.ts:29-47`), N+1 batching, bundle splitting. Two minor opens: **F-P8-1** (CLAUDE.md:437 Doctor Scope Rule stale — says "no cache" but it's Redis-cached 60s; needs a manual CLAUDE.md edit, agent was permission-blocked) and **F-P8-1** (CLAUDE.md:437 Doctor Scope Rule stale — needs a manual edit). §8.5 load test now delivered (`load-test.js` rewritten as a real k6 booking+dashboard test, F-P6-9). See [AUDIT_FINDINGS_2026-06-07_PHASE8.md](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/docs/AUDIT_FINDINGS_2026-06-07_PHASE8.md).
> - ⏳ **Replit-removal cleanup** (audit §6) — incl. `REPLIT_DOMAINS` still read in `policy.ts` `ALLOWED_ORIGINS_SET`.
> - ⏳ **Op follow-up** — re-run the 0026 REVOKE when new `audit_logs` partitions are created (0020 default-privs re-grant them).

> As of 2026-06-02: **Compliance UIs + change-history shipped** — the three fully-built-but-headless backends (patient Consent, Break-Glass, Right-to-Erasure) now have frontends, and audit before/after change-history ("who did what, when, previous→new data") is surfaced. New OpenAPI paths + codegen for all three; new components `PatientConsentCard`, `BreakGlassButton`, `BreakGlassQueue`, `ErasurePanel`, `ChangeHistory`; `auditSnapshot()` capture backfill across 5 PHI entities (PHI-encrypted fields redacted — no second cleartext store). Break-glass approval and erasure review/execute are now operator-reachable (execute = super_admin, typed confirm). api-server 469/469, clinic 40/40, build clean. See CHANGELOG.

> As of 2026-06-02: **Phase 3 ops hardening complete** — PgBouncer connection pooling, `audit_logs` monthly partitioning (migration 0021, ADR-009), and enhanced restore drill (audit integrity check + RUNBOOK §12) all shipped. Scalability score 8.0→8.5. Operational Resilience 7.5→8.0.
>
> As of 2026-06-02: **F-03 MEDIUM closed** — frontend test harness live (25 tests: route-access matrix, i18n key parity, Guard render smoke). `frontend-test` CI job now blocking.
>
> As of 2026-06-02: **F-01 HIGH security gap closed** — `medicore_app` role (NOSUPERUSER NOBYPASSRLS) created; api/worker connect as it; RLS now enforces in production; ESLint guard added; break-glass wrapped; integration tests prove non-superuser. See CHANGELOG for full detail.
>
> As of 2026-05-31: backend remediation phases 0, 1, 3, 4, 5 and Phase 6 RLS complete; **Phase 2 Architecture Corrections complete** — 100% service-by-service transaction RLS rollout complete; compound indexes generated in migration `0018_performance_indexes.sql` and physically applied; batch audit outbox draining implemented reducing round-trips from 200/cycle to 2; background worker extracted and fully containerized with matching production-hardened profiles. All 461/461 tests passing. **Phase 2 OpenAPI sync complete** — all 8 routes in spec, codegen re-run, 24-test suite added. **Phase 2 flag-ON test suite** — 11 tests: fingerprint binding, token atomicity, role-branch, HIBP; 408/408 tests passing. **Bayan Design Port complete:** 2026-05-27. **Security hardening bundle (2026-05-27).** **M3 — EdDSA + JWKS (2026-05-28).** **M8 — Drop `invoices.items` JSONB (2026-05-28).** **P1-1 — Audit transactional outbox (2026-05-28).** **P1-9 — Erasure ↔ backup blackout (2026-05-28).** **P1-8 — SSE graceful drain (2026-05-28).** **P0-4 — clinic_id service-layer enforcement (2026-05-28): 398/398 tests passing.** **P2-3 — Additional Prometheus alerts (2026-05-29): 11 rules, 417/417 tests passing.** **Flow 2 — Materialized `doctor_patients` scope table (2026-05-29): O(1) scope lookup, 419/419 tests passing.** **P2-4 — OpenTelemetry distributed tracing (2026-05-29): `lib/tracer.ts`, HTTP spans, `withSpan()` helper, 428/428 tests passing.** **Audit-log hash chain (2026-05-29): nightly SHA-256 chain, `AuditIntegrityMismatch` alert, migration `0010_audit_integrity_chain.sql`, 441/441 tests passing.** **P2-2 — `style-src 'unsafe-inline'` removed (2026-05-29): chart.tsx `<style>` injector replaced with DOM-API inline styles; CSP regression guard added; 442/442 tests passing.** **P2-6 — `medical_records.isGlobal` modeling smell resolved (2026-05-29): `clinic_notices` table extracted; isGlobal/globalReason dropped from medical_records; `assertMedicalRecordInScope` simplified; 449/449 tests passing.** **P3-1 — `cookie-signature` dedup (2026-05-29): pnpm.overrides forces ^1.2.2.** **P3-2 — Service worker (2026-05-29): PHI-safe caching; nginx no-store on sw.js; 449/449 tests passing.** **REDIS_PASSWORD file-mounted (2026-05-29): all secrets out of `docker inspect`.** **UUIDv7 PK infra (2026-05-29): `uuidV7()` generator, `clinic_notices` migrated, codegen post-step fixed; 454/454 tests passing.**

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

## ✅ Phase 4 — Operational Hardening (complete 2026-05-31)

Closes the four operational gaps that left the platform blind in production: alert-rules-without-scraper, no automated backups, no documented rollback, no Redis liveness check. All 461/461 tests pass post-landing.

- ✅ **Prometheus + Alertmanager + Grafana live** — three new containers in `docker-compose.prod.yml`. Prometheus scrapes `api:5000` + `worker:5001` `/metrics` with Bearer-auth via the existing `metrics_token` secret; 30d/5GB TSDB retention; loads rules from `prometheus-alerts.yml`. Alertmanager sends **email** (SMTP env-interpolated); separate `critical` route with `repeat_interval: 1h`. Grafana **SSH-tunnel-only** — `127.0.0.1:3000` on the host, not exposed via Caddy; 13-panel `MediCore Overview` dashboard provisioned. New secret `grafana_password`. Footprint ≈ +1.3 GB RAM.
- ✅ **Automated DB backups** — new `backup` service runs `scripts/backup-verify.mjs` at 02:00 UTC daily inside an idempotent in-container loop (last-run-day guard). Retention 30d. Offsite: **rsync over SSH** to owner-controlled external server (`BACKUP_RSYNC_TARGET`); new `backup_ssh_key` secret; `StrictHostKeyChecking=accept-new`. `monitoring/backup-metrics.sh` writes `backup_last_success_timestamp_seconds` for the new `BackupStale` (>26h) and `BackupMissingTextfile` (>6h absent) alerts.
- ✅ **Rollback procedure** — `api` and `worker` services switched to `image: ${API_IMAGE:-medicore-api:latest}` with `build:` fallback. CI's `build` job gained `Emit deploy tag` step on main — short SHA written to the GitHub Actions step summary as a copy-pasteable `API_IMAGE=registry/medicore-api:<sha>`. RUNBOOK §10 documents env-snapshot → flip → `up -d --no-build` and the migration-direction check (Drizzle has no down migrations).
- ✅ **Redis health check** — `checkReadiness()` performs a Redis SET+GET roundtrip via `runtime.scopeCache`; reports `checks.redis = { status, latencyMs, store }`. Memory-mode dev reports `{ store: "memory", status: "ok" }`. Redis outage flips `ok=false` → 503 → Docker healthcheck restarts the api container.
- ✅ **RUNBOOK expansion** — §10 Deployment & Rollback (env-snapshot, migration-direction check, blue-green deferred to D2). §11 Monitoring & Alerting (SSH-tunnel Grafana access, Prometheus `wget`-via-`docker exec` ad-hoc queries, `amtool` silence recipes, per-alert playbook table, emergency manual backup recipe).

### Deferred (documented triggers)
- **node_exporter** — host-level filesystem + textfile collector for `BackupStale` to actually fire. Trigger: first node-level outage, or when `backup_last_success_timestamp_seconds` proves valuable enough to wire up.
- **PagerDuty/Slack** — email is sufficient for the current 2-person ops rotation. Trigger: rotation grows beyond email-only, or out-of-hours coverage needs.
- **Caddy-fronted Grafana** — explicitly rejected. Admin-only tool stays off the internet-facing surface.

### Required-before-boot
- `.env`: `API_IMAGE`, `SMTP_SMARTHOST`, `SMTP_FROM`, `SMTP_AUTH_USER`, `SMTP_AUTH_PASS`, `ALERT_EMAIL_TO`, `BACKUP_GPG_RECIPIENT`, `BACKUP_RSYNC_TARGET` (compose rejects missing `:?` vars).
- Secrets: `./secrets/grafana_password`, `./secrets/backup_ssh_key`; `backup_ssh_key.pub` added to offsite host's `authorized_keys`.
- GPG public key for `BACKUP_GPG_RECIPIENT` imported on the host.

---

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

## ✅ Phase 6 — Strategic Features (complete 2026-05-31)

- ✅ **Multi-language clinical content** — `locale` + `timezone` columns on `clinics`; Arabic text columns on all five clinical content tables (medical_records, prescriptions, lab_tests, xray_records, ultrasound_records) + services_catalog. All services accept/return Arabic fields. Frontend forms have collapsible Arabic section (ع toggle). Print templates render bilingual when Arabic is populated. 34 new i18n keys.
- ✅ **Doctor performance analytics** — Per-doctor KPI dashboard: patient volume, no-show rate, avg consult time, revenue, order rate, cancellation rate; clinic-wide peer benchmarking (clinic average alongside each doctor's values); 6-month monthly trend (LineChart); admin leaderboard. New `DoctorAnalytics.tsx` page. Route `/analytics` accessible to doctor/admin/super_admin.
- ❌ **Appointment reminders** — Excluded: no patient-facing communication channel.
- ❌ **Insurance claims** — Excluded: no insurance system in market.
- ❌ **Telemedicine** — Excluded: no video calls inside the app.
- ❌ **Patient portal** — Excluded since Phase 1.

## Phase 6 — Scalability & Multi-Tenancy

- ✅ **Cursor pagination** — All 7 list endpoints (`patients`, `appointments`, `lab`, `xray`, `ultrasound`, `prescriptions`, `medical-records`). `?cursor=<id>` replaces `?offset`. Hard max 100. Response: `{ data, nextCursor }`. `ORDER BY id DESC`.
- ✅ **Redis doctor-scope cache** — `getDoctorPatientScope` caches `doctor_scope:<id>` at 60s TTL. `invalidateDoctorScope` on appointment create/cancel. Wired in `runtime.scopeCache`.
- ✅ **Frontend pagination update** — All 12 call sites (11 pages + `CommandPalette.tsx`) migrated to cursor. Latent runtime bug in `Appointments.tsx` + `DoctorDashboard.tsx` fixed (unwrap `.data` from `PaginatedAppointments`). OpenAPI spec is the single source of truth; generated clients regenerated.
- ✅ **`clinic_id` service-layer enforcement (2026-05-28)** — `clinicId` column added to `usersTable`, `operationsTable`, `inventoryTable`. JWT now carries `clinicId` claim. All 10 PHI service files filter by `AND clinic_id = req.user!.clinicId`. Migration `0008_acoustic_cassandra_nova.sql`. **Postgres Row-Level Security (RLS) rollout complete (2026-05-31)** — all remaining 17 service query files fully wrapped in `runInTenantContext()` transactions, closing the database-level isolation gap. Per-tenant DEK (per-clinic kid) remains open for full multi-tenant SaaS launch.
- ✅ **UUID v7 PKs (new tables)** — `uuidV7()` generator in `lib/db/src/uuid-v7.ts`. `clinic_notices` migrated (migration `0012_clinic_notices_uuid_pk.sql`). Pattern: `uuid("id").$defaultFn(uuidV7).primaryKey()`. Legacy serial tables migrate on a documented schedule.
- ✅ **Phase 3 scalability — DB pool + cache + SSE caps (2026-05-31)** —
  - DB pool defaults bumped (max 40, min 2 warm, `statement_timeout=30s`, `allowExitOnIdle`).
  - `CacheService` on `Runtime` (Redis SETEX/SCAN/UNLINK + in-memory fallback); 15–30 s TTL on `getDashboardSummary` / `getDepartmentLoad` / `getRecentActivity`. PHI- and audit-emitting paths (`getPatientSummary`, `billing.getDailySummary`) intentionally left uncached for HIPAA semantics.
  - SSE caps: 500 per process + 10 per user with oldest-evicts; `sse_active_connections` gauge.
  - ✅ **PgBouncer (2026-06-02)** — Transaction-pooling pgbouncer service in `docker-compose.prod.yml`; api/worker DATABASE_URL routed through pgbouncer:6432; `statement_timeout` + `idle_in_transaction_session_timeout` moved to `ALTER ROLE medicore_app SET ...` (migration 0021) for pooling-safe enforcement; GUC scoping verified safe under transaction mode; pool math in RUNBOOK §11.6; `PGBOUNCER_DEFAULT_POOL_SIZE`/`PGBOUNCER_MAX_CLIENT_CONN` tunable via env. Unblocks a 2nd API replica with only a config change.
  - ✅ **audit_logs monthly partitioning (2026-06-02)** — Migration 0021 converts `audit_logs` to RANGE PARTITION BY month (2026-01→2036-12, 132 partitions + DEFAULT). Composite PK (id, created_at). RLS re-applied, medicore_app grants re-applied, row-count verified, legacy table dropped. `audit_partition_months_remaining` Prometheus gauge + `AuditPartitionLow` alert (< 24 months). ADR-009-audit-partitioning.md. F-01 non-superuser boundary maintained (no runtime DDL by medicore_app).
  - ✅ **Restore drill enhanced (2026-06-02)** — `backup-verify.mjs --restore` now includes audit integrity check (queries `audit_integrity_checks` for mismatches after restore). Quarterly drill procedure documented in RUNBOOK §12 with measured RTO tracking.
  - Deferred: **SSE → Redis Streams** (trigger: patient portal pushing connections to thousands — current Pub/Sub fan-out already multi-replica correct).
- **Read replicas** — Separate analytics DB for reports; prevent report queries from degrading clinical workflows.

## Quality & Testing Track — Planned (decisions locked 2026-05-31)

Closes frontend regression-blindness and standardizes backend route validation. **Not started.** Five work streams, executed in order WS3 → WS5 → WS1 → WS2 → WS4 so each stream lands on top of stable contracts.

**Locked decisions:**
- **E2E strategy → MSW-mocked, no CI.** No GitHub Actions exists; Docker-based E2E adds complexity with no automation payoff. Playwright runs locally against the Vite dev server with MSW intercepting fetches. Fixed fixtures (`e2e/mocks/fixtures.ts`), not per-test factories. Billing "anti-fraud same-user pay gate" moves to a backend integration test — it's a server invariant, not a UI behavior.
- **i18n → ICU MessageFormat.** Arabic has 6 plural categories; plain JSON key-value can't express them cleanly. Use `@formatjs/intl`. Proactive `t()` callsite sweep at migration time (not lazy) so the placeholder→`{var}` conversion lands in one pass.
- **Accessibility → critical/serious axe violations only.** Internal-staff app, ~10 known roles, no patient-facing surface. Full WCAG 2.1 AA is deferred until a patient portal becomes real. Filter by `v.impact === "critical" || "serious"`; do not constrain by `wcag2a/wcag2aa` tags.

**Work streams:**
- **WS3 — Zod route validation (first).** New `api-server/src/middlewares/validate.ts`; migrates 12 route files from raw `req.body` to `schema.safeParse`. **Breaking error-shape change** — `{ error: "Missing required fields" }` → `{ error: "Validation error", details: { field: [...] } }`. Frontend toast handler updated in the same pass to surface `details`.
- **WS5 — i18n extraction + ICU.** Replaces 53KB eager-loaded inline translations in `clinic/src/hooks/i18n.tsx` with lazy-imported `locales/en.json` + `locales/ar.json`. Active locale only (~26KB) loaded per session. All `t()` callsites converted to ICU `{var}` syntax.
- **WS1 — Vitest unit tests.** 7 spec files targeting highest-risk zero-coverage code: `route-access`, `auth` hook, `DataTable`, `useSessionTimeout`, `use-notifications-stream`, `StatusBadge`. Adds `vitest`, `@testing-library/react`, `jsdom`, `msw` to clinic devDeps.
- **WS2 — Playwright + MSW E2E.** 4 spec files (login, patients, appointments, rbac). `playwright.config.ts` points at `http://localhost:5173` — no `webServer: docker compose`. No CI job.
- **WS4 — Accessibility audit.** `e2e/accessibility.spec.ts` using `@axe-core/playwright` against the same MSW-mocked frontend. Critical/serious filter only.

## Phase 7 — Product (post-launch)

- **Patient portal** — Self-booking, results viewing, secure messaging, separate auth domain.
- **WhatsApp/SMS reminders** — Twilio or local provider; no-show prevention.
- **Payment gateway** — Stripe / PayTabs integration.
- **Waiting-room Kanban** — Visual pipeline across the 10-state appointment workflow.
- **FIDO2/WebAuthn** — Phish-proof login for admin/doctor roles (after MFA is stable).
