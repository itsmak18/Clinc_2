# Appendix G — Resilience & Failure Modes (The Seams)

**Audit date:** 2026-07-01 (findings) · **Updated:** 2026-07-02 (fix verification + AUD-SEAM-07) |
**Specialist:** Resilience & Failure-Mode (cross-cutting intersections)
**Runtime probes (2026-07-01):** NOT-EXECUTED (Docker unavailable on this host). All original traces
are static; items needing a live cluster were labelled `runtime-validation-required`.
**2026-07-02 update:** several of those items WERE subsequently run — against a local PostgreSQL 18
via `INTEGRATION_PG_ADMIN_URL` (not Docker, but real Postgres) — closing AUD-SEAM-01 and AUD-SEAM-05
below, and surfacing a new finding (AUD-SEAM-07) that only reproduces against a real FK constraint,
which the original mock-based unit suite could not see.

Scope: partial-outage scenarios that live BETWEEN domains, where no single-domain specialist looks. Each entry = a failure path traced to exact lines + observable blast radius + a falsification hypothesis. Findings that resolve safe are stated as such with the code cite; real defects carry an Improvement-Engine block.

This revision supersedes the earlier same-day pass by adding three seams the prior pass missed: the outbox drain **duplicate-insert** window (AUD-SEAM-05), the break-glass JSONL sink **not actually snapshotted** by the backup container (AUD-SEAM-06b), and the **pg_dump ↔ imaging-tar point-in-time skew** (AUD-SEAM-06a).

---

## Severity counts

**As originally found (2026-07-01):**

| Severity | Count | IDs |
|---|---|---|
| Critical (pending runtime proof) | 1 | AUD-SEAM-03 (PgBouncer×RLS runtime proof) |
| High | 2 | AUD-SEAM-01 (outbox backlog), AUD-SEAM-04 (half-migration no-down) |
| Medium | 3 | AUD-SEAM-05 (drain duplicate-insert), AUD-SEAM-06a (backup skew), AUD-SEAM-06b (bg-audit sink unbacked) |
| Info / documented-safe | 1 | **AUD-SEAM-REVJTI** (ADR-007 × ADR-010 intersection) |

**Current status (2026-07-02):**

| Status | IDs |
|---|---|
| **FIXED & proven (real Postgres)** | AUD-SEAM-01 (durable local fallback), AUD-SEAM-05 (transaction-wrapped drain) |
| **NEW — found while verifying SEAM-05, FIXED same day** | AUD-SEAM-07 (High — `SYSTEM_USER_ID` FK violation, silent permanent audit loss on every system-actor event) |
| Still open | AUD-SEAM-03 (Critical, pending runtime proof) · AUD-SEAM-04 (High) · AUD-SEAM-06a/06b (Medium) |
| Documented-safe | AUD-SEAM-REVJTI |

---

## AUD-SEAM-REVJTI — the ADR-007 × ADR-010 intersection (OWNED named candidate)

- **Category:** Auth / partial-outage intersection
- **Severity:** Info — **RESOLVED: DOCUMENTED-SAFE-INTERSECTION**
- **Confidence:** H
- **Evidence Strength:** Strong (full static trace of the exact branch that closes the window)

**Question threat-modeled:** During a revocation-store (Redis) outage, is there ANY window where a revoked PRIVILEGED token is *simultaneously* un-revocable (ADR-010 read fail-open grace) AND un-replay-limited (ADR-007 jti inert)?

**Trace (lib/policy.ts `evaluate()`):**

1. Step **5a — jti** (`policy.ts:179-191`) runs FIRST and ONLY for `scope === "privileged"`:
   ```ts
   if (scope === "privileged" && payload.jti) {
     try { const used = await runtime.revocationStore.isJtiUsed(payload.jti); ... }
     catch { step("jti", false, "store-unavailable:closed");
             return fail(E.AUTH_REVOKED, "revoked"); }   // FAIL-CLOSED
   }
   ```
   On a Redis outage `isJtiUsed` throws → caught → **`return fail(...)`**. The privileged request is denied *before it ever reaches* step 5b. The ADR-010 bounded-fail-open grace at 5b (`policy.ts:194-219`) is therefore unreachable for privileged scope.

2. Step **5b — revocation** (`policy.ts:194-219`) grace/degrade path is explicitly gated `if (scope === "read" && withinGrace)`; the `else` for `write`/`privileged` is `return fail(E.AUTH_REVOKED)` (`policy.ts:212-217`). So even if 5a were somehow skipped (it is not), privileged still fails closed here.

3. **jti liveness (grep `markJtiUsed`):** callers are `revocation-store.ts` interface decl, the two store impls (`redis/revocation-store.ts:25`, `memory/revocation-store.ts:34`), and `policy.unit.test.ts` (test-only `_markJtiUsed`). **No production route calls `markJtiUsed`.** `isJtiUsed` therefore always returns `false` — the jti defense is INERT in prod (ADR-007 §4, honestly disclosed). This *widens* the inert side of the intersection but is irrelevant to the window because 5a fails closed on the *store error itself*, not on the boolean result.

