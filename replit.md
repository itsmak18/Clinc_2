# MediCore — Clinic Management System

## Overview

Full-stack bilingual (English + Arabic/RTL) clinic management system for internal staff use. Built as a pnpm monorepo with a React+Vite frontend and an Express API backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React 19 + Vite 7 (`artifacts/clinic`)
- **API framework**: Express 5 (`artifacts/api-server`)
- **Database**: PostgreSQL 16 + Drizzle ORM (`lib/db`)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec at `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (server), Vite (client)
- **Auth**: `jose` library (HS256 JWT) with `jti` claims — token stored as HttpOnly cookie `clinic_token`
- **Real-time**: Server-Sent Events via Redis Pub/Sub (horizontal-scale safe)
- **Session Store**: Redis (`ioredis`) — rate limiting, SSE fanout, token revocation

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-server run test` — run backend Vitest unit tests
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm audit --audit-level=critical` — check for critical vulnerabilities

## Codegen Notes

- Orval with `mode: "split"` for `api-client-react` generates `api.ts` + `api.schemas.ts`
- Orval with `mode: "split"` for `api-zod` generates only `api.ts` but writes a barrel `src/index.ts` that also references `api.schemas` (which doesn't exist). The codegen script patches the barrel after orval runs to remove that invalid export.
- After codegen, generated files live in `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`

## Modules & Features

- **Patient Registration** — search, barcode scanner (MRN), allergies banner
- **Appointments** — full state machine with role-based transition buttons
- **Triage** — 3-column nurse kanban (checked-in → triaging → ready), vitals dialog
- **Medical Records** — per-patient with vitals, diagnosis, treatment
- **Prescriptions** — doctor-generated, printable
- **X-Ray** — request, upload report, notify doctor via SSE
- **Lab** — request, enter results, notify doctor via SSE
- **Billing** — invoice creation, payment recording
- **Operations** — surgical procedure scheduling
- **Inventory** — stock tracking with low-stock alerts
- **Schedule** — doctor weekly schedule templates + date-specific overrides
- **Reports** — aggregate stats, demographic breakdown
- **Notifications** — SSE-based real-time push via Redis Pub/Sub, in-app bell
- **Users** — role management, on-shift toggle, password reset
- **Audit Log** — full action history, filterable, CSV/JSON export
- **Dashboard** — live patient flow pipeline (auto-refresh 30s), stat cards, recent activity

## Appointment State Machine

```
scheduled → checked_in → in_triage → ready_for_doctor → in_consultation → awaiting_diagnostics → pending_payment → completed
                                                                         ↘ (can skip diagnostics)
cancelled (from any non-completed state)
```

Validated server-side in `lib/appointment-state-machine.ts`. Invalid transitions return `422`.

## DB Schema Notes

- Appointment timestamps: `checked_in_at`, `triage_started_at`, `consultation_started_at`
- Users: `is_on_shift` boolean (toggled per shift)
- All PHI tables use soft-delete: `deleted_at TIMESTAMP NULL`
- JSONB columns (`vitals`, `medications`, `staff_assigned`) are validated via Zod before write

## Auth Notes

- `requireAuth` middleware reads HttpOnly cookie `clinic_token`, calls `verifyToken()` (async — always `await`)
- `verifyToken` additionally checks Redis for a token revocation timestamp (guards against stale tokens after role changes)
- `requireRole(...roles)` — `super_admin` auto-bypasses centrally; do NOT add `super_admin` to individual role arrays
- SSE connections use `?token=` query param (EventSource API cannot set custom headers)
- Idle timeout: 10-minute inactivity auto-logout hook (`use-idle-timeout.ts`)
- `setAuthTokenGetter` called in `App.tsx` to wire custom fetch to JWT

## Security Hardening (Production)

- **CSRF**: Double-submit cookie (`X-CSRF-Token` header required on all mutations)
- **Rate Limiting**: Redis-backed, applies to login (strict) and all mutation endpoints (global)
- **CORS**: Production-only allows verified Replit domain patterns; `localhost` stripped
- **Pino Redaction**: PHI fields (`vitals`, `fullName`, `phone`, `email`, `diagnosis`, etc.) auto-redacted as `[REDACTED]` in all logs
- **SSE Payloads**: No PHI in event data — IDs only, frontend fetches full records via API
- **Session Fixation**: Token revocation via Redis on role/privilege change
- **Audit Trail**: `audit_logs` table — append-only, 7-year retention, immutable

## Seed Credentials

| Username       | Password    | Role          |
|--------------- |-------------|---------------|
| superadmin     | admin123    | super_admin   |
| admin          | admin123    | admin         |
| dr_ahmed       | doctor123   | doctor        |
| nurse1         | nurse123    | nurse         |
| receptionist   | front123    | front_desk    |
| xray_tech      | xray123     | xray_staff    |
| lab_tech       | lab123      | lab_tech      |
