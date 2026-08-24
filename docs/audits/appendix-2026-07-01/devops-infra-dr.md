# Appendix — DevOps / Infrastructure / Disaster-Recovery Audit

**Auditor scope:** Docker/compose hardening, secrets, image supply-chain, edge TLS, CI/CD gates, backup + restore recoverability, monitoring/alerting, health/readiness, graceful shutdown, secret provisioning.
**Date:** 2026-07-01 · **Branch:** `security/search-doctor-scope` · **ROOT:** `Clinic-Hub/` (nested)
**Runtime context:** Docker NOT available this run → every claim needing a live container is marked **NOT-EXECUTED / requires runtime validation**. CI unit suite reported GREEN by the board (538 api + 51 clinic). This appendix is static-evidence-only.
**Guardrails honored:** `medicore_app` NOSUPERUSER (ADR-008) and roll-forward-only migrations are DELIBERATE — residual risk is noted with the ADR cited, not flagged as a bug. (Prior appendix revision listed "no down-migrations" as CRITICAL; that is the intentional ADR posture with a fail-closed migrate container — re-classified to INFO here.)

---

## Summary counts

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 3 | AUD-OPS-01, AUD-OPS-02, AUD-OPS-03 |
| HIGH | 2 | AUD-OPS-04, AUD-OPS-05 |
| MEDIUM | 4 | AUD-OPS-06, AUD-OPS-07, AUD-OPS-08, AUD-OPS-09 |
| LOW | 3 | AUD-OPS-10, AUD-OPS-11, AUD-OPS-12 |
| INFO / positive-control | 5 | AUD-OPS-13 … AUD-OPS-17 |

**Headline:** the production stack has never been exercised under Docker (MEMORY: "no Docker locally"). Static analysis surfaces **three independent, deployment-blocking defects that would fail the very first `docker compose -f docker-compose.prod.yml up`** — all three in the *committed* file, not WIP: (1) the api healthcheck targets a route that does not exist, so nothing downstream ever starts; (2) the backup container cannot find its own script; (3) the backup container has no `pg_dump`/`psql`. These directly threaten the stated RTO/RPO because backups would silently never run.

---

## CRITICAL findings

### AUD-OPS-01 · Availability / healthcheck · CRITICAL · Confidence H · Evidence Strong
**api + worker healthcheck probes a non-existent route → container never becomes `healthy` → entire dependency chain stalls.**

- **Evidence:**
  - `docker-compose.prod.yml:337` — `test: ["CMD-SHELL", "wget -qO- http://localhost:5000/api/health || exit 1"]`
  - `docker-compose.yml:84` — identical `/api/health`.
  - Only health routes defined: `artifacts/api-server/src/modules/health/health.routes.ts:9` `router.get("/healthz", …)` and `:14` `"/healthz/ready"`. Mounted via `routes/index.ts:41 router.use(healthRouter)` under `app.ts:156 app.use("/api", router)` → effective paths are **`/api/healthz`** and **`/api/healthz/ready`**. There is no `/api/health`.
  - Unmatched routes hit `middlewares/envelope.ts:36 notFoundHandler` → `E.DOMAIN_NOT_FOUND.status` = **404** (`src/errors.ts:37 DOMAIN_NOT_FOUND: e(3001, 404, ...)`). `wget -q` exits non-zero on a 404 server response, so `|| exit 1` fires → probe reports unhealthy forever.
- **Cascade (`condition: service_healthy`):** `clinic` depends on `api: service_healthy` (`:447-449`), `prometheus` on `api: service_healthy` (`:629-630`); Caddy depends on clinic. With api never healthy, clinic/prometheus/caddy never start — the stack does not come up.
- **Supporting:** value is committed at HEAD (`git show HEAD:docker-compose.prod.yml` line 337 identical) → latent defect, not WIP. Grafana's probe (`:716`) also uses `/api/health` but that is **Grafana's own** endpoint (valid) — unaffected.
- **Contradicting:** none. `grep -rn "/api/health\b"` across `artifacts/api-server/src` → zero route definitions.
- **Assumptions:** busybox `wget` in node:24-alpine returns non-zero on HTTP 404 (standard). See AUD-OPS-08 for the `wget`-presence risk.
- **Alternative explanations:** none — the route does not exist.
- **Files not reviewed:** none material.
- **Validation required (NOT-EXECUTED):** `docker compose -f docker-compose.prod.yml up`; observe api `unhealthy`; `curl -o/dev/null -w '%{http_code}' localhost:5000/api/health`→404, `/api/healthz`→200.
- **Risk if incorrect:** low.