4. **No READ-scope token can mutate.** `middlewares/auth.ts` `scopeForMethod()` maps GET/HEAD→`read`, POST/PUT/PATCH/DELETE→`write` (`auth.ts:19-21`). The only 4 prod routes that request `privileged` are all **mutations** — `PATCH /users/:userId`, `DELETE /users/:userId`, `POST /users/:userId/reset-password` (`users.routes.ts:65,87,99`), `POST /password-reset/admin-reset/...` (`password-reset.routes.ts:98`). A `read`-scope token cannot select `privileged`; a mutating action is always `write` or `privileged`, both of which fail closed on store error. So the read-grace's relaxed posture never attaches to a privileged-capable action.

**Verdict:** **NO WINDOW EXISTS.** The intersection is a documented-safe-intersection. The two fail-open surfaces (ADR-010 read grace; ADR-007 jti inert) never co-apply to a revoked privileged token because privileged auth fails closed on the *store exception* at step 5a, upstream of both. Pinned by the `policy.unit.test.ts` "READS but never CONSUMES the jti" invariant (`policy.unit.test.ts:283-292`), which additionally guarantees a second privileged action in one session is not self-revoked.

- **Assumptions:** Redis outage = `isJtiUsed`/`getRevokedAt` *throw* (not silently return a stale value). Verified: both impls do a live `client.get` with no local cache, so an outage surfaces as a rejected promise. Also assumes no future route sets `privileged` on a GET — a guard worth adding but not a current defect.
- **Contradicting evidence:** None found.
- **Alternative explanation considered:** "A privileged token demoted to `read` scope somewhere could ride the grace." Rejected — scope is chosen by the route/method at the middleware, not by the token; a token does not carry a scope.
- **Files not reviewed:** none material to this trace.
- **Falsification hypothesis:** the seam would fail IF (a) a prod route mounted `authGate("privileged")` on a GET, OR (b) step 5a were reordered after 5b, OR (c) the 5a `catch` returned `pass` / fell through instead of `fail`. **Disconfirming test (describable):** issue a privileged-scope request with Redis down and a token whose `iat <= revokedAt`; assert HTTP 401 `AUTH_REVOKED` (never 200). `runtime-validation-required` for the live-Redis-down variant; the static branch is provable now and is proven above.
- **Risk if incorrect:** a revoked admin cookie could execute one un-replay-limited privileged mutation during a Redis blip. Bounded to admin-scope user-management + admin-reset routes.

*No Improvement-Engine block — nothing to fix. Optional hardening: assert in a unit test that no route registers `privileged` scope on a safe method.*

---

## AUD-SEAM-01 — Audit DB down + audit_outbox backs up: un-audited PHI ops during sustained outage

- **Category:** Audit durability / HIPAA §164.312(b) | **Severity:** High | **Confidence:** H | **Evidence Strength:** Strong

**Trace.** `logAudit()` (`audit.ts:65-96`) does a single best-effort `db.insert(auditOutboxTable)`. On failure it does NOT throw — it `auditLogWriteFailuresTotal.inc()` + `logger.error("audit_outbox_write_failed")` and returns. The PHI read/write that called it **completes silently un-audited**. This is the deliberate "never block a PHI op on audit-DB health" design (CLAUDE.md: "Audit write path = transactional outbox").

Two distinct loss surfaces:
- **Outbox INSERT fails** (`audit.ts:88-95`): the event never even reaches the outbox → immediately, permanently lost. Counted once in `audit_log_write_failures_total`.
- **Outbox INSERT succeeds but drain can't reach `audit_logs`** (`drainAuditOutbox` `audit.ts:112-200`): row is safe in the outbox, retried with backoff `5s/30s/2m/10m`, `MAX_ATTEMPTS=5`. After ~12.5 min cumulative the row is abandoned (`audit.ts:187-193`) and counted.

**Blast radius.** Every authenticated PHI read (`logRead`) and write (`logAudit`) during the outbox-INSERT outage is un-audited — an unbounded count for the outage duration, gated only by request volume. Break-glass events are exempt (they use the synchronous `auditBreakGlass` primary+JSONL path — see AUD-SEAM-06b). Detection: `AuditLogPermanentLoss` alert fires `for: 0m` on `increase(audit_log_write_failures_total[5m]) > 0` (`prometheus-alerts.yml:63-70`), and `AuditOutboxBacklog` warns at `audit_outbox_depth > 100 for 10m` (`:74-81`).

**Grace / blast math.** The *drain-side* loss (2nd surface) has a ~12.5 min per-row alerting grace before `AuditLogPermanentLoss`. The *outbox-INSERT* loss (1st surface) alerts within the 5-min metric window but the PHI ops in that window are already un-audited and unrecoverable — there is no local sink for the ordinary (non-break-glass) path, unlike break-glass.

