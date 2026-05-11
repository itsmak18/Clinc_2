# MediCore Security Policy & Threat Model

## Threat Model

The MediCore platform is designed to handle Protected Health Information (PHI) and is built with a defense-in-depth approach.

### Key Security Invariants

1.  **Centralized RBAC:** All API routes enforce Role-Based Access Control (RBAC). The `super_admin` role bypasses role arrays but NOT state machine invariants or data-scoping rules.
2.  **Strict Data Scoping:** Doctors can only access medical records and prescriptions for patients they have seen (or if explicitly marked as global).
3.  **PHI Audit Logging:** Every read, create, update, or void action involving PHI is logged centrally to the `audit_logs` table with context.
4.  **Immutable Medical Records:** Prescriptions and medical records cannot be hard-deleted. They are soft-deleted with a reason for auditability.
5.  **CSRF Protection:** All mutating actions (POST, PUT, PATCH, DELETE) require a valid CSRF token, checked via a double-submit cookie pattern.

## Vulnerability Disclosure Policy

We take security seriously. If you believe you have found a security vulnerability in our application, please report it to us immediately.

### Reporting Guidelines

1.  Do not disclose the vulnerability publicly until we have had time to investigate and fix it.
2.  Do not attempt to access, modify, or delete data belonging to other users.
3.  Provide clear, reproducible steps for the vulnerability.

### Contact

Send all security reports to: `security@medicore.example.com`

### Scope

*   `@workspace/api-server`
*   `@workspace/clinic` (Frontend)
*   `@workspace/db` (Database Schema)

We will respond to all reports within 48 hours and work to deploy a fix as soon as possible.
