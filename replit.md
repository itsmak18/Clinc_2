# MediCore — Clinic Management System

## Overview

Full-stack bilingual (English + Arabic/RTL) clinic management system for internal staff use. Built as a pnpm monorepo with a React+Vite frontend and an Express API backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/clinic)
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec at lib/api-spec/openapi.yaml)
- **Build**: esbuild (server), Vite (client)
- **Auth**: Custom JWT (HS256), token stored as `clinic_token` in localStorage

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Codegen Notes

- Orval with `mode: "split"` for `api-client-react` generates `api.ts` + `api.schemas.ts`
- Orval with `mode: "split"` for `api-zod` generates only `api.ts` but writes a barrel `src/index.ts` that also references `api.schemas` (which doesn't exist). The codegen script patches the barrel after orval runs to remove that invalid export.
- After codegen, generated files live in `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`

## Seed Credentials

| Username       | Password    | Role          |
|--------------- |-------------|---------------|
| superadmin     | admin123    | super_admin   |
| admin          | admin123    | admin         |
| dr_ahmed       | doctor123   | doctor        |
| nurse1         | nurse123    | nurse         |
| receptionist   | front123    | front_desk    |
| xray_tech      | xray123     | xray_tech     |
| lab_tech       | lab123      | lab_tech      |

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
- **Reports** — aggregate stats
- **Notifications** — SSE-based real-time push, in-app bell
- **Users** — role management, on-shift toggle, password reset
- **Audit Log** — full action history
- **Dashboard** — live patient flow pipeline (auto-refresh 30s), stat cards, today's appointments, recent activity

## Appointment State Machine

```
scheduled → checked_in → in_triage → ready_for_doctor → in_consultation → awaiting_diagnostics → pending_payment → completed
                                                                         ↘ (can skip diagnostics)
```

## DB Schema Notes

- Appointment timestamps: `checked_in_at`, `triage_started_at`, `consultation_started_at`
- Users: `is_on_shift` boolean (toggled per shift)
- Appointment status enum extended with: `in_triage`, `ready_for_doctor`, `in_consultation`, `awaiting_diagnostics`, `pending_payment`

## Auth Notes

- `requireAuth` middleware accepts both `Authorization: Bearer <token>` header and `?token=` query param (for SSE EventSource)
- Idle timeout: 10-minute inactivity auto-logout hook (`use-idle-timeout.ts`)
- `setAuthTokenGetter` called in `App.tsx` to wire custom fetch to JWT