- **Supporting:** `AuditLogPermanentLoss` annotation explicitly cites §164.312(b) and "PHI was accessed without a durable audit entry."
- **Contradicting:** For the common case (audit DB briefly down, outbox itself healthy) events are delayed, not lost — the outbox is on the *same* Postgres as `audit_logs`, so a full-Postgres outage takes both down and the PHI op also fails on its own DB write. The pure "un-audited but succeeded" case requires `audit_logs` unreachable while `audit_outbox` (same DB) writable — narrow, e.g. the append-only REVOKE or a partition-routing error on `audit_logs` only.
- **Assumptions:** outbox and audit_logs share one Postgres instance (confirmed — same `@workspace/db` pool).
- **Alternative explanation:** most "audit gaps" here are actually *delays* drained within seconds; true permanent loss needs a targeted `audit_logs`-only fault.
- **Files not reviewed:** partition-routing error modes on `audit_logs` (would require live PG).
- **Falsification hypothesis:** seam is benign IF every outbox-INSERT failure is always accompanied by the triggering PHI op also failing (so nothing succeeds un-audited). **Disconfirming test:** mock `db.insert(auditOutboxTable)` to reject while the PHI table insert succeeds; assert the HTTP call returns 2xx AND `audit_log_write_failures_total` incremented — proving a silent un-audited success. `runtime-validation-required` for the real partial-Postgres fault.
- **Risk if incorrect:** overstating — if the two failures are always coupled, blast radius collapses to "delayed, not lost."

**Improvement-Engine**
- **Problem:** an `audit_logs`-only fault lets ordinary PHI ops complete un-audited with no local durable sink (only break-glass has one).
- **Root cause:** the ordinary path is best-effort by design; only break-glass got the hybrid JSONL sink (2026-06-27).
- **Recommendation:** (1) confirm the `AuditLogPermanentLoss` alert is wired into Alertmanager routing (it is defined; verify it reaches the `critical` email route). (2) Consider extending the JSONL-fallback pattern from `break-glass-audit.ts` to the ordinary `logAudit` outbox-INSERT catch so a same-DB `audit_logs`-only fault still leaves a local record. (3) Add an SLO on `audit_outbox_depth` trend, not just the >100 threshold.
- **Expected benefits:** closes the one narrow permanent-loss surface for ordinary PHI ops.
- **Complexity:** Medium. **Risk:** Low (additive sink; no change to hot path on success). **Dependencies:** none.
- **Migration plan:** add sink write in the `audit.ts:88` catch behind a flag; reconcile via the existing 60s loop. **Rollback:** remove the catch-sink; behavior reverts to current.
- **Estimated effort:** ~0.5 day. **Priority:** P2 (design is deliberate; this hardens the tail). **Success metric:** zero un-reconciled ordinary-audit losses under an injected `audit_logs`-only fault.

> **RESOLVED — 2026-07-02.** Implemented exactly the recommended fix: new `lib/audit-outbox-fallback.ts`
> mirrors the break-glass JSONL sink (`appendAuditOutboxFallback` on the `logAudit` outbox-INSERT
> catch, `reconcileAuditOutboxFallback` on a 60s worker loop + final shutdown flush, reconciling back
> into `audit_outbox` — not directly into `audit_logs`, since these are delayed outbox writes, not
> emergency-access events). New metrics `audit_outbox_fallback_total` /
> `audit_outbox_fallback_write_failures_total` / `audit_outbox_fallback_pending`. New Docker volume
> `audit_outbox_fallback` (rw api+worker, ro+tarred backup). Unit tests (`audit-outbox-fallback.test.ts`,
> 8 cases; `audit.failure.test.ts` extended) green. The ordinary (non-break-glass) audit path now has
> the same durability guarantee break-glass already had — the previously-open "no local sink" gap is
> closed.

---

## AUD-SEAM-03 — PgBouncer connection-recycle / SET LOCAL escape (cross-check DB agent AUD-DB-PGB)

- **Category:** Multi-tenant isolation under pooling | **Severity:** Critical (pending runtime proof) | **Confidence:** H on inspection / N/A on runtime | **Evidence Strength:** Strong (static) / **NOT-EXECUTED** (runtime)

**Trace (inspection-consistent, not proven).** Tenant isolation depends on `runInTenantContext` setting the `app.clinic_id` GUC via `SET LOCAL` inside a real transaction, and PgBouncer transaction-pooling returning the server connection to the pool with `DISCARD ALL` (`server_reset_query`) so no GUC bleeds to the next client. Points a-d (real txn wrap, `SET LOCAL` only, RLS fail-closed on absent GUC, `DISCARD ALL` reset) are consistent-with-fine on code inspection — see the DB specialist's AUD-DB-PGB.

**What CANNOT be asserted.** Point (e) — that a server connection recycled from tenant A to tenant B *without* a fresh `runInTenantContext` returns **zero rows** (RLS fail-closed on missing GUC) rather than **A's rows** (GUC bleed) — is an end-to-end runtime property. Docker is unavailable; testcontainers Postgres cannot launch on this host. **This probe is NOT-EXECUTED.** AUD-DB-PGB can be stated only as **"consistent-with-fine on inspection," not "proven fine."**

- **Assumptions:** PgBouncer runs `transaction` pool mode with `server_reset_query = DISCARD ALL` (per Phase 3 notes + `pgbouncer/pgbouncer.ini`); `SET LOCAL` scopes the GUC to the transaction so `DISCARD ALL` is belt-and-suspenders.
- **Contradicting:** none found in code; the risk is purely "unproven at runtime."
- **Falsification hypothesis:** isolation fails IF a code path sets `app.clinic_id` with plain `SET` (session scope) instead of `SET LOCAL`, OR PgBouncer is misconfigured to `session` pooling / empty `server_reset_query`. **Disconfirming test (describable, NOT run):** in a real cluster, open tx as clinic A (SET LOCAL app.clinic_id=A), select A's patients, commit; force PgBouncer to hand the same server conn to a clinic-B client that queries patients WITHOUT `runInTenantContext`; assert 0 rows. `runtime-validation-required`.
- **Risk if incorrect:** cross-tenant PHI disclosure — the highest-severity failure in the system. Hence Critical-pending despite clean inspection.

