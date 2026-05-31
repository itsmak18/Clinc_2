# Clinic-Hub Rating Panel

A multi-agent review board that rates the architecture, code, security, data, contracts, ops, and product ideas of Clinic-Hub. All raters are read-only; none modify code.

## The agents

| Agent | Model | Weight | Rates |
|---|---|---|---|
| `rate-panel-lead` | opus | — | **Orchestrator.** Spawns the others, aggregates a weighted scorecard, writes `docs/REVIEW_SCORECARD.md`. |
| `rate-security` | opus | 25% | AuthN/Z, RBAC, break-glass, step-up, device trust, PHI encryption, consent/erasure, audit. |
| `rate-architecture` | opus | 20% | Monorepo layout, layering, contract-driven design, coupling, ADRs, scalability. |
| `rate-backend` | sonnet | 12% | Express 5 routes/services/middleware, error handling, async safety, observability, tests. |
| `rate-database` | sonnet | 12% | Drizzle schema, migrations, indexing, constraints, PHI-at-rest, erasure modeling. |
| `rate-api-contract` | sonnet | 10% | OpenAPI → zod → orval client integrity; spec/server/client drift. |
| `rate-frontend` | sonnet | 9% | React/Radix/TanStack Query/Tailwind, a11y, performance, page consistency. |
| `rate-devops` | sonnet | 8% | Docker/compose, nginx/caddy, Prometheus/Grafana, health checks, CI, runbook, backups. |
| `rate-product-ideas` | sonnet | 4% | Clinical workflow fit, feature completeness, UX, roadmap + a fresh idea backlog. |

## How to run

**Full panel (recommended):**
> Use the `rate-panel-lead` agent to rate Clinic-Hub.

The lead dispatches every specialist, then produces `docs/REVIEW_SCORECARD.md` plus a chat summary.

**A single dimension:**
> Use the `rate-security` agent to audit the API.

## Shared conventions

- **Scoring:** every rater scores 0–10 per dimension and emits a machine-parseable `SCORE BLOCK` footer the lead consumes.
- **Severity:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low · 💡 Idea.
- **PHI cap rule:** any unresolved 🔴 Critical security or data-integrity finding caps the overall project grade at C.
- **Read-only:** raters inspect, type-check, and read git history. They never edit files, run migrations, install deps, or start services.
