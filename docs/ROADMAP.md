# Roadmap

> As of 2026-07-05: **Financial clearance gate Phase A landed flag-OFF (ADR-011).** Follow-up phases
> from the 2026-07-04 workflow audit, in priority order:
> - ⏳ **Flip-on prerequisites:** price `LAB_DEFAULT`/`XRAY_DEFAULT`/`US_DEFAULT` per clinic (zero-price
>   warn-log is the tripwire), staging rehearsal (order → basket → front-desk pay → queue → complete;
>   override loop; TTL-0 expiry), then `CLEARANCE_GATE_ENABLED=true` in prod.
> - 💡 **Phase B — consult prepay + episodes:** `checkin` requires a paid consult line OR an
>   auto-detected free-follow-up window (`parentAppointmentId` episode link); checkout tail becomes
>   conditional on balance > 0.
> - 💡 **Phase C — pharmacy coupling:** dispense requires a paid line + atomic `inventory_transactions`
>   decrement; live stock at prescribing; substitution workflow.
> - 💡 **Phase D — fraud controls:** discount reason-codes + role caps + per-employee monthly report;
>   wire `requireStepUp` for void/refund; three-way ordered↔paid↔performed reconciliation (now
>   structurally possible via `invoice_item_id`); doctor self-cancel of own pending orders; retire or
>   confine the `markPaid` POS bypass.
> - 💡 **Phase E — payer model:** insurance authorization / deposits / wallet / credit accounts /
>   charity codes as additional clearance sources (`clearance_status` model already accommodates).

> As of 2026-07-02: **Independent architecture audit — Phase 1 quick wins done, Phases 2–4 tracked.**
> Full report: [ARCHITECTURE_AUDIT_2026-07-02.md](audits/ARCHITECTURE_AUDIT_2026-07-02.md) (§13b has one row
> per finding with a suggested fix). Phase 1 (F1 worker-healthcheck CI gap, F5 audit-fallback alerting)
> landed same day; F9 ("5 raw fetch in pages") was retracted as a grep false positive, not fixed.
> **Next (Phase 2, structural, 1–2 weeks):**
> - ⏳ **Barrel-honesty for cross-module service calls (F4)** — `autoAdvanceVisit`,
>   `hasActiveConsent`, `getActiveBreakGlassPatientIds` are consumed via deep `../other-module/x.service`
>   imports (10 call sites across billing/clinical/imaging), contradicting `CLAUDE.md`'s "barrel-only"
>   rule. Re-export them from the owning module's `index.ts`; repoint consumers; add an ESLint rule
>   banning deep `modules/*/*.service` imports so it can't regress.
> - ⏳ **`lib/scope.ts` layer placement (F6)** — doctor-scope authz logic lives in the utility tier
>   alongside `dateUtils`/`logger`. Move to a `modules/authz/` home or explicitly document it as kernel.
> - ⏳ **Split the 5 large view pages (F10)** — Schedule/Reports/PatientDetail/Inventory/Dashboard;
>   extract sub-sections into `components/` on next touch (Schedule already started).
> - ⏳ **Land the doctor-schedule WIP** (7 uncommitted files as of 2026-07-02) as a reviewable PR.
>
> **Deliberately deferred (own dedicated change, not bundled):**
> - 💡 **Flatten `Clinic-Hub/Clinic-Hub` → `Clinic-Hub` (F11)** — Med–High risk: rewrites every CI
>   path, Docker build context/`COPY`, `pnpm-workspace` glob, and the `backups`/`storage` symlinks.
>   Verify build+CI green before/after as its own PR, not mixed with lower-risk changes.
>
> **Also tracked, lower priority (see report §13b for full list):** F2 (roll-forward-only migrations,
> no automated cutover recovery), F3 (no load/query-plan validation), F7 (31 `as any` in modules;
> `strictFunctionTypes`/`noUnusedLocals` OFF), F8 (integration-db suite Docker-gated, doesn't always
> run in CI), F13 (fph disable-lever unguarded), F14 (consent gate is service-layer only, no DB
> backstop), F15 (jti replay defense dormant — deliberate per ADR-007, revisit only if re-scoping).

