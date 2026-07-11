# MediCore — Independent Architecture Audit (2026-07-02)

## Context

Full principal-level architecture audit: is MediCore maintainable, scalable, understandable,
testable, and secure enough for a 20-engineer / 10-year horizon? This is the **third** audit in four
days (arch review 2026-06-29 → 8.5/10; engineering-board audit 2026-07-01 → 82/100). To be worth
writing, this pass is an **independent verification against the live tree on
`security/search-doctor-scope` (HEAD `55e31df`)** — confirming or breaking the prior verdicts with
fresh `file:line` evidence, and surfacing what the prior two glossed. Nothing below is copied from the
existing reports; every claim was re-derived from the current code.

**Headline:** This is a genuinely strong, boring-in-the-good-way codebase. The application core is
production-grade. The real risk is **not the code — it is that the production deployment has still
never been run end-to-end under Docker**, plus a handful of honest structural smells the earlier
audits under-weighted. Brutal-honesty caveat delivered up front: there is little spaghetti to find
here, and pretending otherwise would be dishonest. The sharp edges are elsewhere.

> **Where this lives:** the real project root is nested at `Clinic-Hub/Clinic-Hub/` (a repo-hygiene
> smell, §2). All paths below are relative to that inner root.

---

## 1. Executive Summary

| Dimension | Score /10 | One-line reasoning |
|---|---|---|
| **Overall architecture** | **8.5** | Enforced-boundary modular monolith, API-contract-first, zero circular deps, no god files. Loses points for deep-import coupling + unproven deployment. |
| **Maintainability** | **8.5** | Rigid per-module template (`routes`/`service`/`index`), CI-gated layer rules, exhaustive `CLAUDE.md`. Drag: kernel complexity in `lib/`, type-strictness deliberately relaxed. |
| **Scalability** | **8.0** | Cursor pagination, composite indexes, partitioned audit, PgBouncer, Redis runtime, RLS multi-tenancy. Ceiling: single Postgres primary; SSE replay is per-process. |
| **Testability** | **7.5** | 61 backend test files (23 real-Postgres RLS), CI-gated. But no load/chaos/mutation tests, thin E2E (3 specs), and the integration-db suite needs a Docker host it doesn't always have. |
| **Security** | **9.0** | Fail-closed EdDSA-JWT kernel, RLS + non-superuser DB role, AES-256-GCM PHI encryption, append-only daily-verified audit chain, break-glass, erasure. Minor: audit-on-read best-effort, fph disable-lever unguarded. |
| **Developer experience** | **8.0** | New engineer can grok one module in ~30 min thanks to templates + docs. Drag: nested `Clinic-Hub/Clinic-Hub`, essential kernel complexity, features landing via long-lived WIP branches. |

**Reasoning in brief.** The system inverts the usual audit outcome: normally you hunt for the
architecture buried under the code; here the architecture is explicit, documented, and *mechanically
enforced* (ESLint `no-restricted-imports` blocks DB in routes; CI greps block raw fetch,
`document.write`, offset pagination, contract drift, migration drift). That enforcement is the single
biggest reason the scores are high — rules that are CI-gated don't rot. The points come off for (a) a
production stack that is statically-correct but never executed, (b) a workflow "hub"
(`autoAdvanceVisit`) that couples 5 modules through **deep imports that bypass the barrel the docs
require**, and (c) testing breadth that stops at targeted regression + RLS and never reaches load or
chaos.

---

## 2. Repository Structure Analysis

**Verdict: Modular Monolith with enforced layering + API-contract-first shared kernel.** It is *not*
Clean or Hexagonal architecture and does not pretend to be — see below.

```
Clinic-Hub/Clinic-Hub/           ← real root (nested; see smell)
  artifacts/
    api-server/src/
      modules/<feature>/         ← 12 feature modules, each: <f>.routes.ts + <f>.service.ts + index.ts
      routes/index.ts            ← ONLY the router-mount table
      services/                  ← shared infra only (errors, email, sms)
      middlewares/               ← 11 cross-cutting middlewares
      lib/                       ← cross-cutting kernel (policy, audit, RLS ctx, encryption, runtime/)
      worker.ts / cron.ts        ← background process split out of request path
    clinic/src/                  ← React 19 SPA (pages/, components/, hooks/, lib/, mocks/, e2e/)
  lib/                           ← workspace packages: api-spec, api-zod (gen), api-client-react (gen), db
```

- **Folder organization — strong.** Feature-module layout is consistent across all 12 modules; the
  `routes/services` split of the old layout was fully migrated (commit `525ed2d`). No orphan dirs.
- **Naming — strong & predictable.** `<feature>.routes.ts` / `<feature>.service.ts` / `index.ts`
  barrel everywhere. DB schema files are one-table-per-file (`patients.ts`, `lab_tests.ts`, …).
- **Feature boundaries — enforced, not aspirational.** ESLint blocks `@workspace/db`/`drizzle-orm` in
  `*.routes.ts`, and blocks the raw `db` export in `*.service.ts` (forcing `dbUnsafe` with a
  justification). This is the codebase's best single property.