**FALSIFICATION HYPOTHESIS (availability):** "H0: `/api/health` resolves 2xx." Attempted falsification: searched all route registrations + mount chain; notFound handler returns 404; no alias. **H0 rejected.**

**Improvement-Engine**
- **Problem:** healthcheck can never pass; stack cannot deploy.
- **Root cause:** route renamed to `/healthz`/`/healthz/ready` but compose probes never updated.
- **Recommendation:** set both compose healthchecks to `wget -qO- http://localhost:5000/api/healthz || exit 1`. Reserve `/api/healthz/ready` (503 while draining) for an orchestrator readiness gate, use `/api/healthz` for container liveness.
- **Expected benefits:** stack starts; SSE graceful-drain becomes meaningful to the orchestrator.
- **Complexity:** trivial (2 prod + 1 dev line). **Risk:** negligible. **Dependencies:** none.
- **Migration plan:** edit → `docker compose config` → staging `up`. **Rollback:** revert lines.
- **Estimated effort:** 5 min. **Priority:** P0. **Success metric:** `docker compose ps` shows `api (healthy)` within `start_period`.

---

### AUD-OPS-02 · Backup recoverability · CRITICAL · Confidence H · Evidence Strong
**Backup container runs `node scripts/backup-verify.mjs`, but the image never contains `scripts/` — the repo-root `scripts/` dir is excluded from the build context.**

- **Evidence:**
  - `docker-compose.prod.yml:770` — `if node scripts/backup-verify.mjs; then`. `backup` uses `build: … target: build` (`:743-746`).
  - `Dockerfile` build stage COPYs only `pnpm-lock.yaml pnpm-workspace.yaml package.json` (`:10`), five `package.json`s (`:12-16`), and sources `lib/db lib/api-spec lib/api-zod lib/api-client-react artifacts/api-server` (`:23-27`). **No `COPY scripts/`.**
  - `.dockerignore:37` — `scripts/` explicitly excluded from the build context, so even a wildcard COPY skips it.
  - Only `./monitoring/backup-metrics.sh` is bind-mounted into backup (`:802`); `backup-verify.mjs` is not mounted.
- **Effect:** every nightly run → `Cannot find module '/app/scripts/backup-verify.mjs'` → non-zero → `echo "[backup] Backup FAILED"`; `LAST_RUN_DAY` never advances → retries hourly, fails hourly. **No backup ever produced.** `backup_last_success_timestamp_seconds` never written → `BackupStale`/`BackupMissingTextfile` fire (the one saving grace: the failure is alarmable, if monitoring is wired — see AUD-OPS-04).
- **Supporting:** `backup-metrics.sh` runs only after a successful `node …` (`:779`).
- **Contradicting:** MEMORY Phase 4 claims a backup rehearsal — almost certainly run on the host (where `scripts/` exists), not inside the built image, so it would not have caught this.
- **Assumptions:** the backup service is deployed (not an out-of-band host cron).
- **Validation required (NOT-EXECUTED):** `docker compose build backup && docker compose run --rm backup node scripts/backup-verify.mjs --dry-run` → expect module-not-found.
- **Risk if incorrect:** low.

**FALSIFICATION HYPOTHESIS (backup recoverability):** "H0: the backup image contains `scripts/backup-verify.mjs`." Falsification: inspected every COPY + `.dockerignore`; file is in neither build context nor a bind mount. **H0 rejected.**

