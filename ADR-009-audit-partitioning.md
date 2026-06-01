# ADR-009: audit_logs Partitioning Strategy

**Date:** 2026-06-02  
**Status:** Accepted  
**Author:** Mike (lead) / Rose (review)  
**Supersedes:** —  
**Related:** ADR-008-app-db-role.md, migration 0021_audit_logs_partition.sql, RUNBOOK §12

---

## Context

`audit_logs` is an append-only, 7-year-retention table required by HIPAA §164.312(b). The table was unpartitioned since initial creation (migration 0000). At the time of this ADR the table is weeks old and small (a few hundred rows). The risk register had this as an open MEDIUM item:

> *audit_logs unpartitioned and grows unbounded — 7-year append-only; query performance degrades linearly; pruning (partition drop) requires a full DELETE + VACUUM.*

Two questions had to be settled before implementation:

1. **Partition now (small table) vs defer (avoid disruption)?**
2. **Monthly vs yearly partitions?**

---

## Decision

**Partition now, by calendar month.**

---

## Rationale

### Why now (not deferred)

On a live, large table, converting from heap to partitioned requires:
- A maintenance window (full table lock during CREATE TABLE + INSERT + RENAME)
- A multi-hour copy for a multi-GB 7-year table
- Halting the audit outbox drain so no inserts land on the old table mid-swap

On the current small table (~weeks of data) the same steps take **< 1 second**. The copy+rename runs inside the `migrate` container (which runs before api/worker start), so there is **no concurrent write pressure** and **no maintenance window**.

Deferring means landing this same migration on a table that has grown by orders of magnitude. The cost of acting now is a 100-line migration. The cost of deferring is a planned multi-hour outage.

### Why monthly (not yearly)

| Factor | Monthly | Yearly |
|--------|---------|--------|
| Partition drop granularity (HIPAA 7-yr purge) | 1 month | 12 months — overshoot by up to 11 months of data |
| Partition count for 7-yr horizon | ~84–132 | ~7–11 |
| Partition pruning on date-range queries | Excellent | Good |
| Monitoring headroom visibility | Fine-grained | Coarse |

Monthly is the standard choice for HIPAA audit retention. The overhead of ~132 partitions is negligible in Postgres 16 (partition pruning is index-aided; planner overhead is O(log n) on partition count).

### No inbound FK concern

The hard restriction on partitioned tables is **inbound foreign keys** — other tables referencing the partitioned table as the parent. Grep confirmed no table has a FK to `audit_logs`. Only outbound FKs (`clinic_id → clinics`, `user_id → users`) exist, which are fully supported on partitioned tables since Postgres 12.

### Hash chain integrity

`recordDailyIntegrity` and `verifyIntegrity` query by `created_at` for one UTC day. A calendar day lives wholly inside one monthly partition. Daily chaining via `prevHash` is unaffected by partition boundaries — the query planner prunes to the relevant partition, which is faster than the current full-table scan.

### Composite PK (id, created_at)

Postgres requires the partition column to appear in every UNIQUE/PK constraint. The existing `id SERIAL PRIMARY KEY` becomes `PRIMARY KEY (id, created_at)`. The `id` column remains globally unique (single shared sequence on the parent). The composite key satisfies Postgres's constraint; downstream ORM queries (Drizzle) use `id` alone in WHERE clauses and are unaffected.

### Runtime DDL boundary (ADR-008 invariant maintained)

`medicore_app` is `NOSUPERUSER NOBYPASSRLS` with DML-only grants. Creating partition tables requires DDL privileges that `medicore_app` does not have (by design — ADR-008). Therefore:

- **Pre-creation horizon:** Partitions 2026-01 through 2036-12 (132 monthly + 1 DEFAULT) are created by the migrate container (bootstrap superuser) in migration 0021. This covers the 7-year HIPAA retention horizon plus ~3 years of headroom.
- **DEFAULT partition:** A catch-all partition ensures that out-of-range inserts never error (any row beyond 2036-12 lands in DEFAULT). This is a safety net, not a growth plan.
- **Worker monitoring:** The worker's monthly cron emits `audit_partition_months_remaining` (count of future partition names relative to now). An alert fires when headroom drops below 24 months, prompting an operator to land a follow-up migration to extend the horizon.
- **No runtime DDL:** The worker never calls CREATE TABLE. The F-01 non-superuser boundary is fully preserved.

### statement_timeout and idle_in_transaction_session_timeout

Migration 0021 also sets:
```sql
ALTER ROLE medicore_app SET statement_timeout                  = '30000ms';
ALTER ROLE medicore_app SET idle_in_transaction_session_timeout = '60000ms';
```

These move the timeouts from the node-pg pool client option (a session-level SET on connect, which leaks across PgBouncer transaction-mode connections) to role-level defaults that survive `DISCARD ALL` / `RESET ALL` correctly. Under PgBouncer `server_reset_query = DISCARD ALL`, `RESET ALL` restores each GUC to its role default — not to 0. This is the correct behavior for pooled connections.

---

## Consequences

### Positive

- `audit_logs` partition pruning dramatically improves date-range query performance for `recordDailyIntegrity`, `verifyIntegrity`, data retention cron, and HIPAA audit queries.
- HIPAA 7-year retention can be enforced by dropping an entire monthly partition (`DROP TABLE audit_logs_part_2033_05`) — O(1) DDL, no DELETE+VACUUM required.
- The hash chain (`audit_integrity_checks`) is unaffected — daily ranges are within one partition.

### Negative / trade-offs

- Drizzle schema (`lib/db/src/schema/audit_logs.ts`) still declares `id: serial("id").primaryKey()`. The actual DB PK is composite. This mismatch is intentional — Drizzle's plain `.select()/.insert()` queries do not use the PK definition for query generation. Relational queries (`db.query.*`) are not used for `auditLogsTable`. This is the same pattern as 0015 (RLS policies not modeled in Drizzle schema).
- Partition horizon must be extended every few years via a new migration (operator-triggered after the `audit_partition_months_remaining` alert fires).
- Partition count (~132 + 1 DEFAULT) adds minor planner overhead. Acceptable at Postgres 16 partition counts in the hundreds.

---

## Verification checklist

- [ ] `SELECT relkind FROM pg_class WHERE relname = 'audit_logs'` returns `'p'` (partitioned).
- [ ] `SELECT COUNT(*) FROM audit_logs` matches the pre-migration row count.
- [ ] `SELECT * FROM audit_integrity_checks ORDER BY checked_date DESC LIMIT 7` shows no `status = 'mismatch'` rows.
- [ ] Insert a row with `created_at = '2040-01-01'` → lands in `audit_logs_part_default` (no error).
- [ ] Existing RLS + clinic-id integration tests pass (`pnpm --filter @workspace/api-server run test:integration-db`).
- [ ] `EXPLAIN SELECT * FROM audit_logs WHERE created_at BETWEEN '2026-06-01' AND '2026-06-30'` shows a single-partition scan.