- **Layer separation — present at 4 tiers:** HTTP (routes) → domain (services) → kernel (lib) →
  runtime (lib/runtime, swappable memory/Redis). Frontend mirrors: pages → hooks/query → generated
  client. Contract tier (`lib/api-spec` → Orval → `api-zod` + `api-client-react`) is the seam between
  front and back — types are generated both directions from one `openapi.yaml`, never duplicated.

**Which named pattern applies:**
- **Modular Monolith — YES.** Single deployable, feature modules with barrels, shared kernel.
- **Layered — YES**, and cleanly.
- **Vertical Slice — PARTIAL.** Modules are vertical slices, but the cross-cutting kernel (audit,
  RLS, policy, encryption) is horizontal and shared — a pragmatic hybrid.
- **Clean / Hexagonal — NO, and correctly so.** There is **no repository/port abstraction**; services
  call Drizzle directly (`patients.service.ts:4` imports `dbUnsafe`/`runInTenantContext`). There are
  no domain entities distinct from DB rows, no use-case interactors, no dependency inversion around
  persistence. For a ~20-user internal system this is the *right* call (their own stated priority:
  "boring architecture over fashionable"), but it must be named honestly: the DB is a hard,
  concrete dependency of every service. See §6 "Missing abstractions."
- **Microservices — NO** (and shouldn't be).

**The one structural smell:** the working directory is `Clinic-Hub/` but the actual project sits one
level down in `Clinic-Hub/Clinic-Hub/`. Every tool invocation, every new hire, every CI path has to
know this. It is cosmetic but it is a daily papercut and an onboarding trap. **Fix: flatten** (§14 P1,
but as its own dedicated change — see §13b F11).

---

## 3. Dependency Analysis

**Circular dependencies: none found.** Confirmed: `policy.ts`↔`auth.ts` are type-only; barrels export
routers, not into cycles. `tsc --build` (project references) would fail on a true cycle and does not.

**Cross-module dependencies — the real finding.** There are **10 cross-module edges**, all justified
by domain workflow/security, BUT they are wired in a way that contradicts the project's own rule:

| Consumer | Imports | From | Via barrel? |
|---|---|---|---|
| `billing.service.ts:11` | `autoAdvanceVisit` | `../clinical/appointments.service` | ❌ deep |
| `imaging/xray.service.ts:13` | `autoAdvanceVisit` | `../clinical/appointments.service` | ❌ deep |
| `imaging/ultrasound.service.ts:13` | `autoAdvanceVisit` | `../clinical/appointments.service` | ❌ deep |
| `clinical/lab.service.ts:13`, `vitals.service.ts:10` | `autoAdvanceVisit` | `./appointments.service` | intra-module |
| `clinical/{lab,prescriptions}.service.ts` | `getActiveBreakGlassPatientIds` | `../compliance/break-glass.service` | ❌ deep |
| `imaging/{xray,ultrasound,imaging-attachments}.service.ts` | `getActiveBreakGlassPatientIds` | `../compliance/break-glass.service` | ❌ deep |
| `clinical/{medical-records,prescriptions}.service.ts` | `hasActiveConsent` | `../compliance/consent.service` | ❌ deep |

**`CLAUDE.md` states:** *"Cross-module calls import another module ONLY through its `index.ts` barrel,
never a deep `modules/x/x.service` path."* **The code violates this in every cross-module edge** —
`clinical/index.ts` exports only routers (verified: lines 12–19 are all `export … Router`), never
`autoAdvanceVisit`. So the documented public surface of a module (its barrel) and its *actual*
consumed surface have silently diverged. This is **hidden coupling**: `appointments.service.ts` is an
undeclared workflow hub with **5 inbound edges**, and nothing at the barrel level advertises it. The
06-29 and 07-01 audits both noted the hub but neither flagged the barrel-rule violation.

**Dependency direction — one debatable violation:** `lib/scope.ts` performs doctor↔patient
*authorization* (a domain concern) from the *utility* tier. No cycle, no bug, but authz logic in
`lib/` alongside `dateUtils` and `logger` is a layering smell the 06-29 audit chose not to move.

**Shared mutable state — controlled.** All in-process stores (SSE connection maps + replay buffer in
`lib/sse.ts`, rate/revocation/cache stores in `lib/runtime/`) sit behind swappable interfaces
(memory in dev, Redis in prod). The one caveat: **SSE replay buffer is per-process** — across 2+ API
replicas a client reconnecting to a different replica loses replay (delivery still fans out via Redis
pub/sub; only replay degrades). Documented, not a bug, but a real multi-replica caveat.

---

## 4. Separation of Concerns Analysis

| Concern | Separated? | Evidence |
|---|---|---|
| Presentation (HTTP) | ✅ | `*.routes.ts` parse/validate/map-errors only; ESLint bans DB imports there. |
| Business logic | ✅ | `*.service.ts` own queries, scope, audit, rules. |
| Data access | ⚠️ **concrete, not abstracted** | Services call Drizzle directly. No repository seam (see §6). Clean *placement*, but no *inversion*. |
| Infrastructure | ✅ | `services/` (email/sms/errors), `lib/runtime/` (cache/events/stores), compose/monitoring at root. |
| External integrations | ✅ | Resend/Twilio/HIBP all behind interfaces, optional, fail-open where safe. |

**Classic violations — checked, essentially absent:**
- SQL in controllers → **none** (ESLint-enforced).
- HTTP calls in UI → server state only via generated TanStack Query hooks. **Zero raw `fetch()` calls
  in `pages/**`, confirmed.** (An earlier pass of this audit misreported "5 raw fetch() in pages" —
  that was a grep substring bug matching `refetch(` from TanStack Query's own `refetch()` callback;
  corrected after re-verifying with a word-boundary pattern.) The CI guard
  (`.github/workflows/ci.yml:70-73`) already covers both `fetch("/api/…")` **and** `fetch(apiUrl(…))`,
  scoped to `pages/`, and `CLAUDE.md`'s claim that the 2 legacy reads (`DischargeSheet.tsx`,
  `GlobalSearch.tsx`) were migrated 2026-06-29 checks out — no doc/code drift here.