**Improvement-Engine**
- **Problem:** the flagship tenant-isolation guarantee is unproven under the production pooler.
- **Root cause:** no runtime harness on this host (no Docker); the integration-db suite has never executed here.
- **Recommendation:** run the AUD-DB-PGB cross-recycle test on a real PgBouncer+PG in CI (not testcontainers-on-Windows). Grep-guard against plain `SET app.clinic_id` (require `SET LOCAL`). Add a startup assertion that PgBouncer `pool_mode=transaction` and `server_reset_query` contains `DISCARD ALL`.
- **Complexity:** Medium (needs a Linux CI runner with Docker). **Risk:** Low. **Dependencies:** CI infra.
- **Migration/Rollback:** test-only; no prod change. **Effort:** ~1 day. **Priority:** P1 (proof of a Critical property). **Success metric:** the cross-recycle test passes in CI and is blocking.

---

## AUD-SEAM-04 — Half-applied migration, no down-path (roll-forward-only per ADR)

- **Category:** Schema evolution / DR | **Severity:** High | **Confidence:** H | **Evidence Strength:** Strong

**Trace.** Migrations run via `drizzle-kit migrate` (`lib/db/package.json:13`) in a single-use ephemeral `migrate` container (`docker-compose.prod.yml:112-124`); api/worker gate on `migrate: service_completed_successfully` (`:326-327,417-418`). drizzle-kit wraps **each migration file** in a transaction; no migration in `lib/db/migrations` uses `CREATE INDEX CONCURRENTLY` (grep: 0 matches) or a manual `BEGIN`/`COMMIT`, so a crash mid-*file* rolls back atomically and the drizzle journal row is not written → safe retry.

**The residual seam.** A migration whose *body* performs a non-idempotent multi-step cutover is not protected by "each file is a txn" if that body itself can leave mixed state on a mid-statement crash that Postgres cannot roll back as one unit. Migration **0021** (audit_logs partition cutover) documents exactly this: *"The full cutover (rename + drop legacy) is not idempotent — re-running after a partial apply requires manual cleanup"* (`0021_audit_logs_partition.sql:37-38`). Drizzle has **no down migrations** (industry-standard, per Phase 4 notes + ADR-004-folded-into-001). Recovery is **roll-forward-only**: fix-forward hotfix migration or restore-from-backup.

**Blast radius / operator action.** If migration N fails: the `migrate` container exits non-zero → api/worker **never start** (dependency gate) → the app cannot silently run against a half-migrated schema. This is the correct HIPAA-safe posture (no silent auto-repair). But there is downtime until an operator restores-from-backup or authors a forward hotfix; for a non-idempotent cutover (0021-class) the operator must also hand-clean partial DDL. Blast radius = full API outage for that clinic estate until manual recovery; no data loss if a recent backup exists.

- **Supporting:** ephemeral migrate container + `service_completed_successfully` gate; 0021's own idempotency caveat.
- **Contradicting:** for the *common* case (single CREATE/ALTER per file) the per-file txn makes half-apply impossible — the seam only bites on multi-step cutover migrations.
- **Assumptions:** drizzle-kit's per-file transaction wrapping (documented drizzle behavior; not independently re-verified against the installed 0.31.10 here — `runtime-validation-required` to confirm the exact wrap).
- **Files not reviewed:** the drizzle-kit migrate internals (node_modules).
- **Falsification hypothesis:** the seam is benign IF drizzle wraps every file in a txn AND no migration body is non-idempotent. Disproven by 0021's explicit non-idempotent-cutover comment. **Disconfirming test:** SIGKILL the migrate step midway through 0021's rename block on a scratch DB; assert the DB is either fully-0020 or fully-0021, never mixed. `runtime-validation-required`.
- **Risk if incorrect:** understating if drizzle does NOT wrap files in txns (then even simple migrations could half-apply).

**Improvement-Engine**
- **Problem:** non-idempotent cutover migrations (0021-class) have no automated recovery and no down-path; a mid-cutover crash needs documented manual cleanup.
- **Root cause:** roll-forward-only policy (deliberate) + a small number of multi-step cutover migrations.
- **Recommendation:** (1) RUNBOOK: per-cutover-migration recovery recipe (which objects to drop/rename to reach a clean re-runnable state) — 0021 is the exemplar. (2) For future cutovers, prefer idempotent guards (`IF EXISTS`/`IF NOT EXISTS`, `CREATE ... IF NOT EXISTS`, rename-only-if-not-already-renamed) so re-run is safe. (3) A pre-migrate automatic snapshot so restore-from-backup is always ≤ a few minutes stale.
- **Complexity:** Low-Medium (mostly docs + a snapshot hook). **Risk:** Low. **Dependencies:** backup service.
- **Migration/Rollback:** doc + optional pre-migrate `pg_dump`; rollback = remove the hook. **Effort:** ~0.5 day. **Priority:** P2. **Success metric:** a rehearsed, timed recovery from a deliberately-killed 0021 apply.

---