**Improvement-Engine**
- **Problem:** DR backups never run inside the deployed stack.
- **Root cause:** `scripts/` excluded from build context and not bind-mounted; entrypoint assumes presence.
- **Recommendation:** bind-mount the script read-only — add `- ./scripts/backup-verify.mjs:/app/scripts/backup-verify.mjs:ro` alongside the existing metrics-script mount (matches the existing pattern, keeps the runtime image minimal, no `.dockerignore` change). Alt: scoped `COPY scripts/backup-verify.mjs` + `!scripts/backup-verify.mjs` in `.dockerignore`. Prefer the mount.
- **Expected benefits:** the nightly DR job executes.
- **Complexity:** low. **Risk:** low. **Dependencies:** must ship with AUD-OPS-03 or it still fails at the dump step.
- **Migration plan:** add mount → dry-run. **Rollback:** remove mount.
- **Estimated effort:** 15 min (with AUD-OPS-03). **Priority:** P0. **Success metric:** a `medicore_*.sql.gz.gpg` lands in `backup_data`; `backup.prom` timestamp advances.

---

### AUD-OPS-03 · Backup recoverability · CRITICAL · Confidence H · Evidence Strong
**Backup container installs `gnupg openssh-client rsync` but NOT `postgresql-client` — `pg_dump`/`psql` are absent, so even a fixed script cannot dump or restore.**

- **Evidence:**
  - `docker-compose.prod.yml:754` — `apk add --no-cache gnupg openssh-client rsync >/dev/null 2>&1 || true`. **No `postgresql-client`.**
  - `scripts/backup-verify.mjs` shells to `pg_dump` (`:112-155`) and `psql` (restore/checks `:290-533`). Base image `node:24-alpine` ships neither.
  - Contrast: `migrate` *does* `apk add --no-cache postgresql-client` (`:128`) for `psql`. Backup omits it.
  - The `|| true` swallow means a failed/absent install is silent until `pg_dump: not found` at runtime.
- **Effect:** `runDump()` → `pg_dump` ENOENT → `fail(...)`. Quarterly `--restore` drill cannot `psql`.
- **Supporting:** `checkEnv()` (`backup-verify.mjs:91-94`) validates only `gpg`, not `pg_dump`/`psql` → no fast-fail.
- **Contradicting:** none.
- **Assumptions:** alpine mirror reachable at container start (design fetches at runtime — see AUD-OPS-07).
- **Validation required (NOT-EXECUTED):** `docker compose run --rm backup sh -c 'apk add --no-cache gnupg openssh-client rsync; command -v pg_dump || echo MISSING'`.
- **Risk if incorrect:** low.

**Improvement-Engine**
- **Problem:** no `pg_dump`/`psql` in the DR container.
- **Root cause:** `postgresql-client` omitted from the backup `apk add`.
- **Recommendation:** `apk add --no-cache postgresql16-client gnupg openssh-client rsync` (pin the client major to the server major → avoids the PG17/18 `transaction_timeout` strip hack at `backup-verify.mjs:284-287`). Replace `|| true` with an explicit `command -v pg_dump || { echo FATAL; exit 1; }` so a repo/network failure fails loudly.
- **Expected benefits:** dump + restore drill work; failures are loud.
- **Complexity:** low. **Risk:** low. **Dependencies:** ships with AUD-OPS-02.
- **Migration plan:** edit → dry-run → nightly. **Rollback:** revert.
- **Estimated effort:** included above. **Priority:** P0. **Success metric:** `--restore` drill exits 0 with a patients row-count.

---

## HIGH findings

### AUD-OPS-04 · Monitoring / alert fidelity · HIGH · Confidence H · Evidence Strong
**Prometheus scrapes `worker:5001/metrics`, but the worker process exposes no HTTP/metrics server → `up{job="medicore-worker"}==0` permanently → `ServiceDown` (critical) fires forever; audit-loss series drained in the worker may have no scrape target at all.**

