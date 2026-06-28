# MediCore Incident Response & Operational Runbook

This document defines the standard operating procedures for the MediCore Clinic-Hub platform. It is intended for on-call engineers, system administrators, and technical leadership.

---

## §0. Database Role Architecture

Two Postgres roles serve distinct purposes. Never swap them.

| Role | Purpose | Privileges |
|---|---|---|
| `${POSTGRES_USER}` (bootstrap superuser) | Runs migrations (DDL: CREATE TABLE, ALTER, INDEX). Used by the `migrate` container only. | SUPERUSER — bypasses all RLS. Never give this to api/worker. |
| `medicore_app` (NOSUPERUSER NOBYPASSRLS) | Runtime api + worker. All DML (SELECT/INSERT/UPDATE/DELETE). | Non-superuser → RLS enforces inside `runInTenantContext`. |

**Connection split (docker-compose.prod.yml):**
- `migrate` → `DATABASE_URL = postgresql://${POSTGRES_USER}:$(postgres_password)@postgres:5432/${POSTGRES_DB}`
- `api` / `worker` → `DATABASE_URL = postgresql://medicore_app:$(app_db_password)@postgres:5432/${POSTGRES_DB}`

**Password rotation (app_db_password):**
1. Generate a new value: `openssl rand -base64 48 | tr -d '\n' > ./secrets/app_db_password`
2. Restart the stack: `docker compose -f docker-compose.prod.yml up -d` — the `migrate` container sets the new password via `ALTER ROLE medicore_app LOGIN PASSWORD '...'` and the smoke gate verifies the connection before api/worker start.

**Rollback caveat (migration 0020):** Rolling back past migration 0020 removes the
`CREATE ROLE medicore_app` statement but leaves the role in the DB. If you need a full
role cleanup: `DROP ROLE medicore_app;` (run as superuser). The api/worker DATABASE_URL
must be switched back to the bootstrap superuser before the role is dropped, or they
will fail to connect. Treat any rollback past 0020 as a SEV-1 data-access event.

**Verification (after a deploy):**
```sh
docker compose exec api sh -c 'node -e "const{Pool}=require(\"pg\");const p=new Pool({connectionString:process.env.DATABASE_URL});p.query(\"SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user\").then(r=>console.log(r.rows[0])).then(()=>p.end())"'
```
Expected: `{ current_user: 'medicore_app', rolsuper: false, rolbypassrls: false }`

---

## 1. Incident Severity Definitions

*   **SEV-1 (Critical):** Complete system outage, data loss, or confirmed PHI breach. Immediate paging of all stakeholders.
*   **SEV-2 (High):** Major feature broken (e.g., cannot check in patients, doctor schedules failing) or severe performance degradation.
*   **SEV-3 (Medium):** Non-critical feature broken or localized performance issues.
*   **SEV-4 (Low):** Minor bug or cosmetic issue.

## 2. Database Failover & Restore Procedure

### 2.1. Failover

If the primary PostgreSQL database goes down:

1.  Acknowledge the alert.
2.  Switch the `DATABASE_URL` environment variable to the standby replica.
3.  Restart the `api-server` instances.
4.  Verify functionality via `/api/healthz/ready`.
5.  Promote the standby to primary in your infrastructure provider.

> **Current limitation:** the compose stack ships single-instance Postgres
> (no warm standby). The above steps assume a managed-Postgres deployment
> with a configured read replica. For the bundled compose deployment the
> only recovery path is §2.2 (restore from backup). Adding warm standby is
> tracked as plan item D2.

### 2.2. Restoring from Backup

Backups are produced + verified by `scripts/backup-verify.mjs`. In production
they are GPG-encrypted (`.sql.gz.gpg`); see [BACKUP_KEY_MANAGEMENT.md](docs/BACKUP_KEY_MANAGEMENT.md)
for the keypair, escrow envelopes, and drill procedure.

1.  Identify the latest clean backup. Local path is `$BACKUP_STORAGE_PATH`;
    offsite copy is wherever `$OFFSITE_UPLOAD_COMMAND` writes (e.g.,
    `rclone copy backblaze:medicore-backups/ ./local-restore/`).
