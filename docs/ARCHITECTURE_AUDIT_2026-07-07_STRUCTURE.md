# MediCore — Structure-Level Architecture Review (2026-07-07)

**Scope:** folder/file structure of the repo at `Clinic-Hub/Clinic-Hub/` (branch with billing Phase A–D work, HEAD `056d0d0`). Every claim below is derived from the tree as it exists today; where a claim needed file content to verify, that file was read and is cited. Claims that could not be verified from structure alone are marked with a confidence level. This is the fourth+ audit of this codebase (2026-06-29, 07-01, 07-02 precede it); nothing here is copied from those reports.

---

## 1. Overall Architecture

**Style: modular monolith in a contract-first pnpm monorepo.** Evidence:

- **Backend** (`artifacts/api-server`): Express 5 app with 12 feature modules under `src/modules/` (audit, billing, clinical, compliance, health, identity, imaging, inventory, notifications, operations, reporting, search), each co-locating `*.routes.ts` + `*.service.ts` behind an `index.ts` barrel. Cross-cutting infrastructure in `src/lib/` (auth kernel, audit chain, encryption, metrics, tracing) and `src/middlewares/`. A single route registry (`src/routes/index.ts`) mounts all module routers at `/api`.
- **Contract-first spine**: `lib/api-spec/openapi.yaml` → orval-generated `lib/api-client-react` (typed React Query client) + `lib/api-zod` (server-side request validation). One spec drives both sides of the wire. This is the strongest single structural decision in the repo.
- **Data layer**: `lib/db` as a workspace package — one Drizzle schema file per table (36 files), 44 SQL migrations, `tenant-context.ts` (RLS enforcement), `uuid-v7.ts`. The DB is a package boundary, not an app-internal folder.
- **Process topology**: `index.ts` (API), `worker.ts` (background jobs), `cron.ts` (schedules) — separate entry points, one codebase. Pluggable runtime stores (`src/lib/runtime/` with `memory/` and `redis/` implementations behind interfaces) let one binary run dev and prod.
- **Frontend** (`artifacts/clinic`): React 19 SPA, layer-based (pages/components/hooks/lib), *not* feature-modular — the one place the architecture is asymmetric with the backend.

It is not Clean Architecture (no ports/adapters ceremony, services call Drizzle directly), not DDD-with-aggregates, not microservices — and correctly so for a clinic system built by a small team. The 2026-06-29 module migration (documented in `docs/FOLDER_STRUCTURE.md`) moved the backend from layer-based to feature-based; the migration is visibly ~95% complete (see §3).

**Rating: 8.5/10.** The backend module structure, contract pipeline, and DB package are principal-grade. Deductions: frontend never got the same modularization, module boundaries are convention-only (no import-boundary lint between modules), and the monorepo carries template residue (§6).

---

## 2. Folder Structure — folder-by-folder