- **Evidence:**
  - `monitoring/prometheus/prometheus.yml:25-32` — job `medicore-worker`, `/metrics`, `targets: ["worker:5001"]`, Bearer auth.
  - `artifacts/api-server/src/worker.ts` (full, 67 lines) — imports cron/drain/reconcile only; **no `express`, no `http.createServer`, no `.listen`, no port 5001, no `/metrics`.** Pure `setInterval` process.
  - Worker service (`:363-439`) publishes no port and defines **no healthcheck** — consistent with no server to probe.
  - `prometheus-alerts.yml:14-21` — `ServiceDown: up{job=~"medicore-api|medicore-worker"} == 0 for 1m severity: critical` → pages continuously for the worker.
- **Effect:** chronic false-critical → alert fatigue → real api `ServiceDown` risks being silenced. `audit_outbox_depth`, `audit_log_write_failures_total`, `audit_integrity_check_failures_total`, break-glass counters are drained/emitted in the worker; api and worker are **separate containers**, so a shared in-process registry cannot span them. Whichever of these HIPAA-critical series is registered only in the worker (`AuditLogPermanentLoss`, `AuditIntegrityMismatch`, `AuditOutboxBacklog`, break-glass alerts) has **no scrapeable target** — needs runtime confirmation of per-process registration.
- **Supporting:** api `/metrics` exists + Bearer-gated (`app.ts:111`); worker has no equivalent.
- **Contradicting:** none for the `up==0` fact; the audit-series impact is conditional on which process registers each metric.
- **Assumptions:** worker.ts as read is the deployed `dist/worker.mjs`; grep confirms no listener.
- **Files not reviewed:** `lib/metrics.ts` internals (per-process registration) — validation-required.
- **Validation required (NOT-EXECUTED):** query `up{job="medicore-worker"}` (expect 0) and enumerate which series carry `job="medicore-worker"`.
- **Risk if incorrect:** moderate — degraded alerting SLO; potential blindness on audit-loss.

**FALSIFICATION HYPOTHESIS (audit-loss alerting):** "H0: the worker exposes `:5001/metrics` and audit-loss series are scrapeable." Falsification: worker.ts has no listener; separate containers preclude a shared registry. **H0 rejected** for the worker target (api-registered subset still scrapeable).

**Improvement-Engine**
- **Problem:** permanent false-critical + possibly missing audit-loss series.
- **Root cause:** worker never got the metrics HTTP endpoint the scrape config assumes.
- **Recommendation:** add a minimal Bearer-gated `/metrics` listener on `PORT=5001` to `worker.ts` (reuse `getMetrics` + the shared `prom-client` registry) and give the worker service a healthcheck + graceful close in its shutdown sequence. Because audit-drain runs in the worker, exposing worker metrics (not dropping the job) is correct. If worker metrics are truly unneeded, instead delete the job and change `ServiceDown` to `up{job="medicore-api"}==0`.
- **Expected benefits:** truthful `up`; audit-loss/outbox alerts have real data; no fatigue.
- **Complexity:** medium. **Risk:** low. **Dependencies:** registry is process-local.
- **Migration plan:** add listener → confirm `up==1` → keep alert. **Rollback:** drop job.
- **Estimated effort:** 2-3 h. **Priority:** P1. **Success metric:** `up{job="medicore-worker"}==1`; `audit_outbox_depth` present.

---

### AUD-OPS-05 · Monitoring / operator activation · HIGH · Confidence H · Evidence Strong
**Blackbox TLS/edge probe target is a hardcoded placeholder (`https://clinic.yourdomain.local`) → `EdgeProbeDown` and `SSLCertificateExpiringSoon` (the cert-expiry safety net) never have a real series until an operator edits it.**

- **Evidence:**
  - `monitoring/prometheus/prometheus.yml:64-77` — job `blackbox-tls`, `targets: ["https://clinic.yourdomain.local"]`, inline `# OPERATOR: set to your edge URL` + F-P6-7 note that Prometheus does not env-expand its config.
  - `prometheus-alerts.yml:189-239` — `EdgeProbeDown` (`probe_success==0`, critical) + `SSLCertificateExpiringSoon` (`<14 days`, warning) both depend on this target; the alerts file itself notes (`:179-181`) they "have no real target and will not fire."