> As of 2026-06-29: **Architecture audit P1+P2 complete + WIP landed.** 182-file uncommitted WIP committed in 7 logical slices (all green: 538/538 backend, 51/51 frontend, typecheck+lint). Architecture maturity 8.5→9.0/10. Closed:
> - ✅ **P0 — WIP landing** — break-glass audit durability, prescription dispensing (migration 0039), CSP unification, DENY role contracts, dep CVE overrides, mockup-sandbox removal, docs prune.
> - ✅ **P1 — Typed config module** — `lib/config.ts` centralizes all ~50 env reads; ESLint `no-restricted-properties` guard flipped to `"error"` (all 32 files migrated). `process.env` direct reads are a CI-blocking lint error.
> - ✅ **P2a — Thin controller** — billing cancel reason moved to service; 0 business-logic leaks in routes.
> - ✅ **P2b — Generated hooks** — last 2 raw `fetch()` calls replaced (`DischargeSheet` → `useGetAppointmentDischarge`, `GlobalSearch` → `useGlobalSearch`; `/search` added to OpenAPI contract).
> - ✅ **P2c — i18n split** — `i18n.tsx` 2169-line monolith → `hooks/locales/en.ts` + `ar.ts`.
>
> **Still open / next:**
> - ⏳ **integration-db suite** — run `pnpm --filter @workspace/api-server run test:integration-db` end-to-end on real Postgres (Docker or `INTEGRATION_PG_ADMIN_URL`). New `break-glass-audit.integration-db.test.ts` not yet CI-gated.
> - ⏳ **P3 — Domain-event bus** (optional) — invert `autoAdvanceVisit` hub: 5 services import it; low blast-radius now, defer until coupling bites.
> - ⏳ **Task Completion Rule** — update Obsidian vault note.

> As of 2026-06-22: **Zero-trust audit hardening — codeable medium-and-above findings closed (working tree, uncommitted).** Source-first re-audit (overall ≈8.5→8.7). 29 new real-Postgres tests + targeted fixes; tsc 0, esbuild clean, no regressions. See CHANGELOG (2026-06-22) + HEALTH_STATUS note. **Closed:**
> - ✅ **F-Z1 / F-014 — jti replay defense formally DISARMED (not armed).** Arming would regress: the live `privileged` routes (`PATCH`/`DELETE /users/:id`, admin reset) use the reused session cookie, so consuming its jti rejects the 2nd admin action in a session. Pinned by a kernel invariant test (`policy.unit.test.ts` "READS but never CONSUMES the jti") + **ADR-007 §4 correction** (the "zero routes use privileged scope" claim was stale — three now do). Supersedes the "author ADR-014 to arm" recommendation.
> - ✅ **Imaging integration-db tests** — `imaging-attachments` (upload/scope/download/delete), `imaging-quota`, `imaging-orphan-reconcile` (+ `services-catalog`, `vitals-scope`, `login-mint`). Advances the ADR-012 test-breadth item (imaging done; break-glass-e2e still open).
> - ✅ **CSP report retention enforced** — daily purge cron + `CSP_REPORT_RETENTION_DAYS` (was "90-day retention recommended; not enforced").
> - ✅ **Orphaned imaging files reclaimed** — daily reconciler + `IMAGING_ORPHAN_GRACE_HOURS`, with an empty-live-set circuit breaker (defense vs a future non-dormant-RLS regression).
> - ✅ **Per-clinic imaging quota** — `IMAGING_CLINIC_QUOTA_BYTES` (opt-in, default off).
> - ✅ **JWT mints `timezone` + real `clinicId`** — closes the multi-clinic date-math fallback + resolved-user session-audit (LOGIN_SUCCESS/PENDING/LOGOUT) landing in clinic 1.
>
> **Still open / next:**
> - ⏳ **F-M4 streaming uploads (deferred, deliberate)** — quota done; replacing the 25 MB in-memory buffer with streaming AES-GCM is a PHI-envelope crypto refactor on a low-frequency endpoint with no evidence of memory pressure. Revisit on a Node-RSS / event-loop-lag alert correlated with imaging uploads.
> - ⏳ **Commit + CI-gate the working tree** — all of the above is uncommitted alongside the larger feature WIP; the full suite + `pnpm audit` + codegen-diff must run green in CI. This is the single lever from 8.7 → 9.
> - ⏳ **Doc-only:** `.claude/CLAUDE.md:239` jti row still says "jti consumed on first use" (misleading — harness-blocked agent edit; needs a manual one-line paste to match ADR-007).