2.  Provision a fresh PostgreSQL instance (compose or managed).
3.  Stop all incoming traffic at the edge (Caddy) to prevent split-brain.
4.  Restore. Pick the line that matches the backup file extension:
    ```bash
    # Encrypted backups (production default):
    gpg --batch --yes --decrypt medicore_YYYY-MM-DD_HH-MM-SS.sql.gz.gpg \
      | gunzip -c \
      | psql "postgres://user:pass@host:port/dbname" -v ON_ERROR_STOP=1

    # Unencrypted backups (dev/staging only):
    zcat medicore_YYYY-MM-DD_HH-MM-SS.sql.gz \
      | psql "postgres://user:pass@host:port/dbname" -v ON_ERROR_STOP=1
    ```
    `ON_ERROR_STOP=1` aborts on the first SQL error so a partial restore
    does not silently complete with missing rows.
5.  **CRITICAL — Erasure re-application (GDPR/HIPAA).** A pg_dump backup taken
    before an erasure request's blackout window expires contains pre-erasure PHI.
    Restoring such a backup silently revives erased patient data. Before
    promoting the restored instance to production, run:

    ```sql
    -- Run against the RESTORED database.
    SELECT id, patient_id, executed_at, erasure_blackout_until
    FROM erasure_requests
    WHERE status = 'executed'
      AND erasure_blackout_until IS NOT NULL
      AND erasure_blackout_until > now()
    ORDER BY executed_at DESC;
    ```

    For each row returned, re-apply anonymization using the same SQL that
    `executeErasure()` runs in production:

    ```sql
    -- Replace :patient_id with the value from the query above.
    BEGIN;
    UPDATE patients SET
      full_name='[ERASED]', full_name_ar='[ERASED]', phone='[ERASED]',
      address=NULL, allergies='[ERASED]', emergency_contact=NULL,
      date_of_birth='1900-01-01', blood_type=NULL,
      is_active=false, deleted_at=now(), updated_at=now()
    WHERE id = :patient_id;

    UPDATE medical_records SET
      chief_complaint='[ERASED]', diagnosis='[ERASED]',
      treatment='[ERASED]', notes=NULL, vitals=NULL, updated_at=now()
    WHERE patient_id = :patient_id;

    UPDATE prescriptions SET deleted_at=now(), updated_at=now()
    WHERE patient_id = :patient_id AND deleted_at IS NULL;
    COMMIT;
    ```

    Log each re-application as a SEV-2 incident for the audit trail.

    > **Automated check**: `backup-verify.mjs --restore` runs this query
    > automatically after the restore drill and **fails** if active blackouts
    > are found, preventing accidental promotion of a tainted restore.

6.  **CRITICAL — Recreate the runtime app role + grants (F-P6-8).** Backups are
    dumped with `--no-owner --no-acl`, which strips every `GRANT` to `medicore_app`,
    and the `medicore_app` role is cluster-global so it does **not** exist in a
    freshly provisioned instance. Without this step, api/worker (which connect as
    `medicore_app`, NOSUPERUSER) get *permission denied* / *role does not exist* on
    every query. Run as the restore-target superuser (re-applies migration 0020 +
    0026):

    ```sql
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medicore_app') THEN
        CREATE ROLE medicore_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END $$;
    -- Set the same password the api/worker DATABASE_URL uses (./secrets/app_db_password):
    ALTER ROLE medicore_app LOGIN PASSWORD '<contents of ./secrets/app_db_password>';
    GRANT USAGE ON SCHEMA public TO medicore_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO medicore_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medicore_app;
    -- 0026: audit_logs is append-only for the app role (parent + every partition).
    REVOKE UPDATE, DELETE ON audit_logs FROM medicore_app;
    DO $$ DECLARE part text; BEGIN
      FOR part IN SELECT inhrelid::regclass::text FROM pg_inherits
                  WHERE inhparent = 'audit_logs'::regclass LOOP
        EXECUTE format('REVOKE UPDATE, DELETE ON %s FROM medicore_app', part);
      END LOOP;
    END $$;
    ```

    Verify before promoting: connect **as `medicore_app`** and confirm it is
    non-superuser and can read a tenant table —
    `psql "postgres://medicore_app:…@host/db" -c "SELECT count(*) FROM patients;"`
    must succeed (the quarterly drill automates this; see §12).
7.  Update `DATABASE_URL` to point to the new instance.
8.  Restart `api-server` instances.
9.  Verify data integrity via `/api/healthz/ready` and manual spot-checks of
    recent records (e.g., `SELECT MAX(created_at) FROM patients;`).
10. Restore traffic at the edge.

### 2.3. Backup & Restore Validation Cadence

