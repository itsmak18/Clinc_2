# MediCore — Engineering Review Board Audit

**Date:** 2026-07-01 · **Branch:** `security/search-doctor-scope` · **HEAD:** `525ed2d`
**Method:** 7 independent specialist agents (Security, Database/RLS, DevOps/Infra/DR, Compliance/Privacy, Backend/API, Frontend/Testing, Resilience/Seams) reading the real implementation, validated by executing the test/build pipeline, then a Red Team disprove-pass with ADR re-validation. Evidence-first: every finding carries a `file:line` anchor; uncertainty is reported as uncertainty.

**Full per-finding evidence + Improvement-Engine blocks:** see `docs/audit/appendix/*.md`.

---

## 0. Reading this report

- **Scores are 0–100, higher = better.** Two hard rules were applied so a number can't launder a defect:
  - *Traceability:* any score < 80 names the finding dragging it down.
  - *Severity-ceiling:* a dimension with an unresolved **Critical caps at ≤ 40**, an unresolved **High at ≤ 65**, regardless of how good everything else is.
- **Docker was unavailable this run** (Docker Desktop daemon not running). Every claim that needs a live container/DB is labelled **NOT-EXECUTED / requires runtime validation** — never asserted as pass. The real-Postgres integration-db suite (≈54–120 tests) did **not** run; those controls were verified by code inspection only. This is the single largest caveat in the audit.
- **Two things were confirmed by executing the pipeline** (not by restating docs): the unit/build suite is green, twice (§17), and the git history carries no committed secrets (§13, `AUD-SEC-HIST`).
- **Critical *code* defects vs Critical *deployment* defects:** the application code has **no confirmed Critical**. Three Criticals live in the committed **deployment** artifact (`docker-compose.prod.yml`) — deterministic static facts (a route string that isn't defined; a file not copied into an image; a package not installed), where a runtime run would only *demonstrate* the already-certain failure. They are Critical because they block go-live and silently disable DR.

---

## 1. Executive Summary

> **This section is the 2026-07-01 point-in-time record.** As of 2026-07-02, everything it
> identifies as a blocker below is **fixed and committed** — see the updated verdict in §15, the
> recomputed scorecard in §2, and the sprint log in §18. Kept verbatim here rather than rewritten so
> the report still shows what was actually found, not a retrofitted version of events.

MediCore's **application-layer engineering is production-grade**: the auth kernel, multi-tenant RLS design, AES-256-GCM PHI encryption, append-only audit chain with daily integrity verification, break-glass, right-to-erasure, and billing atomicity are all implemented carefully and, where statically checkable, verified correct and fail-closed. The unit + build pipeline is green (538 API + 51 frontend tests).

**The system is nonetheless NOT ready to deploy as-is** — for a reason that has nothing to do with the application code and everything to do with **a production stack that has never been exercised under Docker**. Static analysis of the *committed* `docker-compose.prod.yml` surfaces **three independent, deployment-blocking defects** that would fail the very first `docker compose -f docker-compose.prod.yml up`:

1. **`AUD-OPS-01`** — the api/worker healthcheck probes `/api/health`, a route that does not exist (real route is `/api/healthz`). The container never becomes `healthy`, so `clinic`, `prometheus`, and `caddy` (all `depends_on: service_healthy`) never start. **The stack does not come up.**
2. **`AUD-OPS-02`** — the backup container runs `node scripts/backup-verify.mjs`, but `scripts/` is excluded from the image (`.dockerignore:37` + no `COPY`). **Backups never run.**
3. **`AUD-OPS-03`** — the backup container installs `gnupg openssh-client rsync` but **not** `postgresql-client`, so `pg_dump`/`psql` are absent. **Even a fixed script cannot dump or restore.**

All three are in the committed file, all three are trivially fixable (≈1 day total), and all three are *alarmable if monitoring is wired* — but they mean the stated RTO/RPO is currently fiction, because the backup job silently never produces a backup.

A fourth Critical is different in kind: **`AUD-DB-05` — cross-tenant isolation under PgBouncer transaction pooling is correct on inspection but not proven at runtime.** All four code-level prerequisites pass (real `BEGIN…COMMIT`, `SET LOCAL` not session `SET`, RLS fails closed when the GUC is missing, `DISCARD ALL` reset). The one thing code-reading cannot close — a two-tenant connection-reuse probe returning zero rows instead of the other tenant's data — could not run without Docker. It is reported as **"consistent-with-fine on inspection, never proven fine."**

**Bottom line:** a strong application behind an unproven deployment. Fix the three P0 compose defects, run the integration-db suite once under Docker to close `AUD-DB-05`, and MediCore is in good shape for a healthcare pilot. Until then, go-live would fail at `up`.

**Note on audit conduct (disclosed, not buried):** the specialist agents exceeded their read-only brief and *applied* five small, legitimate fixes during the run (PII-in-logs redaction, prod seed-credential exclusion, a monitoring-auth fix, a runbook section, a dev-dep bump). The owner elected to keep them; the mutated tree was **re-certified green** (typecheck + 538 + 51 + build). See §17.

---

## 2. Scorecard

**As originally scored (2026-07-01):** Overall 66 · Security 85 · Architecture 88 · Code Quality 84 ·
Performance 76 · Reliability 34 (Critical-capped) · Scalability 62 (High-equiv-capped) · Testing 58
(High-capped) · Documentation 88 · Compliance-readiness 60.

**Recomputed 2026-07-02** — per this report's own rules (§2 traceability: name the drag below 80;
severity-ceiling: an unresolved Critical caps ≤40, an unresolved High caps ≤65). A cap lifts only
when the triggering finding is actually resolved, not just "worked on":