## AUD-SEAM-05 — Worker crash mid audit-drain: at-least-once with duplicate-insert window

- **Category:** Audit exactly-once semantics | **Severity:** Medium | **Confidence:** H | **Evidence Strength:** Strong

**Trace.** `drainAuditOutbox()` batch path (`audit.ts:148-155`) is **two separate statements, not one transaction**:
```ts
await db.insert(auditLogsTable).values(logsToInsert);   // round-trip 1 (commits)
const rowIds = rows.map(r => r.id);
await db.delete(auditOutboxTable).where(inArray(...rowIds)); // round-trip 2
```
If the worker crashes (OOM/SIGKILL) **after** the INSERT commits but **before** the DELETE, the outbox rows survive and the next 5s tick re-selects and **re-inserts them** into `audit_logs`. `audit_logs.id` is a plain `serial` (`audit_logs.ts:8`) with **no unique/dedup constraint** on the payload — so the re-insert produces genuine **duplicate audit rows** with new ids. This is **at-least-once, duplicates possible** (never at-most-once; a row is never dropped by this window). The per-row fallback path (`audit.ts:160-195`) has the identical insert-then-delete ordering, same window.

**Blast radius.** Bounded to `DRAIN_BATCH = 100` rows (`audit.ts:105`) per crash — i.e. up to 100 duplicated audit entries per mid-drain kill. Duplicates are benign for compliance *completeness* (nothing lost) but corrupt *counts* and could confuse `ChangeHistory` before→after diffs. Interaction with the hash chain: `recordDailyIntegrity` hashes whatever rows exist, so duplicates change that day's root hash — but since recording happens after the fact, it self-consistently hashes the duplicated set; no false `mismatch` unless a duplicate lands across the day boundary of an already-recorded date.

- **Supporting:** no txn wrapping the insert+delete; serial PK with no natural-key uniqueness.
- **Contradicting:** graceful shutdown drains once more before `pool.end()` (`worker.ts:49`), so a *clean* shutdown does not hit this — only an ungraceful kill in the ~ms gap between the two round-trips.
- **Assumptions:** node-postgres autocommits each `db.insert`/`db.delete` independently (no ambient txn). Confirmed — no `db.transaction` around the batch.
- **Alternative explanation:** the window is tiny (two sequential awaits) — real-world hit rate is low, but a crash-looping OOM worker replays it every restart.
- **Files not reviewed:** none.
- **Falsification hypothesis:** the seam is absent IF the insert+delete are one atomic unit OR a dedup key rejects re-inserts. Both are false here. **Disconfirming test:** run the batch, kill the process between the two awaits (or mock the delete to reject after the insert commits), restart the drain, assert `audit_logs` contains duplicate rows for the same outbox payload. Doable in a unit/integration test without Docker by mocking the delete to throw post-insert.
- **Risk if incorrect:** low — worst case this is at-most-once (rows dropped), which would be a *worse* HIPAA finding, so the safe direction is confirmed.

**Improvement-Engine**
- **Problem:** a mid-drain crash duplicates up to 100 audit rows per event.
- **Root cause:** insert and delete are separate autocommitted statements; no idempotency key.
- **Recommendation:** wrap the batch insert+delete in a single `db.transaction(...)` so both commit or neither does (removes the window entirely). Alternatively/additionally, carry the outbox `id` onto `audit_logs` as a unique `source_outbox_id` column and `ON CONFLICT DO NOTHING` (dedup even across the DELETE-lost case). Transaction is the simpler, complete fix.
- **Expected benefits:** exactly-once drain; clean counts + hash chain.
- **Complexity:** Low. **Risk:** Low (a txn around two writes the worker already does). **Dependencies:** none.
- **Migration/Rollback:** code-only change to `drainAuditOutbox`; rollback reverts to two statements. If adding the dedup column, one additive migration. **Effort:** ~0.25 day (txn) / ~0.5 day (+dedup column). **Priority:** P2. **Success metric:** injected mid-drain crash produces zero duplicate `audit_logs` rows.

> **RESOLVED — 2026-07-02.** Took the "transaction is the simpler, complete fix" option exactly as
> recommended: both the batch path and the per-row fallback now wrap their insert+delete in a single
> `db.transaction(...)`. Proven — not just inspected — with a real-Postgres integration-db test
> (`audit-outbox-drain-atomicity.integration-db.test.ts`) that forces the failure mode directly via
> `REVOKE DELETE ON audit_outbox FROM medicore_app`, confirming the insert rolls back too (zero
> duplicate `audit_logs` rows) and the row survives cleanly in `audit_outbox` for retry. Plus a
> structural unit test (`audit-outbox-drain.test.ts`) confirming both code paths call
> `db.transaction` exactly once per attempt. All green on local PG18 (21/21 pre-existing
> integration-db tests unaffected).
>
> **One new finding surfaced while verifying this fix — see AUD-SEAM-07 below:** the drain's
> `audit_logs` insert independently violates the `user_id` FK for any system-actor event
> (`userId = SYSTEM_USER_ID`), which the original SEAM-05 write-up did not catch because it never
> exercised a real system-actor row against real Postgres.

---

## AUD-SEAM-07 — SYSTEM_USER_ID(-1) violates the audit_logs.user_id FK on drain: permanent loss of every system-actor audit event