| Cadence | What runs | How |
|---|---|---|
| **Nightly (02:00 UTC)** | `backup-verify.mjs` — dump, encrypt, local decrypt-and-inspect, offsite upload, retention sweep | Automated via the `backup` service loop in `docker-compose.prod.yml` |
| **Quarterly (1st day of Q1/Q2/Q3/Q4)** | `backup-verify.mjs --restore` — full chain (decrypt + psql replay), patient row-count sanity, erasure-blackout check, audit integrity check, measured RTO | Manual — see §12 for the full drill procedure |
| **Annual** | GPG keypair rotation per [BACKUP_KEY_MANAGEMENT.md](docs/BACKUP_KEY_MANAGEMENT.md) §"Rotation policy" | Manual; coordinate with the on-call rotation |

A failed nightly run must page on-call within 1 hour. A failed quarterly drill
is itself a SEV-2 — the backups are not proven recoverable.

## 3. Investigating Rate Limit & DDoS Alerts

If the system detects a spike in 429 Too Many Requests errors:

1.  Check the API logs for the IP addresses hitting the limits. Look for the `correlationId` to trace the requests.
2.  If the traffic is malicious, block the IP range at the WAF/load balancer level.
3.  If the traffic is legitimate but misconfigured (e.g., a runaway script), contact the user/admin.
4.  To temporarily increase limits during an expected surge, adjust the rate limiter configuration and restart the service.

## 4. Troubleshooting Checklist

*   **API returns 503:** Check the `/api/healthz/ready` endpoint. The DB might be unreachable or the connection pool might be exhausted.
*   **API returns 500:** Check the application logs. Search for "Internal server error" and the associated `correlationId`.
*   **Users cannot log in:** Verify the DB connection. Check if the user is locked out due to rate limiting.
*   **Performance degradation:** Check memory usage and DB pool stats in the readiness probe. Review slow query logs in PostgreSQL.

## 5. Symptom: Users Logged Out Unexpectedly Mid-Session

**Likely cause**: Browser auto-update changed the `User-Agent` header → `fph` fingerprint mismatch → server rejects token with error code `1004` (`AUTH_TOKEN_FINGERPRINT_MISMATCH`). The frontend shows a toast: *"Your session was invalidated because your browser changed."*

**Recovery**: User logs in again. The session was **not compromised** — the fingerprint binding is working as designed.

**If widespread (e.g., Chrome pushed a silent update across all workstations)**:
1. Set `FINGERPRINT_BINDING=disabled` in the environment.
2. Restart the API server.
3. Notify affected staff to log in again.
4. Re-enable `FINGERPRINT_BINDING` (remove the env var) after the update wave completes and all users have re-authenticated.

**Note**: Fingerprint binding only applies to tokens that were originally issued with an `fph` claim. Tokens without `fph` (e.g., issued before fingerprint binding was enabled) are unaffected.

## 6. Service Level Targets

| Metric | Target | Basis | Improvement path |
|---|---|---|---|
| Uptime | **99.5%** (~3.6 h/month) | Single-VM compose deployment with no warm standby. Reach 99.9% only after plan item D2 (Patroni / managed Postgres). | D2 |
| **RTO** (Recovery Time Objective) | **4 hours** for SEV-1 | Download offsite backup → provision fresh Postgres → decrypt + replay → smoke test → cut traffic over | D2 (warm standby) → ~30 min |
| **RPO** (Recovery Point Objective) | **24 hours** | Nightly `backup-verify.mjs` cron at 02:00 UTC. Worst case: outage at 01:59 loses ~24h of writes. | Plan D3 follow-up: pgBackRest/wal-g with WAL streaming → RPO ~15 min |

Targets must be re-validated after every quarterly chaos drill (§7).
Slipping more than one drill in a row demotes the stated target until it is
re-proven in a clean run.

## 7. Chaos Drill Cadence

Quarterly, on a non-clinical day, in a clone of production:

| Drill | Pass criteria |
|---|---|
| **Restore-from-backup** | `backup-verify.mjs --restore` against an ephemeral DB completes within RTO; sanity row counts match expected ranges. |
| **Primary DB kill** | `docker compose -f docker-compose.prod.yml kill postgres` → measure how long until clinic surface is usable again; must complete within the stated RTO. |
| **Redis loss** | Stop the redis container while a doctor session is active; verify token continues to work (read-scope soft-fail per plan A6 decision) or fails closed per the documented policy. |
| **Edge proxy loss** | Stop Caddy; verify alerting fires within 5 minutes; restart and confirm TLS still serves without manual cert work. |