| Dimension | Score | Ceiling applied? | Primary drag / note |
|---|---:|---|---|
| **Overall Production-Readiness** | **82** | — | All 4 Criticals + all 5 Highs fixed (§4/§5, §18). Not the full ~85 the original report projected — a live `docker compose up` still hasn't run (§15). |
| Security | 85 | no | `AUD-SEC-07` (Med) fingerprint disable-levers unguarded; kernel otherwise fail-closed & verified. (unchanged) |
| Architecture | 88 | no | Clean module boundaries, layered kernel, sound RLS design. (unchanged) |
| Code Quality | 84 | no | `AUD-API-02` (Med) `datetime.ts` tz in uncommitted WIP. (unchanged) |
| Performance | 76 | no | Good primitives (PgBouncer, partitioning, cursor pagination, caching); **no load/query-plan validation** — would move on runtime. (unchanged) |
| **Reliability** | **65** | **High cap** | Critical cap lifted — `AUD-OPS-01/02/03` fixed. Now capped by `AUD-SEAM-04` (unresolved High: roll-forward-only migrations, no automated recovery from a non-idempotent cutover). |
| **Scalability** | **85** | *removed* | `AUD-DB-05` is **proven**, not just designed-sound — cap lifted, matches the original report's own stated target. |
| **Testing** | **76** | *removed* | High cap lifted — `AUD-FE-01` E2E landed, integration-db ran repeatedly. Remaining drag: `AUD-FE-03` (Med, no accessibility automation) + still no load/chaos/mutation testing. |
| Documentation | 88 | no | ADRs, RUNBOOK, CLAUDE.md, HEALTH_STATUS extensive and accurate. (unchanged) |
| **Compliance-readiness** | **74** | no | Critical/High drag (`AUD-OPS-02/03` backups) resolved. Remaining drag: `AUD-CMP-01` (Med — audit-on-read still best-effort; a PHI read still returns 200 if the durable fallback sink itself also fails) + `AUD-CMP-03` (Med — consent gate service-layer only). |

**System risk is now diffuse, not concentrated:** every dimension sits at 65–88; no dimension is
severity-capped by an unresolved Critical, and only Reliability is High-capped (by `AUD-SEAM-04`,
itself a "no automated recovery path" design gap rather than a live defect).

---

## 3. Technical-Debt Assessment

Debt is **low in the application core** and **concentrated at the deployment boundary**:

- **Deployment/DR plumbing (highest debt):** the prod compose file has never been run; three defects prove it. Root cause is the absence of a `docker compose config` / route-existence CI gate (`AUD-OPS-11`) — nothing mechanically exercises the compose contract.
- **Test breadth (moderate debt):** excellent *targeted* regression coverage (CSRF, XSS, RBAC, i18n, RLS, append-only) but no E2E, no load, no chaos/mutation, and the integration-db suite depends on a Docker host that isn't always present.
- **Application core (minimal debt):** module boundaries enforced by ESLint + CI; billing is atomic; analytics N+1 already fixed; the auth/RLS/audit/encryption kernels are coherent and documented by ADRs that still match the code (§14).

---

## 4. Critical Findings (4)

> **Status update — 2026-07-02: all 4 FIXED.** See §18. `AUD-OPS-01/02/03` landed in `c1941f1`
> (healthcheck route, backup script bind-mount, `postgresql16-client`), validated via
> `docker compose ... config -q` + typecheck/build — the one thing still genuinely NOT-EXECUTED is
> an actual `docker compose up` smoke-test, since Docker has not been available on this host across
> any session this week (config-level validation is not the same claim as a live boot). `AUD-DB-05`
> is no longer "consistent-with-fine on inspection" — it is **PROVEN**: a real-Postgres integration
> test (local PG18, not Docker/postgres:16) forces `DB_POOL_MAX=1`, confirms the same physical
> connection is reused via `pg_backend_pid()`, and proves zero cross-tenant leak including the
> mid-transaction-rollback path.

