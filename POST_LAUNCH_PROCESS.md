# MediCore Post-Launch Stabilization & Operations Guide (Phase 13)

This document outlines the operational procedures for the first 4 weeks post-launch (Weeks 19-22) and establishes the ongoing protocols for maintaining the MediCore Clinic-Hub in a production environment.

## 1. Daily Metrics Review (First 14 Days)

During the first two weeks of production traffic, the On-Call Engineer must perform a daily review of the Grafana dashboards at 09:00 AM local time.

**Checklist:**
- [ ] **P95 Latency:** Verify that P95 latency remains under 500ms during peak hours (08:00 - 16:00).
- [ ] **Error Rates:** Verify that the global 5xx error rate remains below 0.1%.
- [ ] **Database Connection Pool:** Ensure `pg_stat_activity` shows no connection spikes near the maximum pool size.
- [ ] **Slow Queries:** Review the PostgreSQL slow query logs for any query taking longer than 1000ms.
- [ ] **Redis Pub/Sub:** Verify that SSE dropped connection rates are within acceptable margins.

## 2. Bug Triage & Hotfix Process

Bugs discovered in production follow a strict triage pipeline:

1. **P0 (Critical - PHI Exposure, Complete Outage):**
   - **SLA:** Immediate acknowledgment (15 mins), resolution within 4 hours.
   - **Process:** Engineer halts all feature work. Fix implemented directly on a `hotfix/*` branch off `main`. Code requires 2 approvals. CI must pass. Immediate deploy.
2. **P1 (High - Core Workflow Blocked, e.g., Cannot Book Appointments):**
   - **SLA:** Resolution within 24 hours.
   - **Process:** Next up in current sprint.
3. **P2 (Medium - UI Bug, Non-blocking Error):**
   - **SLA:** Next sprint scheduling.
4. **P3 (Low - Cosmetic):**
   - **SLA:** Backlog.

## 3. Performance Baseline Establishment

By Week 22, the engineering team will lock in the production baseline metrics based on real-world usage patterns.
- Average daily active users (DAU).
- Peak requests per second (RPS).
- Average memory consumption per Node.js instance.
*Any deviation of >25% from these baselines will trigger a Prometheus automated alert.*

## 4. Audit Log Growth Monitoring

The `audit_logs` table scales linearly with usage. Since this table is append-only and immutable:
- **Monitoring:** The DB alerting rules will fire a warning when the `audit_logs` table exceeds 10GB.
- **Action Plan:** When the warning fires, we will implement the PostgreSQL table partitioning strategy (partitioning by month) defined in ADR-005.

## 5. User Feedback Collection & Triage

- Feedback is collected via the front-desk staff portal and aggregated weekly.
- Product Management will review feedback every Friday.
- Usability issues preventing patient care are automatically escalated to P1.

## 6. Incident Post-Mortem Process

For every P0 or P1 incident, a blameless post-mortem must be drafted within 48 hours of resolution.

**Template:**
1. **Incident Summary:** What happened, when, and impact.
2. **Timeline:** Chronological order of events.
3. **Root Cause Analysis (5 Whys):** Deep dive into the failure point.
4. **Resolution:** What was done to mitigate the issue.
5. **Action Items:** Ticket numbers for structural fixes (e.g., adding missing tests, updating runbooks, improving alerting).
