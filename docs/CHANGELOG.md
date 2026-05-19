# Changelog

## Implemented Features (State as of 2026-05-18)

| Feature | Status | Key Files |
|---|---|---|
| HttpOnly cookie auth (C-01) | ✅ | `routes/auth.ts`, `lib/auth.ts`, per-role cookie TTL |
| Per-role JWT TTL + fingerprint | ✅ | `lib/auth.ts` ROLE_TTL, `fph` claim in `signToken` |
| v7 auth kernel | ✅ | `lib/policy.ts`, `middlewares/auth-gate.ts` |
| Login shield (WAF-equivalent) | ✅ | `middlewares/login-shield.ts` |
| Service layer extraction | ✅ | `services/` — 19 domain services |
| Canonical error envelope | ✅ | `errors.ts` E map, `middlewares/asyncHandler.ts` |
| CI guard (validate:errors) | ✅ | `scripts/validate-errors.ts`, `ci.yml` |
| Billing SoD | ✅ | `services/billing.service.ts` |
| Audit trail (PHI coverage) | ✅ | `lib/audit.ts`, `logRead`/`logAudit`/`logDenied` |
| Doctor scope (SQL-level) | ✅ | `lib/scope.ts` |
| RBAC (10 roles) | ✅ | `lib/db/src/schema/users.ts` |
| CSP (SPA + meta tag + regression guard) | ✅ | `lib/csp.ts`, `vite.config.ts`, `tests/csp.test.ts` |
| Prometheus + Grafana | ✅ | `lib/metrics.ts` |
| SSE (pluggable EventBus) | ✅ | `lib/sse.ts`, `lib/runtime/` |
| Session revocation (fail-closed) | ✅ | `RevocationStore`, `verifyToken` throw on store error |
| jti replay defense (privileged) | ✅ | `isJtiUsed`/`markJtiUsed` in `RevocationStore` |
| Compliance Dashboard | ✅ | `routes/dashboard.ts`, `pages/ComplianceDashboard.tsx` |
| Per-role dashboards (all 10 roles) | ✅ | 7 new endpoints in `dashboard.service.ts` + `routes/dashboard.ts`; 7 new pages; all in OpenAPI + codegen |
| Per-role navigation (Layer 2) | ✅ | `getLandingRoute()` + `navPinnedByRole` in `route-access.ts`; `RoleQuickActions` + `RoleContextLine` in `Layout.tsx` |
| Page chrome (Layer 3) | ✅ | `EmptyState.tsx`; `DataTable` density prop; status palette deduped + WCAG-differentiated; welcome-bar context line |
| Schedule system | ✅ | `routes/schedule.ts`, `services/schedule.service.ts` |
| Ultrasound module | ✅ | `routes/ultrasound.ts`, `pages/Ultrasound.tsx` |
| Dark mode toggle | ✅ | `Layout.tsx` — `.dark` on `<html>`, localStorage `theme` |
| Per-role UI improvements | ✅ | Triage kanban, Lab/XRay inline expand, nurse quick vitals |
| MFA (TOTP) | ❌ REMOVED | Completely removed — no files, no schema, no routes |