Record each drill's outcome (date, who ran it, observed RTO/RPO, deviations
from target) in an ops log entry. A drill failure is itself a SEV-2 incident —
the controls being drilled are unproven.

## 8. On-Call Rotation

The engineering team utilizes a primary and secondary on-call rotation.
*   **Primary On-Call:** Acknowledges page within 5 minutes. Leads incident response.
*   **Secondary On-Call:** Backs up the primary. Escalated to if primary does not acknowledge within 10 minutes.
*   **Escalation Policy:** Primary -> Secondary -> Engineering Manager -> CTO.

## 9. Contact Information

(Add specific contact info for on-call engineers, management, and vendors here).

## 10. Deployment & Rollback

The api/worker services in `docker-compose.prod.yml` resolve their image from the
`API_IMAGE` / `WORKER_IMAGE` environment variables and fall back to `medicore-api:latest`
when unset. CI tags every main-branch build with the short SHA so any prior build is
re-deployable without rebuilding.

### 10.1 Standard deploy

1. CI builds `registry/medicore-api:<short-sha>` from `main` and writes the tag to
   the build summary (`BUILD_TAG` step output in `.github/workflows/ci.yml`).
2. On the prod host, snapshot the current env before changing it:
   ```bash
   cp .env .env.bak.$(date -u +%Y%m%dT%H%M%SZ)
   ```
3. Update `API_IMAGE` (and `WORKER_IMAGE` if pinned separately) in `.env`:
   ```env
   API_IMAGE=registry/medicore-api:abc1234
   ```
4. Pull + restart without rebuild:
   ```bash
   docker compose -f docker-compose.prod.yml pull api worker
   docker compose -f docker-compose.prod.yml up -d --no-build api worker
   ```
5. Verify health within 60 s:
   ```bash
   curl -sf https://<CADDY_DOMAIN>/api/health | jq '.ok, .checks.db.status, .checks.redis.status'
   ```
   All three must read `true`/`ok`. If any is `error`, proceed to §10.2.

### 10.2 Rollback

1. Identify the previous working tag from the most recent `.env.bak.*` snapshot:
   ```bash
   grep ^API_IMAGE= .env.bak.* | tail -1
   ```
2. Restore the old tag in `.env`, then:
   ```bash
   docker compose -f docker-compose.prod.yml pull api worker
   docker compose -f docker-compose.prod.yml up -d --no-build api worker
   ```
3. Re-verify health (`/api/health`).
4. **Migration check.** If the bad release shipped a migration, the rollback only
   reverts code — DB schema is still forward. Open the migration file and confirm
   it is additive (new tables, new columns, new indexes). If it is destructive
   (dropped column, narrowed type, RLS policy that breaks reads), assess whether
   to:
   - **Roll forward** with a hotfix migration that re-adds the lost shape, or
   - **Restore from backup** (§2.2) and accept the data loss between the failed
     deploy and the backup timestamp.

   Drizzle does not auto-generate down migrations — there is no `db:rollback`.

### 10.3 Blue-green / multi-replica

Not implemented. Single-container deploy is the current footprint. Tracked alongside
the warm-standby work in plan item D2.

## 11. Monitoring & Alerting

### 11.1 Grafana access (SSH-tunnel only)

Grafana is **not** exposed via Caddy. It listens on `127.0.0.1:3000` on the host.
Access it from a workstation:

```bash
ssh -L 3000:localhost:3000 deploy@<prod-host>
# Then in a browser on the workstation: http://localhost:3000
# Login: admin / contents of ./secrets/grafana_password
```

The `MediCore Overview` dashboard is provisioned from
[monitoring/grafana/dashboards/medicore-overview.json](monitoring/grafana/dashboards/medicore-overview.json).

### 11.2 Prometheus

Prometheus has no published port. Reach it for ad-hoc queries via:

```bash
docker compose -f docker-compose.prod.yml exec prometheus \
  wget -qO- 'http://localhost:9090/api/v1/targets' | jq '.data.activeTargets[].health'
```

Reload alert rules without a restart after editing `prometheus-alerts.yml`:

```bash
docker compose -f docker-compose.prod.yml exec prometheus \
  wget -qO- --post-data='' http://localhost:9090/-/reload
```

### 11.3 Alertmanager — silencing

Silence an alert during planned maintenance:

```bash
docker compose -f docker-compose.prod.yml exec alertmanager \
  amtool silence add alertname=HighLatency --duration=1h --comment "planned migration"
```

List + expire silences:

```bash
docker compose -f docker-compose.prod.yml exec alertmanager amtool silence query
docker compose -f docker-compose.prod.yml exec alertmanager amtool silence expire <id>
```

### 11.4 Alert playbooks

| Alert | First action | Escalate to backup if |
|---|---|---|
| `ServiceDown` | `docker compose ps` to see which of api/worker is down; `docker compose logs <job> --tail=200` for the crash cause (OOM, unhandled rejection, failed DB connect). `docker compose up -d <job>` to restart. | Crash-loops after restart → roll back to the last good `API_IMAGE` (§10.2); if DB-connection refused, check Postgres/PgBouncer health. |
| `EdgeProbeDown` | Verify Caddy: `docker compose ps caddy` + `docker compose logs caddy --tail=100`; confirm the domain still resolves and TLS handshakes (`curl -vI https://<domain>/api/health`). | Edge stays unreachable but internal `api` is healthy → DNS/cert/proxy issue, not app; engage infra/network owner. |
| `HighErrorRate` | Tail `docker compose logs api --tail=200`; check the last deploy SHA — if it matches the failing window, roll back (§10.2). | Errors persist after rollback → restore from backup (§2.2). |
| `DBPoolExhaustion` | Inspect `pg_stat_activity`; kill long-running queries; raise `DB_POOL_MAX` only if every conn shows healthy short-lived work. | Pool stays saturated after `+10` slots → DB instance too small, escalate to capacity planning. |
| `AuditLogPermanentLoss` | **HIPAA §164.312(b) breach assessment is mandatory.** Query `audit_outbox_row_exhausted` log entries for affected entity IDs; do NOT delete the outbox rows. | Always — this alert is a SEV-1 by definition. |
| `AuditIntegrityMismatch` | Run `SELECT * FROM audit_integrity_checks WHERE status='mismatch'`; preserve evidence — do NOT update `audit_logs` until investigation completes. | Always — possible tampering, SEV-1. |
| `HighNodeMemory` | Capture heap snapshot (`kill -USR2 <pid>` in container then copy out); restart api container to recover headroom. | RSS climbs back to threshold within 1 h after restart → leak in latest build, roll back. |
| `BackupStale` | Check `docker compose logs backup --tail=200` for the most recent run; verify GPG keyring + SSH target are still valid. | Two consecutive missed runs → restore drill is now overdue, treat as SEV-2. |
| `AuditPartitionLow` | Headroom < 24 future monthly `audit_logs` partitions. Land a follow-up migration (per ADR-009) that `CREATE`s the next batch of monthly partitions. **Append-only is now automatic:** migration 0028's `audit_partition_append_only_trg` event trigger auto-`REVOKE`s UPDATE/DELETE from `medicore_app` on every new audit_logs partition (so 0020's default-privs re-grant can no longer silently re-open it). After landing the migration, verify with `SELECT has_table_privilege('medicore_app','<new_partition>','DELETE')` → must be `false`; the `audit-append-only.integration-db.test.ts` test also enforces this in CI. | Migration can't be landed before the horizon is exhausted → rows fall into the un-prunable DEFAULT partition; escalate. |

### 11.5 Emergency manual backup

If `BackupStale` fires and you need an immediate backup outside the 02:00 UTC slot:

```bash
docker compose -f docker-compose.prod.yml exec backup \
  node scripts/backup-verify.mjs
```

This runs the full dump → encrypt → verify → rsync chain synchronously and writes a
fresh `backup_last_success_timestamp_seconds` after success, clearing the alert.

### 11.6 PgBouncer pool math

PgBouncer sits between api/worker and Postgres. Under transaction pooling each app
transaction borrows a server connection for its duration only.

| Variable | Default | Meaning |
|---|---|---|
| `PGBOUNCER_DEFAULT_POOL_SIZE` | 20 | Connections PgBouncer opens to Postgres per database |
| `PGBOUNCER_MAX_CLIENT_CONN` | 200 | Connections app (api+worker) may open to PgBouncer |
| `DB_POOL_MAX` (per process) | 40 | node-pg connections from one api or worker process to PgBouncer |

**Headroom budget (single replica):**
- api: 40 + worker: 40 = 80 client connections to PgBouncer → PgBouncer: 20 to Postgres.
- Postgres total: 20 (app) + 2 (migrate at deploy) + 1 (backup) ≈ 23 → well under `max_connections=100`.