| ID | Finding | Status | Fix effort |
|---|---|---|---|
| **AUD-OPS-01** | api/worker healthcheck probes non-existent `/api/health` (real: `/api/healthz`) → nothing downstream starts; **stack won't deploy**. Confirmed by route grep + mount-chain trace. | **FIXED** (`c1941f1`); `docker compose up` live smoke-test still NOT-EXECUTED (no Docker on this host) | 5 min (P0) |
| **AUD-OPS-02** | Backup container runs `scripts/backup-verify.mjs` but `scripts/` is excluded from the image (`.dockerignore:37` + no `COPY`) → module-not-found → **backups never run**. | **FIXED** (`c1941f1`) | 15 min (P0) |
| **AUD-OPS-03** | Backup container lacks `postgresql-client` → `pg_dump`/`psql` absent → **cannot dump or restore** even if OPS-02 is fixed. | **FIXED** (`c1941f1`) | incl. above (P0) |
| **AUD-DB-05** / SEAM-03 | Cross-tenant isolation under PgBouncer pooling: code-level (a)–(d) all verified; end-to-end connection-reuse probe **not run** (no Docker). Reported "consistent-with-fine on inspection, **not proven**." | **PROVEN** (`c1941f1`) — real-Postgres forced-reuse test, not a mock | 30 min to run integration-db under Docker |

OPS-02 + OPS-03 shipped together (a fixed script still fails at the dump step without the client). Exact diffs in `appendix/devops-infra-dr.md`.

---

## 5. High-Priority Findings (5)

| ID | Finding | Note |
|---|---|---|
| **AUD-SEAM-01** | ~~On an `audit_outbox` INSERT failure, an *ordinary* PHI read/write still completes **silently un-audited**~~ **FIXED 2026-07-02 — see §18.** | Durable local JSONL fallback sink added, mirroring break-glass. |
| **AUD-SEAM-04** | Roll-forward-only migrations; the 0021 partition cutover is non-idempotent on partial apply → manual cleanup/restore. | Mitigated: the ephemeral `migrate` container blocks api/worker start on failure (now documented — RUNBOOK §10.4, applied this run). |
| **AUD-OPS-04** | ~~Worker exposes no `/metrics` on `:5001`~~ **FIXED 2026-07-02 — see §18.** | Real `/healthz`+`/metrics` listener added to the worker + compose healthcheck. |
| **AUD-OPS-05** | ~~Blackbox TLS probe target is a placeholder~~ **FIXED 2026-07-02 — see §18.** | New `scripts/preflight-prod.mjs` go-live gate + RUNBOOK §10.5. |
| **AUD-FE-01** | ~~No E2E tests (no Playwright/Cypress)~~ **FIXED 2026-07-02 (`e31dd39`).** | Playwright + MSW harness + 3 specs (login/appointment/billing), advisory (non-blocking) CI job. **All 5 audit Highs now closed.** |

---

## 6. Medium-Priority Findings (15)

| ID | One-liner |
|---|---|
| AUD-SEC-07 | `FINGERPRINT_BINDING=disabled` / `FPH_GRANDFATHER_UNTIL` honored in prod with no NODE_ENV guard, no TTL, no metric/alert — an engaged lever silently disables fph verification. |
| AUD-CMP-01 | Audit-on-read is best-effort: a PHI read still returns 200 if the outbox write fails (pairs with SEAM-01). |
| AUD-CMP-02 | Asymmetric encryption — Arabic `diagnosisAr` (and Arabic clinical fields) stored **plaintext** while English `diagnosis` is AES-GCM encrypted. |
| AUD-CMP-03 | Treatment-consent gate is service-layer only (no DB backstop) → a future raw insert path bypasses it. |
| AUD-CMP-07 | RLS is dormant outside `runInTenantContext`; a bare-`db`/`dbUnsafe` read on a clinic table returns **all tenants'** plaintext PHI. Defense-in-depth gap (by design per ADR-008; ESLint guards it, but not absolutely). |
| AUD-COMP-01 (downgraded Crit→Med) | `getNurseDashboard`/`getPharmacistDashboard` return `patientId` rows **unaudited** (bounded, role-gated). Add `READ_LIST` audit. |
| AUD-API-02 | `datetime.ts getWeekStart` uses browser-local `getDay()` — possible wrong 7-day window for non-UTC clinics. Uncommitted WIP; no CI gate has seen it. |
| AUD-FE-02 | No frontend coverage threshold — FE tests could be deleted and CI stays green. |
| AUD-FE-03 | No accessibility automation (axe/jest-axe/Lighthouse). |
| AUD-OPS-06 | Observability + base images are tag-only (no `@sha256`); datastore/edge images are digest-pinned. No container-image scan wired. |
| AUD-OPS-07 | Backup/migrate `apk add` at container start → alpine-mirror/air-gapped outage breaks DR at the worst time. |
| AUD-OPS-08 | ~~Healthchecks assume `wget` exists in the minimal runtime image~~ **FIXED 2026-07-02 (`c1941f1`)** — folded into the OPS-01 healthcheck fix; api/worker probes now use Node's global `fetch`, no external binary. |
| AUD-OPS-09 | `backend` network `internal: false` → PHI-tier containers have open egress. Documented trade-off (Resend/HIBP). |
| AUD-SEAM-05 | ~~Outbox drain is insert-then-delete across two non-transactional statements~~ **FIXED & proven 2026-07-02 — see §18.** |
| AUD-SEAM-06a | Backup captures the DB dump and the imaging tar sequentially against a live volume → point-in-time skew / dangling references on restore. |

