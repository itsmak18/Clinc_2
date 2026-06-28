# MediCore Threat Model (STRIDE)

This document outlines the STRIDE threat analysis for the Clinic-Hub PHI infrastructure.

## Data Flow & PHI Boundaries
- **Untrusted Zone:** Public Internet, Patient Devices
- **DMZ / WAF:** Cloudflare / Replit Load Balancers
- **Trusted Zone:** Node.js API Server, Redis Cache
- **Restricted Zone:** PostgreSQL Database

**PHI Flow:** `Client -> HTTPS -> NGINX -> API Server (Zod Sanitization) -> Drizzle ORM -> PostgreSQL`

## STRIDE Analysis

### 1. Spoofing (Authentication)
*   **Threat:** An attacker steals an admin's token to access patient records.
*   **Mitigation:** Tokens are HttpOnly cookies with `SameSite=Strict`. `jose` is used to prevent algorithm confusion. `jti` is tracked and invalidated upon privilege changes.

### 2. Tampering (Integrity)
*   **Threat:** A malicious user modifies request payloads to alter clinical data.
*   **Mitigation:** `Zod` schemas strictly strip all unknown fields from `req.body`. All database modifications are executed via parameterized queries via Drizzle ORM to prevent SQL Injection.

### 3. Repudiation (Non-Repudiation)
*   **Threat:** A staff member deletes a medical record and denies doing it.
*   **Mitigation:** Soft-deletes are enforced system-wide. Complete, immutable audit logging records the UserID, Action, and IP Address for every mutation.

### 4. Information Disclosure (Confidentiality)
*   **Threat:** An API endpoint leaks PII/PHI in stack traces or unauthorized queries.
*   **Mitigation:** The global error handler strictly sanitizes 5xx errors in production. The `requireRole` and `doctor scope` middleware enforce row-level tenant isolation.

### 5. Denial of Service (Availability)
*   **Threat:** An attacker floods the login or API endpoints to exhaust resources.
*   **Mitigation:** Redis-backed distributed rate limiting limits mutations to 100 per 15 minutes globally, and stricter limits apply to login endpoints.

### 6. Elevation of Privilege (Authorization)
*   **Threat:** A user modifies the request to escalate their role to `super_admin`.
*   **Mitigation:** Role updates are restricted to `super_admin` in `users.ts`.