> As of 2026-06-21: **X-Ray / Ultrasound imaging — real server upload/download + workflow rename shipped.** Files now upload to a server volume (`IMAGING_STORAGE_DIR`), AES-256-GCM encrypted at rest, served via an authenticated/doctor-scoped/audited download endpoint (`imaging_attachments` table + `imaging-attachments.service.ts`); status renamed `requested → in_progress → completed` (migration 0038 `RENAME VALUE`). Erasure now purges image files + the `images` jsonb. 500 api / 51 clinic tests green; E2E + encryption-at-rest smoke verified. See CHANGELOG. **Follow-ups:**
> - ⏳ **Offsite the imaging tar** — the backup container snapshots `imaging_data` into `/backups` daily, but `backup-verify.mjs`'s `OFFSITE_UPLOAD_COMMAND` rsync currently targets the DB dump only. Wire the imaging tarball into the offsite push (or document that `/backups` itself is rsynced) so a site-loss DR recovers studies, not just metadata.
> - ⏳ **Imaging integration-db test** — fold upload/download/erasure into the real-Postgres suite (overlaps the ADR-012 "imaging" item below).
> - 💡 **DICOM** — current pipeline is PNG/JPEG/WEBP (browser-renderable). A DICOM viewer + `.dcm` ingest is a separate future feature.

> As of 2026-06-14: **Independent principal zero-trust re-audit — 8.4/10, no open criticals.** Full report [AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md](audits/AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md); handoff + task-level plan `HANDOFF.md`. **Next actions:**
> - ⏳ **F-Z1 (Medium, security) — arm or formally disarm the jti replay defense** (`policy.ts:169` checks `isJtiUsed()` but prod never calls `markJtiUsed()` → unarmed). Recommend arming for break-glass activate / step-up / admin-reset / erasure execute; author **ADR-014**.
> - ⏳ **Phase 0 go-live drills:** stand up staging (+`STAGING_URL`), verify **live** alert/probe delivery (`amtool` + blackbox), restore drill on real hardware (record RTO).
> - ⏳ **Test breadth (ADR-012):** real-Postgres `*.integration-db` tests for billing SoD, appointments FSM, prescriptions/consent, imaging, break-glass e2e.
> - ⏳ **DR (ADR-011):** WAL archiving + warm standby to retire the RPO≈24h cliff.
> - ✅ **REPLIT_DOMAINS code removal is COMPLETE** (F-Z5) — `policy.ts:70-79` reads only `ALLOWED_ORIGINS`; the "still read in policy.ts" line below is **stale**. Remaining REPLIT work is doc-only (CLAUDE.md CORS lines).
> - ⏳ **Doc-truth pass (F-Z2/Z3/Z4/Z6):** CLAUDE.md "All tables use serial PKs" → mixed serial+uuidV7; stale test counts; empty `minimumReleaseAgeExclude`; `tenant-context.ts:86` comment.