- Business logic in views → not present; pages are view + hook wiring (max `useState` density is 10 in
  `Inventory.tsx`; no reducer sprawl).
- DB models exposed raw to API → **no** — responses are shaped/redacted per role
  (`serializeForRole`, `maskIdCard`, `SUMMARY_SECTIONS` in `patients.service.ts:56-89`).

---

## 5. Spaghetti Code Report

There is **no spaghetti**. That is the honest finding — say it plainly rather than manufacture issues.
What exists is *size* and *coupling*, not tangle. Ranked by blast radius:

| # | File / area | Problem | Severity | Suggested fix |
|---|---|---|---|---|
| 1 | `modules/clinical/appointments.service.ts` (553 LOC) | Houses `autoAdvanceVisit` (the state-machine hub) — 5 inbound cross-module edges via deep import. Change here can silently break billing/lab/imaging/vitals. | **Med (coupling)** | Extract `autoAdvanceVisit` to `modules/clinical/index.ts` barrel (or a `visit-workflow` module); OR invert to a domain-event bus (06-29 P3, deferred). At minimum make the coupling *declared*. |
| 2 | `modules/reporting/dashboard.service.ts` (566) | Widest service: 10 role-specific read rollups. Cohesive, but one file. | Low | Split per audience (`clinic-dashboard` vs `doctor-dashboard`) when next touched. |
| 3 | `pages/Schedule.tsx` (~689), `Reports.tsx` (618), `PatientDetail.tsx` (549), `Inventory.tsx` (538), `Dashboard.tsx` (519) | Large view files. No logic leak, but size hampers 30-min readability. | Low | Extract sub-sections into `components/`. Schedule already started (`components/schedule/` WIP). |
| 4 | `lib/print.ts` (510) | Builds HTML for `document.write` sinks (DOM-XSS surface). Security-sensitive by nature. | Med (security) | Keep small, keep the `escapeHtml`/`safeUrl` discipline, keep the CI grep guard. Do not grow it. |
| 5 | `hooks/locales/{en,ar}.ts` (1072 / 1050) | Pure data dictionaries. Merge-conflict magnets but zero logic. | Low | Already split from the old 2169-LOC `i18n.tsx` (good). Leave as data. |

**God objects: none.** No class or service concentrates unrelated responsibilities. Deep nesting: no
hot-spots found. Duplicate logic across tiers: none (contract types are generated, not copied).

---

## 6. Modularity Analysis

- **Feature isolation — high.** 12 modules, barrel-fronted, ESLint-fenced. Zero deep *intra*-import
  violations for routers.
- **Encapsulation — good but leaky at the service edge.** Barrels advertise routers; cross-module
  service functions (`autoAdvanceVisit`, `hasActiveConsent`, `getActiveBreakGlassPatientIds`) are
  consumed by deep path, so a module's *true* public API isn't its barrel (§3).
- **Reusability — strong for the kernel** (`lib/audit`, `lib/field-encryption`, `lib/scope`,
  `lib/runtime/*` are cleanly reused). Weak by design for persistence — no repository to reuse/mock.
- **Plugin capability — partial.** Runtime stores are true plugins (memory↔Redis). Email/SMS/HIBP are
  swappable. But there is no formal plugin/extension seam for new feature modules beyond the
  copy-the-template convention (which, to be fair, works well here).

**Missing abstractions (honest list):**
1. **No repository layer.** Services bind directly to Drizzle + specific tables. Trade-off: less
   ceremony, faster to read (a win at this scale), but every service is untestable without a real DB
   (hence the Docker-dependent integration suite) and the ORM is impossible to swap. *Recommendation:
   do NOT add one now* — it would be abstraction for its own sake against their stated priorities. Add
   it only if/when a second persistence target or heavy unit-test-without-DB need appears.
2. **`autoAdvanceVisit` is an implicit domain-event hub with no bus.** The honest target is a small
   in-process event emitter (`payment.completed` → advance visit) so producers don't import the
   consumer. Deferred is fine; declaring it via the barrel is the cheap interim.
3. **No typed cross-module service contract.** Barrels should re-export the sanctioned cross-module
   service functions so the fence is real.

**Recommended target architecture: keep the Modular Monolith.** Do not chase DDD/Hexagonal/microservices —
they would add ceremony this system doesn't need and violate "boring over fashionable." The correct
evolution is *tightening the existing pattern* (barrel-honest cross-module edges, optional event bus),
not replacing it.