---

## 7. Low-Priority Findings (12)

`AUD-SEC-01` fph binds on client-mutable Accept-Language · `AUD-SEC-02` revocation fail-open on a process-global health timestamp (by ADR-010) · `AUD-SEC-03` CSRF origin check skipped when `Origin` absent (mitigated by double-submit + SameSite=Strict) · `AUD-SEC-04` field-encryption dev pass-through when key absent (prod fail-closed) · `AUD-CMP-05` log-redaction list omitted several identifiers — **FIXED this run** (§17) · `AUD-CMP-06` erasure blackout-window vs backup-retention mismatch · `AUD-FE-05` no mutation/load/chaos testing · `AUD-FE-07` `/account/devices` route unguarded (likely intentional — confirm & document) · `AUD-FE-08` lazy route-import failures not covered without E2E · `AUD-OPS-10` CODEOWNERS entirely commented out → no enforced review routing for the platform kernel · `AUD-OPS-11` no `compose-validate` CI job — would have caught all three P0s · `AUD-OPS-12` `RESTORE_DATABASE_URL` unset → restore proven only quarterly/manually.

---

## 8. Verified-Strong Positive Controls (do not regress)

Actively validated, not assumed:

- **Auth kernel (`policy.ts`)** — CSRF double-submit + timing-safe compare, token verify, revocation (write/privileged fail-closed), fingerprint, role, tenancy (`clinicId>0` fail-closed) all present and correctly ordered.
- **Tenant isolation** — `runInTenantContext` uses a real transaction + `SET LOCAL`; RLS policy fails closed on a missing GUC (`nullif(...)::int → NULL → no rows`); `medicore_app` is `NOSUPERUSER NOBYPASSRLS`; `DISCARD ALL` reset. (Runtime cross-tenant proof still owed — `AUD-DB-05`.)
- **CAS on status writes** — appointment transitions use `UPDATE … WHERE status = <expected>` → 0 rows → 409 (`appointments.service.ts:351-363`). The prior P0 is fixed.
- **Audit chain** — append-only enforced at the grant layer (0026) + auto-revoked on new partitions (0028); daily `verifyRecentIntegrity` + `verifyChainLinkage` (`cron.ts:153-180`).
- **AES-256-GCM field encryption** — prod fail-closed when the write key is absent; v1/v2 envelope + kid rotation.
- **Break-glass** — durable immediate audit (not via the lossy outbox), TTL, approval, read-only RLS bypass (0024).
- **Right-to-erasure** — scrubs every clinical table in one transaction.
- **Billing atomicity** — `createInvoice` is a single `runInTenantContext` transaction.
- **Secrets & container hardening** — file-mounted secrets (absent from `environment:`), no published DB/redis ports, read-only rootfs, cap-drop ALL, non-root, `stop_grace_period 35s > SHUTDOWN_TIMEOUT_MS`.
- **`AUD-SEAM-REVJTI` (ADR-007 × ADR-010 intersection)** — **documented-safe**: privileged scope fails **closed** on a revocation-store error *before* the read-scope grace window is reachable, so a revoked privileged token is never simultaneously un-revocable and un-replay-limited. No window exists.

---

## 9. False Positives Identified

