# MediCore Incident Response & Operational Runbook

This document defines the standard operating procedures for the MediCore Clinic-Hub platform. It is intended for on-call engineers, system administrators, and technical leadership.

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

6.  Update `DATABASE_URL` to point to the new instance.
7.  Restart `api-server` instances.
8.  Verify data integrity via `/api/healthz/ready` and manual spot-checks of
    recent records (e.g., `SELECT MAX(created_at) FROM patients;`).
9.  Restore traffic at the edge.

### 2.3. Backup & Restore Validation Cadence

| Cadence | What runs | How |
|---|---|---|
| **Nightly (02:00 UTC)** | `backup-verify.mjs` — dump, encrypt, local decrypt-and-inspect, offsite upload, retention sweep | cron entry: `0 2 * * * cd /opt/medicore && node scripts/backup-verify.mjs` |
| **Quarterly (1st day of Q1/Q2/Q3/Q4)** | `backup-verify.mjs --restore` against an ephemeral DB on the offline restore workstation — proves the full `gpg --decrypt \| gunzip \| psql` chain end-to-end | manual; record outcome in the ops log |
| **Annual** | GPG keypair rotation per [BACKUP_KEY_MANAGEMENT.md](docs/BACKUP_KEY_MANAGEMENT.md) §"Rotation policy" | manual; coordinate with the on-call rotation |

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
