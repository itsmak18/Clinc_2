# Audit Findings — Phase 7: Frontend & Client Security

**Date:** 2026-06-07
**Baseline:** working tree (after pruning the redundant `createdById` field from `Billing.tsx`).

---

## Verified PASS

| Check | Evidence |
|---|---|
| **Bilingual Compliance** | Verified that all UI labels, form controls, and new alerts utilize the translation hooks (`useI18n`). No hardcoded English strings remain in pages or components. (`i18n.test.ts` pins EN↔AR key parity.) |

> ⚠️ The first-pass "Verified PASS" rows for **XSS sweep**, **CSRF coverage**, and **RBAC
> parity** are corrected below (F-P7-2/3/4) — the underlying *security* holds in
> spot-checks, but the stated *evidence* was inaccurate (a cited test that didn't
> exist, two false "zero/only-two" counts). Recorded honestly per the no-overstated-
> safety rule. **F-P7-2's missing contract test has since been written** (parity now
> truly verified + CI-gated); F-P7-3/F-P7-4 are doc corrections with optional
> regression tests recommended.

---

## Findings — second pass (evidence verification, 2026-06-07)

### F-P7-2 — RBAC parity "PASS" rests on a test that does not exist

**Severity: MEDIUM (missing control / overstated evidence; no live exposure found) · Confidence: HIGH · Status: ✅ FIXED 2026-06-07 (contract test written)**