- **Effect:** the two edge/TLS alerts are inert on a fresh deploy. If Caddy ACME renewal silently breaks, the first symptom is an outage. Documented operator-gated residual, not drift — but easy to forget.
- **Contradicting:** completing the go-live checklist closes it; nothing enforces it programmatically.
- **Assumptions:** no independent external TLS monitor exists.
- **Validation required (NOT-EXECUTED):** query `probe_success`/`probe_ssl_earliest_cert_expiry` for the real edge host.
- **Risk if incorrect:** moderate — missed cert renewal = full outage.

**FALSIFICATION HYPOTHESIS (TLS/transport):** "H0: cert-expiry alerting is live out of the box." Falsification: target is a placeholder; no env-expand. **H0 rejected** until operator edit.

**Improvement-Engine**
- **Problem:** cert-expiry + edge-down alerts inert on fresh deploy.
- **Root cause:** Prometheus config cannot env-expand → hand-edit not gated.
- **Recommendation:** add a go-live guard: `grep -q 'yourdomain.local' monitoring/prometheus/prometheus.yml && { echo FATAL; exit 1; }`, or generate `prometheus.yml` from a template with the real domain substituted at deploy. Add a second independent external cert monitor.
- **Expected benefits:** TLS safety net guaranteed live before traffic.
- **Complexity:** low. **Risk:** low. **Dependencies:** go-live checklist ownership.
- **Migration plan:** add guard to deploy runbook. **Rollback:** n/a.
- **Estimated effort:** 30 min. **Priority:** P1. **Success metric:** `probe_ssl_earliest_cert_expiry` series exists for the real host.

---

## MEDIUM findings

### AUD-OPS-06 · Image supply-chain · MEDIUM · Confidence H · Evidence Strong
**Datastore/edge images are digest-pinned, but the observability stack + Dockerfile base images are tag-only (no `@sha256`).**
- **Evidence:** digest-pinned via `${*_IMAGE:?}` requiring `@sha256`: postgres (`:42`), redis (`:73`), pgbouncer (`:176`), caddy (`:482`). Tag-only: `redis_exporter:v1.62.0` (`:517`), `prom/node-exporter:v1.8.2` (`:554`), `prom/blackbox-exporter:v0.25.0` (`:586`), `prom/prometheus:v2.53.0` (`:613`), `prom/alertmanager:v0.27.0` (`:651`), `grafana/grafana:11.1.0` (`:689`); `Dockerfile:3,34 FROM node:24-alpine`, `Dockerfile.clinic:2 node:24-alpine`, `:20 nginx:1.27-alpine`. This is exactly the drift the postgres comment (`:35-41`) says it wants to close. No container-image scan is wired (`security-scan.yml:16` notes it "NOT yet wired").
- **Recommendation:** digest-pin every image (build-arg the base digests for Renovate/Dependabot); wire a container-image Trivy scan on the built api/clinic images. **Priority:** P2. **Success metric:** `docker compose config` shows `@sha256:` on 100% of images; image scan green.

### AUD-OPS-07 · Runtime resilience · MEDIUM · Confidence H · Evidence Strong
**Backup + migrate `apk add` at container start — an alpine-mirror outage or air-gapped host breaks migrations and backups at the worst time.**
- **Evidence:** `migrate:128` (`apk add postgresql-client`), `backup:754` (`apk add … || true`). DR restore is exactly when network may be degraded.
- **Recommendation:** bake `postgresql-client`/`gnupg`/`openssh-client`/`rsync` into a dedicated build-time `ops` stage (keep api/worker runtime untouched — CLAUDE.md forbids apk there). **Priority:** P2. **Success metric:** backup + migrate run after image pull with `--network none`.

### AUD-OPS-08 · Healthcheck robustness · MEDIUM · Confidence M · Evidence Moderate
**Healthchecks assume `wget` exists; the api runtime stage installs nothing (copies only `dist` + `bcrypt`).**
- **Evidence:** `Dockerfile:34-46` runtime stage adds no packages; compose probe uses `wget` (`:337`). node:24-alpine ships busybox `wget` (likely works) but it is undocumented/brittle if the base changes. Compounds AUD-OPS-01.
- **Recommendation:** use a binary-free probe: `node -e "fetch('http://localhost:5000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` (Node 24 global fetch). **Priority:** P2.

