# Audit Findings — Phase 8: Architecture, Performance & Scale

**Date:** 2026-06-07
**Baseline:** working tree.

---

## Verified PASS

| Check | Evidence |
|---|---|
| **DB Pool Sizing & Safety** | Verified pool math: PgBouncer transaction-pooling connects up to `default_pool_size = 20` (plus `reserve_pool_size = 5`) server connections to Postgres, keeping database connection consumption well below Postgres's `max_connections = 100` limit. This leaves a 75-connection headroom for administrative tasks, backups, migrations, and scaling out replicas. Per-process `DB_POOL_MAX = 40` clients are multiplexed safely. Verified that `statement_timeout` and `idle_in_transaction_session_timeout` are set via `ALTER ROLE medicore_app` in migration `0021_audit_logs_partition.sql` rather than connection string parameters, which is pooling-safe under PgBouncer `transaction` pooling. |
| **N+1 / Query Efficiency** | Checked deep-read services (`dashboard`, `search`, `analytics`, `reports`). All database queries utilize proper joins or batched `inArray` bulk fetches followed by in-memory aggregation (such as `computeKPIsForDoctorIds` in `analytics.service.ts`), avoiding N+1 loops. All search queries in `globalSearch` are bounded by `.limit(5)` and execute in a single parallel transaction. Verified composite index coverage matching all query patterns in migration `0018_performance_indexes.sql`. |
| **SSE Capacity Bounds** | Verified that `addSSEClient()` limits active connections globally to `SSE_MAX_CONNECTIONS = 500` and per-user connections to `SSE_MAX_PER_USER = 10`. The notifications stream handler (`routes/notifications.ts` line 30) checks the boolean return value of `addSSEClient()`, returning a `503 Service Unavailable` with a `Retry-After: 30` header when capacity is saturated. Refuses connections during graceful shutdown (`isShuttingDown()`) to allow clean drain. |
| **Cache Scope & Freshness** | Verified that caching via `runtime.cache.getOrSet` is strictly limited to non-PHI summaries: `dashboard:summary` (TTL 30s), `dashboard:dept_load` (TTL 30s), and `dashboard:recent_activity` (TTL 15s). The doctor permissions scope (`doctor_scope:${doctorId}`) is cached in Redis (TTL 60s) and is actively invalidated on appointment mutations. No patient PHI or medical records are cached, preventing stale reads and data leakage of PHI. |
| **Frontend Bundle Splitting** | Verified route-level code splitting using React `lazy` and `<Suspense>` wrappers in `App.tsx` for all pages. The wouter router splits the frontend into independent, route-specific chunks loaded on demand, ensuring fast load times and optimized client memory usage. |

---

## Findings & Resolutions (first pass)

All design checks for Phase 8 have **passed** successfully. No code defects or configuration adjustments were required. The architecture, connection pooling, indexing, and caching schemes are fully compliant and ready to support the targeted pilot scale.

---

## Second pass — independent verification (2026-06-07)

Re-checked the first-pass claims against the actual config (Phases 6 & 7 were rubber-stamped, so Phase 8's "all passed" warranted the same scrutiny). **Unlike 6/7, the Phase 8 claims hold up:**

- **Pool math ✓** — `pgbouncer/pgbouncer.ini`: `pool_mode=transaction`, `default_pool_size=20`, `reserve_pool_size=5`, `max_client_conn=200`; budget comment "20 + migrate(2) + backup(1) = 23 ≪ 100". Postgres `max_connections` is the default 100 (not overridden). api+worker client conns (`DB_POOL_MAX=40` each = 80) ≤ 200. Accurate.
- **SSE caps ✓** — `routes/notifications.ts:29-31` checks `addSSEClient()` return → `503 + Retry-After: 30`; `:21` drains with `503 + Retry-After: 10`. Accurate (doc cited "line 30").
- **Cache scope ✓** — including the `doctor_scope:<doctorId>` Redis cache the claim mentions: it genuinely exists (`lib/scope.ts:29-47`, `SCOPE_CACHE_TTL_SEC=60`) with `invalidateDoctorScope` (`:81-83`) called on appointment mutations. Non-PHI ID list; acceptable.
- **N+1 ✓ (spot)** — `computeKPIsForDoctorIds` batches via `inArray`; `globalSearch` bounded `.limit(5)`.

### F-P8-1 — CLAUDE.md Doctor Scope Rule is stale (doc drift)

**Severity: LOW (doc accuracy; could mislead a security decision) · Confidence: HIGH · Status: 🟡 OPEN — needs a CLAUDE.md edit (agent was permission-blocked from editing the config file)**

`.claude/CLAUDE.md:437` states `getDoctorPatientScope(doctorId)` returns IDs "from appointments table (**no cache — fresh on each call**)." Both halves are now wrong: it reads the `doctor_patients` materialized table, and it **is** Redis-cached 60s under `doctor_scope:<doctorId>` (`lib/scope.ts:29-47`) when `SESSION_STORE=redis` (in-memory dev stays fresh). A dev relying on "fresh on each call" for an access-revocation decision would be wrong by up to 60s. **Requested CLAUDE.md edit (apply manually):**

> `getDoctorPatientScope(doctorId)` — returns authorized patient IDs from the `doctor_patients` materialized scope table. **Redis-cached** under `doctor_scope:<doctorId>` for `SCOPE_CACHE_TTL_SEC` (60s) when `SESSION_STORE=redis`; in-memory dev has no `scopeCache` so it's fresh each call. `invalidateDoctorScope(doctorId)` deletes the key on appointment mutations. Any new path that changes a doctor↔patient assignment must call `invalidateDoctorScope` or accept ≤60s staleness.

### Plan §8.5 — real load test (= F-P6-9) ✅ DONE 2026-06-07

Plan §8.5's "basic load test against the booking + dashboard paths" was **not** delivered: `scripts/load-test.js` only GETs `/healthz/ready` + `/metrics` (no auth, no clinical workflow, default port 3000 = Grafana). **Now rewritten** as a real k6 test (login → dashboard + clinical reads + `POST /appointments` booking with CSRF, 0→20→0 VU ramp, read/write latency thresholds) — see F-P6-9 resolution in `AUDIT_FINDINGS_2026-06-07_PHASE6.md`. `node --check` clean; runtime-verify with `k6 run scripts/load-test.js` against a live stack. Bundle-splitting (the other half of §8.5) was already fine (`App.tsx` lazy/Suspense).
