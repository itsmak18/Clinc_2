# MediCore Frontend Deep-Dive — 2026-07-08

**Scope:** code-level follow-up to the structure audit (`ARCHITECTURE_AUDIT_2026-07-07_STRUCTURE.md` §9, scored 6.5/10). The structure audit could only see folder shape; this pass read the code. Result: **discipline is better than the structure implied; the real debt is forms, not architecture.** Expands plan Phase 4 (`IMPROVEMENT_PLAN_2026-07-08.md`) accordingly.

Frontend totals: ~23,000 LOC TypeScript/TSX, 37 pages, 37 shared components + 6 schedule + 15 ui primitives.

---

## 1. Corrections to the structure audit (things that looked worse than they are)

1. **API layer discipline is strong.** 63 files consume the generated typed client (`@workspace/api-client-react`). The `fetch(` hits in the five role dashboards were false positives (`refetch()` from React Query). The only genuine raw `fetch` is `hooks/auth.tsx` (`/api/auth/me` bootstrap + logout) — defensible: it runs before/outside the query client, and logout CSRF behavior has a dedicated regression test (`auth-logout-csrf.test.tsx`).
2. **Lazy loading is universal** — every page is `lazy()`-wrapped in `App.tsx` with Suspense.
3. **A hand-rolled ErrorBoundary exists** in `App.tsx` (class component with `ErrorInfo`).
4. **Provider stack is sane and minimal:** QueryClient → Auth → I18n → PrintLang → Tooltip. No provider pyramid problem.
5. **State management is correctly absent.** React Query is the server-state store; no Redux/Zustand needed. The heavy `useState` counts (below) are *form* state, not an architecture gap.
6. **All runtime deps live in `devDependencies`** — correct for a fully-bundled SPA; nothing is installed at runtime.

These corrections don't change the 6.5 structure score, but they matter: the foundation (contract client, code-splitting, guards, error boundary) is solid. The problems are concentrated and fixable.

---

## 2. The real debts (quantified)

### D-1 🟠 Hand-rolled forms everywhere — the #1 frontend debt
No form library, no client-side validation schema. Zero `react-hook-form`, zero `zod` imports in `src/` (confirms audit confidence-flag (b): `@workspace/api-zod` exists in the workspace and the client ignores it).

Measured consequence — `useState` farms in every CRUD page:

| Page | LOC | useState |
|---|---|---|
| XRay.tsx | 482 | 16 |
| Billing.tsx | 500 | 15 |
| Inventory.tsx | 538 | 10 |
| Triage.tsx | 432 | 7 |

Every field is its own `useState`; validation is whatever the server's 400 envelope returns after submit. Impact: (a) each new form re-invents wiring; (b) users get post-submit errors instead of inline field validation; (c) client and server can silently disagree on what's valid; (d) page LOC bloat — form state is roughly a third of every CRUD page.

**Fix:** adopt `react-hook-form` + `@hookform/resolvers/zod`, with schemas imported from `@workspace/api-zod` — the same generated schemas the server validates with. Client and server then *cannot* diverge, and the audit flag closes with a real fix instead of an ADR. Adopt incrementally per feature during the Phase-4 migration — never as a big bang.

### D-2 🟠 The imaging/diagnostic copy-paste family
`XRay.tsx` (482), `Lab.tsx` (478), `Ultrasound.tsx` (467) — three pages within 15 LOC of each other, same anatomy (list query + status filter + entry dialog + Arabic section + print). This is a copy-paste triplet; MedicalRecords (415) and Prescriptions (397) are cousins. One parameterized diagnostic-workflow component (entity type, fields, print template as props/config) collapses ~1,400 LOC to ~500 and makes the fourth modality (e.g. ECG) a config entry instead of a fourth fork.
**Confidence:** high on the smell (sizes + shared dialog components + identical feature set), medium on exact overlap — diff two of them before committing to the abstraction; extract only what is actually identical. Do not force a premature framework — if the diff shows <60% overlap, extract shared pieces (entry dialog, print hook) instead of a mega-component.

### D-3 🟡 Ten pages over 400 LOC
Reports 618, PatientDetail 549, Inventory 538, Dashboard 519, Billing 500, XRay 482, Lab 478, Ultrasound 467, Triage 432, Appointments 418. Pattern per page: query + filters + table + dialog + inline form (+ print). Feature-folder migration alone will not shrink these — pair each Phase-4 move with extracting the page's dialog+form into `features/<x>/components/`. Rule of thumb after refactor: page = composition + routing concerns, ≤200 LOC.

### D-4 🟡 Locale monoliths
`hooks/locales/en.ts` 1,095 lines / `ar.ts` 1,073 — flat key files, every feature's strings in one place. The EN↔AR set-equality test is an excellent guard — keep it. During Phase 4, split per feature (`features/<x>/locales/{en,ar}.ts`) with an aggregator, and make the parity test iterate the merged map (unchanged assertion, same guarantee).

