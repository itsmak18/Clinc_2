# MediCore Improvement Plan — 2026-07-08

**Source:** every finding in `ARCHITECTURE_AUDIT_2026-07-07_STRUCTURE.md`. Nothing dropped, nothing added.
**Shape:** 7 phases. Path-churn work (relocation, renames) is front-loaded so later refactors don't re-touch moved files. Every item carries acceptance criteria and a regression guard — a fix without a guard is a fix that comes back.
**Net effort:** ~2–3 engineer-weeks of hands-on work, ~6 calendar weeks part-time.

**Dependency spine:** 0.0 → 0.1 → everything. 2.3 (boundary lint) before Phase 4 (features migration) so new structure is enforced as it lands. 3.1 (`apps/` rename) before Phase 4 so feature moves don't churn twice.

---

## Phase 0 — Blockers (week 1) 🔴

### 0.0 Land in-flight work
59 modified files sit uncommitted on `security/search-doctor-scope` (billing Phases A–D). Nothing else starts until this is committed, CI-green, and pushed to both remotes (`origin`, `gitsafe-backup`). Relocation with a dirty tree risks losing work; refactors mixed into a security branch poison its review.

- **Steps:** finish/commit the billing work as its own PR(s); push; merge or park.
- **Acceptance:** `git status` clean; CI green on the branch.

### 0.1 OneDrive exit + un-nest (audit F-1, part 1)
- **Steps:**
  1. Push all branches to both remotes (backup before touching anything).
  2. `git clone https://github.com/itsmak18/Clinc_2.git C:\dev\medicore` — fresh clone collapses the `Clinic-Hub/Clinic-Hub` nesting for free; re-add the `gitsafe-backup` remote.
  3. Copy untracked runtime/secret files explicitly from the old tree: `.env`, `.env.rehearsal`, `secrets/` contents. Do **not** copy `backups/` and `storage/` into the new tree — move them into `~/medicore-local/` (already exists) and set `BACKUP_DIR` / `IMAGING_STORAGE_DIR` in `.env` to point there.
  4. Verify at the new path: `pnpm install`, `pnpm test`, `pnpm --filter clinic test`, dev stack boots via `start-dev.ps1`.
  5. Delete the old OneDrive tree. Then purge OneDrive's recycle bin and version history for that folder — OneDrive keeps deleted-file copies; deletion alone does not remove the cloud replica.
  6. Update any absolute paths (IDE workspaces, Claude Code project dir, scheduled tasks).
- **Acceptance:** repo at `C:\dev\medicore`, tests green, no repo content under any synced folder, `~/medicore-local` holds runtime data.
- **Guard:** none possible in CI — add a RUNBOOK §0 note: "working trees never live under synced folders."

### 0.2 Secret rotation (audit F-1, part 2)
Assume every value that ever sat in `.env` under OneDrive is exposed. This is a security-sensitive sequence — follow it in order; two of these keys can destroy data if rotated carelessly.

1. **Inventory** the old `.env` / `.env.rehearsal` / `secrets/` — list every credential.
2. **Cheap rotations first:** `SESSION_SECRET` (forces staff re-login — acceptable), Postgres passwords (bootstrap superuser + `medicore_app` + PgBouncer `userlist`), Redis password, Grafana admin, Alertmanager webhook tokens, metrics bearer token, SMTP/SMS credentials if real.
3. **`FIELD_ENCRYPTION_KEY` — dangerous rotation.** Losing the old key bricks every encrypted PHI field (per `FIELD_ENCRYPTION_KEY_MANAGEMENT.md`). Follow that document's rotation procedure exactly: introduce new key, re-encrypt all rows, verify decryption of a sample under the new key, **only then** retire the old key. Rehearse on a restored backup copy first. Keep the old key in escrow until the re-encryption is verified in production.
4. **GPG backup keypair:** per `BACKUP_KEY_MANAGEMENT.md` the private key lives offline-only. Verify it never existed inside the OneDrive tree (search old tree + OneDrive history). If only the public key was present: no rotation needed. If the private key was ever there: generate a new keypair, re-encrypt retained backups, re-escrow.
- **Acceptance:** written rotation log (which secret, when, verified how); app healthy under all new credentials; PHI sample decrypts.
- **Guard:** the existing `secrets-scan` CI job; secrets/README updated with rotation dates.