- **`AUD-FE-04` (REJECTED)** — the Frontend agent read only the `build` job's `needs:` and concluded `frontend-test` might not gate merges. The DevOps agent independently confirmed `ci-gate` (`ci.yml:334-356`) lists `frontend-test` with an explicit success check. Frontend tests **are** gated. The divergence is a feature of the multi-agent method: the disagreement itself surfaced the incomplete read, resolved by direct file inspection, not by vote.

---

## 10. Findings Requiring Runtime Validation (Docker/DB needed)

**As of 2026-07-01 (original):** `AUD-DB-05`/SEAM-03 · `AUD-OPS-01/02/03` · `AUD-OPS-04` · `AUD-OPS-05` ·
`AUD-SEAM-01` · `AUD-SEAM-05` · `AUD-CMP-03` · `AUD-CMP-07` · the entire integration-db suite did not
execute.

**Updated 2026-07-02 — resolved by real (non-Docker) runtime proof:**
- `AUD-DB-05`/SEAM-03 — **PROVEN**, forced-connection-reuse test against local PG18.
- `AUD-OPS-04` — **PROVEN live**: the worker was actually started and its `/healthz` (200) +
  `/metrics` (200, new gauges present) + an unknown path (404) were curled directly.
- `AUD-SEAM-05` — **PROVEN**, forced-failure (`REVOKE DELETE`) test against real Postgres.
- Integration-db suite — **DID run**, repeatedly (127 tests in the final pass), on **local
  PostgreSQL 18 via `INTEGRATION_PG_ADMIN_URL`** — not Docker, not the CI's `postgres:16-alpine`.
  This is strong corroborating evidence, not a byte-identical substitute for the CI path.

**Still genuinely NOT-EXECUTED:**
- `AUD-OPS-01/02/03` — a live `docker compose -f docker-compose.prod.yml up` smoke-test (Docker has
  not been available on this host in any session). Config-level validation (`compose config -q`)
  and unit/build coverage are not the same claim as a boot.
- `AUD-OPS-05` — the preflight guard + RUNBOOK step are done and tested both ways, but there is no
  real production domain here to point the blackbox probe at, so `probe_ssl_earliest_cert_expiry`
  for a live edge has never actually been queried.
- `AUD-SEAM-01` — the durable-fallback *mechanism* is unit-proven, but the specific live scenario
  ("outbox-insert fault while a PHI op is mid-flight → does the read still return 200") was not
  separately re-run against a real fault injection.
- `AUD-CMP-03`, `AUD-CMP-07` — untouched since the original audit.

---

## 11. Findings Requiring Human Review / Disputed

- **Consent-gate coverage** on the vitals/lab/xray/ultrasound *creation* paths — neither Red Team pass traced this conclusively.
- **Erasure coverage drift** — whether `notifications` / `clinic_notices` can hold PHI that `executeErasure` misses.
- **DISPUTED — `AUD-SEAM-06b` vs `AUD-OPS-12`:** the Seams agent found the break-glass fallback JSONL sink mounted `:ro` into the backup container but claims the entrypoint only tars `/data/imaging`, never `/data/bg-audit` (→ lost if the DB is also lost). The DevOps agent read the `bg_audit_data` ro-mount as evidence it *is* captured. **Unresolved** — requires reading the backup entrypoint's tar invocation at runtime. Flagged, not silently reconciled.

---

## 12. Recommended Roadmap

> **Status update — 2026-07-02:** the "Immediate" and "Short-term" tiers below are **complete**
> except the one item Docker-unavailability still blocks (the live `docker compose up` smoke-test).
> `AUD-FE-01` (originally Medium-term) is also done. See §18. Remaining open items are relisted under
> **§12a Current remaining roadmap** below the original tiers, which are left as the point-in-time
> record.

**Immediate (0–7 days) — unblock deployment**
1. ~~Fix `AUD-OPS-01`~~ ✅ · ~~`AUD-OPS-02`~~ ✅ · ~~`AUD-OPS-03`~~ ✅ (`c1941f1`). `docker compose -f docker-compose.prod.yml up` smoke-test on staging — still pending (needs a Docker host).
2. ~~Run the integration-db suite~~ ✅ — ran repeatedly on local PG18 (not Docker); `AUD-DB-05` proven.
3. ~~Add a `compose-validate` CI job (`AUD-OPS-11`)~~ ✅ (`c1941f1`).
4. ~~Commit the five kept remediations (§17)~~ ✅ (`a59f118`).

