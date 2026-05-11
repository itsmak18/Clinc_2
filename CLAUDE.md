# MediCore — Clinic Management System

> **CLAUDE.md** — Read this first before touching any code. These are hard rules.

---

## Overview

Full-stack bilingual (EN + AR/RTL) clinic management system for internal healthcare staff. PHI-handling system — treat all patient data as sensitive.

**Monorepo packages:**
- `artifacts/api-server` → Express 5 API (`@workspace/api-server`)
- `artifacts/clinic` → React + Vite frontend (`@workspace/clinic`)
- `lib/db` → Drizzle ORM schema + migrations (`@workspace/db`)
- `lib/api-spec` → OpenAPI spec (`@workspace/api-spec`)
- `lib/api-client-react` → Orval-generated TanStack Query hooks
- `lib/api-zod` → Orval-generated Zod request validators

---

## Stack & Versions

| Tool | Version / Choice |
|---|---|
| Node.js | 24 |
| TypeScript | 5.9 |
| Package Manager | pnpm workspaces |
| Frontend | React 19 + Vite 7 |
| API Framework | Express 5 |
| Database | PostgreSQL 16 + Drizzle ORM |
| Validation | `zod/v4` only (never bare `zod`) |
| API Codegen | Orval from `lib/api-spec/openapi.yaml` |
| Auth | `jose` library (HS256 JWT) — **not** hand-rolled crypto |
| Token Storage | HttpOnly cookie (`clinic_token`) |
| Real-time | Server-Sent Events via Redis Pub/Sub |
| Logging | Pino (structured JSON) with PHI redaction |
| Metrics | Prometheus + Grafana |
| Session Store | Redis (rate limiting, token revocation) |

---

## ABSOLUTE RULES — Never Break These

1. **`super_admin` bypass is centralized in `requireRole()`.** Do NOT add `super_admin` to individual route role arrays. It auto-bypasses.
2. **`verifyToken` and `signToken` are async** — always `await` them. They use the `jose` library.
3. **Doctor data scoping is at the SQL level** — never post-filter in JS. Use `getDoctorPatientScope()` + `inArray()`.
4. **Never hard-delete PHI** — soft-delete with `deletedAt` timestamp only.
5. **Every PHI mutation must call `logAudit()`**. Every PHI read must call `logRead()`. No exceptions.
6. **SSE payloads must not contain PHI** — use IDs only. The frontend fetches full data via its authenticated API hooks.
7. **No `req.body` in Pino logs** — PHI fields are auto-redacted by Pino, but don't log bodies explicitly.
8. **Zod `zod/v4` only** — `import { z } from "zod/v4"`, never `"zod"`.
9. **No `react-router`** — use `wouter` only.
10. **No raw `fetch` in components** — use TanStack Query hooks from `@workspace/api-client-react`.
11. **No `ml-*`/`mr-*` CSS** — use `ms-*`/`me-*` for RTL compatibility.
12. **Enum values are append-only** — never rename or delete. See `ENUM_GOVERNANCE.md`.
13. **No stack traces in API error responses** — the global error handler strips them in production.

---

## Key Commands

```bash
pnpm run typecheck                                      # typecheck all packages
pnpm --filter @workspace/api-server run test            # run backend unit tests (Vitest)
pnpm --filter @workspace/api-spec run codegen           # regenerate API hooks + Zod schemas
pnpm --filter @workspace/db run push                    # push schema to DB (dev only)
pnpm audit --audit-level=critical                       # check for critical vulnerabilities
```

---

## Auth Flow

- Login → `POST /api/auth/login` → sets HttpOnly `clinic_token` cookie
- Every request → `requireAuth` middleware reads cookie, calls `verifyToken()` (async, jose)
- `verifyToken` checks Redis for revocation timestamp (role-change guard)
- `requireRole(...roles)` → `super_admin` auto-bypasses, other roles checked against list
- SSE connections use `?token=` query param (EventSource can't set headers)
- Idle timeout: 10-minute inactivity auto-logout via `use-idle-timeout.ts` hook

---

## Appointment State Machine

```
scheduled → checked_in → in_triage → ready_for_doctor → in_consultation → awaiting_diagnostics → pending_payment → completed
                                                                         ↘ (can skip diagnostics)
cancelled (from any state except completed)
```

Transitions are validated server-side in `lib/appointment-state-machine.ts`. Invalid transitions return `422`.

---

## DB Schema Notes

- All tables use soft-delete: `deleted_at TIMESTAMP NULL`
- PHI tables: `patients`, `medical_records`, `prescriptions`, `xray_records`, `ultrasound_records`, `lab_tests`
- Timestamps: `checked_in_at`, `triage_started_at`, `consultation_started_at` on appointments
- `is_on_shift` boolean on `users` — toggled per shift by admin
- JSONB columns: `vitals` (medical_records), `medications` (prescriptions), `staff_assigned` (operations)
- All JSONB writes are validated via Zod guards before insertion

---

## Codegen Notes

- Orval `mode: "split"` generates `api.ts` + `api.schemas.ts` in `lib/api-client-react/src/generated/`
- After codegen, the barrel `src/index.ts` is auto-patched to remove an invalid `api.schemas` export
- Run codegen whenever `openapi.yaml` is modified
- All new routes must be added to `openapi.yaml` first, then codegen, then frontend hooks

---

## Security Architecture (Implemented)

| Layer | Implementation |
|---|---|
| Authentication | `jose` HS256 JWT with `jti` claim |
| Authorization | `requireRole()` with `super_admin` bypass |
| Session Revocation | Redis blocklist on role change |
| CSRF | Double-submit cookie pattern (`X-CSRF-Token` header) |
| Rate Limiting | Redis-backed `express-rate-limit` (login + global mutations) |
| Data Scoping | SQL-level doctor scope via `getDoctorPatientScope()` |
| Logging | Pino with PHI fields redacted (`[REDACTED]`) |
| Audit Trail | `audit_logs` table — append-only, immutable |
| SSE | Redis Pub/Sub fanout — no PHI in event payloads |
| CORS | Production: Replit domains only. Dev: localhost allowed |
| Error handling | No stack traces in production responses |

---

## Seed Credentials (Dev Only)

| Username | Password | Role |
|---|---|---|
| superadmin | admin123 | super_admin |
| admin | admin123 | admin |
| dr_ahmed | doctor123 | doctor |
| nurse1 | nurse123 | nurse |
| receptionist | front123 | front_desk |
| xray_tech | xray123 | xray_staff |
| lab_tech | lab123 | lab_tech |

---

## Adding a New Route — Checklist

1. [ ] Add endpoint to `lib/api-spec/openapi.yaml`
2. [ ] Run `pnpm --filter @workspace/api-spec run codegen`
3. [ ] Create/update route file in `artifacts/api-server/src/routes/`
4. [ ] Apply `requireAuth` + `requireRole(...)` — **include all roles except super_admin**
5. [ ] Apply `safeParseInt()` to all `:id` params
6. [ ] Call `logAudit()` / `logRead()` for every PHI access
7. [ ] Register route in `artifacts/api-server/src/routes/index.ts`
8. [ ] Add nav item to `artifacts/clinic/src/components/Layout.tsx`
9. [ ] Add `route-access.ts` entry for RBAC gating on frontend
10. [ ] Add i18n key for both `en` and `ar` locales