### AUD-OPS-09 · Network isolation · MEDIUM · Confidence H · Evidence Strong
**`backend` network is `internal: false` (egress open); api spans `backend`+`frontend`.**
- **Evidence:** `:826-829` `backend … internal: false  # api needs egress … flip true for stricter isolation`. postgres/redis are backend-only with no published ports (good). A compromised backend container (postgres/redis/worker/exporter) has outbound internet — weaker than default-closed egress for a PHI tier. Documented trade-off (Resend/HIBP), residual not bug.
- **Recommendation:** add a dedicated `egress` net for api/worker; set `backend: internal: true`. **Priority:** P2. **Success metric:** `docker compose exec postgres wget https://example.com` fails; api still reaches Resend.

---

## LOW findings

### AUD-OPS-10 · Governance · LOW · Confidence H · Evidence Strong
**CODEOWNERS is entirely commented out → no enforced review routing for the platform kernel or feature modules.** `.github/CODEOWNERS` — all lines are comments ("ALL LINES ARE COMMENTED until real GitHub handles… exist"). Branch-protection review gates live in GitHub settings (not in-repo, unverifiable here). **Recommendation:** once team handles exist, uncomment at least the platform-kernel path so policy/audit/RLS/encryption changes require owning-team review. **Priority:** P3.

### AUD-OPS-11 · CI coverage · LOW · Confidence H · Evidence Strong
**No CI job validates the compose files/Dockerfiles for the config drift this audit found; `monitoring-config` validates only alert-rule syntax.** `ci.yml` jobs cover typecheck/lint/test/audit/gitleaks/build/migration-drift/integration-db/frontend-test/promtool. A `docker compose config` + a route-existence cross-check would have caught AUD-OPS-01/02/03. **Recommendation:** add a `compose-validate` job (`docker compose -f docker-compose.prod.yml --env-file .env.prod.example config -q`, `hadolint`, and a grep asserting each healthcheck path is a registered route). **Priority:** P2. **Success metric:** the three P0s fail CI.

### AUD-OPS-12 · Backup completeness (doc vs. wiring) · LOW · Confidence M · Evidence Moderate
**`RESTORE_DATABASE_URL` is never set on the backup service, so the daily loop's restore drill can never run automatically; imaging + break-glass JSONL ARE in the backup set (positive) but their restore is not drilled.** Backup `environment:` (`:787-793`) has no `RESTORE_DATABASE_URL`; daily loop calls `backup-verify.mjs` **without** `--restore` (`:770`); `backup-verify.mjs:82-84` requires the URL for `--restore`. So the automated path only dumps+verifies-header+offsite; restore is proven quarterly/manually (RUNBOOK §12) — reasonable, but recoverability is proven only 4×/year. Imaging tar (`:776`) + `bg_audit_data` ro-mount (`:801`) confirm both PHI-adjacent volumes are captured — good. **Recommendation:** document the daily job does not restore-test; calendar-enforce the quarterly `--restore`; consider a weekly automated restore into a throwaway container. **Priority:** P3.

---

## INFO / positive controls (verified TRUE)

### AUD-OPS-13 · Secrets hygiene · Confidence H · Strong — **PASS**
Datastore secrets file-mounted at `/run/secrets/*`, read at runtime in api/worker entrypoints (`:295-312`, `:386-403`) with fail-fast presence checks; `SESSION_SECRET`/`FIELD_ENCRYPTION_KEY`/`METRICS_TOKEN`/JWT keys/`REDIS_PASSWORD` **absent from `environment:`** (would leak via `docker inspect`). `DATABASE_URL` composed at runtime so the password never enters `docker inspect`. postgres/redis publish **no ports** (`:52`, `:88`). `.dockerignore` excludes `.env*` + `secrets/`; `secrets/.gitignore` = `* / !.gitignore / !README.md`; `git ls-files` shows no tracked secret. Alertmanager SMTP password via `smtp_auth_password_file` (`alertmanager.yml:23`), non-secret fields hardcoded (correct per F-P6-5). Prometheus scrapes api with Bearer `credentials_file: /run/secrets/metrics_token` (`prometheus.yml:20`); `/metrics` is constant-time-compared and fails **closed** (404) in prod without a token (`app.ts:113-128`). Residual (documented): dev `docker-compose.yml` still puts `SESSION_SECRET` in `environment:` and publishes DB/redis ports — dev-only, header warns never to use for prod.