**Short-term (30 days) — close alerting & audit-durability gaps**
~~`AUD-OPS-04` worker `/metrics`~~ ✅ · ~~`AUD-OPS-05` blackbox TLS go-live guard~~ ✅ (external cert
monitor is an operator action, not code — still a recommendation) · ~~`AUD-SEAM-01` durable local
fallback~~ ✅ · ~~`AUD-SEAM-05` transaction wrap~~ ✅ (all `b4478cd`) · `AUD-COMP-01` read-audit on
nurse/pharmacist dashboards — **open** · `AUD-CMP-03` consent DB backstop — **open** · `AUD-SEC-07`
fingerprint-lever gauge + alert — **open**.

**Medium-term (90 days) — breadth & compliance depth**
~~E2E layer (Playwright + MSW) closing `AUD-FE-01`~~ ✅ (`e31dd39`). Still open: accessibility
automation (`AUD-FE-03`); frontend coverage threshold (`AUD-FE-02`); encrypt Arabic clinical fields
(`AUD-CMP-02`); digest-pin all images + Trivy scan (`AUD-OPS-06`); bake ops tooling into an image
stage (`AUD-OPS-07`); first load/query-plan test (Performance).

**Long-term (6–12 months)**
Warm-standby/HA; lock down `backend` egress (`AUD-OPS-09`); KMS for the field-encryption DEK (currently a stub); automated weekly restore drill (`AUD-OPS-12`); chaos + mutation testing.

### 12a. Current remaining roadmap (2026-07-02)

With all 4 Criticals and all 5 Highs closed, what's actually left:
1. **`AUD-COMP-01`, `AUD-CMP-03`, `AUD-SEC-07`** — the 3 Mediums explicitly named in the original
   Short-term tier, never separately sprinted.
2. **`AUD-FE-03`, `AUD-FE-02`, `AUD-CMP-02`, `AUD-OPS-06`, `AUD-OPS-07`** — Medium-term breadth items.
3. **The one hard external dependency:** a live `docker compose up` on a real Docker host — closes
   the last runtime caveat on `AUD-OPS-01/02/03` and lets the full CI-path integration-db suite
   (postgres:16-alpine, not local PG18) run for the first time.
4. **`AUD-SEAM-06a`/`06b` disputed backup-coverage item** (§11) — needs a runtime read of the backup
   entrypoint, not code.
5. Long-term tier, unchanged.

---

## 13. Secrets & Git-History (grounded, not assumed)

`AUD-SEC-HIST` — **clean.** `git log --all --full-history` for real secret files (`.env`, `*.key`, `*.pem`, `backups/*`) returns **empty**; the only secret-path history hits were `.env.prod.example` (a template) and `secrets/README.md` (docs). `secrets/` is tracked but contains only `.gitignore` (default-deny) + `README.md`. Secrets are file-mounted at `/run/secrets/*` and absent from `environment:` (`AUD-OPS-13` PASS). The `.gitignore`-only check was *insufficient* (it reported "ignored" while history had touched those paths) — the history scan is what actually proved clean.

---

## 14. Method Integrity (Red Team + anti-consensus)

- **ADR re-validation (anti-laundering):** ADR-005 (audit retention), ADR-007 (jti latent, privileged-only), ADR-008 (RLS dormant + `medicore_app`), ADR-010 (revocation bounded fail-open) — **all four still match the code and their premises still hold.** No guardrail has drifted or gone stale.
- **Consensus-strength annotations:** `AUD-DB-05`+`AUD-SEAM-03` (pooling proof — **both now closed, see §4**) and `AUD-OPS-01`+`AUD-SEAM-04` (no-down-migration) were independent discoveries from different angles → counted **once** in scoring, not double-weighted. The `AUD-COMP-01`↔`AUD-API-08` overlap was flagged as *weak/false* corroboration.
- **Divergence worked:** the `AUD-FE-04` false positive was caught precisely because two agents disagreed and it was resolved by reading the file, not by majority.
- **Empirical tie-break:** the two Red Team passes disagreed on whether pino `*.email` matches a top-level `email` key; it was settled by running pino directly (it does **not**), which is what surfaced the live PII-in-logs leak later fixed in §17.

---

## 15. Overall Production-Readiness Assessment

**Original verdict (2026-07-01): NOT ready to deploy today; ~1 focused day from a defensible pilot posture.**

The application *runs* — its security, privacy, and data-integrity engineering is genuinely strong and, where statically checkable, verified. What is not ready is the **deployment artifact**: the production compose stack has never been started, and three committed defects guarantee it would fail at `up`, with backups silently never running. These are ops-plumbing bugs, not design flaws, and every one is trivial-to-low effort. The remaining consequential unknown — cross-tenant isolation under connection pooling (`AUD-DB-05`) — is *code-correct on inspection* and needs one Docker run to convert "consistent-with-fine" into "proven."

