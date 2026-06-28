# MediCore — Software Architecture Audit (2026-06-29)

> **Scope:** Full architectural review commissioned 2026-06-29. Read-only analysis against the
> running working tree on branch `security/search-doctor-scope` (182 uncommitted files). Remediation
> plan and fixes tracked in the `security/search-doctor-scope` WIP and subsequent commits.

---

## 1. Current Architecture Assessment

**Style:** pnpm monorepo → React 19 SPA + Express 5 REST API + PostgreSQL 16 (Drizzle ORM). API
contract is the single source of truth (`lib/api-spec/openapi.yaml` → Orval → typed client hooks +
Zod validators). Clean layered architecture with an enforced service layer.

| Concern | Verdict | Evidence |
|---|---|---|
| Spaghetti code | **Not present** | Consistent layering; routes→services→lib→runtime; no tangled control flow |
| Tight coupling | **Low** | Routes have 0 DB imports (ESLint-enforced); front/back coupled only through generated contract |
| Circular dependencies | **None found** | `policy.ts`↔`auth.ts` are type-only; `scope.ts→audit.ts` one-way; runtime uses a factory |
| God classes/services | **Borderline, none critical** | Largest logic file = `dashboard.service.ts` 566 LOC (10 cohesive read rollups) |
| Mixed responsibilities | **Rare** | Services are domain-aligned; pages are view+hook wiring |
| Layer violations | **2 minor** | billing route validation leak (fixed); `scope.ts` authz logic living in `lib/` |
| Business logic in UI | **Not present** | Pages delegate all mutations/validation to generated hooks + backend |
| Business logic in controllers | **1 minor leak** | `routes/billing.ts:57-60` (fixed 2026-06-29) |
| DB access in frontend | **None** | No DB/SQL in client; server state only via TanStack Query hooks |
| Direct service-to-service coupling | **Present but justified** | `autoAdvanceVisit` hub + `consent`/`break-glass` cross-calls — workflow/security, not accidental |
| Shared mutable state | **Controlled** | All in-memory stores behind swappable interfaces (`runtime/`); Redis in prod |

**Separation of Concerns: PASS.** The system is cleanly split into Frontend / API layer / Business
logic (services) / Database (lib/db) / Auth (policy kernel) / Infrastructure (compose+monitoring) /
Shared contracts (api-spec+generated) / Configuration / Testing. Only first-class layer missing as
an explicit boundary: **Configuration** (see §4 — typed config module).

**What's genuinely strong (do not "fix"):**
- Service-layer boundary is **CI-enforced** — ESLint `no-restricted-imports` blocks `@workspace/db`/`drizzle-orm` in `routes/**` (lint job, blocking).
- Multi-tenant isolation enforced at **three** layers: app filter (`eq(clinicId)`), Postgres RLS via `runInTenantContext` (migration 0015/0017/0024), non-superuser DB role `medicore_app` (migration 0020) so RLS is real, not nominal.
- API contract generated both directions from one `openapi.yaml`; types are shared, not duplicated.
- Audit is a transactional outbox with a daily-verified hash chain; `audit_logs` is append-only (UPDATE/DELETE revoked, migration 0026/0028).
- Background work split into a separate worker process (`worker.ts`→`dist/worker.mjs`); request code never triggers crons.
- Contract drift, raw-fetch, `document.write`, offset-pagination, and migration drift are all blocked by CI grep/test guards.

---

## 2. Architecture Maturity Score

**Overall: 8.5 / 10 — "Defined → Measured" (CMM Level 4-ish).**

| Sub-dimension | Score | Rationale |
|---|---|---|
| Coupling (10 = loosely coupled) | 8.5 | Routes/DB fully decoupled; remaining service↔service edges are justified domain coupling |
| Cohesion (10 = high) | 8.5 | Services map 1:1 to domains; lib/ is mostly coherent |
| Complexity (10 = low) | 7.5 | A few 500–690 LOC pages/services; one 2169 LOC i18n dict; no deep nesting hot-spots |
| Testability | 8.5 | 63 test files incl. real-Postgres RLS integration suite; frontend route/guard/i18n tests |
| Boundary enforcement | 9.5 | Rules are CI-gated, not aspirational |
| Observability/Ops | 9.0 | Prometheus+Grafana+Alertmanager, partitioned audit, backups, runbook |
| Configuration discipline | 6.0 → 8.5* | 78 scattered `process.env` reads across 32 files; no typed/validated config module. *Fixed 2026-06-29 with typed `lib/config.ts`. |

---

## 3. Files Causing the Most Damage

Ranked by maintenance blast-radius.