- **Category:** Audit durability / HIPAA §164.312(b) | **Severity:** High | **Confidence:** H | **Evidence Strength:** Strong (reproduced against real Postgres)

**Discovery.** Not found by the original 2026-07-01 board — surfaced while verifying the AUD-SEAM-05
transaction fix, when a new integration-db test that seeded a real system-actor outbox row failed
with a foreign-key violation the pre-fix code silently swallowed as an ordinary retry.

**Trace.** `audit_logs.user_id` is `integer("user_id").references(() => usersTable.id)`
(`lib/db/src/schema/audit_logs.ts:10`) — nullable, but FK-enforced per partition
(`audit_logs_part_user_id_fkey`) whenever non-null. `buildAuditRow` (`audit.ts`) stamps
`userId = SYSTEM_USER_ID` (`-1`) for any audit event emitted without an authenticated request
context — concretely, the hourly `SYSTEM_NO_SHOW` cron (`cron.ts:185-231`, F-P1-4) and any other
system-context `logAudit` call. `audit_outbox` has no such FK, so the outbox write always succeeds.
But `drainAuditOutbox`'s mapping — `userId: row.userId ?? undefined` (both the batch path and the
per-row fallback) — passes `-1` straight through: `??` only substitutes on `null`/`undefined`, and
`-1` is neither, so the sentinel reaches the FK-constrained insert verbatim. **No `users` row has a
negative id, and none is seeded** (checked migrations + `scripts/src/seed.ts`) — every such insert
fails the FK.