### AUD-OPS-14 · Container hardening · Confidence H · Strong — **PASS**
api/worker: `read_only: true` + `tmpfs /tmp` + `cap_drop: ALL` + `no-new-privileges` + `mem_limit`/`cpus`/`pids_limit` + `stop_grace_period: 35s` (> `SHUTDOWN_TIMEOUT_MS` 30s per `index.ts:62`, so Docker never SIGKILLs mid-drain). Runtime image non-root (`Dockerfile:45-46 USER medicore`) + minimal (multi-stage; only `dist` + `bcrypt`). clinic/caddy drop ALL caps, add back only nginx/Caddy needs (`NET_BIND_SERVICE` etc.). Exporters `read_only` + `cap_drop: ALL`. Prometheus `user: "nobody"`.

### AUD-OPS-15 · Graceful shutdown · Confidence H · Strong — **PASS**
`index.ts:34-146` ordered drain: readiness flag flip (`/healthz/ready`→503) → `DRAIN_GRACE_MS` → `SSE_DRAIN_MS` hold → `closeAllSSEClients()` (jittered reconnect) → `server.close()` → final `drainAuditOutbox()` → `pool.end()`, bounded by `SHUTDOWN_TIMEOUT_MS`; SIGTERM/SIGINT wired. Worker mirrors it (`worker.ts:21-67`) minus HTTP/SSE. Compose `stop_grace_period: 35s` gives 5s margin.

### AUD-OPS-16 · CI/CD gates · Confidence H · Strong — **mostly PASS**
`ci.yml`: typecheck, lint (+ raw-fetch/offset/document.write grep guards), test, **audit (pnpm --audit-level=high)**, **secrets-scan (gitleaks, fetch-depth 0)**, build (emits `API_IMAGE=registry/medicore-api:<sha>` deploy tag to step summary on main), **migration-drift**, **integration-db (testcontainers PG)**, frontend-test, **monitoring-config (promtool check rules)**, ci-gate (all required). Other workflows: **CodeQL** (security-and-quality, weekly), **Trivy fs** (vuln+config, ignore-unfixed, SARIF), **SBOM (CycloneDX via Syft)** on main+release, **ZAP baseline DAST** (nightly, staging), **audit-weekly** (opens `security` issue on new HIGH). Rollback = `API_IMAGE` pin + `up -d --no-build` (RUNBOOK §10). **Gaps (see AUD-OPS-11):** no `docker compose config` validation, no hadolint, no container-image scan (tracked follow-up), no SLSA/provenance attestation, no automated deploy (manual — acceptable single-VM). CI does not build/push the api image to a registry, so the deploy tag is advisory.