### 0.3 Prod rehearsal end-to-end (audit F-2)
Closes the standing "engineered but never demonstrated" finding, and the pending Phase-6 alert runtime-verify.

- **Steps:** on a clean host/VM: `gen-secrets`, `preflight-prod.mjs`, `docker compose -f docker-compose.prod.yml up`; verify migrate runs as bootstrap role and api/worker connect as `medicore_app`; hit health endpoints through Caddy; fire a test alert end-to-end (Prometheus → Alertmanager → receiver); run `backup.sh` then `backup-verify.mjs --restore` (proves the restore drill incl. tenant-table read); run `load-test.js` smoke.
- **Acceptance:** rehearsal log with command output committed as `docs/audits/PROD_REHEARSAL_2026-07.md`; every RUNBOOK section executed at least once.
- **Guard:** RUNBOOK quarterly-drill cadence (see 6.3 for the automated reminder).

---

## Phase 1 — Hygiene quick wins (week 1–2, all parallelizable) 🟠

| # | Item | Steps | Acceptance | Guard |
|---|---|---|---|---|
| 1.1 | **Root README.md** | Product summary, stack, architecture sketch, quickstart (`pnpm install` → compose up → `pnpm dev`), links: LOCAL_DEV, HANDOFF, RUNBOOK, SECURITY, audits index, ADRs | A new machine bootstraps using README alone | Review checklist |
| 1.2 | **docs/CONVENTIONS.md** | Extract from `.claude/CLAUDE.md`: Bayan-not-shadcn rule, logical Tailwind props, `runInTenantContext`/`dbUnsafe` rules, error-code registry, naming standards (kebab-case files, migration naming), commit style | Conventions readable without AI tooling | Linked from README; ESLint enforces the mechanical ones |
| 1.3 | **docs/audits/ consolidation** | Move 11 loose `AUDIT_*`/`ARCHITECTURE_AUDIT_*`/`SECURITY_REPORT*` files + `docs/audit/*` → `docs/audits/`; write `INDEX.md`: one row per audit, per-finding open/closed status; grep-fix inbound links | Single audit location; INDEX answers "what's open?" | INDEX updated as part of any future audit PR (note in CONVENTIONS) |
| 1.4 | **.claude/ purge** | Delete personal agents/skills (vault-*, slack-archaeologist, people-profiler, obsidian-*, qmd, defuddle, json-canvas); keep project tooling (rate-*, review-*, RATING_PANEL, context-loader if project-scoped) | Repo `.claude/` contains only MediCore-relevant tooling | Review |
| 1.5 | **Catalog cleanup** | Remove Expo comments + `@expo/ngrok-bin` override block from `pnpm-workspace.yaml`; relax `react`/`react-dom` pins to `^19.1.0`; `pnpm install`; full CI | Lockfile updated; CI green; no expo references (`grep -ri expo` clean except lockfile) | none needed — one-time |
| 1.6 | **Migration naming + snapshot sanity** | Adopt `drizzle-kit generate --name <slug>` (document in CONVENTIONS); run a no-op `drizzle-kit generate` — expected result: empty diff against snapshot 0043. If it wants to re-create hand-migrated objects (snapshots 0010–17, 0020–21, 0024–26, 0028 are missing), reconcile snapshots **before** the next real schema change | No-op generate produces no migration | `migration-drift` CI job (verify it covers this case; extend if not) |
| 1.7 | **Verify audit confidence flags** | (a) grep ci.yml for a codegen regen+diff step — if absent, add job: run orval → `git diff --exit-code lib/api-client-react/src/generated lib/api-zod/src/generated`; (b) grep `artifacts/clinic/src` for `@workspace/api-zod` — if unused, either adopt in form validation or write a one-paragraph ADR "client trusts server validation, here's why"; (c) flag 3 closed by 0.3 | All three flags resolved with evidence | (a) becomes a permanent CI gate |

