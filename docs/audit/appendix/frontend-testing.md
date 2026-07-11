# Appendix F — Frontend & Testing/QA

**Audit date:** 2026-07-01 | **Branch:** security/search-doctor-scope

## Verified Passes

### AUD-FE-PASS-01 — Route Guard Architecture: PASS
`App.tsx:105-108` Guard + `canAccessRoute()` in `route-access.ts:233-242`. super_admin bypass enforced (line 235). All 28 routes wrapped. Prefix matching for dynamic routes (`/patients/:id` inherits `/patients`). Contract test `route-access.contract.test.ts` confirms FE navItems ⊆ backend roles across 24 routes.

### AUD-FE-PASS-02 — Logout CSRF: PASS
`hooks/auth.tsx:68-79` manually reads `_csrf` cookie, sends `X-CSRF-Token` (raw fetch bypasses Orval auto-inject, so this path needs manual handling — correctly done). Regression test `auth-logout-csrf.test.tsx:49-61`.

### AUD-FE-PASS-03 — Print XSS Defenses: PASS
`lib/print.ts` — `escapeHtml()` encodes 5 HTML-significant chars; `safeUrl()` restricts href to http/https (blocks `javascript:`/`data:`). All 5 print builders use `escapeHtml()`. Regression test `print-xss.test.ts:37-115` validates `<img onerror>` payload escaped, no live `<script>` node, javascript: URLs dropped. `discharge-sheet-xss.test.tsx:54-75` confirms script payload escaped as text.

### AUD-FE-PASS-04 — i18n Key Parity: PASS
`i18n.test.ts:3-22` — bidirectional EN↔AR parity check, fails CI on any orphan key.

### AUD-FE-PASS-05 — Legacy Fetch Paths (CSRF-Safe): PASS
GlobalSearch + DischargeSheet use Orval-generated hooks (`useGlobalSearch()`, `useGetAppointmentDischarge()`), not raw fetch. Both GET-only (no CSRF risk). CI grep guard blocks raw `fetch("/api/...")` regressions in pages.

### AUD-FE-PASS-06 — New Schedule Components: PASS
6 components (BlockDialog, OverrideDialog, WeekCalendar, DoctorSidebar, WeeklyTemplateList, OverridesTable) — presentational, no fetch, no dangerouslySetInnerHTML/innerHTML.

### AUD-FE-PASS-07 — Navigation Role Filtering: PASS
`Layout.tsx:172-184` filters `navItems` by `user.role`; matches Guard's access matrix.

## Findings

### AUD-FE-01 — No E2E Tests
**Severity:** High | **Confidence:** H | **Evidence Strength:** Strong
No Playwright/Cypress, no `e2e/` directory. Covered: route-access matrix, i18n parity, Guard smoke, print-XSS, discharge-XSS, logout-CSRF, appointment state machine (all unit-level). NOT covered: full appointment workflow UI, cross-role dashboard rendering, form validation, real API integration paths. Risk: a UI regression (wrong button, broken render) passes CI.

### AUD-FE-02 — No Frontend Coverage Threshold
**Severity:** Medium | **Confidence:** H
Backend enforces per-file thresholds (`scope.ts`, `password.ts`, `policy.ts` at 90-100%). `artifacts/clinic/vite.config.ts` has no `coverage` section — a developer could delete FE tests and CI would still pass.

### AUD-FE-03 — No Accessibility Automation
**Severity:** Medium | **Confidence:** H
No axe-core/jest-axe/Lighthouse CI. Radix/shadcn provide baseline ARIA, but regressions (missing aria-label, broken tab order, contrast) are not caught. Recommendation: add axe-core to a future E2E layer.

### AUD-FE-04 — Frontend-Test CI Gating (RESOLVED: False Positive)
**Severity:** N/A — Reject | **Confidence:** H (post Red Team cross-check)
FE agent observed `build` job's `needs: [typecheck, test, audit]` excludes `frontend-test` and flagged this as possibly ungated. **DevOps agent (AUD-DEVOPS-04) independently read `ci-gate` job (`ci.yml:334-356`) and confirmed it lists all 10 jobs including `frontend-test` with explicit success-check logic and `if: always()`.** The FE agent checked the wrong job's dependency list. Frontend tests ARE gated — via `ci-gate`, not `build`. See Red Team appendix for final cross-check confirmation.

### AUD-FE-05 — No Mutation/Load/Chaos Testing
**Severity:** Low | **Confidence:** H
No stryker/k6/chaos toolkit. Acknowledged as advanced-practice gap, not a near-term blocker given the curated regression suite covers CSRF/XSS/RBAC/i18n.

### AUD-FE-06 — Guard Test Sync Pattern
**Severity:** N/A — Not a bug
Test uses direct (non-lazy) `AccessDenied` import intentionally, documented in test comment, to avoid Suspense boilerplate. Real App.tsx wraps route block in `<Suspense>`.

### AUD-FE-07 — /account/devices Unguarded
**Severity:** Low | **Confidence:** M
`/account/devices` has no Guard wrapper / role restriction — appears intentional (personal device management, any authenticated user). Recommend confirming intent and documenting in route-access matrix.

### AUD-FE-08 — Lazy Route Import Failures Not Covered
**Severity:** Low | **Confidence:** M
No test imports lazy page components directly; a broken lazy import would surface only in E2E/manual testing (which doesn't exist per AUD-FE-01).

## Summary
Frontend security regression coverage (CSRF, XSS, RBAC) is comprehensive and CI-gated. Primary gaps are breadth-of-coverage (E2E, a11y, FE coverage threshold), not correctness of what's already tested. AUD-FE-04 is a resolved false positive — frontend-test is gated via `ci-gate`.
