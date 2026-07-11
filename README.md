# MediCore

Bilingual (EN/AR) clinic management system for internal staff: patients,
appointments, triage, clinical records, lab/imaging orders, prescriptions,
billing with financial clearance, inventory, and HIPAA-grade compliance
(field-level PHI encryption, append-only hash-chained audit trail, RLS
multi-tenancy, break-glass access, right-to-erasure).

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 SPA (`artifacts/clinic`) — Vite, wouter, TanStack Query, Tailwind 4, Bayan design system |
| Backend | Express 5 (`artifacts/api-server`) — feature modules, EdDSA JWT + JWKS, policy kernel |
| Data | PostgreSQL 16 + Drizzle ORM (`lib/db`) — RLS via `runInTenantContext`, partitioned audit log |
| Contract | OpenAPI (`lib/api-spec`) → orval-generated typed client (`lib/api-client-react`) + server Zod validation (`lib/api-zod`) |
| Infra | Docker Compose (dev + prod), PgBouncer, Redis, Caddy TLS edge, Prometheus/Grafana/Alertmanager |

pnpm monorepo. Node ≥ 24, pnpm ≥ 9 (`corepack enable`).

## Quickstart (dev)

```sh
pnpm install
cp .env.example .env          # fill SESSION_SECRET etc. — see docs/LOCAL_DEV.md
docker compose up -d postgres redis
pnpm --filter @workspace/db run migrate   # or: see docs/LOCAL_DEV.md
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/clinic run dev
```

Or `./start-dev.ps1` on Windows. Smoke check: `scripts/dev-smoke.ps1`.

## Tests

```sh
pnpm test                                              # typecheck + error-registry + api unit suite
pnpm --filter @workspace/api-server run test:integration-db   # real Postgres (Docker)
pnpm --filter @workspace/clinic run test                      # frontend
pnpm --filter @workspace/clinic run test:e2e                  # Playwright
```

## Documentation map

| Doc | What |
|---|---|
| [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) | Environment setup, env vars |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Developer onboarding |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operations: deploy, backup/restore, rotation, incidents |
| [docs/SECURITY.md](docs/SECURITY.md) | Security architecture + decisions |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Coding standards (tenancy rules, design system, naming) |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/audits/INDEX.md](docs/audits/INDEX.md) | Every audit + finding status |
| [docs/FOLDER_STRUCTURE.md](docs/FOLDER_STRUCTURE.md) | Annotated tree |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Change history |

## Non-negotiable invariants

- Every tenant-scoped query runs inside `runInTenantContext` (RLS); raw
  `dbUnsafe` requires a `// dbUnsafe: <justification>` comment (CI-enforced).
- PHI fields are AES-256-GCM encrypted at rest; `audit_logs` is append-only
  with a daily-verified hash chain.
- Frontend: Bayan CSS classes (not raw shadcn), logical Tailwind properties
  (`ms/me/ps/pe`), EN/AR locale parity (test-enforced).
- API contract changes start in `lib/api-spec/openapi.yaml`, then regenerate.