---

## Phase 2 — Backend structure (week 2) 🟠

### 2.1 Kill `src/services/` + merge the two `errors.ts`
- **Steps:** create `src/lib/errors/` — `codes.ts` (from `src/errors.ts`), `classes.ts` (from `src/services/errors.ts`), barrel `index.ts`. Move `email.service.ts`, `sms.service.ts` → `src/lib/messaging/`. Delete `src/services/`. Update: all imports (mechanical find/replace), `package.json` lint script paths, `eslint.config.mjs` path-scoped blocks, `validate-errors.ts` import, `FOLDER_STRUCTURE.md`.
- **Acceptance:** `src/services/` gone; typecheck + lint + full test suite green; `validate:errors` passes.
- **Guard:** ESLint path rules updated so old paths can't silently return.

### 2.2 Group backend `lib/` (30 flat files → domains)
- **Layout:** `lib/auth/` (auth, auth-constants, jwt-secret, policy, password, device-fingerprint, fingerprint-lever), `lib/audit/` (audit, audit-integrity, audit-outbox-fallback, audit-snapshot, break-glass-audit), `lib/crypto/` (field-encryption, key-provider, phi-fields), `lib/observability/` (logger, metrics, tracer), `lib/errors/` + `lib/messaging/` (from 2.1), `runtime/` unchanged. Domain helpers (appointment-state-machine, schedule-validator, money, scope, dateUtils, validators, jsonb-schemas) stay flat or gain `lib/domain/` — pick one, document it.
- **One mechanical PR**, no logic changes. **Acceptance:** tests green, `git diff --stat` shows only moves + import lines.
- **Guard:** none needed beyond CI; grouping is self-sustaining once CONVENTIONS documents it.

### 2.3 Module-boundary ESLint (prerequisite for Phase 4 and team growth)
- **Rules** (extend existing `no-restricted-imports` blocks — the pattern is already proven for the db guard):
  1. Code outside `modules/<x>/` may import `modules/<x>` **only via its barrel** (`modules/<x>/index.ts`), never deep paths.
  2. `src/lib/**` must never import from `src/modules/**` (infra stays below features).
- **Acceptance:** a synthetic deep-import fails lint locally; then remove it.
- **Guard:** the rule *is* the guard — this makes the module structure non-regressable.

### 2.4 Middleware naming normalization
`asyncHandler.ts` → `async-handler.ts`, `correlationId.ts` → `correlation-id.ts`, `rateLimiter.ts` → `rate-limiter.ts`. Mechanical rename + import fix. Record kebab-case-for-files rule in CONVENTIONS.

### 2.5 (Optional 🟢) Mirror `tests/` by module — defer unless the flat 60-file folder starts hurting; churn outweighs value today.

---

## Phase 3 — Monorepo renames + infra grouping (week 3) 🟠