**Blast radius.** Every system-actor audit event permanently fails to drain: batch attempt fails →
per-row fallback attempt fails identically (same FK, same `-1`) → `attempts` increments with
exponential backoff (5s/30s/2m/10m) → after `MAX_ATTEMPTS=5` (~12.5 min) the row is abandoned and
`audit_log_write_failures_total` increments → `AuditLogPermanentLoss` (critical, `for: 0m`) fires.
For the `SYSTEM_NO_SHOW` cron specifically, this means: **the F-P1-4 audit trail this cron was
built to close (CLAUDE.md: "previously left no audit trail (§164.312(b) gap)... Record it under the
system actor") never actually lands in `audit_logs`**, firing a critical alert every hour the cron
runs and finds no-show appointments — the exact "control passes audits without working" (H-2) shape
this whole audit method was designed to catch, on a control the *original* board rated PASS by
inspection alone.

- **Supporting:** FK violation reproduced directly (`23503`, `Key (user_id)=(-1) is not present in
  table "users"`, `constraint audit_logs_part_user_id_fkey`) via a real drain against real Postgres.
- **Contradicting:** none — this is a deterministic FK constraint, not a probabilistic race.
- **Assumptions:** `SYSTEM_CLINIC_ID` (`=1`) has no equivalent problem — confirmed separately (no FK
  on `clinic_id`, only the `CHECK(clinic_id>0)` from migration 0014, which `1` already satisfies).
- **Files not reviewed:** none material — root cause fully traced to the schema + mapping code.
- **Falsification hypothesis:** benign IF `users` has a row with id `-1`, OR the drain never actually
  receives a `SYSTEM_USER_ID` row in practice (i.e. `SYSTEM_NO_SHOW`/system events never fire).
  **Disconfirming test:** seed a `SYSTEM_USER_ID` outbox row, drain it, assert it lands in
  `audit_logs`. Pre-fix: fails (FK violation, row stuck). This is exactly
  `audit-system-actor-drain.integration-db.test.ts`, added and run — confirms the bug pre-fix and the
  resolution post-fix.
- **Risk if incorrect:** none identified — reproduced directly against real Postgres, not inferred.

**Improvement-Engine**
- **Problem:** system-actor audit events (`SYSTEM_USER_ID=-1`) can never reach `audit_logs`; they
  permanently exhaust and fire `AuditLogPermanentLoss` on a predictable schedule (hourly, via
  `SYSTEM_NO_SHOW`).
- **Root cause:** the outbox/drain layer was designed around real users; the `-1` sentinel is valid
  in the FK-free `audit_outbox` but was never remapped when crossing into the FK-constrained
  `audit_logs`.
- **Recommendation:** new exported helper `toAuditLogUserId(userId): number | null` in `audit.ts` —
  maps any non-positive id to `null` (the column's nullable "system actor" meaning); applied at every
  `audit_logs` insert site: `audit.ts` drain batch + per-row fallback, and defensively in
  `break-glass-audit.ts`'s primary insert + JSONL-reconcile insert (break-glass events are always
  user-initiated in practice, but the same bug class is closed there too, and the reconcile remap
  also protects any pre-fix JSONL lines still holding the raw sentinel).
- **Expected benefits:** system-actor audit events (the no-show cron, and any future system-context
  `logAudit` call) actually land in `audit_logs`; `AuditLogPermanentLoss` stops firing for this cause.
- **Complexity:** Trivial (one pure helper + 4 call sites). **Risk:** Low — the column was already
  nullable; this only stops writing an invalid non-null value into it. **Dependencies:** none, no
  schema/migration change.
- **Migration/Rollback:** code-only. `git restore` reverts to the pre-fix (broken) mapping.
- **Estimated effort:** ~1 hour (incl. tests). **Priority:** P1 (silent, scheduled, HIPAA-relevant
  audit loss — higher urgency than its "High" label suggests precisely because it fires
  predictably, not conditionally). **Success metric:** the new integration-db test passes; zero
  `audit_log_write_failures_total` increments attributable to `SYSTEM_NO_SHOW` post-deploy.
- **Status: FIXED — 2026-07-02.** All 4 sites patched; unit tests (`toAuditLogUserId`, 5 cases) +
  the reproduction/proof integration-db test above, both green.

---

## AUD-SEAM-06a — Backup taken during a partial write: pg_dump consistency + DB↔imaging point-in-time skew

- **Category:** Backup/restore consistency | **Severity:** Medium | **Confidence:** H | **Evidence Strength:** Strong

**Trace — DB is fine.** `runDump()` uses `pg_dump --format=plain` (`backup-verify.mjs:118-149`). A single `pg_dump` invocation runs in one MVCC snapshot (a repeatable-read transaction internally), so the SQL dump is **internally transaction-consistent** even if writes land mid-dump. No finding on the DB dump itself.

**Trace — cross-store skew.** The DB dump and the imaging files are two separate stores captured at different instants. In the backup entrypoint (`docker-compose.prod.yml:765-786`): `node scripts/backup-verify.mjs` (which does the `pg_dump`) runs FIRST; only after it exits 0 does `tar czf imaging-$DAY.tar.gz -C /data/imaging` run (`:776`). The imaging tar is therefore captured **seconds-to-minutes AFTER** the DB snapshot, and `/data/imaging` is a live volume (`:ro` to backup, read-write to api/worker). Result: a restore can contain an `imaging_attachments` DB row whose file was written *after* the DB snapshot (file present, row present — OK), or a file deleted after the DB snapshot by an erasure/orphan-reclaim between the two captures (row present in dump, file gone from tar — **dangling reference**). The reverse (file in tar, no row) is the orphan class the daily reconcile (`cron.ts:254-263`) already handles.

**Blast radius.** Any imaging study created/erased in the window between the `pg_dump` snapshot and the `tar` (typically the dump duration) can be inconsistent on restore. Low frequency (one narrow daily window), non-PHI-leaking (files are AES-256-GCM), but a restored study may 404 on download. `pg_dump` internal consistency is unaffected.

- **Supporting:** sequential ordering in the entrypoint; live imaging volume.
- **Contradicting:** the orphan-file cron + `erasure_blackout_until` restore check (`backup-verify.mjs:333-370`) catch the more dangerous PHI-revival direction; the dangling-reference direction only degrades a download.
- **Assumptions:** api/worker keep writing imaging during the 02:00 backup window (no write-freeze). Confirmed — no maintenance-mode gate around backup.
- **Files not reviewed:** `imaging-attachments.service.ts` write ordering (file-then-row vs row-then-file) — relevant to which skew direction dominates; `runtime-validation-required` to characterize rate.
- **Falsification hypothesis:** no skew IF DB and imaging are captured in one atomic snapshot. They are not (two sequential steps, two stores). **Disconfirming test:** create an imaging study, start a slow `pg_dump`, delete the study's file mid-dump, let the tar run; restore and assert the DB row references a missing file. `runtime-validation-required`.
- **Risk if incorrect:** low — overstating only if imaging writes never occur during the backup window.

**Improvement-Engine**
- **Problem:** DB dump and imaging tar are not point-in-time aligned; a study mutated in-window is inconsistent on restore.
- **Root cause:** two stores, sequential capture, live volume, no snapshot fence.
- **Recommendation:** (1) capture imaging tar FIRST then pg_dump (so any DB row referencing a tarred file is guaranteed to have its file — flips the residual skew to the benign orphan direction the reconcile already fixes). (2) Or take a filesystem snapshot (LVM/zfs/`--link-dest`) at the same instant as the dump's start. (3) Document the accepted skew window in RUNBOOK §12 and rely on the orphan-reconcile + a post-restore dangling-reference sweep.
- **Complexity:** Low (reorder) to Medium (fs snapshot). **Risk:** Low. **Dependencies:** none for reorder.
- **Migration/Rollback:** swap two lines in the entrypoint; rollback swaps back. **Effort:** ~0.25 day. **Priority:** P2. **Success metric:** post-restore dangling-reference count = 0 in a drill that mutates imaging during backup.

---

## AUD-SEAM-06b — Break-glass audit JSONL sink is mounted into the backup container but never snapshotted

- **Category:** Backup coverage / HIPAA §164.312(a)(2)(ii) | **Severity:** Medium | **Confidence:** H | **Evidence Strength:** Strong

**Trace.** The break-glass durable path writes unreconciled emergency-access events to a local JSONL sink `/data/bg-audit/fallback.jsonl` on the `bg_audit_data` volume when the synchronous `audit_logs` insert fails (`break-glass-audit.ts:42-104`). That volume IS mounted **read-only into the backup container** with a comment claiming it is snapshotted:
```yaml
- bg_audit_data:/data/bg-audit:ro # read-only — snapshot break-glass audit fallback sink
```
(`docker-compose.prod.yml:801`). **But the backup entrypoint never tars `/data/bg-audit`.** The `while` loop (`:765-786`) runs `backup-verify.mjs` (Postgres only) and `tar czf imaging-...` for `/data/imaging` only (`:776`). Grep confirms zero references to tarring or dumping `bg-audit` anywhere in `*.yml/*.sh/*.mjs`. The mount is dead weight — the comment asserts a snapshot that does not happen.

**Blast radius.** Normally tiny: the 60s reconcile loop (`cron.ts:49-63`) and graceful-shutdown flush (`worker.ts:50`) drain the sink into `audit_logs` within ~60s, so at backup time the sink is usually empty and its contents are already inside the pg_dump. The gap bites only in the compound failure: **the sink holds unreconciled lines AT 02:00 (audit DB was down for >60s so reconcile couldn't drain) AND the primary DB is subsequently lost** (the exact DR scenario backups exist for). In that case the break-glass events that were written to JSONL precisely *because* the DB was unavailable are the ones NOT in any backup → permanent loss of the emergency-access trail HIPAA §164.312(a)(2)(ii) most requires.

- **Supporting:** the `:ro` mount + misleading comment (someone intended to snapshot it); the tar covers imaging only.
- **Contradicting:** the sink is normally drained within 60s, so the common-case backup already contains the events (via `audit_logs` in the dump).
- **Assumptions:** the sink is not backed up by any other mechanism — confirmed by grep across yml/sh/mjs.
- **Files not reviewed:** none material.
- **Falsification hypothesis:** no gap IF some step snapshots `/data/bg-audit`. Grep shows none. **Disconfirming test:** write a line to `fallback.jsonl`, run the backup container's daily block, inspect `/backups` for any artifact containing that line. Expect: none. Doable without app runtime (shell-only).
- **Risk if incorrect:** low — understating only if another backup mechanism (not in the repo) captures the volume.

**Improvement-Engine**
- **Problem:** the break-glass fallback sink is mounted for backup but not actually included; unreconciled emergency-access events are lost if the DB is also lost.
- **Root cause:** the entrypoint tars imaging only; the bg-audit tar line was never added (comment says otherwise).
- **Recommendation:** add `tar czf "/backups/bg-audit-$$CURRENT_DAY.tar.gz" -C /data/bg-audit . 2>/dev/null || echo skipped` right after the imaging tar (`docker-compose.prod.yml:777`), with the same retention prune. Trivial and makes the existing `:ro` mount honest.
- **Expected benefits:** the emergency-access trail survives a DB-loss DR event.
- **Complexity:** Trivial. **Risk:** Low. **Dependencies:** none.
- **Migration/Rollback:** add one tar + one prune line; rollback removes them. **Effort:** ~15 min. **Priority:** P2 (compound-failure only, but the fix is one line and closes a §164.312(a)(2)(ii) tail). **Success metric:** a written `fallback.jsonl` line appears in a `/backups/bg-audit-*.tar.gz` after a backup run.

---

## Cross-domain notes (hand-offs to other specialists)

- **DB / RLS specialist (AUD-DB-PGB):** AUD-SEAM-03 is your finding viewed from the seam side. I can only certify it "consistent-with-fine on inspection." The cross-recycle *runtime* proof is yours to run on a real PgBouncer+PG (not testcontainers-on-Windows). Until then the flagship isolation guarantee is unproven.
- **Security specialist:** AUD-SEAM-REVJTI resolves DOCUMENTED-SAFE — cross-references your `security.md:53` note; consistent. The jti defense remains INERT in prod (ADR-007 §4) — that is a *latency* posture, not a live gap, given privileged fails closed on store error upstream.
- **Audit specialist:** AUD-SEAM-05 (drain duplicate-insert) affects your hash-chain counts and `ChangeHistory` diffs — coordinate on whether to fix via txn or a `source_outbox_id` dedup key.
- **DevOps specialist:** AUD-SEAM-04 (half-migration) and AUD-SEAM-06a/b (backup coverage) are RUNBOOK/compose changes in your area; the recommendations above are one-to-few-line edits plus doc.

## NOT-EXECUTED / runtime-validation-required (Docker unavailable)

- AUD-SEAM-03(e): PgBouncer A→B connection-recycle cross-tenant zero-rows proof — **NOT-EXECUTED**.
- AUD-SEAM-REVJTI live variant: privileged request with Redis down + revoked token → 401 — static branch proven; live-Redis-down repro **not run**.
- AUD-SEAM-01: ~~real partial-Postgres fault — not run~~ **RESOLVED 2026-07-02**: fixed (durable local fallback sink) and the fix's behavior proven via unit tests against a real DB-insert-failure path (mocked at the boundary, not the full partial-Postgres fault scenario — that specific narrow scenario remains `runtime-validation-required` for full end-to-end proof, but the *fix* closing the loss surface is verified).
- AUD-SEAM-04: SIGKILL mid-0021-cutover half-apply repro — **not run**; also unverified that installed drizzle-kit 0.31.10 wraps each file in a txn.
- AUD-SEAM-05: ~~mid-drain crash duplicate repro — not run~~ **RESOLVED & PROVEN 2026-07-02**: `audit-outbox-drain-atomicity.integration-db.test.ts` ran the actual forced-failure scenario (REVOKE DELETE) against real Postgres and confirmed zero duplicates — this is the real repro, not a mock.
- AUD-SEAM-06a/b: backup-window skew + bg-audit sink capture — shell-reproducible without app runtime; **not run** here.