> As of 2026-06-05: **Production-audit campaign Phases 1–4 — all findings fixed (working tree, uncommitted).** Diff-aware re-audit; findings + resolutions in `docs/AUDIT_FINDINGS_2026-06-03_PHASE{1,2,3,4}.md`. New migrations **0024** (break-glass read-bypass GUC), **0025** (RLS policy consistency: dormant 0022 tables + `clinic_invoice_counters` RLS/CHECK), **0026** (`audit_logs` append-only). New env `AUDIT_VERIFY_WINDOW_DAYS` (default 7). Highlights: fixed a CRITICAL booking break (0022 FORCE-RLS × `dbUnsafe` reader, F-P1-1); made break-glass actually deliver clinical PHI (F-P2-1); completed right-to-erasure across all clinical tables (F-P3-1); activated audit-integrity verification that was recorded-but-never-run (F-P4-1/2). 479/479 unit tests, typecheck + lint clean; migrations validated on real PG16. **Still open / next:**
> - ⏳ **Run the integration-db suite once under Docker** (`pnpm --filter @workspace/api-server run test:integration-db`) to validate the new app-service-level tests (booking happy-path, erasure scrub, break-glass reads) — the DB layer is already PG16-validated, this exercises the service code.
> - ⏳ **Commit the batch** (0024–0026 + service/test changes) — currently all uncommitted in the working tree alongside pre-existing WIP.
> - ✅ **Phase 1 sweep / Phase 5 (backend logic & API surface) — COMPLETE (2026-06-07)**: exhaustive `dbUnsafe`/`clinicId` sweep (multiline-verified), 6 deep-read service traces, transaction/race review, error-envelope + authGate scope. Findings F-P5-1..5 fixed (incl. HIGH: prescription creation was broken by a `dose`/`dosage` contract drift) + eradicated the `clinic_id DEFAULT 1` footgun (migration **0027**). See `.claude/AUDIT_FINDINGS_2026-06-06_PHASE5.md`. 484 unit / 60 integration-db green.
> - 🟢 **Phase 6 (deployment, DevOps & observability) — audited; all findings fixed, runtime-verify pending (2026-06-07)**: First pass did CI-gate review, backup/restore portability fixes (ESM & Windows), an SSE alert, and a go-live checklist — but marked "complete" while the alert stack was **inert**. Second pass fixed it: `ServiceDown` (`up==0`) process-down alert (F-P6-6); Alertmanager SMTP delivery via `smtp_auth_password_file` (F-P6-5 — `${VAR}` is never expanded → no email was ever sent); blackbox `${BLACKBOX_TARGET}` hardcoded + `EdgeProbeDown` (F-P6-7); restore drill now re-provisions `medicore_app` + proves it can read a tenant table (F-P6-8 — was superuser-only); blocking `monitoring-config` CI job (`promtool check rules`). F-P6-9 FIXED — `scripts/load-test.js` rewritten as a real k6 booking+dashboard load test (runtime-verify with `k6 run`). **Runtime-verify at deploy:** live SMTP delivery (`amtool`), promtool, blackbox target, next quarterly restore drill. See [AUDIT_FINDINGS_2026-06-07_PHASE6.md](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/docs/audits/AUDIT_FINDINGS_2026-06-07_PHASE6.md).
> - 🟢 **Phase 7 (frontend & client security) — re-audited; security sound, sign-off corrected, parity test written (2026-06-07)**: First pass claimed PASS on XSS/CSRF/RBAC with **inaccurate evidence**. Verified second pass: RBAC parity spot-checked on the sensitive routes — **no authz gap** (backend is the real gate; analytics is service-layer-gated). Corrected the false claims: "zero innerHTML" (`DischargeSheet.tsx:98`, safe via React escaping — F-P7-3), "only two GET-only manual fetches" (four; logout is a POST that correctly attaches CSRF — F-P7-4). **F-P7-2 FIXED:** wrote the real `route-access.contract.test.ts` (the file the first pass falsely cited) — asserts client roles ⊆ backend roles across all 24 routes; **43/43 frontend tests green**, CI-gated via `frontend-test`. F-P7-1 (Billing `createdById`) verified fixed. Follow-ups ✅ done: DischargeSheet-escaping + logout-CSRF regression tests (F-P7-3/4, 45/45 green) and a route-layer `requireRole` gate on `/analytics`. See [AUDIT_FINDINGS_2026-06-07_PHASE7.md](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/docs/audits/AUDIT_FINDINGS_2026-06-07_PHASE7.md).
> - ✅ **Phase 8 (architecture, performance & scale) — re-verified accurate (2026-06-07)**: Independently re-checked the first-pass "all passed" against config (after 6/7 were rubber-stamped). **Phase 8's claims hold**: pool math (`pgbouncer.ini` pool_size=20/reserve=5/max_client_conn=200 ≪ Postgres 100), SSE caps (`notifications.ts:29-31` → 503), non-PHI caching incl. the real `doctor_scope:<id>` Redis cache (`scope.ts:29-47`), N+1 batching, bundle splitting. Two minor opens: **F-P8-1** (CLAUDE.md:437 Doctor Scope Rule stale — says "no cache" but it's Redis-cached 60s; needs a manual CLAUDE.md edit, agent was permission-blocked) and **F-P8-1** (CLAUDE.md:437 Doctor Scope Rule stale — needs a manual edit). §8.5 load test now delivered (`load-test.js` rewritten as a real k6 booking+dashboard test, F-P6-9). See [AUDIT_FINDINGS_2026-06-07_PHASE8.md](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/docs/audits/AUDIT_FINDINGS_2026-06-07_PHASE8.md).
> - ✅ **`REPLIT_DOMAINS` removal COMPLETE** (F-Z5) — code was already clean (`policy.ts` `ALLOWED_ORIGINS_SET` reads only `ALLOWED_ORIGINS`); docs corrected 2026-06-15 (CLAUDE.md CORS row + env list). Broader Expo/ngrok/mockup-sandbox prune still tracked under Phase 4 hygiene.
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
- **Read replicas** — Separate analytics DB for reports; prevent report queries from degrading clinical workflows. (Reports now aggregate in SQL over arbitrary ranges as of 2026-06-19 — heavier read load makes this more relevant.)
- **Reports — surface unused server data (2026-06-19 follow-up)** — `appointmentsSummary` already returns `byStatus` + daily `byDay`, but the UI renders only `byDoctor`. Add an appointment-status breakdown + a daily-volume trend chart (data is free; no backend change).