### 3.1 `artifacts/` → `apps/`
Minimum-churn scope: rename the **folder only**; keep package names (`@workspace/api-server`, `clinic`) so no import in source code changes.
- **Touch list (complete):** `pnpm-workspace.yaml` glob; root `package.json` `--filter "./artifacts/**"`; `tsconfig.json`/`tsconfig.base.json` paths + references; `.github/workflows/*` path filters and job working-directories; `CODEOWNERS`; `Dockerfile`/`Dockerfile.clinic` COPY paths; both compose files' build contexts; `lib/api-spec/orval.config.ts` if it references app paths; `FOLDER_STRUCTURE.md`; `start-dev.ps1`; `scripts/dev-smoke.ps1`.
- **Acceptance:** CI fully green **and** both docker images build (`compose-validate` isn't enough — run the builds).
- **Guard:** CI path filters now reference `apps/` — a stale `artifacts/` path anywhere fails visibly.

### 3.2 Infra grouping
- Move `Dockerfile` → `apps/api-server/`, `Dockerfile.clinic` → `apps/clinic/`; `nginx.conf` → alongside `Dockerfile.clinic` (it's the SPA container's config); `caddy/`, `pgbouncer/` → `infra/`; `prometheus-alerts.yml` → `monitoring/prometheus/`.
- Keep `monitoring/` top-level (the `monitoring-config` CI job and compose mounts reference it; moving it buys nothing).
- Update compose volume mounts + build contexts + CI job paths.
- **Acceptance:** `docker compose config` clean for both files; monitoring-config job green; prod stack boots (piggyback on a 0.3 re-run if timing allows).

### 3.3 Naming unification
- Rename GitHub repo `Clinc_2` → `medicore` (GitHub redirects old URLs; update `gitsafe-backup` mirror config + local remotes).
- Local folder already `C:\dev\medicore` from 0.1.
- `@workspace/*` → `@medicore/*` scope rename: **defer indefinitely** 🟢 — touches every import for zero functional value. Record the decision in INDEX so future audits stop flagging it.

---

## Phase 4 — Frontend feature modularization (weeks 3–5, one PR per feature) 🟡

### 4.0 Scaffold + rules first
- `src/app/`: `App.tsx`, router, `providers/` (move `hooks/auth.tsx`, `hooks/i18n.tsx` — they are providers, not hooks).
- `src/features/<name>/{pages,components,hooks,lib}/` — name features after the backend modules (the taxonomies map ~1:1).
- ESLint boundary rules for the frontend (same pattern as 2.3): features may import `components/`, `hooks/`, `lib/` (shared) and other features **only via their barrel**; shared folders never import features.
- Document the recipe in CONVENTIONS before the first move.

### 4.1 Migration order (risk-ascending; each PR: move files, rewrite imports, zero logic change)
1. **schedule** — `components/schedule/*` already grouped; + `Schedule.tsx`, `useDoctorSchedule`, `DayScheduleView`/`ScheduleDayView` (merge-or-rename these two while there — near-duplicate names).
2. **identity** — Login, VerifyDevice, ForgotPassword, AccountDevices, UserProfile, Users, use-idle-timeout, useSessionTimeout.
3. **billing** — Billing, BillingDashboard, Reconciliation, ServicePrices + ClearanceChip, OverrideClearanceDialog + `lib/clearance.ts`. (After in-flight billing work lands — avoid churning an active area.)
4. **imaging** — XRay, Ultrasound, ImagingDashboard, ImageUploader, DiagnosticResultDialog.
5. **clinical** (biggest — may split into 2 PRs) — Patients, PatientDetail, Appointments, MedicalRecords, Prescriptions, Lab, Triage, NurseVitals, DoctorConsult/Inbox/Orders + patient components + `lib/appointment-flow.ts`.
6. **compliance** — ComplianceDashboard, AuditLog, ErasurePanel, PatientConsentCard, BreakGlass*, ChangeHistory, `lib/auditDiff.ts`.
7. **dashboards/reporting** — role dashboards, DoctorAnalytics, Reports, Metric, Sparkline.
8. **inventory / operations / search / notifications** — small remainders.
- Normalize hook filenames to `use-kebab-case.ts` as each moves.
- Residual `components/` = cross-feature only (DataTable, StatusBadge, StatusStepper, SearchSelect, ui/); residual `lib/` = api.ts, datetime, ids, constants, route-access, print/reportTemplates (or → a `printing` feature); audit `utils.ts` exports and redistribute.
- **Acceptance per PR:** typecheck, all frontend tests green, route-access contract test untouched and green, lazy-loading preserved (spot-check bundle chunks), no route path changes.
- **Guard:** the 4.0 ESLint rules — structure can't regress once enforced.

---

## Phase 5 — Test depth (weeks 4–6, parallel with Phase 4) 🟡

| # | Item | Detail | Acceptance |
|---|---|---|---|
| 5.1 | **E2E clinical path** | New Playwright specs: full happy path (front-desk check-in → nurse vitals → doctor consult → lab/imaging order → result entry → prescription → billing clearance → payment); role-denial spec (sample the 10-role × route matrix at the browser level — the unit matrix exists, browser-level does not); device-verification/step-up flow | ~8–10 specs total; e2e CI job green; clinical path covered end-to-end |
| 5.2 | **Test factories** | `src/tests/_factories/` — patient/user/appointment/invoice builders on top of `seedCrossTenant` patterns; refactor 2–3 existing integration-db tests onto them to prove the API | New tests default to factories (CONVENTIONS note) |
| 5.3 | **Per-feature FE smoke tests** | As each Phase-4 feature lands: render + guard test per feature (pattern exists in `Guard.test.tsx`) | Each feature PR includes its smoke test |
| 5.4 | (Optional 🟢) **Coverage ratchet** | Vitest coverage thresholds pinned at current levels — prevents silent decay; don't chase a number | CI fails if coverage drops |

---

## Phase 6 — Delivery + ops automation (week 6) 🟡

| # | Item | Detail | Acceptance / Guard |
|---|---|---|---|
| 6.1 | **CD pipeline** | `deploy.yml` on `workflow_dispatch` + tag: build both images, push to GHCR with digests, SSH to host → `docker compose pull && up -d` → run `preflight-prod.mjs` + health check; rollback = redeploy previous tag (procedure already in RUNBOOK) | One-command deploy executed once for real; RUNBOOK updated |
| 6.2 | **Feature-flag registry** | `src/lib/flags.ts`: typed accessors over env vars; migrate existing flags (device-trust flag-OFF); log flag states at boot | Grep finds no ad-hoc `process.env.FLAG_*` outside flags.ts (add ESLint restricted-import/pattern if cheap) |
| 6.3 | **Ops cadence automation** | GitHub Actions cron: quarterly → opens issue "run restore drill (RUNBOOK §12)"; `audit-weekly` failure → opens issue instead of silent red | Issues appear on schedule |
| 6.4 | **ADR: API versioning stance** | One page: single first-party client, lockstep deploy, envelope + stable error codes = evolution room; no `/v1` until a second client exists | ADR merged; future audits stop flagging it |

---

## Explicit non-goals (decided, not forgotten)

- **No repository layer** — Drizzle + tenant-context wrapper is the data boundary; adding repos is ceremony.
- **No `/v1` URL versioning now** — see 6.4 ADR.
- **No `@workspace` → `@medicore` scope rename** — churn ≫ value.
- **No `clinical` module split** — right-sized until it grows past ~12 route/service pairs.
- **No microservices / no design for 100 devs** — wrong target for this product.
- **No DI container** — module singletons + runtime seam already provide the seam that matters.

---

## Sequence and effort summary

| Phase | Window | Effort | Blocking? |
|---|---|---|---|
| 0.0 land in-flight billing | week 1 | done when CI green | blocks all |
| 0.1 OneDrive exit | week 1 | ½ day | blocks all path work |
| 0.2 secret rotation | week 1 | ½–1 day (+ FIELD key re-encrypt rehearsal) | production sign-off blocker |
| 0.3 prod rehearsal | week 1–2 | 1 day | production sign-off blocker |
| 1.1–1.7 hygiene | week 1–2 | 1–1½ days total, parallel | no |
| 2.1–2.4 backend structure | week 2 | 1½ days | 2.3 blocks Phase 4 |
| 3.1–3.3 renames + infra | week 3 | 1 day | 3.1 before Phase 4 |
| 4.x frontend features | weeks 3–5 | ~1–2 days/feature, 8 PRs | no — incremental |
| 5.x test depth | weeks 4–6 | ~3 days spread | no |
| 6.x delivery/ops | week 6 | 1–1½ days | no |

**Definition of done for the whole plan:** audits INDEX shows every 2026-07-07 finding closed with a commit link; production deploy demonstrated; every structural fix backed by a CI/ESLint guard that makes regression fail loudly.