---

## 7. Frontend Architecture Review

- **Component organization — clean.** 41 pages, 49 components (incl. `components/ui/` shadcn
  primitives). Route-level code splitting via `lazy()` for every page (`App.tsx:24-58`).
- **State management — appropriately minimal.** Server state = TanStack Query (`staleTime 30s`,
  `retry 1`). Client/session state = React Context (`AuthProvider`, `I18nProvider`, `PrintLangProvider`)
  stacked 5-deep in `App.tsx:296-312`. **No Redux, no Zustand, no global store** — correct for the
  size. `useState` density is low (max 10). No state explosion.
- **API layer separation — strong and enforced.** All `/api/*` traffic flows through the generated
  `customFetch` (`lib/api-client-react/src/custom-fetch.ts:364-376`) which injects `X-CSRF-Token` from
  the `_csrf` cookie and sends `credentials: "include"`. A CI grep guard blocks hand-written
  `fetch("/api/…")` in pages.
- **Reusable components — yes** (Layout, ChangeHistory, DischargeSheet, ScheduleDayView, GlobalSearch).
- **Routing — `wouter`** (not react-router, enforced), guard-wrapped: `<Guard path role>` →
  `canAccessRoute()` (`App.tsx:105-108`), unified route-access matrix in `lib/route-access.ts`,
  `super_admin` auto-bypass. Route block wrapped in `RouteErrorReset` keyed by location so errors clear
  on navigation.

**Detected issues:**
- **Prop drilling — not a problem.** Context + query hooks keep prop chains short.
- **Component bloat — the 5 large pages (§5).** Readability, not correctness.
- **Shared-state issues — none material.** The 401 interceptor is registered globally
  (`setUnauthorizedHandler(logout)`, `App.tsx:166-169`) — clean single source.