| Folder | Purpose | Verdict |
|---|---|---|
| `artifacts/` | Application packages (api-server, clinic) | **Rename to `apps/`.** "Artifacts" universally means *build outputs* — every new engineer will misread it. Likely Nx-template residue (`.gitignore` still references nx-rules; root package is named `workspace`; catalog pins React "because expo requires it" with no Expo app present). |
| `artifacts/api-server/` | Express API | Good internally. `storage/` (PHI imaging uploads) lives inside the package dir — gitignored, but see §13 OneDrive finding. |
| `artifacts/clinic/` | React SPA | Package name "clinic" vs product name "MediCore" vs repo name "Clinic-Hub" — three names for one product (§6). Internals need feature grouping (§9). |
| `lib/` | Workspace libraries (db, api-spec, api-client-react, api-zod) | Correct and well-factored. Conventionally `packages/`, but `lib/` is defensible. Generated code committed under `src/generated/` — acceptable **if** CI gates codegen drift (could not verify a codegen-drift job exists; `migration-drift` does — add the analogue. Confidence: medium that it's missing). |
| `scripts/` | Ops + dev scripts | Grab-bag of `.sh`, `.ps1`, `.mjs`, `.js`, `.ts` + its own package.json. Works, but `backup.sh`/`backup-verify.mjs`/`preflight-prod.mjs` are *operational* scripts and `dev-smoke.ps1`/`seed.ts` are *dev* scripts — split or subfolder when it grows. |
| `docs/` | ADRs, runbook, audits, security | Excellent content, poor hygiene: **11 audit/finding files loose in `docs/` root** plus a separate `docs/audit/` tree with appendices. Two competing audit locations. Consolidate to `docs/audits/YYYY-MM-DD-*/`. |
| `monitoring/` | Prometheus/Grafana/Alertmanager/blackbox as code | Exemplary. Rarely seen committed and CI-validated (`monitoring-config` job). |
| `caddy/`, `pgbouncer/`, root `nginx.conf` | Infra configs | All three are live (verified: compose prod uses caddy for TLS edge, nginx serves the SPA container, pgbouncer pools). But they're scattered: two in folders, one at root. Group under `infra/`. |
| `secrets/` | Secret material mount point | Correct pattern: contains only `.gitignore` + `README.md`. |
| `.github/workflows/` | CI/CD | 6 workflows: ci (13 jobs), codeql, security-dast (+`.zap/rules.tsv`), security-scan, sbom, audit-weekly. Top-decile security automation. |
| `.claude/` | AI-assistant config, **committed** | Polluted: `agents/` contains `vault-migrator`, `slack-archaeologist`, `people-profiler`, `obsidian-*` skills — personal tooling with zero relation to a clinic system, now part of the repo every engineer clones. Keep project-relevant commands (`RATING_PANEL`, `rate-*`, review agents are arguably project tooling); evict the personal vault/Slack material. |
| `backups/`, `storage/` (root) | Runtime data, gitignored | Should not live in the working tree at all given the sync situation (§13). `medicore-local/` in the user home dir suggests a half-completed relocation. |
| Root files | compose ×2, Dockerfile ×2, nginx.conf, prometheus-alerts.yml, tsconfigs, env examples | Functional but root is crowded (19 files). `Dockerfile`/`Dockerfile.clinic` belong in their app dirs; `prometheus-alerts.yml` belongs in `monitoring/prometheus/`. |
| **Missing** | Root `README.md` | **No README at repo root.** `docs/LOCAL_DEV.md` and `docs/HANDOFF.md` exist, but the front door is missing. First file any engineer, auditor, or acquirer looks for. |

**Structural meta-issue:** the repo root is nested — `Clinic-Hub/Clinic-Hub/`. The outer folder holds nothing but the inner repo. Flagged in the 07-02 audit, still present.

---

## 3. Separation of Concerns

**Done well:** routes vs services split inside every module; authorization centralized in a policy kernel (`lib/policy.ts`) rather than scattered per-route; runtime stores behind interfaces (`lib/runtime/{memory,redis}/`); tenant isolation pushed down into the DB package (`lib/db/src/tenant-context.ts`) and enforced by ESLint `no-restricted-imports` guards (verified present in `eslint.config.mjs`); audit logging isolated in `lib/audit*.ts` with an outbox.

**Violations found:**

1. **`src/services/` is a half-dead layer.** After the 2026-06-29 module migration, three files remain: `errors.ts`, `email.service.ts`, `sms.service.ts`. The folder name now lies — it holds shared infra, not services. Worse, there are **two `errors.ts` files**: `src/errors.ts` (error-code map) and `src/services/errors.ts` (error classes). Verified distinct-but-coupled (the second imports the first). Every new engineer will import the wrong one at least once. Fix: `src/errors.ts` + `src/services/errors.ts` → `src/lib/errors/` (codes + classes together); `email/sms.service.ts` → `src/lib/` or a `modules/messaging` module; delete `src/services/`.
2. **Backend `src/lib/` is drifting toward a god-folder**: 30+ flat files spanning auth (7 files), audit (5), crypto/keys (3), observability (3), domain helpers (schedule-validator, appointment-state-machine, money). The `runtime/` subfolder proves the team knows how to group; apply it: `lib/auth/`, `lib/audit/`, `lib/crypto/`, `lib/observability/`.
3. **Frontend business logic lives in `lib/` as a flat pile**: `appointment-flow.ts`, `clearance.ts`, `route-access.ts` are domain logic; `print.ts`, `reportTemplates.ts` are rendering; `utils.ts` is the classic dumping ground. Not wrong per se, but with no feature folders, page → lib → component dependencies are invisible (§9).
4. **Hooks folder hosts providers**: `hooks/auth.tsx` and `hooks/i18n.tsx` are context providers, not hooks. Misfiled; belongs in `providers/` or a feature module.

No circular-dependency or DB-in-controller smells visible at structure level. The route registry comments ("router.use() positions unchanged") show ordering is load-bearing and hand-maintained — acceptable, but a known fragility.

---

## 4. Scalability

**To 1M users / high load — structurally ready, unusually so:** PgBouncer transaction pooling (`pgbouncer/`), partitioned `audit_logs` (migration 0021, monthly to 2036), Redis-backed rate/revocation/cache/event stores, SSE fan-out via the Redis event bus (so multiple API replicas can serve SSE), cursor pagination (per ADR history), `load-test.js` exists. The single-writer Postgres is the eventual ceiling; that's the correct ceiling for this domain. **Bottleneck to verify at deploy, not in structure:** the 07-02 audit's finding that the full prod compose had never been run end-to-end. Structure can't prove that's fixed.

**To 50 developers — holds with two fixes:** (a) module boundaries are convention-only; nothing stops `modules/billing` importing `modules/clinical/patients.service.ts` directly, bypassing the barrel. At 5 devs, review catches it; at 50 it will tangle. Add `eslint-plugin-boundaries` or extend the existing `no-restricted-imports` blocks (the pattern is already proven in this repo for db imports). (b) The frontend has no ownership seams at all — 37 flat pages means every team touches the same folders.

**To 100 developers — no.** A single Express app + single SPA can't shard ownership that far regardless of folder shape. But that is the wrong target for a clinic-management product; don't design for it.

---

## 5. Maintainability

**Strengths:** `docs/FOLDER_STRUCTURE.md` (annotated tree with per-file one-liners — rare and excellent), ADRs with numbered decisions, RUNBOOK, incident write-up (`incident_2026_06_15_...md`), CHANGELOG, HANDOFF. A new senior engineer could self-orient in a day, which is top-decile.

**Risks:**
- **Doc drift is already happening**: `FOLDER_STRUCTURE.md` still lists the pre-migration `services/` inventory with a "MIGRATED" banner and duplicate stale entries (`auth.service.ts` listed twice). Hand-maintained trees rot; either regenerate it in CI or trim it to the annotated top two levels.
- **Audit sprawl**: 11 `AUDIT_*`/`ARCHITECTURE_AUDIT_*` files loose in `docs/` root + `docs/audit/` + `SECURITY_REPORT_2.0.md` + `AUDIT_REPORT.md`. No index, no naming convention (`AUDIT_FINDINGS_2026-06-03_PHASE1` vs `ENGINEERING_AUDIT_2026-07-01`). Which findings are open? Unanswerable from structure. One `docs/audits/` folder + an `INDEX.md` with open/closed status.
- **Deep nesting: none.** Max depth is sane everywhere (4 levels in src).
- **Large folders:** frontend `pages/` (37), `components/` (37), backend `lib/` (30), `tests/` (60 flat files — acceptable for tests, borderline).

---

## 6. Naming

- **`artifacts/` → `apps/`** — the single worst name in the repo (§2).
- **Three product names**: repo `Clinic-Hub`, docs/product `MediCore`, frontend package `clinic`, root package `workspace`. Pick MediCore, rename the rest incrementally (repo rename is cheap; package renames touch imports — do `workspace` → `medicore` scope only if appetite exists).
- **Migration names are a coin flip**: hand-written ones are descriptive (`0021_audit_logs_partition.sql`, `0026_audit_logs_append_only.sql`); drizzle-kit autonames are Marvel noise (`0042_late_typhoid_mary.sql`, `0030_unknown_the_leader.sql`) — zero information at exactly the moment (incident, 2 a.m.) migration names matter. Policy: rename autogenerated slugs before merge (`drizzle-kit generate --name`).
- **Case inconsistency, middlewares**: `asyncHandler.ts`, `correlationId.ts`, `rateLimiter.ts` (camelCase) vs `auth-gate.ts`, `login-shield.ts`, `step-up.ts`, `device-scope.ts` (kebab). Same folder, two conventions — visibly two eras. Standardize on kebab (majority in `lib/`).
- **Case inconsistency, hooks**: `use-idle-timeout.ts` vs `useDoctorSchedule.ts` vs `useUrlSync.ts`. Same problem.
- **Vague names**: `TweaksPanel.tsx` + `useTweaks.ts` — unguessable responsibility; `operations` module — plausibly "clinic operations" but collides with the DevOps sense of the word.
- **Good names worth noting**: `login-shield`, `break-glass`, `clearance-gate`, `audit-outbox-fallback` — self-documenting, domain-true.

---

## 7. Modularity

- **Backend: 12 modules, right-sized.** `clinical` is the biggest (8 route/service pairs) and is the one candidate for a future split (scheduling vs records), but not yet. `imaging` correctly separate from `clinical`. `billing` gained `clearance.service.ts`, `payments.*`, `invoice-number.ts` — cohesive.
- **Libraries: clean dependency direction** — apps depend on `lib/*`, never the reverse; `api-client-react`/`api-zod` are generated leaves.
- **Missing boundary enforcement** between modules (§4) — the one structural gap.
- **Frontend: no modules at all.** The obvious partition already exists in the page names: front-desk (FrontDeskCheckin/Dashboard, Triage), doctor (DoctorConsult/Inbox/Orders/Dashboard/Analytics), nursing (NurseVitals/Dashboard), imaging (XRay, Ultrasound, ImagingDashboard), billing (Billing, BillingDashboard, Reconciliation, ServicePrices), compliance (ComplianceDashboard, AuditLog), identity (Login, VerifyDevice, AccountDevices, Users, UserProfile). The backend taxonomy maps ~1:1 — reuse it.
- **Nothing to merge.** No over-fragmentation found.

---

## 8. Backend Review — 9/10

Checklist against the requested inventory (structure-verified):

| Concern | Present as | Notes |
|---|---|---|
| Controllers/Routes | `modules/*/**.routes.ts` + registry | ✔ |
| Services | `modules/*/**.service.ts` | ✔ |
| Repositories | **Absent — deliberate.** Services use Drizzle directly | Acceptable: Drizzle *is* the typed data-mapper; a repo layer would add ceremony. The RLS/tenant-context wrapper provides the safety a repo layer usually smuggles in. Documented trade-off — fine. |
| Models/Entities | `lib/db/src/schema/*` (36 tables, one file each) | ✔ Exemplary |
| DTOs/Validation | Generated Zod (`@workspace/api-zod`) + `middlewares/validate.ts` | ✔ Contract-first; validate-don't-transform |
| Middlewares | 12, incl. envelope, correlationId, step-up, login-shield | ✔ |
| Config | `lib/config.ts` + env examples | ✔ |
| AuthN/AuthZ | `lib/auth*.ts`, `lib/policy.ts` kernel, JWKS, device trust | ✔ Unusually strong |
| Logging | Pino + PHI redaction (`lib/logger.ts`) | ✔ |
| Caching | `runtime/cache-service` (memory/redis) | ✔ |
| Queue/Jobs/Workers | audit outbox + `worker.ts` + `cron.ts` | ✔ No general-purpose queue — fine at this scale |
| Events | `runtime/event-bus` | ✔ |
| Storage/Uploads | `lib/imaging-storage.ts` + `middlewares/imaging-upload.ts` + quota tests | ✔ |
| Email/SMS | `services/email.service.ts`, `sms.service.ts` | ✔ but misplaced (§3) |
| API versioning | **None** — mounted at bare `/api` (verified `app.ts:143`) | Low risk: single first-party SPA client, lockstep deploy, envelope + error-code registry give evolution room. Don't add `/v1` ceremony now; write the one-paragraph ADR saying why. |
| Errors | `errors.ts` code map + `validate-errors.ts` CI check | ✔ but split across two files (§3) |
| Guards/Policies | `auth-gate`, `device-scope`, `step-up`, `policy.ts` | ✔ |

Deductions: the `services/` residue + dual `errors.ts`, flat `lib/`, and version-policy-by-omission. Everything else is genuinely production-grade.

---

## 9. Frontend Review — 6.5/10

**Present and good:** lazy loading (verified: 36 `lazy` references in `App.tsx`), route protection (`lib/route-access.ts` + `Guard` + contract test asserting parity with backend policy — best-practice), i18n EN/AR with parity tests, MSW mocks, shadcn primitives quarantined in `components/ui/` with Bayan design system on top, print/report templates with XSS regression tests.

**Structural debts:**
1. **37 flat pages + 37 flat components** with only `schedule/` and `ui/` as subfolders. `components/schedule/` proves the team already felt the pain once. Everything about a feature (page, components, hooks, lib logic) is scattered across four folders — feature changes touch all of them.
2. **No `features/` layer** despite a backend that's fully feature-modular. Asymmetry: a full-stack change to billing touches `modules/billing/` (one folder) on the server and `pages/ + components/ + lib/ + hooks/` (four folders) on the client.
3. **Providers misfiled in `hooks/`** (§3).
4. **State management**: React Query via generated client — correct choice, no store needed; not a gap.
5. **Forms/validation**: no `forms/` dir; `lib/api-zod` schemas exist in the workspace but whether the client reuses them is unverifiable from structure (confidence: low). If not, client and server validate divergently — worth one check.
6. **Assets**: `public/` only; fine for an internal SPA.

Rating reflects: everything present works and is tested, but the organization is a scaling liability the backend already solved for itself.

---

## 10. Shared Code

- `artifacts/clinic/src/lib/utils.ts` — the canonical dump file. Audit its exports; most likely belongs in `datetime.ts`/feature files.
- Backend `lib/` — god-folder trajectory (§3), but every file has a crisp single responsibility; this is a grouping problem, not a design problem.
- `lib/` workspace packages — genuinely reusable, correctly extracted, no "shared kitchen sink" package exists. Good restraint: no premature `lib/common`.

---

## 11. Configuration — top-decile

- **pnpm workspace**: catalog for version alignment; `minimumReleaseAge: 1440` supply-chain gate (rare, excellent); CVE-annotated overrides with reasoning comments; `preinstall` guard forcing pnpm; `engines` pinned; `packageManager` field.
- **Residue to clean**: React pinned to exactly 19.1.0 "because expo requires it" — **there is no Expo app in this workspace**. Stale constraint that will silently block React upgrades. Same for the `@expo/ngrok-bin` override block. Delete both after a grep confirms no expo usage.
- **TypeScript**: `tsconfig.base.json` + project references (`tsc --build` for libs) — correct monorepo setup.
- **Docker**: dev + prod compose; prod has health-gated dependencies and digest-pinned images with a CI guard (commit `88f7b37`). Dockerfiles at root instead of per-app (minor).
- **CI**: 13-job pipeline with `ci-gate` fan-in, `migration-drift`, `integration-db` (real Postgres), `monitoring-config`, `compose-validate`, `secrets-scan`. Missing: codegen-drift gate for `lib/*/src/generated` (confidence medium), and no visible CD/deploy workflow — deploys appear manual (consistent with the "never run end-to-end" risk).

---

## 12. Documentation — 9/10

Present: ADRs (11), RUNBOOK, SECURITY.md, LOCAL_DEV (env setup), HANDOFF (onboarding), CHANGELOG, ROADMAP, MIGRATION_NOTES, key-management docs ×2, ENUM_GOVERNANCE, incident report, OpenAPI spec as API docs, CODEOWNERS.

Missing/broken: **root README** (the only serious gap), CONTRIBUTING/coding standards as a repo doc (conventions live in `.claude/CLAUDE.md`, invisible to non-AI-assisted contributors — extract to `docs/CONVENTIONS.md`), ADR numbering gaps (001 → 005 → 007…; if 002–004 were rejected, record that), audit-doc sprawl (§5).

---

## 13. Security

Structure-visible controls, unusually complete: policy kernel, step-up auth, device trust + fingerprinting, JWKS/EdDSA, CSRF cookie module, CSP + report-uri + retention, rate limiting + login shield, field-level encryption + key provider + PHI field registry, RLS with dedicated non-bypass DB role and ESLint import guards, append-only audit with hash chain + integrity verification + outbox + fallback, break-glass with approval + audit, consent, erasure, secrets/ hygiene, gitleaks-style CI, DAST, CodeQL, SBOM, weekly dependency audit, supply-chain release-age gate. Nothing on the requested checklist is structurally absent.

**The one critical security finding is environmental, not code:**

🔴 **The repo — including gitignored PHI-adjacent material — lives inside a OneDrive-synced folder** (`C:\Users\xxmoh\OneDrive\Desktop\Clinic-Hub\Clinic-Hub`). `.gitignore` correctly excludes `.env`, `.env.rehearsal`, `secrets/` content, `backups/` (marked "contain PHI"), and `storage/` (imaging uploads, marked PHI) **from git** — but every one of those files syncs to a personal Microsoft cloud account anyway. That defeats the entire carefully-built secrets/PHI hygiene layer: real credentials in `.env`, DB dumps, and encrypted-at-rest-but-key-adjacent imaging files replicate off-machine with no BAA, no audit trail, plus OneDrive's known habit of corrupting `.git` and `node_modules` under sync churn. The existence of `~/medicore-local/{backups,storage}` suggests a relocation was started and not finished — `backups/` and `storage/` still exist inside the repo tree.
**Fix (do this first, it costs an afternoon):** move the working tree to a non-synced path (e.g. `C:\dev\medicore`), keep OneDrive for documents only; point `BACKUP_DIR`/`IMAGING_STORAGE_DIR` at `~/medicore-local`; rotate any secret that has ever existed in `.env` under OneDrive; collapse the `Clinic-Hub/Clinic-Hub` nesting in the same move.

---

## 14. Testing — 8.5/10

- **Backend**: 60 test files, three tiers cleanly separated by vitest config: unit, `.integration.test.ts` (app-level), `.integration-db.test.ts` (real Postgres — cross-tenant, RLS, append-only, atomicity). Adversarial naming throughout (`clinic-id-default-leak`, `users.service.privesc`, `pooled-connection-tenant-isolation`) — these are tests written by someone hunting bugs, not padding coverage.
- **Contract tests on both sides** (`contract-routes.test.ts` server, `route-access.contract.test.ts` both) — closes the FE/BE authz-parity gap found in the Phase-7 audit.
- **Helpers**: `tests/_helpers/` (realDb, seedCrossTenant, expectDbError). No factories dir; seeding is ad hoc — acceptable now, will be the first test-infra complaint at 10 devs.
- **Frontend**: 10 targeted test files incl. XSS regressions (print, discharge sheet) and i18n parity.
- **E2E: the weak tier.** 3 Playwright specs (login, appointment, billing) against 37 pages and ~10 roles. The clinical core (consult → orders → results → prescription) has no E2E path. Given how much of this system is role-gated workflow, 3 specs is thin.
- Flat `tests/` folder at 60 files: consider mirroring `modules/` subfolders.

---

## 15. Deployment Readiness

Present: dev + prod compose, health checks (health module + compose `service_healthy` gating + blackbox probes), digest-pinned images + CI guard, Caddy auto-TLS edge, nginx SPA container, PgBouncer, full monitoring stack as code with alert rules + CI validation, `ServiceDown` alert, backup + `backup-verify.mjs --restore` drill, `preflight-prod.mjs`, `gen-secrets.ps1`, `load-test.js`, rollback procedure (per RUNBOOK), env separation (`.env.example` / `.env.prod.example` / `.env.rehearsal`).

Gaps: no CD pipeline (manual deploy); and the standing finding from 07-02 that the prod stack had never been executed end-to-end — the compose/monitoring CI jobs validate *syntax*, not *runtime*. Until one full `docker-compose.prod.yml` rehearsal is on record, deployment readiness is "engineered" but not "demonstrated." Structure cannot confirm this happened; treat as open.

---

## 16. Code Smells Visible From Structure

1. `src/services/` half-dead layer + dual `errors.ts` (§3) — migration residue.
2. Backend `lib/` 30-file flat folder (§3).
3. Frontend layer-scatter (§9).
4. Docs audit sprawl, two audit locations (§5).
5. `.claude/` personal-tooling pollution (§2).
6. Stale Expo pins in the catalog (§11).
7. Marvel migration names (§6).
8. Drizzle `meta/` snapshot gaps (0010–0017, 0020–0021, 0024–0026, 0028 missing) — hand-written SQL migrations bypass drizzle-kit's snapshot chain. The `migration-drift` CI job mitigates; still, confirm `drizzle-kit generate` produces sane diffs from snapshot 0043, or the next autogenerated migration may try to re-create hand-made objects.
9. `FOLDER_STRUCTURE.md` drift (stale duplicate entries) (§5).
10. Nested `Clinic-Hub/Clinic-Hub` root.
11. **Not found** (and looked for): god modules, circular structure, dead feature folders, over-engineering. The `runtime/` abstraction is the closest to "extra machinery" and it pays rent (dev/prod parity).

---

## 17. Missing Engineering Practices

Genuinely missing (most requested practices are present — see §8/§11 tables):
- **Import-boundary enforcement between modules** (highest-leverage gap; the repo already has the ESLint pattern).
- **Codegen-drift CI gate** for generated client/zod (confidence medium).
- **Feature-flag system**: individual env flags exist (device-trust flag-OFF per docs); no registry/convention doc. Cheap: a `flags.ts` with typed accessors.
- **Frontend feature modules** (§9).
- **CD / deploy automation** (§15).
- **Test data factories** (§14).
- **DI container**: absent; module-level singletons + the runtime seam serve the purpose. Not a gap worth a framework — noted only because the checklist asks.

---

## 18. Refactoring Plan (priority-ordered)

| # | Pri | Action | Cost |
|---|---|---|---|
| 1 | 🔴 | Move repo out of OneDrive to `C:\dev\medicore`; collapse nested root; point backups/storage at `~/medicore-local`; rotate `.env` secrets | ½ day |
| 2 | 🔴 | Full `docker-compose.prod.yml` end-to-end rehearsal (standing item); record it in RUNBOOK | 1 day |
| 3 | 🟠 | Root `README.md`: what/stack/quickstart/links to docs | 1 h |
| 4 | 🟠 | Kill `src/services/`: merge error files into `lib/errors/`, relocate email/sms; update FOLDER_STRUCTURE.md | ½ day |
| 5 | 🟠 | ESLint module-boundary rules (modules import each other via barrels only; `lib/` never imports `modules/`) | ½ day |
| 6 | 🟠 | Rename `artifacts/` → `apps/` (workspace glob, tsconfig paths, CI paths, docs) — mechanical, do while team is small | ½ day |
| 7 | 🟡 | Frontend `features/` migration, one feature per PR starting with billing or schedule (schedule components already grouped) | 1–2 days/feature, incremental |
| 8 | 🟡 | Consolidate `docs/audits/` + INDEX.md with open/closed status | 2 h |
| 9 | 🟡 | Purge `.claude/` personal agents/skills; keep project tooling | 1 h |
| 10 | 🟡 | Migration-name policy (`drizzle-kit generate --name`); verify snapshot chain sanity | 2 h |
| 11 | 🟡 | Remove Expo pins/overrides; unpin React to `^19.x` | 1 h + CI run |
| 12 | 🟢 | Naming sweep: kebab-case middlewares/hooks; rename TweaksPanel | 2 h |
| 13 | 🟢 | Move Dockerfiles into app dirs; `infra/` for caddy/nginx/pgbouncer; prometheus-alerts.yml → monitoring/ | 2 h |
| 14 | 🟢 | E2E specs for doctor consult flow + role-denial paths | ongoing |
| 15 | 🟢 | Codegen-drift CI job; `docs/CONVENTIONS.md` extracted from `.claude/CLAUDE.md` | 2 h |

---

## 19. Improved Folder Tree (target state)

```
medicore/                          # was Clinic-Hub/Clinic-Hub — un-nested, out of OneDrive
├── README.md                      # NEW — front door
├── apps/                          # was artifacts/
│   ├── api/                       # was api-server
│   │   ├── Dockerfile             # moved from root
│   │   └── src/
│   │       ├── app.ts / index.ts / worker.ts / cron.ts
│   │       ├── lib/
│   │       │   ├── auth/          # auth.ts, auth-constants, jwt-secret, policy, password, device-fingerprint, fingerprint-lever
│   │       │   ├── audit/         # audit, audit-integrity, audit-outbox-fallback, audit-snapshot, break-glass-audit
│   │       │   ├── crypto/        # field-encryption, key-provider, phi-fields
│   │       │   ├── errors/        # error codes + classes (merged from src/errors.ts + services/errors.ts)
│   │       │   ├── messaging/     # email.service, sms.service (from services/)
│   │       │   ├── observability/ # logger, metrics, tracer
│   │       │   └── runtime/       # unchanged (already the model to copy)
│   │       ├── middlewares/       # unchanged, kebab-case normalized
│   │       ├── modules/           # unchanged — this layout is correct
│   │       └── tests/             # optionally mirrored by module
│   └── web/                       # was clinic
│       ├── Dockerfile             # was Dockerfile.clinic
│       └── src/
│           ├── app/               # App.tsx, router, providers (auth, i18n moved from hooks/)
│           ├── features/          # NEW — mirrors backend modules
│           │   ├── billing/       # pages + components + hooks + logic for billing
│           │   ├── clinical/ …    # schedule/ components move here first
│           ├── components/        # ONLY cross-feature (DataTable, StatusBadge, ui/)
│           ├── hooks/             # ONLY cross-feature hooks
│           └── lib/               # ONLY cross-feature utils (datetime, ids, api)
├── lib/                           # workspace packages — unchanged (db, api-spec, api-client-react, api-zod)
├── infra/                         # NEW grouping
│   ├── caddy/  nginx/  pgbouncer/
│   └── monitoring/                # moved; prometheus-alerts.yml joins it
├── scripts/                       # ops/ + dev/ subfolders when it grows
├── docs/
│   ├── audits/                    # ALL audit files + INDEX.md (open/closed)
│   ├── adr/
│   └── CONVENTIONS.md             # NEW — extracted from .claude/CLAUDE.md
├── docker-compose.yml / docker-compose.prod.yml
└── (runtime data — backups/, storage/ — lives OUTSIDE the tree in ~/medicore-local)
```

---

## 20. Architecture Scorecard

| Category | Score | One-line justification |
|---|---|---|
| Architecture | 8.5 | Modular monolith + contract-first spine; frontend asymmetry |
| Folder Structure | 7 | Backend excellent; `artifacts/` misnomer, root clutter, nesting |
| Backend | 9 | Feature modules, policy kernel, runtime seam; services/ residue |
| Frontend | 6.5 | Everything works and is tested; layer-scatter at 37 pages |
| Scalability | 8 | PgBouncer, partitioning, Redis stores, SSE fan-out ready |
| Maintainability | 8 | Superb docs, but doc drift + audit sprawl already visible |
| Readability | 8 | Self-documenting names, annotated tree; naming-case drift |
| Security | 9.5 | Best-in-class structure; the OneDrive finding is environmental |
| Testing | 8.5 | Adversarial 3-tier suite + dual contract tests; E2E thin |
| Documentation | 9 | ADRs/RUNBOOK/incidents; no root README |
| Deployment | 7.5 | Fully engineered; end-to-end prod rehearsal still unproven |
| Developer Experience | 7.5 | One-command dev, catalogs, smoke script; no README front door |
| Modularity | 7.5 | Backend 9, frontend 5, no boundary enforcement |
| Consistency | 7 | Two naming eras visible in middlewares/hooks/migrations |
| Production Readiness | 8 | Blocked only by items #1–2 of the plan |
| **Overall** | **8** | |

---

## 21. Executive Summary

**Biggest strengths:** the contract-first pipeline (one OpenAPI spec generating both the typed client and server validation); the backend feature-module layout with a centralized policy kernel; a security/compliance structure (RLS + dedicated DB role + append-only hash-chained audit + break-glass + erasure + field encryption) that exceeds what most funded health-tech startups ship; an adversarial three-tier test suite with contract tests on both sides; monitoring and supply-chain defenses as reviewed code.

**Biggest weaknesses:** the frontend never received the modularization the backend got in June — it is a layer-scattered SPA at 37 flat pages; module boundaries exist by convention only; naming carries visible residue from two eras and an abandoned template (`artifacts/`, Expo pins, Marvel migrations); documentation is excellent but already drifting and sprawling.

**Highest-risk issues:** (1) the repo and its gitignored secrets/PHI-adjacent files sit inside a personal OneDrive sync — an environmental hole under a very well-built application security posture; (2) the production compose stack remains unproven end-to-end as far as structure can show; (3) E2E coverage of 3 specs for a 10-role clinical workflow system.

**Technical debt estimate:** low for the codebase class — roughly **2–3 engineer-weeks** to clear every item in §18 through #13. The debt is concentrated in organization and residue, not in design. No load-bearing rewrite is needed anywhere.

**Production approval:** **conditional yes** — conditions: item #1 (OneDrive/secrets relocation + rotation, ½ day) and item #2 (one recorded end-to-end prod rehearsal). Both are days, not months. I would not sign off with PHI-adjacent files syncing to a personal cloud, full stop.

**20+ engineer team approval:** yes, contingent on the boundary-enforcement lint (#5), frontend feature migration underway (#7), and README/CONVENTIONS (#3, #15) — without those, onboarding friction and cross-team file contention arrive around engineer 8–10.

**Top 10 ROI improvements:** 1) OneDrive exit + secret rotation; 2) prod rehearsal; 3) root README; 4) module-boundary ESLint; 5) kill `services/` + merge errors; 6) `artifacts/` → `apps/`; 7) frontend `features/` (start with schedule — its components are already grouped); 8) audit-doc consolidation + index; 9) migration naming policy; 10) E2E for the clinical happy path.

**Confidence notes:** claims about file contents were verified by reading (`routes/index.ts`, `app.ts` mount, eslint guards, compose proxy usage, `App.tsx` lazy loading, error-file duplication, workspace/config files). Claims marked medium/low confidence: absence of a codegen-drift CI job, client-side reuse of Zod schemas, current status of the prod-rehearsal finding. These three are one grep/one CI-log check each — verify before acting on them.