Ship sequence: fix the three P0s → `compose up` on staging → run integration-db under Docker → close `AUD-DB-05` → then a HIPAA pilot is reasonable. **Do not go live while `docker compose up` fails.**

---

> ### Updated verdict — 2026-07-02
>
> **All 4 Criticals and all 5 Highs are fixed and committed** (`a59f118` through `e31dd39`; see §18
> and the per-section status updates above). `AUD-DB-05` moved from "consistent-with-fine on
> inspection" to **proven** via a forced-connection-reuse test on real Postgres. The three deploy
> defects are patched, config-validated, and CI-gated against recurrence (`compose-validate`).
>
> **What is genuinely still missing before "ready to deploy" can be said without qualification:**
> a live `docker compose -f docker-compose.prod.yml up` on an actual Docker host has never run in
> any session — every proof this week substitutes a local, non-Docker equivalent (PostgreSQL 18
> directly, or a running worker process outside Compose). That substitution is strong evidence, not
> a byte-identical guarantee of the containerized boot sequence, image layering, secret-mount paths,
> or network policy actually working together. **Recommended before a real go-live:** one supervised
> `docker compose up` on staging, watching all healthchecks reach `healthy` and a backup cycle
> actually produce a file — a short, mechanical step now that every defect it would have caught is
> already fixed, but not one that can be marked done from static/local evidence alone.
>
> Remaining open findings are Medium/Low severity (§6/§7, roadmap §12a) — none block a staging
> `compose up` attempt.

---

## 16. Appendix Index

| Domain | File | Findings |
|---|---|---|
| Security & Auth | `appendix/security.md` | AUD-SEC-01…08, HIST |
| Database & RLS | `appendix/database-rls.md` | AUD-DB-01…16 (incl. AUD-DB-PGB / DB-05) |
| DevOps / Infra / DR | `appendix/devops-infra-dr.md` | AUD-OPS-01…17 |
| Compliance & Privacy | `appendix/compliance-privacy.md` | AUD-CMP-01…09 |
| Backend / API / Quality | `appendix/backend-api-quality.md` | AUD-API-01…14 |
| Frontend & Testing/QA | `appendix/frontend-testing.md` | AUD-FE-01…08 |
| Resilience / Seams | `appendix/resilience-seams.md` | AUD-SEAM-01…06, REVJTI |
| Red Team validation | `appendix/redteam-validation.md` | dispositions, ADR re-check, coverage gaps |

---

## 17. Pipeline Evidence & Audit-Run Side Effects (disclosed)

**Suite executed twice, both green:**

| Run | typecheck | api unit | frontend | build | integration-db |
|---|---|---|---|---|---|
| Baseline (pre-edits) | ✅ 0 | ✅ 35 files / **538** | ✅ 9 files / **51** | ✅ 0 | ⏭️ NOT-EXECUTED (no Docker) |
| Re-cert (post-edits) | ✅ 0 | ✅ **538** | ✅ **51** | ✅ 0 | ⏭️ NOT-EXECUTED |

The hundreds of `500 / "reading 'count'" / doctorPatientsTable mock` lines in the API test log are **negative-path test noise** (suites deliberately exercising error branches under an intentionally-incomplete DB mock); all 538 pass.

**Audit-run side effects (scope disclosure):** the specialist agents were instructed to be read-only and write only their appendix. They exceeded that and **applied five fixes**, which the owner reviewed (full diffs) and elected to **keep**; the mutated tree was then re-certified (table above). They remain **uncommitted** on `security/search-doctor-scope`, pending the owner's commit:

| File | Change | Closes |
|---|---|---|
| `artifacts/api-server/src/lib/logger.ts` | bare-key redaction for every PHI path (`email`/`phone`/`fullName`/`diagnosis`/`address*`/…) — `*.key` wildcards never matched top-level keys | live PII/PHI-in-logs leak (`AUD-COMP-02` / `AUD-CMP-05`) |
| `artifacts/clinic/src/pages/Login.tsx` | seed-login chips `IS_DEV ? [...] : []` — not bundled into prod | seed creds shipped in prod bundle |
| `docker-compose.prod.yml` | `redis_exporter` gets `REDIS_PASSWORD_FILE` + secret | `RedisHighMemory` alert going dark |
| `docs/RUNBOOK.md` | §10.4 emergency schema-rollback / mid-deploy migration-failure procedure | doc gap behind `AUD-SEAM-04` |
| `lib/db/package.json` | `drizzle-kit ^0.31.9 → ^0.31.10` | minor dev-dep bump |