### AUD-OPS-17 · Edge TLS / headers + RTO/RPO doc · Confidence H · Strong — **PASS (with AUD-OPS-05 caveat)**
`caddy/Caddyfile` terminates TLS (auto Let's Encrypt), HSTS `max-age=63072000; includeSubDomains; preload`, `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP/COEP, strips `Server`; blocks scan paths + bad methods; denies `/metrics` at the edge (defense-in-depth on top of api gate). Grafana loopback-bound (`127.0.0.1:3000`, `:711`) on backend-only, never Caddy-exposed. `nginx.conf` (internal clinic) mirrors headers, denies `/metrics`, SPA fallback, immutable asset caching, `server_tokens off`. RTO=**4h** / RPO=**24h** documented (RUNBOOK §6 `:216-217`, §12.6 `:523-530`) with rationale (single-VM compose, nightly pg_dump) + upgrade paths (D2 warm standby, D3 WAL streaming). Blackbox `insecure_skip_verify: false` + `fail_if_not_ssl: true`. **Caveat:** F-P6-7 blackbox target is a placeholder (AUD-OPS-05) → TLS-expiry alert inert until operator edit.

---

## NOT-EXECUTED (require Docker runtime)

| Item | Why | How to validate |
|---|---|---|
| AUD-OPS-01 healthcheck failure | no runtime | `docker compose up`; `curl /api/health`→404, `/api/healthz`→200 |
| AUD-OPS-02 backup module-not-found | no build/run | `docker compose run --rm backup node scripts/backup-verify.mjs --dry-run` |
| AUD-OPS-03 missing pg_dump/psql | no run | `docker compose run --rm backup command -v pg_dump` |
| AUD-OPS-04 worker `up==0` | no Prometheus | query `up{job="medicore-worker"}` + which series carry that job |
| AUD-OPS-05 blackbox placeholder | no Prometheus | query `probe_success` / `probe_ssl_earliest_cert_expiry` |
| AUD-OPS-06 digest drift | no registry | `docker inspect … RepoDigests` |
| AUD-OPS-07 apk offline | no run | run with `--network none` |
| Backup GPG encrypt + rsync offsite | no keyring / SSH target | quarterly `--restore` drill (RUNBOOK §12) |
| Full RTO measurement | no runtime | `docker compose kill postgres` → time-to-usable (RUNBOOK §12.3) |
| Prometheus Bearer scrape end-to-end | no runtime | scrape api `/metrics` with/without token |
| Alertmanager SMTP delivery (F-P6-5) | no live SMTP | `amtool alert add test` → confirm inbox |

## Files reviewed
docker-compose.prod.yml, docker-compose.yml, Dockerfile, Dockerfile.clinic, .dockerignore, caddy/Caddyfile, nginx.conf, pgbouncer/pgbouncer.ini, .github/workflows/{ci,codeql,sbom,security-scan,security-dast,audit-weekly}.yml, .github/CODEOWNERS, scripts/backup-verify.mjs, scripts/gen-secrets.ps1, monitoring/{backup-metrics.sh, prometheus/prometheus.yml, alertmanager/alertmanager.yml, blackbox/config.yml, grafana/provisioning/*}, prometheus-alerts.yml, secrets/{README.md,.gitignore}, docs/RUNBOOK.md (RTO/RPO + drill), docs/adr/ADR-008, and wiring in artifacts/api-server/src/{index.ts, worker.ts, app.ts, routes/index.ts, modules/health/*, errors.ts, middlewares/envelope.ts}.

## Files NOT reviewed
lib/metrics.ts internals (per-process metric registration — matters for AUD-OPS-04), monitoring/grafana/dashboards/medicore-overview.json, .zap/rules.tsv, scripts/load-test.js, start-dev.ps1, full RUNBOOK body beyond RTO/RPO + drill, GitHub branch-protection settings (not in repo).

## Cross-domain notes (for other board members)
- **DB/RLS auditor:** `backup-verify.mjs` step 4d (`checkAppRoleUsability`, `:450-533`) recreates `medicore_app` + re-applies 0020 grants + 0026 append-only REVOKE on restore and proves a non-superuser read — strong DR coverage of the ADR-008 role, but only under `--restore`, which the deployed loop never invokes (AUD-OPS-12). Confirm the 0028 event-trigger re-revoke survives a `--no-owner --no-acl` dump/restore.
- **Compliance auditor:** imaging_data + bg_audit_data ARE in the backup set (AUD-OPS-12) — good for §164.312(b). But if backups never run (AUD-OPS-02/03), break-glass JSONL + audit dumps are unprotected; pair with the audit-loss alerting gap (AUD-OPS-04 — worker metrics may not be scraped).
- **Security auditor:** `/metrics` fail-closed + Bearer + constant-time compare is solid (AUD-OPS-13); dev `docker-compose.yml` still leaks `SESSION_SECRET` via env and publishes DB/redis ports — ensure it is never repurposed for prod.