**Adding a 2nd api replica:** increase `PGBOUNCER_DEFAULT_POOL_SIZE` (not `DB_POOL_MAX`). Two replicas = 80 + 80 = 160 client connections; PgBouncer still multiplexes down to `default_pool_size` server connections. Verify Postgres headroom before increasing.

**Prepared statements:** PgBouncer transaction pooling breaks named prepared statements. node-pg uses unnamed statements by default — safe. If `.prepare()` is ever added to a Drizzle query, either set `max_prepared_statements > 0` in pgbouncer.ini (PgBouncer ≥ 1.21) or keep statements unnamed.

---

## 12. Quarterly Restore Drill Procedure

Run on the 1st calendar day of each quarter (Jan, Apr, Jul, Oct) on a non-clinical day.
A failed drill is a SEV-2 — the recovery path is unproven until re-run clean.

### 12.1 Prepare

1. Provision an ephemeral throwaway Postgres instance (local Docker or a disposable managed-PG):
   ```bash
   docker run -d --name medicore-restore-drill \
     -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=drillpass \
     -e POSTGRES_DB=medicore_restore \
     -p 15432:5432 postgres:16-alpine
   ```
2. Set `RESTORE_DATABASE_URL` in your local shell:
   ```bash
   export RESTORE_DATABASE_URL="postgresql://postgres:drillpass@localhost:15432/medicore_restore"
   ```
3. Record the start time: `date -u` → note it as `DRILL_START`.

### 12.2 Run the drill

```bash
docker compose -f docker-compose.prod.yml exec -e RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" backup \
  node scripts/backup-verify.mjs --restore
```

The script will:
1. Restore the latest backup (`gpg --decrypt | gunzip | psql`).
2. Row-count sanity check (`patients` table).
3. Erasure-blackout check — fails if pre-erasure PHI would be revived (see §2.2).
4. Audit integrity check — fails if any `audit_integrity_checks.status = 'mismatch'`.
5. **App-role usability check (F-P6-8)** — recreates `medicore_app` + re-applies the
   0020 grants / 0026 audit_logs REVOKE on the restored DB (both stripped by
   `pg_dump --no-acl`), then connects **as `medicore_app`** and asserts it is
   non-superuser, RLS-binding, and can read a tenant table. This proves the recovery
   path for the role the app actually uses, not just for the `postgres` superuser —
   the drill fails if the app role cannot be made usable.

### 12.3 Verify and record RTO

After `backup-verify.mjs --restore` exits 0:
1. Record end time: `date -u` → compute `RTO = DRILL_END - DRILL_START`.
2. Spot-check a few recent rows:
   ```bash
   psql "$RESTORE_DATABASE_URL" -c "SELECT MAX(created_at) FROM patients;"
   psql "$RESTORE_DATABASE_URL" -c "SELECT COUNT(*) FROM audit_logs;"
   psql "$RESTORE_DATABASE_URL" -c "SELECT COUNT(*) FROM audit_integrity_checks WHERE status='ok';"
   ```
3. Verify the audit hash chain (optional deep check):
   ```bash
   # In the api-server working directory with DATABASE_URL pointing at the restore DB:
   DATABASE_URL="$RESTORE_DATABASE_URL" node -e "
     const { verifyIntegrity } = require('./dist/lib/audit-integrity');
     const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
     verifyIntegrity(d).then(r => console.log(r)).catch(console.error);
   "
   ```
4. Record in the ops log: `date | drill outcome (pass/fail) | measured RTO | who ran it | any deviations`.

### 12.4 Teardown

```bash
docker rm -f medicore-restore-drill
```

### 12.5 Note on partitioned audit_logs

Since migration 0021, `audit_logs` is a monthly partitioned table. A plain `pg_dump` + `psql` restore round-trips partitioned tables correctly — Postgres replays the DDL (CREATE TABLE audit_logs PARTITION BY RANGE ...) and the partition definitions in the dump, then re-inserts rows. No special restore steps are needed.

The `backup-verify.mjs` patient row-count check and audit integrity check both work identically on the restored partitioned table.

### 12.6 Accepted RTO/RPO (current architecture)

| Metric | Target | Notes |
|---|---|---|
| RTO | 4 hours | Single-VM compose, no warm standby. Re-provision + restore from backup is the only recovery path. |
| RPO | 24 hours | Nightly `pg_dump` at 02:00 UTC; worst-case outage at 01:59 loses ~24h writes. |

SLO re-validation: if the quarterly drill consistently beats 4h RTO, update §6. If it exceeds 4h, escalate to capacity planning and consider managed Postgres with PITR (plan item D2/D3).

