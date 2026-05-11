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

### 2.2. Restoring from Backup

Backups are verified weekly via `scripts/backup-verify.mjs`. To restore:

1.  Identify the latest clean backup in the secure storage location.
2.  Provision a fresh PostgreSQL instance.
3.  Stop all incoming traffic to prevent split-brain issues.
4.  Run the restore command:
    ```bash
    zcat medicore_YYYY-MM-DD_HH-MM-SS.sql.gz | psql "postgres://user:pass@host:port/dbname"
    ```
5.  Update `DATABASE_URL` to point to the new instance.
6.  Restart `api-server` instances.
7.  Verify data integrity via `/api/healthz/ready` and manual spot-checks of recent records.
8.  Restore traffic.

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

## 5. Contact Information

(Add specific contact info for on-call engineers, management, and vendors here).
