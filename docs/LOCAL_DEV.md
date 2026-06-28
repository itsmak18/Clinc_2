# MediCore — Local Dev Setup

No Replit. No Redis. Just Node + Postgres.

## Prerequisites

- Node.js 24+
- pnpm (`npm i -g pnpm`)
- PostgreSQL 16 running locally

## One-time bootstrap

```bash
# 1. Install dependencies
pnpm install

# 2. Push DB schema (creates all tables)
pnpm --filter @workspace/db run push

# 3. Seed (users, patients, appointments, inventory, notifications)
pnpm --filter @workspace/scripts run seed
```

## Start dev servers

```powershell
.\start-dev.ps1
```

Opens two windows:
- **Backend** → http://localhost:5000 (tsx watch — auto-restarts on save)
- **Frontend** → http://localhost:5173 (Vite HMR)

## Login credentials

| Username | Password | Role |
|---|---|---|
| superadmin | admin123 | super_admin |
| admin | admin123 | admin |
| dr_ahmed | doctor123 | doctor |
| nurse1 | nurse123 | nurse |
| receptionist | front123 | front_desk |
| xray_tech | xray123 | xray_staff |
| lab_tech | lab123 | lab_staff |

## Environment (`.env` at repo root)

```
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/clinic_db
PORT=5000
NODE_ENV=development
SESSION_SECRET=<32-byte hex>
BCRYPT_ROUNDS=12
CLINIC_TZ=Europe/Istanbul
BASE_PATH=/
```

`SESSION_STORE` defaults to `memory` in development — no Redis required.
Set `SESSION_STORE=redis` and `REDIS_URL=redis://localhost:6379` only for production.

## Useful commands

```bash
# Typecheck entire workspace
pnpm run typecheck

# Run backend tests
pnpm --filter @workspace/api-server run test

# Re-seed (truncates and re-inserts)
pnpm --filter @workspace/scripts run seed

# Rebuild backend for production
pnpm --filter @workspace/api-server run dev:build

# Re-run codegen after editing openapi.yaml
pnpm --filter @workspace/api-spec run codegen
```