| File | LOC | Risk | Severity |
|---|---|---|---|
| **(working tree)** 182 uncommitted files on `security/search-doctor-scope` | — | New PHI features (imaging, vitals) live only in an unmerged tree; CI gates haven't fully run on the merged result. | **P0 process** |
| `artifacts/clinic/src/hooks/i18n.tsx` | 2169 | Single EN+AR string dictionary. Merge-conflict magnet. Pure data (no logic). Fixed 2026-06-29: split into `locales/en.ts` + `locales/ar.ts`. | Medium (fixed) |
| `artifacts/clinic/src/lib/print.ts` | 510 | Security-sensitive: builds HTML for `document.write` sinks (DOM-XSS surface, audit F-01). Keep small + heavily reviewed. | Medium (security) |
| `artifacts/api-server/src/services/dashboard.service.ts` | 566 | Widest service — 10 role-specific read rollups. Cohesive but a natural split point. | Low–Med |
| `artifacts/api-server/src/services/appointments.service.ts` | 553 | Houses `autoAdvanceVisit`, the workflow **hub** imported by billing/lab/xray/ultrasound/vitals. Central blast radius. | Med (coupling) |
| `artifacts/clinic/src/pages/Schedule.tsx` (689), `Reports.tsx` (618), `PatientDetail.tsx` (549), `Inventory.tsx` (538), `Dashboard.tsx` (519) | — | Large pages. View + hook wiring (no domain logic leak), but size hampers readability. | Low |
| `artifacts/api-server/src/lib/scope.ts` | ~190 | Authorization/scope domain logic living in `lib/` (utility tier). Borderline layer placement. | Low |

---

## 4. Dependency Violations

**No critical layer violations.** Minor issues found and fixed.