## Quality & Testing Track — Planned (decisions locked 2026-05-31)

Closes frontend regression-blindness and standardizes backend route validation. **Not started.** Five work streams, executed in order WS3 → WS5 → WS1 → WS2 → WS4 so each stream lands on top of stable contracts.

**Locked decisions:**
- **E2E strategy → MSW-mocked. ✅ Shipped 2026-07-02 (AUD-FE-01) — now runs in CI as a non-blocking `e2e` job** (the original "no CI" call was reversed once `.github/workflows/ci.yml` existed: advisory job runs on every PR, failures visible, not in `ci-gate.needs`). Playwright runs against `vite dev` with MSW intercepting fetches. Shared `loginAs()` fixture in `e2e/fixtures.ts`. Billing "anti-fraud same-user pay gate" stays a backend integration test — it's a server invariant, not a UI behavior.
- **i18n → ICU MessageFormat.** Arabic has 6 plural categories; plain JSON key-value can't express them cleanly. Use `@formatjs/intl`. Proactive `t()` callsite sweep at migration time (not lazy) so the placeholder→`{var}` conversion lands in one pass.
- **Accessibility → critical/serious axe violations only.** Internal-staff app, ~10 known roles, no patient-facing surface. Full WCAG 2.1 AA is deferred until a patient portal becomes real. Filter by `v.impact === "critical" || "serious"`; do not constrain by `wcag2a/wcag2aa` tags.

**Work streams:**
- **WS3 — Zod route validation (first).** New `api-server/src/middlewares/validate.ts`; migrates 12 route files from raw `req.body` to `schema.safeParse`. **Breaking error-shape change** — `{ error: "Missing required fields" }` → `{ error: "Validation error", details: { field: [...] } }`. Frontend toast handler updated in the same pass to surface `details`.
- **WS5 — i18n extraction + ICU.** Replaces 53KB eager-loaded inline translations in `clinic/src/hooks/i18n.tsx` with lazy-imported `locales/en.json` + `locales/ar.json`. Active locale only (~26KB) loaded per session. All `t()` callsites converted to ICU `{var}` syntax.
- **WS1 — Vitest unit tests.** 7 spec files targeting highest-risk zero-coverage code: `route-access`, `auth` hook, `DataTable`, `useSessionTimeout`, `use-notifications-stream`, `StatusBadge`. Adds `vitest`, `@testing-library/react`, `jsdom`, `msw` to clinic devDeps.
- **WS2 — Playwright + MSW E2E. ✅ Shipped 2026-07-02 (AUD-FE-01).** 3 spec files (login→dashboard, create appointment, create billing invoice) via a shared `loginAs()` fixture; `playwright.config.ts` uses `webServer: pnpm dev` with `VITE_E2E=1` at `http://localhost:5173` (chromium only). Advisory `e2e` CI job (non-blocking). rbac + more flows are cheap follow-ups on the harness.
- **WS4 — Accessibility audit.** `e2e/accessibility.spec.ts` using `@axe-core/playwright` against the same MSW-mocked frontend. Critical/serious filter only.

## Phase 7 — Product (post-launch)

- **Patient portal** — Self-booking, results viewing, secure messaging, separate auth domain.
- **WhatsApp/SMS reminders** — Twilio or local provider; no-show prevention.
- **Payment gateway** — Stripe / PayTabs integration.
- **Waiting-room Kanban** — Visual pipeline across the 10-state appointment workflow.
- **FIDO2/WebAuthn** — Phish-proof login for admin/doctor roles (after MFA is stable).