### D-5 🟡 `lib/api.ts` is misnamed
It contains `apiUrl` + display formatters (`formatCurrency`, `formatDate`, `getInitials`, `calcAge`). It is a formatting module wearing an API name — actively confusing next to the real API layer (generated client). Rename → `lib/format.ts`; move `apiUrl` next to the client config.

### D-6 🟡 `print.ts` (510 LOC) + `reportTemplates.ts` — template monolith
Past DOM-XSS site (F-01, fixed, regression-tested by `print-xss.test.ts` + `discharge-sheet-xss.test.tsx` — guards in place). Structure debt only: one file renders every document type. Fold into a `printing` feature (or per-feature templates) during Phase 4; keep the XSS tests pointed at whatever it becomes — those tests are the guard, don't orphan them.

### D-7 🟢 `Layout.tsx` 399 LOC
Shell + nav + role pinning in one file. Nav is already role-driven (`route-access.ts`, `navPinnedByRole`) — make the nav list fully data-driven from that config and Layout drops to a shell.

### D-8 🟢 Component naming collision
`DayScheduleView.tsx` (components/) vs `ScheduleDayView.tsx` (components/) — confirmed both exist. Diff, merge or rename during the schedule feature migration (first Phase-4 PR — already noted there).

### D-9 🟢 No component catalog
Bayan design system lives in `index.css` + conventions doc; no Storybook/Ladle. At one-team scale this is optional; revisit when a second frontend contributor joins. Not scheduled.

---

## 3. Revised Phase 4 (supersedes the plan's Phase 4 detail)

**4.0 Scaffold (unchanged)** — `src/app/` + providers move, `features/` skeleton, frontend boundary ESLint, conventions entry. **Add:** install `react-hook-form` + `@hookform/resolvers`; write ONE reference form (pick the smallest real form, e.g. ServicePrices) wired to an `@workspace/api-zod` schema; document the pattern. This reference PR is the template every migration PR copies.

**4.1 Per-feature migration order and per-feature work** (each = move + form conversion + locale split + page slimming; one PR per feature):

| # | Feature | Moves | Extra work in the same PR |
|---|---|---|---|
| 1 | schedule | Schedule.tsx, components/schedule/*, useDoctorSchedule | resolve D-8 (DayScheduleView vs ScheduleDayView) |
| 2 | identity | Login, VerifyDevice, ForgotPassword, AccountDevices, UserProfile, Users, use-idle-timeout, useSessionTimeout | first react-hook-form conversions (small forms — Login, ForgotPassword) |
| 3 | billing | Billing, BillingDashboard, Reconciliation, ServicePrices, ClearanceChip, OverrideClearanceDialog, lib/clearance.ts | Billing.tsx: 15 useState → RHF; extract invoice dialog (after in-flight billing work lands) |
| 4 | imaging + lab | XRay, Ultrasound, Lab, ImagingDashboard, ImageUploader, DiagnosticResultDialog | **D-2:** diff the triplet, extract shared diagnostic workflow; biggest LOC payoff of the whole phase |
| 5 | clinical (2 PRs) | Patients, PatientDetail, Appointments, MedicalRecords, Prescriptions, Triage, NurseVitals, DoctorConsult/Inbox/Orders, patient components, appointment-flow.ts | PatientDetail (549) decomposition; RHF on Triage/vitals forms |
| 6 | compliance | ComplianceDashboard, AuditLog, ErasurePanel, PatientConsentCard, BreakGlass*, ChangeHistory, auditDiff.ts | — |
| 7 | reporting | Dashboard, role dashboards, DoctorAnalytics, Reports, Metric, Sparkline | Reports.tsx (618) split by report type |
| 8 | printing + remainders | print.ts, reportTemplates.ts, printLang; inventory, operations, search, notifications | D-6; keep XSS tests green against new paths |

**Cross-cutting during migration:** locale split per feature (D-4), hooks → `use-kebab-case`, `lib/api.ts` → `lib/format.ts` (D-5, do in PR #1 — touches everything, cheapest earliest), Layout nav data-driven (D-7, any PR).

**Acceptance per PR (extends plan):** typecheck + FE tests + i18n parity test green; route-access contract test untouched; converted forms show inline field errors sourced from the shared zod schema; page files ≤ ~200 LOC post-extraction (soft target, not a gate).

**Effort delta vs original plan:** +~30% on Phase 4 (form conversions + triplet consolidation) → roughly 2–2.5 weeks part-time instead of 1.5–2. Payoff: −3,000–4,000 LOC net, inline validation everywhere, fourth-modality cost drops to config.

---

## 4. What NOT to do (frontend non-goals)

- No Redux/Zustand/global store — React Query + auth context is correct for this app.
- No Next.js/SSR migration — internal authenticated SPA behind a clinic network; SSR buys nothing.
- No Storybook yet (D-9) — revisit at second frontend contributor.
- No i18n framework swap (i18next etc.) — the hand-rolled hook + parity test is small, typed, and guarded; a framework adds surface for zero current need.
- No blanket rewrite of the 400-LOC pages outside their feature-migration PR — one-touch rule: each page is reorganized exactly once, when its feature moves.
