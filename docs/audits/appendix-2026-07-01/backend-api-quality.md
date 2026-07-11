# Appendix E — Backend / API / Code Quality

**Audit date:** 2026-07-01 | **Branch:** security/search-doctor-scope

## Findings

### AUD-API-01 — Auth Error Envelope Exceptions (Info, Documented)
2 raw shapes in `auth.routes.ts:51-63` (429 `retryAfterSecs`, 401 `attemptsRemaining`) — intentional, Login page reads them. Only documented exceptions. PASS.

### AUD-API-02 — datetime.ts getWeekStart Timezone (Medium)
**Confidence:** H (mechanism) / M (impact) | **Evidence Strength:** Strong
`datetime.ts:2-5` `getWeekStart` uses `d.getDay()` (browser-local). Accepts a `Date` with no tz context. Non-UTC clinic could see wrong 7-day window.
**Contradicting:** schedule components pass `YYYY-MM-DD` strings + times, suggesting local-calendar-date treatment (bug may not manifest). This is an untracked new working-tree file — no CI gate has seen it.
**Validation:** trace `useDoctorSchedule.ts` date construction before `getWeekStart`. If clinics run non-UTC, port `date-fns-tz` or pass tz param.

### AUD-API-03 — Module Boundaries: PASS
Zero routes import `@workspace/db`. All services use `dbUnsafe`/`runInTenantContext`. ESLint enforced.

### AUD-API-04 — Billing Atomicity: PASS
`billing.service.ts:130-209` `createInvoice` = single `runInTenantContext` tx (patient check + counter + header + items). Validation before tx (no burned sequence). Audit/visit-advance post-commit. Memory claim confirmed.

### AUD-API-05 — N+1 Prevention (Analytics): PASS
`analytics.service.ts:137-179` — revenue aggregated per-patient in ONE grouped query, fanned out in-memory. Prior N+1 (one SUM/doctor) fixed. Appts/lab/xray fetched in 3 batches. No per-doctor DB query in loop.

### AUD-API-06 — Zod Validation Coverage: MOSTLY PASS
Spot-check: `validate(CreateInvoiceBody)`, `validate(CreateAppointmentBody)` present. `POST /invoices/:id/cancel` validates reason in service (not middleware) — acceptable. Recommend spot-check 2-3 more mutation routes.

### AUD-API-07 — Dead Code: PASS
Single non-blocking TODO (`dashboard.service.ts` cache-TTL-to-env). No blocking TODOs.

### AUD-API-08 — Legacy Fetch: PASS
GlobalSearch + DischargeSheet use generated Orval hooks (auto-CSRF). No raw `fetch("/api/...")` in pages. CI grep guard blocks regressions.

### AUD-API-09 — Param Validation: PASS
Routes use `validateParamInt` / `safeParseInt`. No unvalidated IDs to services.

### AUD-API-10 — API Versioning Absence: Info
No `/v1/` prefix. Acceptable for internal-only tool (clients upgraded together). Future external API would need versioning.

### AUD-API-11 — Email/SMS Logging: see AUD-COMP-02
Services correctly route through shared `logger.child()` + `config`. Residual: recipient on top-level key not redacted (Compliance appendix AUD-COMP-02).

### AUD-API-12 — New Schedule Components Security: PASS
6 components in `components/schedule/` are presentational — no fetch, no `dangerouslySetInnerHTML`, no innerHTML. Mutations via Orval hooks in parent.

### AUD-API-13 — Trust Proxy: PASS
`app.ts:25` `trust proxy = loopback,linklocal,uniquelocal`. Won't trust public X-Forwarded-For. Rate-limit/audit identity safe.

### AUD-API-14 — CORS: PASS
Callback origin checker, never wildcard. Prod = ALLOWED_ORIGINS only; dev adds localhost patterns.

## Summary
Backend code quality strong. Module boundaries clean, billing atomic, N+1 fixed, validation broad. Only actionable: AUD-API-02 datetime tz (verify against real usage) — the one untracked WIP file worth a second look before it lands.
