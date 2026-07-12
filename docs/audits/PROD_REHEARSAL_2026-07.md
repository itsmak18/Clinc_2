# Production Compose Rehearsal — 2026-07-11 → 2026-07-12

**Closes:** the standing "prod stack never run end-to-end" finding (ARCHITECTURE_AUDIT_2026-07-02) and the Phase-6 "alert runtime-verify at deploy" item (AUDIT_FINDINGS_2026-06-07_PHASE6).
**Setup:** `docker compose --env-file .env.rehearsal -f docker-compose.prod.yml up -d --build --scale backup=0` on Windows/Docker Desktop; secrets via gen-secrets; Caddy on `https://localhost` (internal CA); blackbox TLS target pointed at localhost (local-only edit, not committed — preflight keeps guarding real deploys).

## Verdict

**The stack had never worked.** Eight defects stood between `git clone` and a serving stack — none visible to CI, all found and fixed in this rehearsal. After fixes: **13/13 services healthy, full request path serving, alert pipeline live, backup/restore proven.**

## Catches (all fixed in this pass)

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | `vite.config.ts` imports `../api-server/src/lib/csp` — never in Dockerfile.clinic's build context (landed with the E2E-layer commit on main) | clinic image **cannot build** | COPY csp.ts + auth-constants.ts (chain ends there) |
| 2 | `tsconfig.base.json` not copied — clinic tsconfig `extends` it, vite resolves at build | clinic image **cannot build** (second layer) | COPY tsconfig.base.json |
| 3 | Runtime api image ships `node_modules/bcrypt` only; bcrypt 6 `require()`s `node-gyp-build` | api/worker **crash-loop on boot** | COPY node-gyp-build |
| 4 | redis_exporter `REDIS_PASSWORD_FILE` parses a JSON map `{"redis://addr":"pw"}`; compose fed it the raw secret (comment even asserted "native file-secret support") | exporter crash-loop → Redis alerts dark | new `redis_exporter_passwords` JSON-map secret (gen-secrets writes it); image stays scratch |
| 5 | PgBouncer generated an **md5 userlist** against Postgres 16 (scram-sha-256 verifiers): "cannot do SCRAM authentication: wrong password type" | **api could never reach the DB** — the PgBouncer path had never once worked | plaintext userlist entry + `auth_type = scram-sha-256` both directions |
| 6 | No `max_prepared_statements` in pgbouncer.ini — node-postgres extended-protocol statements break under transaction pooling | parameterized queries fail via pool | `max_prepared_statements = 200` (PgBouncer ≥ 1.21) |
| 7 | `rateLimiter.ts` login upsert: JS Date params inside CASE-with-NULL branches — PG infers `text`, rejects into `timestamptz`. Only reproduces through PgBouncer's prepared-statement handling; unit + direct-PG integration tests all green | **every login 500'd** on the prod stack | explicit `::timestamptz` casts (suite still 594/594) |
| 8 | Clinic HEALTHCHECK used `localhost` — busybox wget resolves `::1` first, nginx listens IPv4-only | container permanently "unhealthy" while serving fine | probe `127.0.0.1` |

**Meta-lesson (why CI missed all eight):** compose-validate checks YAML syntax, never `docker build`; integration-db connects to Postgres directly, never through PgBouncer; nothing exercises the runtime images. Follow-ups below.

## Verification battery (final state)

| Check | Result |
|---|---|
| 13 services (`--scale backup=0`) | all Up, all healthchecked ones **healthy** |
| Migrations as bootstrap superuser | 168 tables incl. audit partitions |
| api/worker DB role | `medicore_app` via PgBouncer — `rolsuper=f, rolbypassrls=f` proven live (`pg_stat_activity`) |
| Edge: SPA via Caddy TLS | `https://localhost/` → 200 |
| Edge: api via Caddy | `/api/healthz` → `{"status":"ok"}` |
| Full login path (auth + rate-limit + DB) | 401 `attemptsRemaining:4` — correct behavior end-to-end |
| Prometheus targets | api, worker, redis, node, blackbox-tls, prometheus — **all up** |
| Alert pipeline | `HighErrorRate` fired **from real traffic** (the pre-fix login 500s), routed to `critical` receiver, SMTP delivery attempted — stopped only at dummy `smtp.example.com` (expected local boundary). Also `EdgeProbeDown` + `BackupMissingTextfile` routed correctly |
| Backup/restore drill | `pg_dump → gzip → GPG encrypt → decrypt → restore` into ephemeral DB: 0 errors, 168 tables, tenant table readable, **RLS flags intact after restore**; ephemeral DB dropped. (Throwaway GPG key; scripted `backup-verify.mjs --restore` runs in the backup container on real deploys) |
| Load smoke (k6) | **not run** — k6 unavailable locally; follow-up F-2 |

## Follow-ups

1. **CI: build both images** (`docker build` for api + clinic) — would have caught #1–#3. Highest-value single gate from this rehearsal.
2. **CI or staging: one PgBouncer-pathed smoke** (login against a compose'd api+pgbouncer+postgres) — would have caught #5–#7. Alternatively run integration-db through PgBouncer.
3. `healthz` liveness stayed green while the DB was unreachable (by design — liveness ≠ readiness), but compose gates `clinic`/`prometheus` on it. Consider gating on `healthz/ready` (verify it pings DB + Redis) so the stack doesn't cascade-start on a DB-dead api.
4. k6 load smoke on next rehearsal / first staging deploy.
5. Real-deploy deltas documented in `.env.rehearsal` header: digest-pinned images, real domain + DNS, real GPG recipient + offsite target, backup service unscaled, real SMTP.

## Rotation note (Phase 0.2 closure)

Local dev-compose Postgres password rotation was superseded: the rehearsal regenerated **all** runtime secrets fresh via gen-secrets (postgres, app-role, redis, session, field-encryption, metrics, grafana, JWT keypair). The OneDrive-exposed dev `.env` values are fully out of service (SESSION_SECRET rotated 2026-07-11, dev DATABASE_URL password applies only to the local dev compose volume — rotate opportunistically on next dev `compose up`).
