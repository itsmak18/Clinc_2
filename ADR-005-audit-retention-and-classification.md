# ADR-005: Data Retention & Classification Policy

## Context
As a healthcare application handling Protected Health Information (PHI), MediCore must adhere to strict data governance, retention, and classification standards to ensure compliance with HIPAA (and similar international healthcare regulations). We need a defined policy for how long data is retained and how it is classified within the database to guide security controls and auditing.

## Decision
We will implement the following Data Classification and Retention rules:

### 1. Data Classification
All data within the system is categorized into one of three tiers:

*   **Tier 1: PHI (Protected Health Information)**
    *   **Definition:** Any information that can be tied to a patient's identity and relates to their past, present, or future physical or mental health.
    *   **Tables:** `patients` (name, MRN, phone, demographics), `medical_records`, `prescriptions`, `lab_tests`, `xray_records`, `ultrasound_records`, `appointments` (reason, notes).
    *   **Controls:** Must be heavily audited (`logRead`, `logAudit`). Cannot be hard-deleted (soft-delete only). Strict RBAC and scoping (`scope.ts`) enforced.
*   **Tier 2: PII / Operational Sensitive**
    *   **Definition:** Information about staff or operational finance that is sensitive but not patient health data.
    *   **Tables:** `users` (staff details, passwords), `invoices`, `doctor_schedules`.
    *   **Controls:** Audited on mutation. Standard RBAC.
*   **Tier 3: Operational / Ephemeral**
    *   **Definition:** Non-sensitive system data.
    *   **Tables:** `inventory`, `notifications`.
    *   **Controls:** Standard RBAC.

### 2. Retention Policy
*   **Medical Records & PHI:** 7 Years minimum. Implemented via soft-deletes (`deletedAt` columns). Hard deletion of PHI is strictly prohibited without a manual, documented database override by a legal compliance officer.
*   **Audit Logs (`audit_logs`):** 7 Years minimum. To prevent database degradation, audit logs will be partitioned by month once they exceed 500,000 rows. Archived partitions will be moved to cold storage after 1 year.
*   **Backups:** Daily incremental backups, retained for 30 days. Weekly full backups, retained for 1 year.

## Consequences
*   The system must never expose `DELETE` endpoints for medical records or audit logs that execute SQL `DELETE` commands.
*   The `audit_logs` table will grow indefinitely, requiring the future implementation of table partitioning (Phase 14 roadmap).
*   Compliance officers can export audit logs via the `/api/audit-logs/export` endpoint for external retention.