1. **[FIXED 2026-06-29] Controller logic leak** — `routes/billing.ts:57-60` validated the 30-char cancellation reason in the route. Moved into `cancelInvoice()` service.
2. **Authz logic in lib/** — `lib/scope.ts` performs doctor-patient scope authorization (a domain concern) from the utility tier. No cycle, no bug; placement is debatable. Not moved.
3. **[FIXED 2026-06-29] 2 legacy raw `fetch()` calls** — `components/DischargeSheet.tsx:66` and `components/GlobalSearch.tsx:43` bypassed the generated client. Both migrated to generated hooks.
4. **[FIXED 2026-06-29] No typed configuration layer** — 78 direct `process.env.*` reads across 32 files. Fixed with `artifacts/api-server/src/lib/config.ts` (Zod-validated, boot-time) + ESLint guard.
5. **Per-process SSE replay state** — `lib/sse.ts:6-32` keeps connection maps and replay buffers in-process. Not a delivery bug: `emitToUser` fans out through `runtime.eventBus` (Redis pub/sub in prod). Scale caveat, not a violation.

**Explicitly checked and clean:** routes→DB imports (0/31), circular deps (none), frontend DB access (none), duplicated business logic across tiers (none).

---

## 5. Suggested Module Boundaries

The repo **already matches** the canonical target structure.

| Ideal layer | Where it lives today | Status |
|---|---|---|
| frontend/ (components, pages, hooks, services, store, utils) | `artifacts/clinic/src/{components,pages,hooks,lib}` | ✅ |
| backend/ (api, controllers, services, repositories, middleware, events, jobs) | `artifacts/api-server/src/{routes,services,middlewares,lib}` + `worker.ts`/`cron.ts` | ✅ |
| database/ (migrations, seeds, schemas) | `lib/db/{migrations,src/schema}` + `scripts/seed.ts` | ✅ |
| infrastructure/ (docker, monitoring, nginx, deployment) | repo root + `monitoring/`, `caddy/`, `pgbouncer/`, `.github/workflows` | ✅ (scattered at root, cosmetic) |
| shared/ (types, contracts, utilities) | `lib/api-spec` + generated `lib/api-zod`/`lib/api-client-react` | ✅ |

**Recommended refinements implemented:**
- ✅ Typed `config` boundary — `artifacts/api-server/src/lib/config.ts`.
- ✅ i18n split — `hooks/locales/en.ts` + `locales/ar.ts`.
- Appointment workflow event-bus inversion: **deferred** (optional; current coupling is justified).
- Root infra grouping under `infrastructure/`: **deferred** (cosmetic, no functional value).

---

## 6. Refactoring Roadmap (as of 2026-06-29)

| # | Item | Status |
|---|---|---|
| **P0** | Land 182-file `security/search-doctor-scope` WIP in reviewable chunks | Open |
| **P1** | Typed `lib/config.ts` (Zod-validated, boot-time) + ESLint guard | ✅ Fixed 2026-06-29 |
| **P2a** | Move billing cancel rule into `cancelInvoice()` service | ✅ Fixed 2026-06-29 |
| **P2b** | Migrate 2 legacy raw `fetch()` calls to generated hooks | ✅ Fixed 2026-06-29 |
| **P2c** | Split `i18n.tsx` into per-locale files | ✅ Fixed 2026-06-29 |
| **P3** | Domain-event bus to invert `autoAdvanceVisit` hub coupling | Deferred (optional) |
| **P4** | Postgres read-replica / shard-by-clinic | Deferred (infra, on demand) |

---

## 7. Migration Strategy

- No big-bang rewrite. Every item is incremental and behind existing CI gates.
- P0 (WIP landing): slice by feature (imaging, vitals, search/scope) into reviewable PRs; rely on `integration-db` RLS suite + `migration-drift` to prove safety.
- P1 (config): `lib/config.ts` alongside existing reads, migrate module-by-module, delete direct reads last. ESLint guard added to prevent regression.
- P2 (quick wins): independent one-file changes; each ships with its existing test.
- P3/P4: deferred; gated on real Prometheus signals.

---

## 8. Estimated Effort

| Item | Effort | Risk |
|---|---|---|
| P0 — land WIP in chunks | 2–4 days (review) | Medium (volume) |
| P1 — typed config | 1–1.5 days | Low |
| P2a — billing rule move | <1 hour | Trivial |
| P2b — 2 fetch migrations | 1–2 hours | Low |
| P2c — i18n split | 0.5–1 day | Low (mechanical) |
| P3 — event bus (optional) | 3–5 days | Medium |
| P4 — scale-ahead (deferred) | scoped when triggered | Medium |

---

## 9. Risks

- **WIP volume (P0):** 182 uncommitted files mean the merged architecture hasn't been fully CI-validated as one unit; latent integration issues possible. Highest-attention item.
- **Config migration (P1):** touching env reads risks behavioral drift if a default changes silently — mitigate with boot-time Zod validation catching it immediately.
- **Event bus (P3):** introduces eventual-consistency semantics to appointment flow; over-engineering risk for a ~20-user system.
- **i18n split (P2c):** must preserve EN/AR key parity (existing `i18n.test.ts` guards this).
- **Doing nothing was low-risk:** the system was shippable as-is; this roadmap was optimization, not rescue.

---

## 10. Expected Maintainability Improvement

- **P0+P1+P2** move Configuration discipline 6.0 → ~8.5 → projected overall maturity **8.5 → ~9.0**.
- Concrete wins: env misconfig caught at boot; i18n edits stop colliding; controllers 100% thin; zero contract-bypass fetches.

---

## Local-First Dependency Review

**Already strongly local-first.** Dev needs only local Postgres (Redis optional — in-memory runtime fallback). Cloud dependencies are all optional, flag-gated, or swappable:

| Cloud dep | Use | Status |
|---|---|---|
| Resend | Transactional email | Optional — console-logs when `RESEND_API_KEY` unset |
| Twilio | SMS fallback | Optional/stubbed |
| HIBP API | Pwned-password check | Feature-gated (`PHASE2_STRICT_PASSWORD_POLICY`), fails open |
| rsync-over-SSH | Backup replication | Optional — local disk if target unset |
| Imaging storage | X-ray/ultrasound files | **Already fully local** — AES-256-GCM encrypted filesystem, no S3 |

**For fully air-gapped deployment:** swap Resend→self-hosted SMTP and HIBP→offline hash file. Both are config/abstraction-level changes.

---

## Scaling Answer

| Target | Verdict | Notes |
|---|---|---|
| **100 concurrent users** | ✅ Comfortably | Single API + worker, Redis runtime, 40-conn pool. Designed for ~20 internal staff. |
| **1,000 concurrent users** | ✅ With prod config | PgBouncer (transaction pooling, `max_client_conn=200`) + Redis runtime → 2nd API replica safe. SSE fans out via Redis pub/sub. |
| **100,000 patient records** | ✅ Trivial for PG16 | Cursor pagination (hard cap 100 rows), composite indexes (migration 0018), audit_logs range-partitioned monthly through 2036. |
| **Multiple clinics** | ✅ Core strength | First-class `clinic_id` tenancy enforced at app + RLS + non-superuser DB role. Cross-tenant isolation proven by real-Postgres integration suite. |
| **Multiple hospitals** | ⚠️ Works, with ceiling | Many clinics in one Postgres works until single primary can't hold combined write/connection load. Break point: (a) reporting/analytics load → add read replica; (b) very large tenant count → shard by `clinic_id` (Citus); (c) per-process SSE replay degrades across many replicas → move replay buffer to Redis. None of these bite at single-hospital/few-clinics scale. |

**Bottom line:** survives 100–1,000 users and 100k+ records as architected; multi-clinic is a core strength; multi-hospital scales horizontally until the single Postgres primary is the bottleneck — at which point read-replica → shard-by-clinic is the well-signposted path, not a rewrite.

---

*Audit conducted 2026-06-29 against working tree `security/search-doctor-scope`. Remediation
(P1+P2) executed same date. See CHANGELOG.md for per-fix entries.*