- **Two justified raw `fetch()` calls outside the contract, both in `hooks/auth.tsx`** (not pages —
  §4 correction): `fetch("/api/auth/me", …)` on mount (`:38`, GET, session bootstrap — fires before any
  query-client/auth wiring exists, so it can't go through the generated client) and
  `fetch("/api/auth/logout", …)` (`:72`, POST, but it **correctly** attaches `X-CSRF-Token` read from
  the `_csrf` cookie by hand). No CSRF gap, no contract-bypass in the risky sense — these are the auth
  system's own bootstrap/teardown primitives, not a page skipping the client out of habit. Left as-is;
  routing them through the generated client would risk a circular dependency (logout is itself wired as
  the generated client's 401 handler in `App.tsx:166-169`).
- **Auth-gate is client-side only (expected).** Route guards are UX, not security; the server RLS +
  policy kernel is the real boundary. Correct, but worth stating so no one mistakes `canAccessRoute`
  for enforcement.

---

## 8. Backend Architecture Review

- **Controllers (`*.routes.ts`) — thin.** Parse params (`safeParseInt`/`validateParamInt`), `validate()`
  body against generated Zod, call service, map errors via `asyncHandler`. No DB, no business rules
  (the one historical leak, `billing.ts` 30-char rule, was moved to the service 2026-06-29).
- **Services (`*.service.ts`) — the domain core.** Own queries, scope checks, audit, encryption,
  business rules. Direct Drizzle (no repository, §6). RLS adoption is heavy and real: **161
  `runInTenantContext` call sites** across services vs **29 services importing `dbUnsafe`** (each with a
  justification comment) — so tenant-context is the default, bypass is the audited exception.
- **Repositories — absent by design** (§6). Named here for completeness.
- **Domain models / DTOs — generated, not hand-written.** `openapi.yaml` → Orval → `api-zod`
  (backend validation) + `api-client-react` (frontend). Single source of truth; the "never edit
  generated files" rule is CI-guarded.
- **Validation — layered.** Route-level `validate(Schema)` (presence/shape, no mutation of `req.body`)
  + service-level business rules (consent, JSONB `safeParse`, date parsing, role branching). Correct
  division; `CLAUDE.md` even warns about the billing gotcha where a generated schema modeled server-set
  fields.
- **Middleware — 11, well-scoped:** `auth-gate` (the modern single entry), legacy `auth` shims,
  `correlationId`, `envelope` (canonical error shape), `rateLimiter`/`login-shield`, `step-up`,
  `device-scope`, `imaging-upload`, `validate`, `asyncHandler`. Middleware order in `app.ts:24-143` is
  documented and correct (`trust proxy` first).

**Misplaced responsibilities:** only two, both minor and known — `lib/scope.ts` (authz in utility
tier, §3) and the cross-module deep imports (§3). Nothing else.

---

## 9. Database Architecture Review

- **Entity design — one-table-per-file** (34 schema files under `lib/db/src/schema/`), serial PKs on
  most tables, `uuidV7` PKs for newer tables (`clinic_notices`), composite PKs where natural
  (`doctor_patients`, `user_devices`). `createdAt`/`updatedAt`/`deletedAt` (soft-delete) conventions.
- **Relationships & constraints — strongly modeled.** Across 40 migrations: **77 FK references, 45
  CHECK constraints, 100 indexes.** Every clinic-bearing table carries `CHECK (clinic_id > 0)` and an
  RLS `tenant_isolation` policy (dormant outside `runInTenantContext`). `clinic_id` has **no default**
  (migration 0027) so a forgotten tenant id is a compile error, not a silent mislabel — an excellent,
  deliberate safety property.
- **Indexing — composite indexes present** (migration 0018 "performance_indexes"); 100 total across
  migrations. Cursor pagination (`ORDER BY id DESC`, hard cap 100) means no offset-scan degradation.
- **Multi-tenancy readiness — best-in-class for this stack.** Three enforcement layers: app filter
  (`eq(clinicId)`), Postgres RLS via `runInTenantContext`, and a non-superuser `medicore_app` role
  (migration 0020, NOSUPERUSER NOBYPASSRLS) so RLS is *real*, not nominal. Cross-tenant isolation is
  proven by the real-Postgres integration suite.
- **Audit table — range-partitioned monthly through 2036** (migration 0021), append-only
  (UPDATE/DELETE revoked, migrations 0026/0028 + event trigger), transactional-outbox write path.

**Issues:**
- **N+1 — largely avoided.** `getPatientSummary` (`patients.service.ts:301-329`) fans out 5 secondary
  queries via `Promise.all` inside one tenant context — bounded, not N+1. Analytics N+1 was already
  fixed (per 07-01 audit). No obvious per-row query loops found in the services reviewed.
- **Missing indexes — not proven either way without `EXPLAIN`.** 100 indexes exist but **no
  query-plan / load validation has ever run** (07-01 audit, Performance capped at 76 for exactly this).
  This is the honest gap: indexes are *present*, not *proven sufficient* under real cardinality.
- **Normalization — sound.** JSONB is used deliberately (`vitals`, `medications`, `staffAssigned`) with
  guard schemas (`jsonb-schemas.ts`) and a "never insert JSONB without `safeParse`" rule. `invoices.items`
  JSONB was correctly de-normalized into `invoice_items` (migration 0005).

---

## 10. Security Review

**This is the codebase's strongest dimension and it is not close.** Verified controls:

- **Authentication:** `jose` EdDSA (Ed25519) JWT, `kid` header, `jti` claim, `fph` fingerprint binding,
  HttpOnly `clinic_token` cookie, per-role TTL, JWKS endpoint. Fail-closed `verifyToken`.
- **Authorization:** `evaluate()` policy kernel (`lib/policy.ts`), method-based scopes (read→bounded
  fail-open per ADR-010, write/privileged→fail-closed), `super_admin` bypass centralized. SQL-level
  doctor scoping (`getDoctorPatientScope` + `inArray`). Break-glass read bypass wired at the DB layer
  (migration 0024 RLS clause), not in app code.
- **Input validation:** generated Zod at the route edge + business rules in services + JSONB guards.
- **Secrets handling — exemplary.** File-mounted Docker secrets (never `environment:` blocks),
  `minimumReleaseAge: 1440` supply-chain delay, CVE overrides pinned in `pnpm-workspace.yaml`, git
  history verified clean of committed secrets (07-01 audit), prod seed creds excluded (`a59f118`).
- **Permission boundaries:** RLS + `medicore_app` non-superuser role make tenant isolation
  DB-enforced. PHI field encryption (AES-256-GCM, keyed envelope with rotation). Audit-on-read.

**Vulnerabilities / weaknesses (honest, mostly Medium or lower):**
1. **`AUD-CMP-01` — audit-on-read is best-effort.** A PHI read still returns 200 even if the durable
   audit sink *and* its fallback fail. For HIPAA "every access is logged," that is a completeness gap.
   Deliberate (fire-and-forget to not block reads) but a real compliance risk — should be an explicit
   accepted-risk with an alert on fallback-sink failure, not silent.
2. **`AUD-SEC-07` — fingerprint/binding disable levers are unguarded.** `FINGERPRINT_BINDING=disabled`
   is a single env flip with no secondary guard/alert. Emergency lever, but no tripwire.
3. **Consent gate is service-layer only** (`AUD-CMP-03`) — not DB-enforced like tenancy. A new code
   path that forgets `hasActiveConsent` bypasses it. Consider a DB backstop or a lint check.
4. **`jti` replay defense is latent** — no production route calls `markJtiUsed` yet (ADR-007,
   deliberate). Not a bug, but the defense is dormant.

No Critical *code* vulnerabilities. The security posture is the reason a healthcare pilot is even
conceivable.

---

## 11. Testing Review

- **Unit + integration:** **61 backend test files**, of which **23 are real-Postgres
  `*.integration-db.test.ts`** (RLS isolation, cross-tenant, break-glass, erasure, audit append-only,
  appointment lifecycle). This RLS integration suite is a genuine strength — most teams never prove
  tenant isolation against a real engine.
- **Frontend:** 9 test files (route-access, i18n parity, Guard, print-XSS, CSRF) + **3 Playwright E2E
  specs** with MSW mocking (`AUD-FE-01`, landed `e31dd39`).
- **Coverage character:** excellent *targeted regression* (every past security bug has a test) but
  narrow *breadth*.

**Critical missing tests (honest):**
1. **No load / performance test** — hence Performance is unvalidated (§9). For a system claiming
   1,000-user scale, this is the biggest testing gap.
2. **No chaos / resilience test** — outbox drain failure, Redis outage, SSE drain under SIGTERM are
   coded carefully but never fault-injected.
3. **No mutation testing** — can't confirm the 61 files actually *catch* regressions vs merely execute.
4. **`docker compose up` smoke test does not exist** — the deployment is validated by `compose config
   -q` (syntax) only. This is the #1 overall risk (§12).
5. **Integration-db suite is Docker-gated** — on the 07-01 audit host Docker was down and the 54–120
   real-Postgres tests **did not run**; those controls were code-inspection-only that day. The suite's
   value is real but its *availability* is fragile.
6. **E2E is thin** (3 specs) and **no accessibility automation** (`AUD-FE-03`).

---

## 12. CI/CD Review

- **Build pipeline — mature.** `.github/workflows/ci.yml` (18.7 KB): typecheck → lint →
  `validate:errors` → test → audit → secrets-scan → build → migration-drift → ci-gate. Plus
  `codeql.yml`, `sbom.yml`, `security-scan.yml`, `security-dast.yml` (ZAP), weekly `audit-weekly.yml`.
  CODEOWNERS present.
- **Deployment — Docker Compose** (`docker-compose.prod.yml`, 44 KB): api + worker + Postgres +
  PgBouncer + Redis + Caddy + Prometheus + Alertmanager + Grafana + backup. Image-tagged for rollback
  (`API_IMAGE=registry/…:<sha>`).
- **Rollback — documented** (RUNBOOK §10: env-snapshot → flip image → `up -d --no-build`). Note:
  Drizzle has **no down migrations** — destructive migrations require roll-forward-hotfix or
  restore-from-backup. This is a real reliability ceiling (`AUD-SEAM-04`, the one remaining High-cap on
  Reliability).
- **Environment separation — clean** (`.env.example` / `.env.prod.example` / `.env.rehearsal`, secrets
  file-mounted).

**Risks:**
1. **`AUD-OPS-11` class — compose-contract drift.** Three deployment-blocking Criticals
   (`/api/health` vs `/api/healthz`, `scripts/` excluded from backup image, missing
   `postgresql-client`) lived in the committed prod compose until 2026-07-01, fixed in `c1941f1`. A
   `docker compose config -q` + route-existence CI gate (`compose-validate` job, `ci.yml:380-424`,
   blocking in `ci-gate`) was *already added* alongside that fix — this audit found and closed one real
   remaining hole in it (the worker's raw-http-listener healthcheck on port 5001 wasn't covered by the
   Express-route grep; see §13b F1). What still doesn't exist: **a live `docker compose up` +
   restore-drill smoke test.** The gate proves the compose file parses and every claimed route exists
   on paper; it cannot prove the stack actually reaches `healthy` state, because that needs a running
   Docker daemon this host doesn't have. **This remains the single most important open risk in the
   entire audit** — not because nothing was done about it, but because the one check that would
   actually retire it has never run.
2. **Roll-forward-only migrations** with no automated recovery from a non-idempotent cutover
   (`AUD-SEAM-04`).
3. **Features land via long-lived WIP branches** — the 182-file `security/search-doctor-scope` branch
   (now merged) and the current 7-file uncommitted doctor-schedule WIP. Large WIP = the merged whole is
   less CI-exercised than any single PR.

---

## 13. Technical Debt Report

| Priority | Item | Effort |
|---|---|---|
| **HIGH** | No `docker compose up` smoke test + no compose-contract CI gate (`AUD-OPS-11`). Deployment statically-correct, never executed. RTO/RPO unproven until a live restore drill runs. | **Medium** |
| **HIGH** | Roll-forward-only migrations, no automated cutover recovery (`AUD-SEAM-04`). | **Medium** |
| **HIGH** | No load / query-plan validation — Performance & index-sufficiency unproven at scale. | **Medium** |
| **MED** | Cross-module deep imports bypass barrel; `autoAdvanceVisit` is an undeclared 5-edge hub. | **Small–Med** |
| **MED** | Audit-on-read best-effort returns 200 on sink failure (HIPAA completeness). | **Small** |
| **MED** | `lib/scope.ts` authz logic in utility tier (layer placement). | **Small** |
| **MED** | Type-safety deliberately relaxed: `strictFunctionTypes` + `noUnusedLocals` OFF; **31 `as any`** in modules. Latent bug surface. | **Med** (if tightened) |
| **MED** | Integration-db suite Docker-gated → doesn't always run. | **Small** (local-PG fallback exists; wire to CI reliably) |
| **LOW** | Large view files (Schedule/Reports/PatientDetail/Inventory/Dashboard). | **Small each** |
| **LOW** | Nested `Clinic-Hub/Clinic-Hub` repo root. | **Small** |
| **LOW** | 7-file doctor-schedule WIP uncommitted. | **Small** |
| **LOW** | fph disable-lever unguarded; consent gate service-only; jti replay dormant. | **Small each** |

Overall debt is **low in the application core, concentrated at the deployment/operations boundary and
in test breadth** — exactly where a strong-code / unproven-ops system accumulates it.

---

## 13b. Every Finding → Suggested Solution (master table)

One row per distinct problem in this report, each with a concrete fix. Nothing is left without a
proposed solution.

| # | Finding (§) | Suggested solution | Risk of fix | Status |
|---|---|---|---|---|
| F1 | Deployment never run under Docker; no compose-contract gate (§12, `AUD-OPS-11`) | **Corrected during execution: the gate already existed** — `compose-validate` job (`ci.yml:380-424`, blocking in `ci-gate`) already runs `docker compose config -q` on both compose files plus a route-existence check for the api container's `/api/*` healthcheck. What it did NOT cover: the **worker's** healthcheck (port 5001, `req.url === "/healthz"` in a raw `http.createServer`, not an Express route — invisible to the router grep). Closed that gap (`ci.yml:399-441`, dry-run verified locally against the real compose files). The live `docker compose up` + restore drill is still genuinely outstanding — no Docker daemon on this host. | Low | ✅ Gap closed 2026-07-02; live smoke test still outstanding |
| F2 | Roll-forward-only migrations, no cutover recovery (§12, `AUD-SEAM-04`) | Document + script a "snapshot → migrate → verify → auto-restore-on-fail" cutover wrapper; require every destructive migration to ship a tested restore path. | Med (process + tooling) | Open |
| F3 | No load / query-plan validation (§9,§11) | Add k6 smoke against staging + `EXPLAIN (ANALYZE, BUFFERS)` on the top-10 queries in CI (thresholded). | Low (additive) | Open |
| F4 | Cross-module deep imports bypass barrel; `autoAdvanceVisit` = undeclared 5-edge hub (§3,§6) | Re-export `autoAdvanceVisit`/`hasActiveConsent`/`getActiveBreakGlassPatientIds` from module barrels; switch consumers to the barrel; add ESLint rule banning deep `modules/*/*.service` imports. | Low–Med (mechanical + one lint rule) | Open (Phase 2) |
| F5 | Audit-on-read best-effort returns 200 on sink failure (§10, `AUD-CMP-01`) | Emit a Prometheus counter + alert on read-audit fallback failure; document as an explicit accepted-risk in an ADR. (Do NOT make reads block — that trades HIPAA-completeness for availability.) | Low | ✅ Fixed 2026-07-02 |
| F6 | `lib/scope.ts` authz logic in utility tier (§3,§8) | Move to `modules/authz/` (new domain module) OR add a one-line comment declaring it kernel-tier authz; pick one and stop leaving it "debatable." | Low | Open (Phase 2) |
| F7 | Type-safety relaxed: `strictFunctionTypes`/`noUnusedLocals` OFF; 31 `as any` in modules (§13) | Turn on `noUnusedLocals` first (cheap, high signal); triage the 31 `as any` (many are `db.execute` result shims — wrap in a typed helper); defer `strictFunctionTypes` (larger blast radius). | Med (compile churn) | Open |
| F8 | Integration-db suite Docker-gated → doesn't always run (§11) | Wire the documented local-Postgres fallback (`INTEGRATION_PG_ADMIN_URL`) as a CI service container so the suite runs every push, not only when Docker is present. | Low | Open |
| F9 | ~~5 raw `fetch()` in pages~~ — **retracted, false positive** (§4,§7) | Original grep matched `refetch(` as a substring of `fetch(`. Re-verified with a word-boundary pattern: **zero** raw fetch in `pages/**`; the CI guard already covers both `fetch("/api/…")` and `fetch(apiUrl(…))`. The only 2 raw `fetch()` calls in the frontend live in `hooks/auth.tsx` (session bootstrap + logout) and are justified — see §7. No fix needed. | — | Retracted 2026-07-02 (no action taken) |
| F10 | Large view files (Schedule/Reports/PatientDetail/Inventory/Dashboard) (§5) | Extract sub-sections into `components/` on next touch; no rewrite. Schedule already started (`components/schedule/`). | Low | Open |
| F11 | Nested `Clinic-Hub/Clinic-Hub` root (§2) | Flatten up one level — **but as its own dedicated change**, not batched: rewrite CI paths, Docker build contexts/`COPY`, `pnpm-workspace` globs, `backups`/`storage` symlinks, `.claude` project path; verify build+CI green before/after. | **Med–High** (touches every path; highest-risk item in the report) | Open (deliberately deferred) |
| F12 | 7-file doctor-schedule WIP uncommitted (§12) | Land it as a small reviewable PR (or stash) before mixing with other tree changes. | Low | Open (Mike's active WIP — left untouched) |
| F13 | fph disable-lever unguarded (§10, `AUD-SEC-07`) | Require a second signal (e.g. a break-glass-style justification env + alert) to disable fingerprint binding; alert whenever it's off. | Low | Open |
| F14 | Consent gate service-layer only (§10, `AUD-CMP-03`) | Add a DB backstop (trigger/constraint) or a lint check asserting `hasActiveConsent` precedes clinical writes; keeps a forgotten code path from bypassing consent. | Med | Open |
| F15 | `jti` replay defense dormant (§10, ADR-007) | Leave as-is (deliberate per ADR) OR wire `markJtiUsed` on the privileged routes it was designed for; document which. | Low | Open (deliberate, per ADR-007) |

---

## 14. Refactoring Roadmap

### Phase 1 — Quick wins, genuinely low risk ✅ Executed 2026-07-02
- **F1** — the `docker compose config -q` + route-existence CI gate already existed; closed the one
  real gap in it (worker's port-5001 healthcheck wasn't covered — see §13b).
- **F9** — **retracted during execution**: re-verification showed zero raw `fetch()` in `pages/**`
  (the original finding was a grep substring bug); no code change needed.
- **F5** — Prometheus counter + alert on audit read-fallback-sink failure.

> **Pulled OUT of Phase 1 (was mislabeled low-risk):** flattening `Clinic-Hub/Clinic-Hub` (F11) is
> **Med–High risk** — it rewrites every path, build context, and symlink in the repo. Left as its own
> dedicated, separately-verified change, not bundled with the safe quick wins.

### Phase 2 — Structural improvements (1–2 weeks)
- **Make cross-module edges barrel-honest.** Re-export `autoAdvanceVisit`, `hasActiveConsent`,
  `getActiveBreakGlassPatientIds` from their module barrels; change consumers to import the barrel; add
  an ESLint rule banning deep `modules/*/*.service` imports. *Reasoning: the fence the docs promise must
  be the fence the code uses, or coupling stays invisible.*
- **Move `lib/scope.ts` into a `modules/authz/` (or `security/`) domain home**, or explicitly document
  it as kernel. Pick one; stop leaving it "debatable."
- **Split the 5 large view pages** into `components/` sub-parts (Schedule already in progress).
- **Land the doctor-schedule WIP** in a reviewable PR; stop carrying features in the working tree.

### Phase 3 — Architecture modernization (optional, weeks)
- **Introduce a tiny in-process domain-event bus** to invert `autoAdvanceVisit` (producers emit
  `payment.completed` / `diagnostics.ready`; the visit workflow subscribes). *Reasoning: removes the
  5→1 hub coupling entirely. But it adds eventual-consistency semantics to a ~20-user flow — do this
  only if the hub's blast radius actually bites. Barrel-honesty (Phase 2) may be enough.*
- **Add load + query-plan validation** (k6 + `EXPLAIN ANALYZE` on the top 10 queries) to convert
  Performance from "designed-fast" to "proven-fast."

### Phase 4 — Long-term scalability (on real signals only)
- **Read replica** for reporting/analytics when Prometheus shows read contention.
- **Shard by `clinic_id` (Citus)** only at very large tenant counts.
- **Move SSE replay buffer to Redis** before running many API replicas.
- *Reasoning: all three are well-signposted and none bite at single-hospital/few-clinic scale — do not
  pre-build them.*

---

## 15. Recommended Target Structure

**The repo already matches the ideal — do not restructure.** The only change worth making is
*flattening the nested root* and *making the module public surface honest*:

```
medicore/                         ← flattened (was Clinic-Hub/Clinic-Hub)
  apps/
    api/                          ← was artifacts/api-server
      src/modules/<feature>/      ← routes + service + index (unchanged; add barrel re-exports of
                                    cross-module service fns so the fence is real)
      src/lib/                    ← kernel; MOVE scope.ts → modules/authz OR label as kernel
      src/middlewares/  worker.ts  cron.ts
    web/                          ← was artifacts/clinic
      src/{pages,components,hooks,lib}  (split the 5 large pages)
  packages/                       ← was lib/
    api-spec/  api-zod/  api-client-react/  db/
  infrastructure/                 ← group root sprawl (compose, monitoring, caddy, pgbouncer)
  docs/  scripts/
```

**Why this is better (and why it's a light touch):**
- `apps/` + `packages/` is the conventional pnpm-monorepo idiom — new hires recognize it instantly;
  `artifacts/` + top-level `lib/` (colliding with `api-server/src/lib/`) is idiosyncratic.
- Flattening kills the `Clinic-Hub/Clinic-Hub` trap.
- Grouping infra under `infrastructure/` de-clutters the root (cosmetic but real for onboarding).
- **Everything else stays** — the module template, the enforced boundaries, the contract-first codegen,
  the RLS/audit kernel. This codebase does not need an architecture change; it needs its existing
  architecture made *honest at the seams* and *proven at the deployment boundary.*

**Bottom line for the 20-engineer/10-year test:** a new engineer *can* understand one feature module in
~30 minutes (rigid template + `CLAUDE.md`). Understanding the *cross-cutting kernel* (policy, RLS
tenant-context, break-glass GUC, audit outbox+chain) takes longer — but that is essential, not
accidental, complexity, and it is documented by ADRs that still match the code. The maintainability
risk over 10 years is not the code style; it is (1) whether the deployment is ever actually exercised,
and (2) whether the enforced-boundary discipline survives contributor turnover. The CI gates are what
protect (2); extend them to cover the deployment contract and this codebase ages well.

---

*Audit conducted 2026-07-02 against working tree `security/search-doctor-scope` (HEAD `55e31df`),
independent of and cross-checked against `ARCHITECTURE_AUDIT_2026-06-29.md` and
`docs/audit/ENGINEERING_AUDIT_2026-07-01.md`. Phase 1 remediation (F1, F5, F9) executed same date —
see CHANGELOG.md.*