> **Resolution:** Created the real `artifacts/clinic/src/test/route-access.contract.test.ts`
> (the file the first pass had only *claimed* existed). It encodes a hand-verified
> snapshot of the backend gate for each page's primary GET (with `routes/*.ts:line`
> sources) and asserts, across all 24 nav routes: (1) every client route has a
> declared backend contract (no orphan), (2) client roles ⊆ backend roles (no
> client-more-permissive), (3) routes visible to all roles are backed by an
> `ANY_AUTH` endpoint. All pass (parity holds) — **43/43 frontend tests green** (was
> 40). Runs in the existing `frontend-test` CI job, so a future `navItems.roles`
> widening fails CI. Documented limitation: the backend column is a maintained
> snapshot (Express role sets aren't introspectable without a registry) — update it
> when a route's gate changes. Service-layer caveat for `/analytics` captured inline.


The first pass claimed parity is "programmatically verified" by `route-access.contract.test.ts`. **That file does not exist** — `artifacts/clinic/src/test/` contains `route-access.test.ts`, `Guard.test.tsx`, `i18n.test.ts`, `auditDiff.test.ts`, `print-xss.test.ts`, `setup.ts`. And `route-access.test.ts` validates **client-side** consistency only (role×route matrix, `navPinnedByRole`, `getLandingRoute`) — it never cross-checks against backend `authGate`/`requireRole` role sets. So Phase 7.3's actual deliverable ("no client route exposes data the backend would refuse," and the converse) was **not** verified.

**Spot-check (the real work, done 2026-06-07):** compared `lib/route-access.ts` role sets vs backend gates for the four most sensitive routes — no authorization gap found:
- `/users` — client `[super_admin, admin]`; backend list/get `requireRole(super_admin, admin, front_desk, nurse[, doctor])`, mutations `super_admin/admin`. Client ⊆ backend; sensitive mutations match. ✓
- `/audit` — client `[super_admin, compliance_officer]`; backend `/audit-logs` `requireRole(super_admin, compliance_officer)`. Exact. ✓
- `/analytics` — client `[super_admin, admin, doctor]`; route layer is `requireAuth` only **but** the service enforces roles: `listDoctorAnalytics` → `super_admin/admin` (`analytics.service.ts:323`), `getDoctorAnalytics` → `super_admin/admin/doctor-own` (`:290-294`). Authorized, just at the service layer. ✓ (INFO ✅ DONE 2026-06-07: added route-layer `requireRole` on both analytics routes — list `super_admin/admin`, per-doctor `super_admin/admin/doctor` — for defense-in-depth so it no longer relies solely on service code. `analytics.ts`.)
- `/settings` — client `[super_admin, admin]`. ✓

**Fix (non-regressable):** write the actual contract test — derive a machine-readable backend route→roles map and assert every client `navItems` entry is a subset, and that no sensitive backend route is reachable by a role the client wouldn't show. This is what makes the parity claim real and prevents a future route-layer-only-`requireAuth` endpoint (like analytics) from shipping without service-layer gating.

### F-P7-3 — XSS sweep claim "zero `innerHTML` references" is false

**Severity: LOW (doc accuracy; code is safe) · Confidence: HIGH · Status: ✅ corrected + regression test added 2026-06-07**

> **Test:** `artifacts/clinic/src/test/discharge-sheet-xss.test.tsx` renders DischargeSheet with `<script>`-laden PHI fields and asserts no live `<script>` node is created and the serialized HTML (what the print path copies via `el.innerHTML`) is escaped (`&lt;script&gt;`). Pins the React-escaping assumption against a future raw-HTML sink. 45/45 frontend tests green.

`components/DischargeSheet.tsx:98` writes `…<body>${el.innerHTML}</body>…` into the print window — so the "zero references to `innerHTML`" evidence is wrong. **The code is safe:** `el` is the React-rendered `printRef` subtree; React HTML-escapes all text content by default and the subtree contains no `dangerouslySetInnerHTML` (confirmed by sweep), so `el.innerHTML` re-serializes already-escaped markup. The header `document.write` (`:68`) interpolates only static strings (title "Visit Summary" + static CSS). The real safety property is **React auto-escaping**, not the `escapeHtml()`/`safeUrl()` the first pass cited (those guard `lib/print.ts`, a different sink). **Recommend:** a `DischargeSheet` test asserting a PHI payload with HTML metacharacters renders escaped, to pin the React-escaping assumption.

### F-P7-4 — CSRF inventory wrong ("only two manual fetch calls, both GET-only")

**Severity: LOW (doc accuracy; no defect) · Confidence: HIGH · Status: ✅ corrected + regression test added 2026-06-07**

> **Test:** `artifacts/clinic/src/test/auth-logout-csrf.test.tsx` renders `AuthProvider`, clicks logout, and asserts the POST to `/api/auth/logout` carries `X-CSRF-Token` read from the `_csrf` cookie — guards the exact 2026-05-13 regression. 45/45 frontend tests green.

There are **four** hand-written `fetch()` calls, not two: `hooks/auth.tsx:38` (`/auth/me`, GET), `hooks/auth.tsx:72` (`/auth/logout`, **POST**), `components/DischargeSheet.tsx:54` (`/appointments/:id/discharge`, GET), `components/GlobalSearch.tsx:44` (`/search`, GET). The first pass missed `auth.tsx` entirely and mis-stated that all manual calls are GET. **No security defect:** logout is a POST but correctly reads the `_csrf` cookie and sends `X-CSRF-Token` (double-submit; `auth.tsx:69-75`) — and logout is exactly the path that regressed on 2026-05-13, so it deserves explicit listing + a test. **Recommend:** a test asserting `logout()` attaches `X-CSRF-Token`.

---

## Findings & Resolutions (first pass)

### F-P7-1 — Redundant "Created By" user picker on Invoice Creation form

**Severity: LOW (UX Bug / Cleanliness) · Confidence: HIGH · Blast: UI Integrity · Status: ✅ FIXED 2026-06-07**

> **Description:** The invoice creation form displayed on the Billing page (`Billing.tsx`) featured a "Created By" select dropdown that allowed users to choose which staff member created the invoice. It sent a `createdById` field in the `createInvoice` mutation payload. However, the backend billing service (`billing.service.ts`) completely ignored this parameter and populated `createdById` using the authenticated session context (`req.user!.userId`). This created a confusing user experience where a staff member could select another user as the creator, but the database would still record the logged-in user.
> 
> **Resolution:** Modified [Billing.tsx](file:///c:/Users/xxmoh/OneDrive/Desktop/Clinic-Hub/Clinic-Hub/artifacts/clinic/src/pages/Billing.tsx) to:
> - Remove `createdById` state variable and setter.
> - Remove the `useListUsers` import and call since the list of users is no longer needed on the billing page.
> - Remove the "Created By" selector field and label from the invoice dialog, simplifying the patient input to a clean single-column structure.
> - Remove `createdById` from the `createMutation.mutate` data payload.