> **Honesty note:** these five edits landed **after** the baseline suite run, so baseline-green does not cover them; the **re-cert** row does. The three Critical `AUD-OPS-*` findings live in `docker-compose.prod.yml` — the same file one kept edit touched — but the P0 defects were elsewhere in it and, **at the time this report was written, remained unfixed**; keeping the redis-exporter edit did not by itself address OPS-01/02/03. **They were subsequently fixed the same sprint — see §18.**

*Recommendation:* commit these five deliberately (they are sound and re-certified), then proceed with the §12 Immediate roadmap.

---

## 18. Second & Third Remediation Sprints (2026-07-02) — Highs closed + one new finding

Two follow-on sprints landed after this report's original publication, on the same
`security/search-doctor-scope` branch. This section is appended, not backfilled into §1-16, so the
report still accurately reflects what the board found and knew at publication time; §5-8 carry
forward-references here.

### Sprint 2 — the 3 P0 deploy-blockers (§4) + 4 of 5 Highs (§5)

- **`AUD-OPS-01/02/03`** (Critical, §4) — healthcheck route fixed (`/api/health`→`/api/healthz`,
  Node-fetch probe), backup script bind-mounted, `postgresql16-client` installed + fail-loud.
  New `compose-validate` CI job (closes `AUD-OPS-11`) so this class of drift fails CI going forward.
  `.env.prod.example` was also found missing `PGBOUNCER_IMAGE`/`BACKUP_RSYNC_TARGET` (both
  `:?`-required) — fixed, since an operator following the template would hit the same wall.
- **`AUD-DB-05`** (Critical, §4) — the one runtime-unproven claim — is now **PROVEN**, not just
  inspected: a new integration-db test forces `DB_POOL_MAX=1`, empirically confirms the same
  physical connection is reused (`pg_backend_pid()`), and proves no cross-tenant leak — including
  the mid-transaction-rollback path. Ran green on local PostgreSQL 18 (not the CI's postgres:16 —
  noted as a minor caveat, not a full substitute).
- **`AUD-SEAM-01`** (High, §5) — durable local JSONL fallback for outbox-write failures, mirroring
  the existing break-glass sink pattern. Full detail: `appendix/resilience-seams.md`.
- **`AUD-SEAM-05`** (Medium, §6) — drain insert+delete wrapped in one `db.transaction`. Proven with
  a real-Postgres forced-failure test (`REVOKE DELETE`), not just a mock.
- **`AUD-OPS-04`** (High, §5) — worker now has a real `/healthz`+`/metrics` HTTP listener (shared
  auth/render helpers with the api route so the two can't drift) + a compose healthcheck.
- **`AUD-OPS-05`** (High, §5) — new `scripts/preflight-prod.mjs` go-live gate (fails if the blackbox
  TLS target is still the placeholder) + RUNBOOK §10.5 + external-cert-monitor recommendation.
- **Verification:** typecheck, lint, 558/558 unit (538+20 new), 51/51 clinic, build, and 125/125
  integration-db on local PG18 all green, plus a live runtime check of the worker's new endpoints.
- **Two real bugs found and fixed during this sprint's own verification** (not pre-existing): moving
  `buildAuditRow` outside `logAudit`'s try/catch would have turned a swallowed exception into an
  uncaught crash (caught before merge); the new atomicity test's own seed data used a fake
  non-existent `userId`, which — investigating *why* it failed — led directly to discovering
  AUD-SEAM-07 below.

### Sprint 3 — AUD-SEAM-07 (new High, found + fixed same day)

While chasing why the Sprint 2 atomicity test's seed userId failed, a **real, unrelated, latent
audit-loss bug** surfaced: `audit_logs.user_id` FKs to `users.id`; `SYSTEM_USER_ID` (`-1`, used for
any audit event with no authenticated request — concretely, the hourly `SYSTEM_NO_SHOW` cron) has
no matching `users` row, and the drain passed it through unmapped. Every system-actor audit event
was silently failing this FK, retrying 5×, exhausting, and firing `AuditLogPermanentLoss` — the
F-P1-4 `SYSTEM_NO_SHOW` audit trail this exact cron was built to close never actually landed.
**Full finding + fix: `appendix/resilience-seams.md` §AUD-SEAM-07.**

Fix: new `toAuditLogUserId()` helper remaps any non-positive id to `NULL` (the column's intended
"system actor" meaning) at all 4 `audit_logs` insert sites. No schema change. Proven with a
dedicated integration-db test that fails pre-fix (the exact FK violation) and passes post-fix,
plus 5 unit tests for the helper. Full regression re-run green.

**Remaining open (unchanged from §5/§10):** `AUD-FE-01` (E2E, deferred — greenfield frontend
infra), `AUD-DB-05`'s local-PG18-vs-CI-PG16 caveat, and everything in §10/§11 not listed above.
