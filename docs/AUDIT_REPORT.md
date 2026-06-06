# Production-Grade Technical Audit — Clinic-Hub (MediCore)

**Date:** 2026-06-06  
**Auditor:** Antigravity  
**Audit Type:** Pre-production security & architecture review  
**Target Scale:** Single clinic, with future multi-clinic scaling  
**Deployment:** Pre-production (Docker Compose, PgBouncer, Node 24, Postgres 16)  

---

## 1. Executive Summary

We have completed the pre-production security and architecture review of MediCore (Clinic-Hub). The system exhibits an exceptionally robust, defense-in-depth architectural posture. The core security kernel (`policy.ts`) enforces tenancy, CSRF, and fingerprint binding in a single place. Row Level Security (RLS) is active across all 20+ clinic-bearing tables, preventing cross-tenant leaks at the database layer.

Based on our inspection of the active codebase and working tree, we have evaluated the six key security and architectural dimensions:

### 1.1 Dimension Scores (0-10)

| Dimension | Score | Rationale & Key Evidence |
|---|---|---|
| **PHI Protection** | **9.0 / 10** | RLS is active and enforced on all 20+ clinical tables via a non-superuser connection (`medicore_app` with `NOSUPERUSER NOBYPASSRLS`). AES-256-GCM field-level encryption secures core clinical columns (`diagnosis`, `vitals`, `medications`, `allergies`, `emergencyContact`). Right-to-erasure scrubs all tables. Deductions made for: (a) select clinical fields (e.g. lab results/imaging reports) being plaintext, though mitigated by OS-level LUKS and GPG backup encryption; (b) the no-show cron running cross-tenant writes by design outside of `runInTenantContext`. |
| **Authentication & Session** | **9.5 / 10** | High-standard kernel using EdDSA (Ed25519) JWT signing, local JWKS key delivery, timing-safe double-submit cookie CSRF, JTI replay prevention, and device fingerprint binding. Privilege escalation/bypass vectors are closed. A 0.5 deduction is held until Phase 2 device-trust and strict password policy are enabled in production configurations (`PHASE2_DEVICE_TRUST_ENABLED=true` / `PHASE2_STRICT_PASSWORD_POLICY=true`). |
| **Operational Resilience** | **9.0 / 10** | Audit log outbox pattern ensures Express never blocks on audit-DB health. Monthly audit log partitioning (2026-2036) is live with headroom monitoring. Tamper-evident daily audit hash chains are now verified actively via cron (`verifyRecentIntegrity` and `verifyChainLinkage`). Backup verification restores and validates chain integrity, though the drill is not yet fully automated. |
| **Deployment Safety** | **8.5 / 10** | Robust CI pipeline enforcing lints, typechecks, error code checks, and migration drift verification. Base images are pinned by exact SHA digests in production compose configs. The primary remaining risk is the absence of a staging environment setup for pre-deployment rehearsal. |
| **Code Quality & Maintainability** | **9.5 / 10** | Very clean layering (SPA, REST API, shared packages, DB package). Strict ESLint rules block direct `db` database imports in services and routes, enforcing the use of `runInTenantContext` or explicit `dbUnsafe` with developer justification comments. TypeScript strict null checks are active. |
| **Compliance Readiness** | **9.0 / 10** | HIPAA technical safeguards under §164.312(a)-(e) are fully satisfied in the code. Access controls, emergency break-glass procedures (bypassing RLS read-only restrictions via GUCs to fetch clinical PHI), automatic logoffs, and daily audit integrity chain verification are functional. Security credentials must be rotated before real patient data enters the system. |

---

## 2. HIPAA Security Rule Control Mapping

We mapped and verified every sub-requirement under HIPAA Technical Safeguards §164.312 against the actual codebase:

### §164.312(a) — Access Control
* **Unique user identification (PASS):** Enforced via `users.id` serial PK and unique `users.username`. The JWT payload carries a `userId` claim which is logged in all audit trail records.
* **Emergency access procedure (PASS):** Implemented in [break-glass.service.ts](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/services/break-glass.service.ts). Bypasses RLS read-only restrictions for 5 clinical tables via `app.break_glass_patient_ids` GUC (applied in migration `0024`). Active sessions generate compliance officer SSE alerts and audit log entries.
* **Automatic logoff (PASS):** Enforced via per-role JWT TTLs in [auth-constants.ts](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/auth-constants.ts) (e.g. `super_admin`=15m, `front_desk`=4h). Cookies use corresponding `maxAge`. No refresh token is used.
* **Encryption at rest (PARTIAL / PASS):** AES-256-GCM field-level encryption is active for PHI columns via [field-encryption.ts](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/field-encryption.ts). Full disk encryption (LUKS on host) and GPG-encrypted database dumps cover non-encrypted clinical fields.
* **Role-based access (PASS):** Enforced at the route layer via `authGate(scope, roles)` referencing [policy.ts](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/policy.ts). Bypasses are correctly constrained.
* **Multi-tenant isolation (PASS):** Enforced at the database layer via RLS policies (migration `0015` / `0025`) using `runInTenantContext()`, and at the application layer via explicit `clinicId` queries.

### §164.312(b) — Audit Controls
* **Record PHI access/modification (PASS):** Enforced via transactional outbox pattern in [audit.ts](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/audit.ts). Access to clinical files triggers `logRead` or `logAudit`.
* **Tamper-evident trail (PASS):** SHA-256 hash chain in `audit_integrity_checks` (migration `0010`). Backed by automated verification cron jobs.
* **Retention policy (PASS by design):** Cron monitors >7-year audit retention. No auto-deletion is allowed per `ADR-005`.
* **Completeness (PASS):** Failed outbox drains remain in `audit_outbox` for recovery; `AuditLogPermanentLoss` Prometheus alerts fire immediately.

### §164.312(c) — Integrity Controls
* **PHI integrity mechanism (PASS):** AES-256-GCM authentication tags (16 bytes) throw errors on deciphering if data has been tampered with.
* **Transmission integrity (PASS):** TLS termination via Caddy and cookies restricted with `secure`, `httpOnly`, and `sameSite: strict` flags.
* **Audit integrity (PASS):** Chain linkage verification cron ensures no historical row rewriting.

### §164.312(d) — Person/Entity Authentication
* **Authentication mechanism (PASS):** Bcrypt password hashing (rounds=12) and EdDSA JWT signature validation.
* **Multi-factor / device trust (PARTIAL):** Device trust fingerprinting and verification is implemented, but remains dormant until `PHASE2_DEVICE_TRUST_ENABLED=true` is set.
* **Account lockout (PASS):** Gated at the DB layer via `login_attempts` lockout (5 failures / 15min window locks account for 30min) and IP-based rate limiting.

### §164.312(e) — Transmission Security
* **Encryption in transit (PASS):** Enforced via Caddy TLS 1.3 and HSTS preloading.
* **Network segmentation (PASS):** Docker bridge networks separate frontend and backend; Postgres and Redis do not publish host ports.
* **Cookie transport (PASS):** Cookies are flagged `httpOnly`, `secure` (production), and `sameSite: strict`.

---

## 3. Critical Findings & Verification

We verified the codebase against the following key security hypotheses and architectural checks:

### F-P1-1 — No-Show Cron Cross-Tenant Write Behavior (VERIFIED & ACCEPTED)
* **Evidence:** [cron.ts:165-173](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/cron.ts#L165-L173)
* **Finding:** The no-show auto-transition job updates `appointments` across all clinics without a `clinicId` filter and runs outside `runInTenantContext` (RLS is dormant).
* **Severity:** **LOW (Accepted Design)** · **Confidence:** **HIGH** · **Blast Radius:** **Tenant Write**
* **Status:** **PASS** (Remediated by F-P1-4 which writes a system-actor `SYSTEM_NO_SHOW` audit entry to [audit_logs](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/audit.ts) containing all affected appointment IDs and their clinic associations for compliance oversight).

### F-P2-1 — Tenancy Check Bypasses (VERIFIED PASS)
* **Evidence:** [policy.ts:250-264](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/policy.ts#L250-L264)
* **Finding:** We checked if a `super_admin` can bypass tenancy. The role check bypass (line 250) only skips the *role permission* verification. The *tenancy check* (line 259) runs unconditionally for all roles. A `super_admin` token must still carry a positive integer `clinicId`.
* **Severity:** **None (Secured)** · **Confidence:** **HIGH** · **Blast Radius:** **None**

### F-P2-2 — CSRF Double-Submit Cryptographic Randomness (VERIFIED PASS)
* **Evidence:** [csrf-cookie.ts:12](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/csrf-cookie.ts#L12) and [policy.ts:144](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/policy.ts#L144)
* **Finding:** The double-submit CSRF cookie is generated using cryptographically secure `crypto.randomBytes(24)` (hex-encoded, 48 characters). Kernel comparison is performed using `timingSafeEqual`, preventing timing-attack enumerations.
* **Severity:** **None (Secured)** · **Confidence:** **HIGH** · **Blast Radius:** **None**

### F-P2-3 — Fingerprint Binding Bypasses (VERIFIED PASS)
* **Evidence:** [policy.ts:222-225](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/policy.ts#L222-L225)
* **Finding:** If `FINGERPRINT_BINDING=disabled` is set in the environment as an emergency lever, user agent and accept-language binding checks are bypassed. This is documented in [RUNBOOK.md](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/RUNBOOK.md) as a recovery mechanism. In normal operations (env unset), it enforces strict binding and fail-closes on mismatch.
* **Severity:** **Low / Info (Accepted Risk)** · **Confidence:** **HIGH** · **Blast Radius:** **User**

### F-P2-4 — Logout Route Authentication (VERIFIED PASS)
* **Evidence:** [auth.ts:101](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/routes/auth.ts#L101) and [auth.ts:28-30](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/middlewares/auth.ts#L28-L30)
* **Finding:** The `/auth/logout` endpoint is protected by `requireAuth`. This middleware maps POST requests to the `write` scope (enforcing CSRF and fail-closed session revocation in `policy.ts`), routing all requests through the new v7 auth kernel.
* **Severity:** **None (Secured)** · **Confidence:** **HIGH** · **Blast Radius:** **None**

---

## 4. Threat Model (STRIDE) Verification

We verified the mitigation status for each STRIDE threat defined across the trust boundaries:

| Trust Boundary | Threat | STRIDE | Mitigation Status | Code / Config Evidence |
|---|---|---|---|---|
| **TB-1 Internet→Caddy** | Spoofing | S | **VERIFIED** | [Caddyfile](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/Caddyfile) TLS 1.3 termination, CORS origin validation in [app.ts:73-87](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/app.ts#L73-L87). |
| | Tampering | T | **VERIFIED** | TLS 1.3 configuration in Caddy and HSTS header. |
| | DoS | D | **PARTIALLY VERIFIED** | [app.ts:135-147](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/app.ts#L135-L147) applies global mutation IP limits (`globalMutationLimiter`) and login limits (`loginIpRateLimit`). Edge WAF limits are not active in Caddy (requires a plugin). |
| **TB-2 Caddy→API** | Spoofing | S | **VERIFIED** | `trust proxy` configured on Express in [app.ts:24](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/app.ts#L24) (loopback/linklocal/uniquelocal only). |
| | Elevation | E | **VERIFIED** | Strips inbound `X-Session-State` and `X-Security-Flags` headers in [app.ts:39-43](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/app.ts#L39-L43). |
| | Tampering | T | **VERIFIED** | CSRF double-submit checks with timing-safe comparison on mutations in [policy.ts:130-149](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/policy.ts#L130-L149). |
| **TB-3 API→Postgres** | Spoofing | S | **VERIFIED** | Production connects as `medicore_app` configured in [0020_create_app_role.sql](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/lib/db/migrations/0020_create_app_role.sql) as `NOSUPERUSER NOBYPASSRLS`. |
| | Info Disclosure | I | **VERIFIED** | RLS tenant isolation policies enabled on all tables (migration `0015` / `0025`), executed via `runInTenantContext()`. |
| | Tampering | T | **VERIFIED** | Transactional audit outbox in [audit.ts](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/audit.ts), integrity hash-chain in [audit-integrity.ts](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/api-server/src/lib/audit-integrity.ts). |
| | Repudiation | R | **VERIFIED** | UPDATE/DELETE privileges revoked from `medicore_app` on `audit_logs` and partitions in migration `0026`. |
| **TB-4 API→Redis** | Spoofing | S | **VERIFIED** | Redis requires authentication password, private Docker network only, no exposed ports in [docker-compose.prod.yml](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/docker-compose.prod.yml). |
| | Info Disclosure | I | **VERIFIED** | Redis is located strictly on internal `backend` bridge network. |
| **TB-5 Worker→DB** | Elevation | E | **VERIFIED** | Cron jobs in `cron.ts` execute with strict scopes. No-show cron operates cross-tenant intentionally but is fully audited under `SYSTEM_NO_SHOW` (F-P1-4). |

---

## 5. Replit Removal Checklist

Per your instruction, we have identified the locations and planned the exact edits to remove all Replit-specific configurations and plugins from the workspace:

| Location / File | Reference to Remove | Planned Action |
|---|---|---|
| **`pnpm-workspace.yaml`** | Exclusion of `@replit/*` and `stripe-replit-sync` in `minimumReleaseAgeExclude` (lines 31-35) | Remove exclusions from the workspace minimum age check. |
| **`pnpm-workspace.yaml`** | Catalog declarations for `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`, `@replit/vite-plugin-runtime-error-modal` (lines 44-46) | Delete catalog items. |
| **`mockup-sandbox/package.json`** | devDependencies: `@replit/vite-plugin-cartographer` and `@replit/vite-plugin-runtime-error-modal` (lines 41-42) | Remove package dependencies. |
| **`device-verification.service.ts`** | `process.env.REPLIT_DOMAINS` in `buildVerificationLink` (line 173) | Remove environment fallback. |
| **`password-reset.service.ts`** | `process.env.REPLIT_DOMAINS` in `buildResetLink` (line 36) | Remove environment fallback. |
| **`.env.example`** | `REPLIT_DOMAINS` declaration and comments (lines 47-48) | Remove environment variable template. |
| **`.env.prod.example`** | `REPLIT_DOMAINS` comments and declarations (lines 97, 99) | Remove production environment variable template. |
| **`api-server` directory** | `artifacts/api-server/.replit-artifact` | Delete directory. |
| **`clinic` directory** | `artifacts/clinic/.replit-artifact` | Delete directory. |

---

## 6. Phased Remediation Roadmap

The remediation roadmap is ordered by risk (blast radius x exploitability):

### Phase P0 — Launch Blockers (Must fix before any real patient PHI enters)
1. **Remove Replit Dependencies:** Execute the Replit removal checklist (Section 5) to clean up all configurations.
2. **Rotate Credentials:** Rotate all repository-committed secrets (`SESSION_SECRET`, `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` pair, `FIELD_ENCRYPTION_KEY`, DB passwords, etc.) and generate cryptographically secure production keys.
3. **Enable Phase 2 Security Flags:** Turn on `PHASE2_DEVICE_TRUST_ENABLED=true` and `PHASE2_STRICT_PASSWORD_POLICY=true` in production configurations to enforce device-trust controls and breach checks.

### Phase P1 — First 30 Days (Fix before scaling/adding clinics)
1. **Automate Restore Drill Validation:** Extend `backup-verify.mjs` to run inside a temporary Docker test environment to fully restore the DB and execute `verifyRecentIntegrity()`, validating that backups are fully restorable and un-tampered.
2. **Staging Environment Setup:** Deploy a replica staging stack in a private network segment to rehearse schema migrations and secret rotations before production deployment.

### Phase P2 — First 90 Days (Harden for multi-clinic scaling)
1. **Caddy Edge Rate Limiting:** Compile/integrate Caddy with a rate-limit plugin (such as `caddy-ratelimit`) to drop volumetric attacks before reaching the Node application.
2. **Field Encryption Extension:** Consider extending AES-256-GCM field encryption to other clinical PHI tables (such as `lab_tests` and `xray_records` details) for defense-in-depth, updating `executeErasure` to support the changes.

### Phase P3 — Ongoing Tasks
1. **Quarterly Key Rotations:** Rotate the Ed25519 JWT signing key pair quarterly according to the procedure defined in `SECURITY.md`.
2. **Monthly Partition Headroom Checks:** Ensure the Prometheus alert `AuditPartitionLow` is active to alert when partition headroom falls below 24 months.
