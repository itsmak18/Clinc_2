# Changelog

## Security review remediation - admin->super_admin privesc + metrics/login/SSE/billing (2026-06-22)

Full-repository security review (findings: [AUDIT_FINDINGS_2026-06-22.md](AUDIT_FINDINGS_2026-06-22.md)). One HIGH + four lower items, **all fixed this pass**; api-server **509/509 tests green**, tsc 0 errors. The HIGH is new (not in the zero-trust campaign below).

- **F-1 (HIGH) - admin->super_admin account takeover, fixed.** `resetPassword`/`updateUser`/`deleteUser`/`toggleShift` ([users.service.ts](../artifacts/api-server/src/services/users.service.ts)) had no guard on the *target's* role, and `requireStepUp` is a no-op while `PHASE2_STEP_UP_ENABLED` is off - so an `admin` could reset a same-clinic `super_admin`'s password and log in as them (seed co-locates both in one clinic). Added pure exported `canManageTarget(actorRole, targetRole)` enforced in all four mutators (resolve target role before mutating; emit `ESCALATION_DENIED` on deny). Only super_admin may act on a super_admin; admin keeps full management of all other roles. Regression test [users.service.privesc.test.ts](../artifacts/api-server/src/tests/users.service.privesc.test.ts) (8) asserts the privileged write never runs when blocked.
- **F-2 (Low-Med) - `/metrics` fail-closed + constant-time compare.** [app.ts](../artifacts/api-server/src/app.ts): served metrics with no auth when `METRICS_TOKEN` was unset; now 404s in production when unset and uses `timingSafeEqual` for the bearer check.
- **F-3 (Low) - login timing enumeration.** [auth.service.ts](../artifacts/api-server/src/services/auth.service.ts): the no-user/inactive path skipped bcrypt; now spends an equal bcrypt verify against a cached dummy hash.
- **F-4 (Low/info) - clinical descriptors off the SSE/Redis wire.** lab/xray/ultrasound notification `message` carried test name / body part / exam type (no patient identifier); genericized (the `title` already states the category) so nothing clinical rides pub/sub.
- **F-5 (Low) - invoice discount bound.** [billing.service.ts](../artifacts/api-server/src/services/billing.service.ts) `createInvoice` now rejects negative discounts and discounts exceeding subtotal (prevents inflated/negative totals). Optional follow-up: add `minimum: 0` to `CreateInvoiceBody` + regen.

**Verify:** `pnpm --filter @workspace/api-server run typecheck` exit 0; `... run test` **509/509 (34 files)**; new privesc test 8/8. Integration-db suite not run here (needs Docker) - run before merge.

## Zero-trust audit hardening — test coverage + retention/quota/mint fixes (2026-06-22)

A source-first re-audit (overall 8.5→8.7/10). Most documented controls verified TRUE against source; the appointment compare-and-swap P0s were confirmed already fixed in the working tree. Closed the highest-severity *codeable* gaps; **F-H1 (the 154-file uncommitted WIP must be committed + CI-gated) remains the top residual** and is unchanged. **29 new tests, all green** against real Postgres 16; tsc 0 errors; esbuild bundles `index.ts`+`worker.ts`; no regressions.

- **F-H2 — untested new PHI features now covered.** Added real-Postgres integration tests (no production code) for the uncommitted upload/vitals/catalog surfaces: [imaging-attachments.integration-db.test.ts](../artifacts/api-server/src/tests/imaging-attachments.integration-db.test.ts) (magic-byte sniff, byte round-trip, doctor-scope download deny, cross-tenant 404, delete+jsonb-mirror — 6), [services-catalog.integration-db.test.ts](../artifacts/api-server/src/tests/services-catalog.integration-db.test.ts) (tenant isolation, neg-price, idempotent seed, RBAC — 6), [vitals-scope.integration-db.test.ts](../artifacts/api-server/src/tests/vitals-scope.integration-db.test.ts) (listVitals doctor-scope + tenant isolation — 4).
- **F-H3 — jti replay defense de-scoped correctly (not "activated").** Wiring `markJtiUsed` would REGRESS: the three live `privileged`-scope routes (`PATCH`/`DELETE /users/:id`, admin password-reset) authenticate with the reused session cookie, so consuming its jti would reject the 2nd admin action in a session. Pinned the safety invariant with a new test in [policy.unit.test.ts](../artifacts/api-server/src/tests/policy.unit.test.ts) ("evaluate() READS but never CONSUMES the jti") and corrected the stale ADR-007 §4 ("zero routes use privileged scope" → now three do, via session cookies, intentionally not consuming jti).
- **F-M2 — CSP report retention enforced.** `purgeOldCspReports(retentionDays=90)` (index-backed) in [csp-report.service.ts](../artifacts/api-server/src/services/csp-report.service.ts) + daily cron `30 3 * * *` in [cron.ts](../artifacts/api-server/src/cron.ts). New env `CSP_REPORT_RETENTION_DAYS` (default 90). Test (2).
- **F-M5 — orphaned imaging files reclaimed.** `listStoredFiles()` (storage-only, `.enc`-scoped) in [imaging-storage.ts](../artifacts/api-server/src/lib/imaging-storage.ts) + `reconcileOrphanImagingFiles()` in [imaging-attachments.service.ts](../artifacts/api-server/src/services/imaging-attachments.service.ts) + daily cron `0 4 * * *`. Deletes encrypted files with no live row (crash-mid-upload / failed-unlink); 24h grace protects in-flight uploads; **refuses to mass-delete on an empty live set** (defense vs a future non-dormant RLS regression — verified the 0038 policy is dormant). New env `IMAGING_ORPHAN_GRACE_HOURS` (24). Test (5, incl. a `[SAFETY]` live-row-survives case).
- **F-M6 — multi-clinic correctness at the token mint.** Login now mints `timezone` (from `clinics.timezone`) into the JWT (`TokenPayload` gained `timezone?`; `getClinicTimezone`/`policy.ts` already consumed it — dropped the `as any`, closed the TODO). Resolved-user session audits use the real `clinicId`: `logLoginAudit` gained a `clinicId` param (LOGIN_SUCCESS/PENDING pass `user.clinicId`); `logoutUser(…, clinicId)` threaded from the route. Backward-compatible (legacy tokens fall back to env `CLINIC_TZ`). Test (2).
- **F-M4 (partial) — per-clinic imaging storage quota.** `uploadAttachment` rejects (before any disk write) when a clinic's live attachment bytes would exceed `IMAGING_CLINIC_QUOTA_BYTES` (env, default 0 = disabled/non-breaking). Test (3). **Streaming uploads deliberately deferred** — replacing the 25 MB in-memory buffer with streaming AES-GCM is a PHI-envelope crypto refactor on a low-frequency endpoint with no evidence of memory pressure; revisit on a Node-RSS/event-loop-lag alert correlated with uploads.
- **F-M1 — verified already mitigated (no change).** Fire-and-forget read audits already increment `audit_log_write_failures_total{action}` + log `audit_outbox_write_failed`, and the `AuditLogPermanentLoss` alert already fires; downgraded from Medium to Informational rather than add a redundant metric.

**Verify:** 29 new integration/unit tests green via the no-Docker real-Postgres path (`INTEGRATION_PG_ADMIN_URL`); `tsc -p tsconfig.json --noEmit` 0 errors; esbuild bundles `index.ts`+`worker.ts` clean; regression suites (imaging-attachments 6, imaging-orphan 5, policy.unit 36, auth-flow 6, services-catalog 6) all green. New env vars added to [.env.example](../.env.example). One stale doc line remains: `.claude/CLAUDE.md:239` jti row (harness-blocked edit — needs a manual one-line paste).

## X-Ray / Ultrasound — server image upload/download + clearer workflow (2026-06-21)

Reworked imaging from "paste an external image URL" into a real, secure file pipeline, and renamed the status workflow to read like the actual process: **`requested → in_progress → completed`** (was `pending → uploaded → reviewed`, renamed in place — no data loss).

- **Storage + encryption.** New `imaging_attachments` table (uuidV7 PK) is the authoritative record per uploaded file; bytes live on a server volume (`IMAGING_STORAGE_DIR`, default `./storage/imaging`) as **AES-256-GCM ciphertext** (`lib/field-encryption.ts` gained `encryptBuffer`/`decryptBuffer`, reusing the existing `FIELD_ENCRYPTION_KEY` registry — kid/iv/tag persisted on the row, never on disk). New `lib/imaging-storage.ts` (clinic-scoped `{clinicId}/{modality}/{uuid}.enc` paths, traversal-guarded). The existing `images` jsonb is kept as the display projection (urls now point at the authenticated download endpoint), so the doctor dialog, printed reports, and EHR keep rendering unchanged.
- **Endpoints** (shared `imaging-attachments.service.ts`, both modalities): `POST /{xray|ultrasound}/:id/images` (multipart, multer memoryStorage, 25 MB, **magic-byte** MIME sniff — client MIME not trusted; auto-advances `requested → in_progress`), `GET …/images/:attId` (authenticated, **doctor-scope + break-glass** checked, audited `logRead`; `?download` → `Content-Disposition: attachment`), `DELETE …/images/:attId`. Upload/delete gated to `super_admin/admin/xray_staff`; download to the broad read roles.
- **Right-to-erasure** ([erasure.service.ts](../artifacts/api-server/src/services/erasure.service.ts)): now nulls the imaging `images` jsonb (was a gap) **and** hard-deletes the physical files (best-effort post-commit) + soft-deletes the attachment rows → `erasedCounts.imaging_attachments`.
- **Frontend.** New `ImageUploader` (drag-drop + file picker, thumbnail cards with download/delete, client-side type/size guard, upload via the generated `customFetch` FormData path — CSRF/credentials handled) replaces the URL-textbox `ImageListEditor` in [XRay.tsx](../artifacts/clinic/src/pages/XRay.tsx) + [Ultrasound.tsx](../artifacts/clinic/src/pages/Ultrasound.tsx). New `StatusStepper` shows the 3-stage pipeline with a one-click advance. Images are now decoupled from the report Save (managed by upload/delete). `DiagnosticResultDialog` gains per-image download. `lib/print.ts` adds a `<base href>` so server-relative image URLs resolve (and load via cookie) in the print window. Non-editors get a read-only view.
- **Contract/sweep.** OpenAPI status enums renamed + `ImagingAttachment` schema + 6 endpoints (Orval regenerated; multipart upload + binary download use `customFetch`/`<img>`, the generated `useDelete*Image` hooks are used). Status literals swept in dashboard/reports services + seed (the `*Reviewed` report fields now match `completed`). Migration **0038** (`ALTER TYPE … RENAME VALUE` — hand-corrected from drizzle's destructive default, see MIGRATION_NOTES) + CHECK + dormant tenant_isolation RLS + grants. New dep: `multer`.

**Verify:** api-server (500 tests) + clinic (51 tests) green; both typecheck + route lint clean; Orval clean. Migration applied to real Postgres — enum renamed in place, existing rows preserved, RLS forced. **End-to-end smoke (live API):** admin login → create study (`requested`) → upload PNG → status auto-advances to `in_progress` → on-disk file at `1/xray/<uuid>.enc` is **ciphertext, not a readable PNG** → download decrypts to the exact original bytes → `?download` returns `Content-Disposition: attachment` → delete → 404. New unit tests cover `encryptBuffer`/`decryptBuffer` round-trip + GCM-tamper rejection + no-key pass-through.

## Reports — Ultrasound in diagnostics + new Operations report (2026-06-21)

Two additions to the Reports page. (1) **Ultrasound** is now in the diagnostics report (the tab is renamed "Lab / X-Ray / Ultrasound"). (2) A new **Operations** report (super_admin/admin only) answers "how many operations did each surgeon perform?" and "how many times did each staff member (nurse, anesthetist, assistant…) enter the OR?". All aggregation is SQL-side inside `runInTenantContext` (RLS-enforced), mirroring the existing report patterns — no new tables, no migration.

- **Backend** ([reports.service.ts](../artifacts/api-server/src/services/reports.service.ts)):
  - `diagnosticsSummary` extended with `totalUltrasounds`, `ultrasoundsReviewed`, `ultrasoundByStatus`, `topUltrasoundExamTypes` (grouped on `ultrasound_records.examType`), reusing the existing `localDate`/tz bucketing. Ultrasound carries the same `doctor_scope` RLS as lab/xray, so doctors stay patient-scoped automatically.
  - New `operationsSummary`: KPIs (total / completed / in-progress / cancelled), `byStatus`, `bySurgeon` (`performed` = `status IN ('in_progress','completed')`, plus `total`), `byProcedure` (top 10), `byDay` trend (gap-filled), and **`byStaff`** — a raw `tx.execute` that `CROSS JOIN LATERAL jsonb_array_elements(staff_assigned)` to count OR-team participation per user (with `jsonb_typeof = 'array'` guard against the column default). "Performed"/"entered" deliberately counts only operations that actually occurred. Audited as `READ`/`REPORT`.
- **Route** ([reports.ts](../artifacts/api-server/src/routes/reports.ts)): `GET /reports/operations` gated `requireRole("super_admin","admin")` (clinic-wide, includes non-clinical staff — not exposed to doctors/billing). Diagnostics route unchanged.
- **Contract** ([openapi.yaml](../lib/api-spec/openapi.yaml)): `DiagnosticsReport` gains the four ultrasound fields; new `OperationsReport` schema + `getOperationsReport` path. Orval regenerated.
- **Frontend** ([Reports.tsx](../artifacts/clinic/src/pages/Reports.tsx)): diagnostics tab gains 2 ultrasound KPI cards + "Ultrasounds by Status" pie + "Top Ultrasound Types" bar (CSV/print included). New admin-only **Operations** tab: KPI cards, "By Surgeon" bar, status pie, "OR Team Participation" bar + detail table (staff member · role · times in OR), "Top Procedures" bar, and operations-trend line; CSV + print sections added.
- **i18n:** 16 new keys (EN + AR).

**Verify:** api-server + clinic typecheck clean; route lint clean; Orval codegen clean. Verified end-to-end against the running dev server + real Postgres (logged in as superadmin): all four report endpoints return data — operations shows per-surgeon counts (Dr. Ahmed 3 performed) + OR-team participation (nurse Fatima 3×, xray_staff Khalid 1×); diagnostics includes the new ultrasound fields.

### Fix — report `byDay` time-series 500'd (pre-existing) + operations `byStaff` GROUP BY

While verifying the above, the Appointments, Revenue, and (new) Operations tabs showed "No data". Root cause was a **pre-existing bug** that made the Appointments and Revenue report endpoints return **500** outright (the `byDay` query is part of the same request), so those tabs never rendered:

- **`byDay` param-mismatch (appointments, revenue, operations):** the day-bucket expression `(<col> AT TIME ZONE 'UTC' AT TIME ZONE <tz>)::date` reuses a shared drizzle `sql` fragment in SELECT, `GROUP BY`, and `ORDER BY`. Each serialization re-binds `<tz>` as a *separate* placeholder (`$1`/`$7`/`$8`), and Postgres compares parsed expressions including the param id → `column "<col>" must appear in the GROUP BY clause`. Fixed by grouping/ordering on the **ordinal** position of the already-selected bucketed date (`GROUP BY 1 / ORDER BY 1`) so the tz expression is emitted once. ([reports.service.ts](../artifacts/api-server/src/services/reports.service.ts))
- **operations `byStaff`:** the single-level jsonb unnest selected `coalesce(u.full_name, '#' || (elem->>'userId'))`, which references the ungrouped lateral `elem` → same GROUP BY error. Fixed by extracting `user_id` in a subquery first, then aggregating over the plain column.

Both confirmed by reproducing the exact Postgres error and the passing rewrite directly against the DB.

## Operations — reject request + lifecycle actions (start / complete) (2026-06-21)

Two gaps closed in the Operations workflow. (1) Admins/super_admins can now **decline** a pending surgery request, not just approve it. (2) After approval, an operation was stuck at `scheduled` with no UI to advance it — there are now **Start** (→ `in_progress`) and **Complete** (→ `completed`) actions, so the full `requested → scheduled → in_progress → completed` state machine is drivable from the page. **No schema/migration/contract change** — every transition is already permitted by the `operation_status` enum and carried by the existing `PATCH /operations/:id` (`status`, `notes`).

- **Reject** — a **Reject** button beside Approve (table row + detail dialog), shown only to `admin`/`super_admin` on `requested` operations. Opens a small dialog with an **optional** "reason for rejection" textarea. Backend ([operations.service.ts](../artifacts/api-server/src/services/operations.service.ts) `updateOperation`) treats `requested → cancelled` as the decline counterpart to approval, gates it to `admin`/`super_admin`, **appends** the optional reason to existing notes as `[Rejected] <reason>` (preserves the original referral note), audits `REJECT`, and notifies the requester + surgeon.
- **Lifecycle (start/complete)** — `scheduled → in_progress` and `in_progress → completed` are gated to `admin`/`super_admin` **or the operation's own surgeon** (`req.user.userId === surgeonId`) — not any other doctor. Audited as `START` / `COMPLETE`. Buttons appear in the table row and detail dialog for those roles at the matching status.
- **Frontend** ([Operations.tsx](../artifacts/clinic/src/pages/Operations.tsx)): shared `statusActions(op, …)` renderer drives both the table cell and the dialog footer; `updateMutation` success toast is status-aware (rejected / approved / started / completed). `staffAssigned` parse moved ahead of the tenant tx so `updateData` is assembled after reading `existing` (needed for the notes-append).
- **i18n:** 10 new keys (EN + AR) — `reject`, `rejectOperation`, `rejectOperationConfirm`, `rejectionReason`, `rejectionReasonPlaceholder`, `operationRejected`, `startOperation`, `completeOperation`, `operationStarted`, `operationCompleted`.

**Verify:** clinic + api-server typecheck clean. Reason is optional (empty submits a bare decline).

## Medical Records / Prescriptions / Operations — read-only "view all information" detail dialogs (2026-06-21)

The three clinical list pages showed only truncated columns with no way to see a full record. Each now opens a complete read-only detail panel on row click. **No backend/API/schema change** — the list endpoints already return every field (the service `select`s the full set), so the dialogs render from data already in the client cache (no extra fetch, no new audit surface).

- **Shared primitive:** new [DetailView.tsx](../artifacts/clinic/src/components/DetailView.tsx) exports `DetailSection` / `DetailGrid` / `DetailField` — label/value rows in titled sections, RTL-safe (no directional classes; alignment inherits from `dir`). `DetailField` supports a `secondary` line (rendered `dir="rtl"`) for the Arabic translation of a field.
- **Medical Records:** patient/doctor/date header, clinical block (chief complaint, diagnosis, treatment, notes — each with its Arabic line when present), and a **vitals grid** with units + BMI. Abnormal vitals flag rose using the existing `VITAL_NORMAL` ranges. Vitals are read as the real `VitalsMeasurements` runtime shape (`bloodPressureSystolic/Diastolic`, `respiratoryRate`, `glucose`, `pain` …), which the generated `MedicalRecord.vitals` type (legacy `Vitals`) doesn't model — hence `renderVitals(vitals: any)`.
- **Prescriptions:** patient identity (name + allergy flag, MRN, DOB+age, gender), prescriber, date; **per-medication cards** (name, dosage, frequency, duration, instructions); notes (+Arabic). **Print** button reuses `prescriptionHtml` + `openPrintWindow`.
- **Operations:** patient, procedure, status badge, surgeon, OR, scheduled time, requested-by; **surgical team** list (`staffAssigned` → `userName` + role badge, "No team assigned" when empty); notes. An **Approve** button is included in the footer for `admin`/`super_admin` on `requested` operations (reuses the existing `updateOperation` mutation).
- **i18n:** 5 new keys (EN + AR) — `medicalRecordDetails`, `prescriptionDetails`, `operationDetails`, `noVitalsRecorded`, `noTeamAssigned`. Every other label reused existing keys.
- **Note (lesson):** passing `setState` directly to `DataTable`'s `onRowClick` polluted the table's generic `T` inference (widened to the `SetStateAction` union → "Property 'patient' does not exist on (prevState…)" across the column renderers). Wrap as `onRowClick={r => setX(r)}` so `T` is inferred from `data` only.

**Verify:** clinic typecheck clean; frontend **51/51** tests green (incl. EN/AR i18n parity). Purely additive frontend feature — no migration, no contract change.

## Fix — Appointment state machine: concurrency (CAS), cancel bypass, invalid-transition 500s (2026-06-20)

Hardening of the appointment transition path, surfaced by a patient-flow architecture review. Three correctness defects closed in [appointments.service.ts](../artifacts/api-server/src/services/appointments.service.ts); no schema/migration change.

- **W2 — lost update on concurrent transitions (no compare-and-swap).** Status writes updated `WHERE id AND clinic_id` with no guard on the *current* status, so two staff acting on the same patient both validated against a stale read and the later write silently won. Every status write (`transitionAppointment`, `checkinAppointment`, `cancelAppointment`) now appends `eq(status, expectedFrom)` to the UPDATE; 0 rows ⇒ `ConflictError` (409). No `version` column needed — the validated source status is the CAS token.
- **W1 — cancel bypassed the state machine.** `DELETE /appointments/:id` → `cancelAppointment` never called `validateTransition`, so a terminal `completed`/`no_show` could be flipped back to `cancelled`, and a missing/cross-tenant id threw a raw `TypeError` (→ 500). Now it `SELECT`s first (→ `NotFoundError`/404) and routes through `validateTransition("cancel", …)` (→ 409 on terminal), with before/after `auditSnapshot` on the CANCEL audit.
- **Latent — invalid transitions returned 500 instead of 409/403.** The failure path threw `Object.assign(new Error, { status })` — a plain Error `asyncHandler` doesn't recognize (it maps only `instanceof` domain errors), so it fell through to the global handler as a **500**. This affected *every* transition endpoint (e.g. triage-ing a `scheduled` appt). Replaced with a `transitionError()` helper mapping 403→`ForbiddenError`, 409→`ConflictError`.

**Verify:** typecheck clean; backend **493/493** unit; new [appointment-lifecycle.integration-db.test.ts](../artifacts/api-server/src/tests/appointment-lifecycle.integration-db.test.ts) (6 tests: terminal-cancel→409, cancel-not-found→404, active-cancel→200, concurrent-triage→one 200/one 409, stale-transition→409) green against real Postgres.

## Reports — SQL aggregation, timezone-correct buckets, diagnostics endpoint, role split (2026-06-19)

Full rework of the Reports section addressing correctness, scale, financial accuracy, authorization, and UX gaps identified in review.

- **Correctness — diagnostics no longer capped/unfiltered.** The Lab & X-Ray tab previously pulled `useListLabTests({})` / `useListXrayImages({})` (cursor-paginated, default **50 rows**, `nextCursor` dropped at the route) and reduced client-side — so every diagnostics KPI/chart counted **at most the 50 most-recent records** and **ignored the date filter**. Replaced with a new aggregated endpoint **`GET /reports/diagnostics?dateFrom&dateTo`** (`DiagnosticsReport`) that `GROUP BY status / test_name / body_part` in SQL over the selected range.
- **Scale + money — SQL aggregation.** `reports.service.ts` rewritten: all three reports aggregate with `COUNT/SUM/AVG ... GROUP BY` instead of fetching rows into Node. Money is summed as Postgres `numeric` (`SUM(total) FILTER (WHERE status='paid')`), `::float8` only for transport — no float drift. Memory is bounded on wide ranges.
- **Timezone-correct day buckets.** Day boundaries use `(ts AT TIME ZONE 'UTC' AT TIME ZONE clinics.timezone)::date` (the clinic's `timezone`, Phase 6) for both the range filter and `byDay` grouping. Revenue `byDay` is **gap-filled** across every calendar day in range (zero days included).
- **Wait-time fix.** `averageWaitTimeMinutes` now measures `consultation_started_at − checked_in_at` (true waiting-room time), `GREATEST(…, 0)` clamped so clock skew/early check-ins can't drag it negative; only counts appts that reached consultation.
- **Period-over-period.** Each report returns an inline `previous` block (the immediately-preceding window of equal length) computed server-side; the page renders delta chips (▲/▼ %, colour by good-direction). Appointments also returns `noShowRate`, `byStatus`, `byDay`; revenue adds `pendingInvoices`, `cancelledInvoices`, `pendingAmount`, `collectionRate`, and `topServices` (top 10 by collected revenue from `invoice_items` on paid invoices).
- **Authorization / SoD.** Per-endpoint `requireRole` replaces the blanket page gate: **revenue → `super_admin`/`admin`/`billing_manager`** (doctors no longer see whole-clinic revenue or peer billing); **appointments → `super_admin`/`admin`/`doctor`**, doctors **self-scoped** to their own appointments; **diagnostics → +`billing_manager`**, doctors patient-scoped via the existing `doctor_scope` RLS (migration 0017). `billing_manager` added to the `/reports` nav; `route-access.contract.test.ts` (frontend) BACKEND_CONTRACT updated.
- **Validation + audit.** `dateFrom`/`dateTo` validated as `YYYY-MM-DD` with `from ≤ to` (canonical 400 envelope) instead of degrading to a NaN-bounded query. Report reads now `logAudit("READ","REPORT", …, { report, dateFrom, dateTo })` — the audit records *what* was read.
- **UX.** Role-gated tabs; empty states for appointments/revenue ("No data for the selected date range"); **Print** summary (reuses sanitized `openPrintWindow`/`escapeHtml`); CSV export extended to diagnostics; chart containers get `role="img"` + `aria-label` text summaries. New i18n keys `vsPrevPeriod`, `noDataForRange` (EN + AR).
- **Contract.** `openapi.yaml` updated (`AppointmentReport`/`RevenueReport` enriched, new `DiagnosticsReport`, new `/reports/diagnostics` path); Orval regenerated. Typecheck/lint clean; 45 frontend + 493 backend tests green; production build clean.

### Follow-up — closed the gaps between the above and the actual code (2026-06-20)

The 06-19 entry was ahead of the implementation. This pass made it real:
- **Service:** implemented the fields the contract already declared but the service didn't return — `appointmentsSummary` now emits `noShowRate`, `byStatus`, `byDay` (gap-filled), and the `previous` (period-over-period) block; `revenueSummary` now emits `pendingInvoices`, `cancelledInvoices`, `pendingAmount`, `collectionRate`, `topServices` (10 by collected revenue, `invoice_items ⋈ paid invoices`), and `previous`. Extracted a reusable `totalsFor(from,to)` per report to compute current + previous windows; added a `previousRange()` helper.
- **Frontend:** fixed the residual UTC date bug (`toISOString()` → local `toLocaleDateString("en-CA")` for the default range + `today`); **localized the lab/x-ray pie status labels** (were raw enums like `in_progress`) and added an **appointment status pie** + **appointments-over-time trend line** (the `byStatus`/`byDay` data was returned but never charted); appointments CSV now exports the KPI summary, not just by-doctor.
- **OpenAPI:** added `byStatus`/`byDay`/`noShowRate`/`previous` to `AppointmentReport` and the splits/`topServices`/`previous` to `RevenueReport`; regenerated. 9 EN+AR i18n keys.

**Verify:** monorepo typecheck clean; backend 493/493; frontend 45/45 (EN/AR parity). Report SQL (tz bucketing, `filter(...)` aggregates, true wait time, top-services join) executed against live `clinic_db` without error. No DB migration (read-only feature).

## Users — home-address section for employees (2026-06-19)

- **New staff fields:** `users` gains five nullable text columns — `address_line`, `city`, `region`, `postal_code`, `country` (migration `0036_fuzzy_carmella_unuscione.sql`, additive, non-breaking). These are **staff personal data, not PHI** (no field-encryption, not in `auditSnapshot`'s redaction set).
- **API:** `User`, `CreateUserBody`, `UpdateUserBody` in `openapi.yaml` carry the five fields (optional); Orval regenerated. `users.service.ts` accepts them in `createUser`/`updateUser` and returns them via `userSelect`.
- **UI:** a **Home Address** section (Address / City / State-Region / Postal Code / Country) is added to the create-user dialog ([Users.tsx](../artifacts/clinic/src/pages/Users.tsx)) and the edit dialog + a read-only Home Address card on [UserProfile.tsx](../artifacts/clinic/src/pages/UserProfile.tsx) (shows "No address on file." when empty). 8 new i18n keys (EN + AR).
- **Migration note:** apply with `pnpm --filter @workspace/db run db:migrate` on staging/prod (not applied in the dev shell — no `DATABASE_URL`).

### Address treated as sensitive PII (follow-up)

- **Pino log redaction:** `lib/logger.ts` now censors `*.addressLine / *.city / *.region / *.postalCode / *.country` (alongside the existing `*.phone`/`*.email`/PHI paths) so a staff address never lands in structured logs.
- **Audit-snapshot redaction:** `lib/audit-snapshot.ts` gains a separate `AUDIT_SENSITIVE_REDACT_FIELDS` set (the five address columns). It is **not** added to `phi-fields.ts` (those are encrypted-at-rest only, with a drift guard) — the address fields are sensitive PII, not encrypted PHI. `auditSnapshot()` now redacts both sets to `"[redacted]"`; the changed-field *names* still surface via `details.fields`.
- **`updateUser` audit path fixed:** it previously wrote `{ before, after }` into the audit **`details`** column — bypassing `auditSnapshot` entirely, so it copied the full returned row (incl. `passwordHash`) and (after this feature) cleartext addresses into `audit_logs`, and the change-history UI dumped raw JSON instead of a diff. Migrated to the canonical `logAudit(..., { fields: changedFields(before, after) }, auditSnapshot(before), auditSnapshot(after))` pattern → populates `beforeState`/`afterState` (so `ChangeHistory.tsx` renders a real field diff), drops `passwordHash`, and redacts addresses.

**Verify:** api-server + clinic typecheck clean; frontend 45/45; backend **493/493** (added an audit-snapshot test asserting address redaction).

## Fix — Billing not showing in Daily Reconciliation (Z-Report) (2026-06-19)

- **Root cause #1 — `paid_at` stored in the wrong time frame.** `invoices.paid_at` / `created_at` are `timestamp` *without time zone*. `created_at` is filled by the DB (`defaultNow()` → clinic wall-clock), but `paid_at` was filled by the app as a JS `new Date()` (UTC wall-clock) in `createInvoice`/`payInvoice`. The two landed **~3h apart** for the same instant (verified: invoice created `00:16` Istanbul, paid `21:16` UTC). The Z-Report's "collected" lens + payments table filter on `paid_at`, so paid invoices fell outside the day window. (The dashboard daily revenue filters on `created_at`, which is why it worked and the Z-Report didn't.) **Fix:** write `paid_at` (and `updated_at` on pay) with DB `now()` so it shares the `created_at` frame.
- **Root cause #2 — page defaulted to the UTC day.** `Reconciliation.tsx` computed "today" via `new Date().toISOString()` (UTC), so before 03:00 Istanbul the page asked for *yesterday* and showed nothing. **Fix:** default to the local calendar day (`toLocaleDateString("en-CA")`).
- **Hardening — replaced hand-rolled TZ math with the existing helper.** `getDailySummary` + `getBillingReconciliation` rolled their own `getTimezoneOffset` day-window (only correct when Node runs in UTC). Both now use `dayBoundary(date, getClinicTimezone(req))` from `lib/dateUtils.ts` (server-TZ-independent, per-clinic-tz aware) and default the date to `clinicDateString(tz)`. New `clinicDateString()` helper added to `dateUtils`.
- **Dev data:** one pre-existing dev invoice had the old skewed `paid_at`; realigned to `created_at` (`UPDATE invoices SET paid_at = created_at WHERE …`). New invoices are correct by construction.
- **Known residual (follow-up, not this fix):** these columns are `timestamp` without tz, so JS round-trips can still display ±tz-offset depending on the Node process TZ. The durable fix is migrating instant columns to `timestamptz`; tracked separately.

**Verify:** api-server + clinic typecheck clean; `dayBoundary("2026-06-19","Europe/Istanbul")` → `2026-06-18T21:00Z … 2026-06-19T20:59:59.999Z` (Istanbul 00:00–23:59:59). Create a "Save & Pay" invoice → it appears in the Z-Report for today's (clinic-local) date.

## Billing — invoices are paid at creation (point-of-sale), no pending step (2026-06-19)

- **`markPaid` on invoice create.** `CreateInvoiceBody` gains an optional `markPaid` flag; `createInvoice` honors it by inserting the invoice with `status=paid` + `paidAt=now`. The Billing "New Invoice" Save button now sends `markPaid: true` (label "Save & Pay"), so front desk collects at the counter and the invoice is paid immediately — no pending → pay-later step.
- **SoD note (intentional):** the point-of-sale path deliberately bypasses the separate pay step's Separation-of-Duties + anti-fraud gate (those only guard the pending → pay-later flow, where a *different* person settles a standing invoice). The owner asked for immediate payment at the counter. The legacy pending flow + the per-row "Pay Now" action still exist for any invoice created unpaid (`markPaid` omitted) — e.g. insurance/deferred billing. Audited as `CREATE` + `PAY` (`atCreation: true`).

**Verify:** monorepo typecheck clean; frontend 45/45; backend 492/492 (no test asserted the old pending-by-default behavior).

## Fix — invoice Save always failed ("Invalid items format") (2026-06-19)

- **Bug:** the create-invoice form sent each line item as `{ description, quantity, unitPrice, total }`, but the backend guard `invoiceItemSchema` (in `jsonb-schemas.ts`) is `.strict()` and allows only `description`/`quantity`/`unitPrice`. The extra `total` key made `itemsSchema.safeParse` reject the request → `ValidationError("Invalid items format")` → "Failed" toast on every Save. Pre-existing latent bug (the local item state always carried `total`).
- **Fix (frontend):** the Save handler now maps line items to **only the three allowed fields** (`total` is derived server-side), drops blank/zero-qty lines (`description` requires min length 1), and adds pre-submit guards with clear toasts ("Select Patient" / "Please fill the required fields") instead of a generic failure.

**Verify:** monorepo typecheck clean; frontend 45/45. Frontend-only.

## Billing — print prompt right after creating an invoice + bilingual service names (2026-06-19)

- **Print-on-create:** after an invoice is saved, a small "Invoice created" prompt shows the invoice number + total with a **Print invoice** button (and Close). The payload is assembled from the create response + the patient and line items already on screen (the response carries no patient join / per-line totals), so the printout is complete. Printing existing invoices from the list (printer icon per row) is unchanged.
- **Bilingual service names everywhere:** the Service Prices list, search, and the Billing service picker (label + the description it fills onto the line) now show the **Arabic name** when the app is in Arabic (`nameAr`), falling back to English. The list also shows the alternate-language name as a subtitle so both are always visible. All ~30 seeded defaults already ship bilingual.

**Verify:** monorepo typecheck clean; frontend 45/45. Frontend-only (no schema/backend change).

## Billing — searchable patient, always-on service picker, custom lines, price-book defaults (2026-06-18)

- **Billing patient field is now searchable** (`SearchSelect`) by name + MRN + ID-card number — was a plain dropdown.
- **Service picker always shows** on each invoice line (previously hidden when the price book was empty, which read as "no picker"). When empty it shows a "no services" hint; once prices exist it lists them.
- **Custom lines explicit:** a hint under Items — "pick a service from the price book, or type a custom line below." Free-text description + price were always editable; now it's clear you can bill an item that isn't in the catalog.
- **Price book one-click starter list:** new `POST /services-catalog/seed-defaults` (`seedDefaultServices`, super_admin/admin) inserts ~30 common bilingual services (consultations, common labs, X-ray regions, ultrasound exams, operations, procedures) at price 0 — name-matched so re-running never duplicates. Surfaced as an **"Add common services"** button (toolbar + an empty-state card on Service Prices). Admin then just edits the prices instead of creating each from scratch. Includes the `*_DEFAULT` coded fallback rows for the future charge engine.
- 3 new EN+AR i18n keys (`loadDefaults`, `noServicesHint`, `customLineHint`).

**Verify:** monorepo typecheck clean; frontend 45/45; backend contract-routes 69/69 (seed op ↔ route matched). New endpoint only; no schema change.

## Billing — service picker on invoices + admin-sidebar visibility fix (2026-06-18)

- **Invoice line-items now pull from the price book.** Each line in the create-invoice editor gets a **"Pick a service…"** searchable picker (active `services_catalog` entries); choosing one auto-fills the description + the unit price the admin set (still fully editable, and free-text custom lines still work). This is the connection the price book was missing — admins maintain prices in **Service Prices**, front desk picks them on the invoice. (Distinct from the larger clinical-event auto-charge engine, still step 2.)
- **Fix — new pages were invisible to admin/super_admin.** The sidebar uses a *grouped* menu for super_admin/admin driven by the hardcoded `ADMIN_SECTIONS` array in `Layout.tsx`, which only renders keys listed there — so `reconciliation` and `service-prices` (correctly in `navItems`) never showed for admins. Added both keys to the Operations section. **Doc footgun:** CLAUDE.md "Adding a New Page" step 6 claims the sidebar needs no manual edit — true only for non-admin roles; new items must also be added to `ADMIN_SECTIONS`.
- 1 new EN+AR i18n key (`pickService`).

**Verify:** monorepo typecheck clean; frontend 45/45 (incl. EN/AR parity). Frontend-only (no schema/backend change).

## Security — global search doctor-scope leak fixed + LIKE-injection hardening (2026-06-18)

- **HIGH: `GET /search` leaked PHI across doctor scope.** `globalSearch` (`search.service.ts`) filtered only by `clinicId`, so any **doctor** could enumerate **every** clinic patient (name/MRN/phone/DOB) and **every** appointment (reason + patient identity) regardless of assignment — `listPatients` enforced `isDoctorScoped` but search never did. The `medical_records` branch was already protected by the doctor_scope RLS (migration 0017); the **patients** and **appointments** branches (RLS = tenant-only) were not. Fix: `globalSearch` now calls `getDoctorListScope(req, "search")` once and applies `inArray(..., allowed)` to all three branches, passing `{ breakGlassPatientIds }` to `runInTenantContext`. Non-doctor roles unchanged. Violated the CLAUDE.md "Doctor Scope Rule (CRITICAL)"; `GET /search` added to that rule's enforced-route list.
- **LOW: LIKE-metacharacter injection in search.** User-supplied `%` / `_` / `\` were interpolated raw into the ILIKE pattern in `search.service.ts` and `patients.service.ts` (not SQLi — value is bound — but allowed wildcard injection / pathological patterns). New `escapeLike()` in `lib/validators.ts` backslash-escapes them (Postgres default escape char); applied in both services.
- **LOW: unbounded search term.** Search input is now capped to 100 chars before the ILIKE wrap (was: min-2 only, no max), bounding the three parallel scans.
- **Minor: `clinic_notices` content/reason now have max lengths** (`content` ≤ 5000, `reason` ≤ 1000) — previously min-only, an unbounded text column.
- **Minor: `csp-report` field clamps.** The anonymous `/api/csp-report` ingest now truncates persisted string fields (2 KB, `scriptSample` 4 KB) and caps the `raw` JSONB at 16 KB (oversized → `{ _truncated, _bytes }` marker) so a hostile client can't bloat `csp_reports` rows. Outer guards (1 MB body cap + global rate limiter) unchanged.
- **Functional: encrypted `diagnosis` removed from search.** `diagnosis` is AES-GCM encrypted at rest, so the search ILIKE on it only ever matched ciphertext, and the result row shipped that ciphertext to the client — `GlobalSearch.tsx` rendered the `enc:v2:…` blob as the record's primary line. The records branch now matches/returns the plaintext `chiefComplaint` only; `diagnosis` is no longer selected. Frontend renders `chiefComplaint` (fallback "Medical record") + patient name.

**Verify:** monorepo typecheck (api + clinic) + route-lint clean; backend **492/492** unit (incl. 5 new `escapeLike` tests); `search-scope.integration-db.test.ts` (4 tests) passes on **real Postgres with RLS active** — proves a doctor's search returns only assigned patients/appointments, symmetry holds, and an all-wildcard `%%` probe matches literally (empty) rather than everything.

## Billing — service price book (auto-charge foundation, step 1) (2026-06-17)

- **`services_catalog` made tenant-correct + given a full CRUD + admin UI.** The table existed since migration 0019 but was **global (no clinicId) and entirely unused** (no service, route, or UI). Migration `0035` adds `clinic_id` (NOT NULL FK), `code` (stable mapping id for the charge engine), and `deleted_at`, plus the standard tenant-isolation block — `CHECK (clinic_id > 0)` + dormant `tenant_isolation` RLS + `medicore_app` grant (it was **not** in the 0015 RLS set because it had no `clinic_id` then).
- **New endpoints** (`services-catalog.service.ts` + `routes/services-catalog.ts`): `GET /services-catalog` (read: super_admin/admin/billing_manager/front_desk), `POST` / `PATCH /:id` / `DELETE /:id` (manage: super_admin/admin, soft-delete via `deletedAt`). All audited with before→after snapshots. Added to `openapi.yaml` + regenerated client.
- **New page `/service-prices`** ("Service Prices") — manage the price list: name (EN/AR), price, category, and a stable **service code** (e.g. `CONSULTATION`, `LAB_DEFAULT`) used by the upcoming charge engine. Search, active/inactive toggle, edit/delete. Roles: super_admin/admin/billing_manager/front_desk (write gated to admins in the UI + backend). 7 new EN+AR i18n keys; RBAC-parity contract-test entry added.
- **This is step 1 of "auto-generate charges."** Decisions locked (via AskUserQuestion): **manual "Generate charges" button** (reviewable, not silent) + **managed price book in `services_catalog`** (per-item prices, not per-category). **Step 2 (next): the charge engine** — add `billedInvoiceId` to appointments/lab_tests/xray_records/ultrasound_records/operations, a `GET /billing/billable-items?patientId` scan that resolves prices from this catalog (specific name match → category/code default), and an atomic `POST /billing/invoices/from-charges` that creates the invoice + items and stamps the source rows (double-bill safe), plus the "Generate charges" UI on Billing.

**Verify:** monorepo typecheck clean; frontend 45/45 (incl. RBAC-parity + EN/AR parity); backend 492/492 (contract-routes picked up the 4 new catalog ops); migration `0035` applied to dev DB.

## Billing — daily reconciliation / Z-report (super_admin only) (2026-06-17)

- **New `GET /billing/reconciliation?date=` (super_admin only)** → `getBillingReconciliation` service. Two lenses on a single day: money **collected** (invoices whose `paidAt` falls in the day — the cash-drawer list, captures payments on invoices created earlier) and invoices **created** that day (invoiced / outstanding-pending / cancelled totals + counts). Returns a `summary` block + a `payments` array (invoice #, patient, amount, paidAt, created-by) joined to patient + creator names. Audited `RECONCILIATION_VIEW` + `logRead("invoice")`. Day window respects `CLINIC_TZ` (same logic as `getDailySummary`).
- **New page `/reconciliation`** (Z-Report) — super_admin only (nav + route guard + `route-access` entry roles `["super_admin"]`; backend `requireRole("super_admin")`; RBAC-parity contract test entry added). 4 summary cards (Collected / Invoiced / Outstanding / Cancelled, each amount + count), a payments-collected table, CSV export, and a browser **Print** (toolbar hidden via `print:hidden`). 9 new EN+AR i18n keys.
- **Known limitation (surfaced for a follow-up):** there is no `paidById` column, so "collected by" shows the invoice **creator**, not the cashier who took payment. Adding `paidById` would make the Z-report a true per-cashier drawer report.

**Verify:** monorepo typecheck clean; frontend 45/45 (incl. RBAC-parity + EN/AR parity); backend 487/487 (incl. contract-routes ↔ the new op). No schema change (reads existing `invoices`).

## Imaging structured report templates + Audit Log page overhaul (2026-06-17)

- **X-Ray & Ultrasound — structured report templates:** new `lib/reportTemplates.ts` ships bilingual scaffolds (X-ray: Normal Chest, Pneumonia, Normal Bone/Extremity, Fracture, Normal Abdomen; Ultrasound: Normal Abdominal, Cholelithiasis, Obstetric, Normal Pelvic, Normal Thyroid). An **"Insert template…"** picker sits next to the Findings field in both report editors; choosing one fills Findings + Impression (and the Arabic fields, auto-expanding the Arabic section) — appended if text already exists, so it never clobbers. Frontend-only (report stays free text), so radiologists get a fast start and the bilingual print stays populated. 1 new EN+AR key (`insertTemplate`).
- **Audit Log — "log everything" surfaced:** coverage was already broad in the backend (login/logout, password change, approvals, break-glass, consent, erasure, stock-adjust, denials are all logged) — the page just exposed a stale subset. The page now: (1) **unions a curated, comprehensive action/entity list with whatever the data actually contains**, so a newly-added action/entity can never hide; (2) adds tones for every action (security/denied = rose, break-glass/compliance = amber, reads = muted); (3) adds a **free-text search** (user / username / entity id / IP / action) on top of the server date/action/entity filters; (4) adds a **"Hide reads"** toggle to mute `READ`/`READ_LIST`/`AUDIT_LOG_READ` noise; (5) splits the banner into **security events** (failed/locked logins, denials, fraud-gate, password resets) and **break-glass events**, with row highlighting + icons for both. 2 new EN+AR keys (`breakGlassEvents`, `hideReads`).

**Verify:** monorepo typecheck clean (4 projects + libs); frontend 45/45 (incl. EN/AR parity for the 3 new keys). No backend/schema change.

## Inventory — stock-movement ledger + expiry early-warning (2026-06-17)

- **Stock-movement ledger (new table `inventory_transactions`, migration `0034`):** every quantity change now writes an append-only ledger row — signed `delta`, `quantityAfter` snapshot, `reason` (`initial`/`restock`/`consumed`/`expired`/`adjustment`), optional `note`, and `performedById` (who) + `createdAt` (when). UUID-v7 PK; full tenant isolation (CHECK `clinic_id>0` + dormant `tenant_isolation` RLS + `medicore_app` grants, mirroring the 0014/0015/0020 standard).
  - `createInventoryItem` records an `initial` entry; `updateInventoryItem` records an `adjustment` when its quantity field changes; the new `adjustInventoryStock` service applies a signed movement **atomically** (reads current qty, rejects results < 0, updates + inserts the ledger row in one tenant transaction).
  - **New endpoints:** `POST /inventory/:itemId/adjust` (`{delta, reason, note?}`, super_admin/admin) and `GET /inventory/:itemId/transactions` (ledger, most-recent-first, joined to staff name; readable by the same clinical roles that read inventory). Added to `openapi.yaml` + regenerated client (`useAdjustInventoryStock`, `useListInventoryTransactions`).
  - **UI — per-item "Stock Movements" dialog** (history icon on each row): a quick **adjust** form (Restock + / Consumed − / Expired − with amount + note) over the **full ledger** (colored ± delta, reason badge, resulting qty, note, timestamp, who). The inline −/+ steppers now post real movements (`restock`/`consumed`) instead of a silent absolute write, so the count always traces to a logged reason.
- **Expiry early-warning:** items expiring within **30 days** now show an amber **"Expiring soon"** status + a dedicated stat chip (now 4: Total / Low / Expiring soon / Expired), distinct from already-expired (rose). The expiry-date cell goes amber in the warning window.
- 11 new EN+AR i18n keys (stockMovements, adjustStock, apply, amount, consumed, adjustment, initial, noMovements, currentStock, stockHistory, + reuse of expiringSoon).

**Verify:** monorepo typecheck clean (4 projects + libs); frontend 45/45 (incl. EN/AR parity); backend 487/487 (incl. contract-routes ↔ the 2 new ops); migration `0034` generated + applied to dev DB.

## Inventory — full management for admins (add / edit / delete + filters & stock controls) (2026-06-17)

- **Edit existing items:** the Inventory list was previously add-only. Admins/super-admins can now click any row (or the new pencil action) to **edit** every field — name, category, quantity, unit, min-stock, expiry, notes — plus an **active/inactive** toggle. Reuses the existing `PATCH /inventory/:itemId`; the update now records a real before→after change-history (`auditSnapshot`, `details.fields`).
- **Remove items (new):** added `DELETE /inventory/:itemId` (soft-delete via `deletedAt`, super_admin/admin only) → `deleteInventoryItem` service + `useDeleteInventoryItem` hook. Surfaced as a trash action and a Delete button inside the edit dialog, both behind a confirm dialog. Audited `DELETE` with before→after snapshot. Added the op to `openapi.yaml` and regenerated the client.
- **Quick stock controls:** inline −/+ steppers on the quantity cell adjust stock in one click (no dialog) for fast restock/consume.
- **Filters & at-a-glance stats:** summary chips for **Total / Low stock / Expired** (the Low-stock chip toggles a low-stock-only filter), a **category** filter (derived from existing items, with a datalist on the category input), and the existing search. Inactive items render dimmed with an "Inactive" tag.
- 14 new EN+AR i18n keys (editInventoryItem, itemUpdated, itemDeleted, deleteItem, deleteItemConfirm, restock, lowStockOnly, expiredOnly, totalItems, expiringSoon, allCategories, …). Read access for clinical staff (doctor/nurse/lab/xray) is unchanged — write/delete stay admin-only.

**Verify:** monorepo typecheck clean (4 projects + libs); frontend 45/45 (incl. EN/AR parity); backend contract-routes + route-access 69/69 (new delete op ↔ route matched). No DB migration (uses existing `deletedAt`).

## Appointments fix + per-user profile page with doctor working hours (2026-06-17)

- **Fix — "No schedule for this day" on every booking:** `doctor_schedules` was **empty** (0 rows) — schedules are created via the Schedule → Weekly Template UI and were never set up, and the seed never created them. `checkDoctorAvailability` rejects any weekday with no active schedule row, so every booking failed. Fixed: (a) inserted full-week 09:00–17:00 hours for the existing doctors; (b) **the seed now creates doctor schedules** (`seed.ts` — full week for both seeded doctors), so fresh DBs aren't dead-on-arrival for booking. Root cause was data, not logic.
- **New: per-user profile page** (`/users/:userId`, admin/super-admin only — guarded by the existing `/users` rule). Click a name in the Users list → full profile (name EN/AR, username, role, status, on-shift, email, phone, specialty/department for doctors, created). Edit details inline (reuses `updateUser`).
- **Doctor working hours on the profile:** for doctors, a 7-day **working-hours editor** (reuses `getDoctorSchedule`/`upsertWeeklyBlock`/`deleteWeeklyBlock`/`updateWeeklyBlockStatus`) — set/edit each day's hours + slot length + max patients, toggle a day active/inactive, or mark it off. These hours are exactly what gate appointment booking. (Non-doctor staff hours intentionally deferred — a fingerprint/clock-in attendance system is planned for those.)

**Verify:** clinic typecheck clean; frontend 45/45 (route-access + EN/AR parity incl. new keys); no backend changes (reuses existing endpoints).

## Operations — fix: doctors couldn't pick a surgeon; record the requester (2026-06-17)

- **Bug (regression):** the rewrite fetched the surgeon/team lists via `GET /users`, which is restricted to `super_admin/admin/front_desk/nurse` — **doctors got 403, so the surgeon picker was empty** and they couldn't submit. Fixed: the **surgeon** picker now uses the doctor-accessible `GET /users/doctors` (added to the OpenAPI spec → `useListDoctors`; the Express route already existed). The **OR-team** picker (needs the full staff directory, doctors can't list it) is now shown only to roles that *can* list staff (`canManageTeam`); for a doctor's request the admin assigns the team at approval. The `/users` query is `enabled` only for those roles (no more 403 noise).
- **Who sent the request:** new `operations.requested_by_id` column (migration `0033`, nullable FK → users), **server-set to the signed-in user** (can't be spoofed), distinct from the surgeon. Surfaced as a **Requested by** column (joined via an aliased users join). Added `requestedBy`/`requestedById` to the `Operation` schema.
- **Note (not a bug):** the patient picker is doctor-scoped (a doctor sees only their assigned patients — HIPAA), identical to Lab/X-Ray/Medical Records. A doctor with no assigned patients sees an empty list by design.

**Verify:** monorepo typecheck clean; frontend 45/45; backend 487/487 (incl. contract-routes); migration 0033 applied.

## Operations — searchable patient + surgeon, and a recorded surgical team (2026-06-16)

- **Patient** and **Surgeon** are now searchable pickers (`SearchSelect`; patient matches name/MRN/ID card). Surgeon stays a *choice* (not locked to the signed-in user) — an admin/front-desk legitimately schedules for a surgeon who isn't them; there is no separate "scheduled by" column to overwrite.
- **Surgical team** (`staffAssigned`): the OR team — assisting surgeons, anesthetist, scrub/circulating nurses — can now be recorded. A staff multi-picker adds members (any clinic user, excludes the surgeon + already-added) each with a free-text role; the list view shows a teal **Users · N** badge. The `staffAssigned` column already existed but was always saved `[]`.
- **Contract fix:** `staffAssigned` was typed in OpenAPI as `integer[]` while the backend zod (`staffAssignedSchema`) actually validates `[{userId, role?}]`. Added a `StaffAssignedItem` schema and corrected `Operation`/`Create`/`UpdateOperationBody`; Orval regen'd. (Latent because the UI only ever sent `[]`.)
- **Bug fix:** scheduling with an empty date threw synchronously (`new Date("").toISOString()`); now validated with a missing-fields toast, like Appointments.

### Approval gate — surgery requests route up to an OR coordinator (admin)

New `requested` operation status (migration `0032`, enum value before `scheduled`). The surgeon's request goes **up** to admins to confirm logistics (room/slot/resources) — **not** the clinical decision, which stays the surgeon's.

- A **doctor** creating an operation → status `requested`; all clinic **admins/super_admins** get an in-app notification ("Surgery scheduling request"). Submit button reads **Send request** with a hint.
- An **admin/super_admin** creating one → straight to `scheduled` (they're the coordinator; no self-approval).
- **Approve** action (admins only, on `requested` rows) → `scheduled`; the **surgeon + OR team** are notified ("Operation scheduled"). Enforced server-side in `updateOperation` (a doctor moving `requested`→`scheduled` gets `ForbiddenError`; audited as `APPROVE`). Notifications use the `general` type + `emitToUser` (same pattern as rx→pharmacy).

**Verify:** monorepo typecheck clean; frontend 45/45; backend 487/487 (incl. contract-routes); migrations 0031+0032 applied to dev DB.

## Lab / X-Ray / Ultrasound — multiple images per study + multi-test/exam orders; blank prescription (2026-06-16)

Two new capabilities (migration `0031_overrated_johnny_storm`):

- **Multiple images per imaging study** (X-Ray + Ultrasound): new `images` jsonb column (`[{url, fileName?, caption?}]`). The report editor's single image field is replaced by a repeatable `ImageListEditor` (cover badge on the first, per-image caption, thumbnail preview). `imageUrl` is kept as the cover for back-compat/list thumbnails. Printed reports now render an **Images (N)** gallery (embedded `<img>`, http/https only, deduped) via a shared `imagesSectionHtml` helper.
- **Multi-add orders** (all three): new nullable `order_group_id` column + `(clinic_id, order_group_id)` index. The create dialog now queues several line-items — X-ray: body parts; Ultrasound: exam type + body part; Lab: test names (CBC + Lipid + HbA1c from one draw) — and one **Save** creates N rows sharing a client-generated `orderGroupId` (only set when >1). Rows that belong to one order show a teal **Layers · N** badge in the list. Single-item create is unchanged. Mechanism: client loops `mutateAsync` with the shared id; no new endpoint. `CreateXray/Ultrasound/LabTestBody` gained `orderGroupId`; `Update{Xray,Ultrasound}Body` + records gained `images`; `MediaImage` schema added; Orval regen'd.
- **Blank prescription** (Prescriptions): a toolbar button prints an **empty** prescription form (ruled Rx lines, blank patient fields, doctor name pre-filled) for the physician to handwrite — creates no record. New `blankPrescriptionHtml`.

New shared frontend bits: [ImageListEditor.tsx](../artifacts/clinic/src/components/ImageListEditor.tsx), [lib/ids.ts](../artifacts/clinic/src/lib/ids.ts) (`newOrderGroupId`, `countByOrderGroup`).

**Verify:** monorepo typecheck clean (4 projects + libs); frontend 45/45 (EN/AR parity incl. new keys); backend 487/487 (incl. contract-routes); migration applied to dev DB.

## Lab / X-Ray / Ultrasound — searchable patient picker + requester locked to signed-in user (2026-06-16)

Applied the same pattern as Medical Records / Prescriptions to all three imaging & lab request dialogs:
- **Searchable patient picker** (name / MRN / ID card) via the shared `SearchSelect`, replacing the plain `<Select>`.
- **"Requested by" locked to the signed-in user** — the doctor `<Select>` + `useListUsers`/`getListUsersQueryKey` query/imports were removed; the field is now a read-only "{name} (you)" chip (any role) and `requestedById` is taken from `user.id` on save.
- Added missing-field validation (toast naming the missing fields) on each create button. Verify: clinic typecheck clean, frontend 45/45.

## Prescriptions — pharmacy chooser simplified to two plain buttons (2026-06-16)

Replaced the "Select Your Pharmacy" two-card panel with two plain footer buttons: **External Pharmacy** (`btn-outline`, printer → prints paper) and **In-Clinic Pharmacy** (`btn-primary`, send → sends digitally). Behavior unchanged; removed the now-unused `Building2` import. Verify: clinic typecheck clean.

## New Medical Record — doctor locked to the signed-in user (2026-06-16)

Mirrors the Prescriptions change: the "Doctor" field in the New Medical Record dialog is no longer a searchable picker — it's **locked to the signed-in user** (read-only "{name} (you)" chip, any role), and `doctorId` is taken from `user.id` on save. Removed the doctor `SearchSelect` + `useListUsers` query/import. Patient picker stays searchable. Verify: clinic typecheck clean, frontend 45/45.

## Prescriptions — searchable pickers, auto-prescriber, and Send-to-Pharmacy (2026-06-16)

- **Searchable patient picker** (name / MRN / ID card) via the shared `SearchSelect`.
- **Auto-prescriber (all roles):** the prescriber is **always locked to the signed-in user** (read-only "{name} (you)" field) — nobody, *including admin/super_admin*, can pick a different signer. The doctor `<Select>`/`useListUsers` query were removed entirely; `doctorId` is taken from `user.id`.
- **"Select Your Pharmacy" two-card chooser** (replaces the plain Save buttons; modeled on the provided mockup): **In-Clinic Pharmacy → "Send Digitally"** (primary, "Most Convenient" badge) and **External Pharmacy → "Print Prescription"** (so the doctor can hand the patient a paper for a pharmacy of their choice). Each prescription row also keeps both a Print and a Send button. New backend `POST /prescriptions/{id}/send-to-pharmacy` (`super_admin`/`admin`/`doctor`) → `sendPrescriptionToPharmacy` notifies **every active pharmacist in the clinic** (in-app notification row + SSE `{prescriptionId}` — IDs only, no PHI) and audits `SEND_TO_PHARMACY`. OpenAPI endpoint added + Orval regen'd (passes the contract-routes guard). No schema change — the notification is the signal.
- **Verify:** monorepo typecheck clean; frontend 45/45 (incl. EN/AR parity, 6 new keys); backend 487/487 (incl. contract-routes); live: create rx → 201, send-to-pharmacy → 200 `{sent:true, pharmacistsNotified:1}`.

## Medical Records — consent + allergy banners, structured/validated vitals, and TWO latent bugs fixed (2026-06-16)

Added the three highest-value improvements to the New Medical Record form, which uncovered two real bugs in the create path (both latent because the form previously never produced a valid vitals payload).

- **Consent banner:** on patient select, fetch `GET /patients/:id/consents`; if no active `treatment` consent (none with `revokedAt == null`), show an amber banner ("can't be saved until consent is recorded") linking to the patient page, and **block Save early** (server enforces it as 422/3010 anyway). Green "consent on file" banner when present.
- **Allergy banner:** on patient select, surface the patient's allergies in a rose banner — critical context while writing a diagnosis/treatment.
- **Structured + validated vitals:** Blood Pressure split into Systolic/Diastolic numeric inputs; added Respiratory Rate; all numeric with units; **abnormal values highlighted red** (clinical ranges) and **hard-bound validation** matching `vitalsSchema` (blocks + names the offending vital); **auto-computed BMI**. Plus required-field validation (patient/doctor/complaint/diagnosis/treatment) with a clear toast.
- **BUG #1 (fixed by the above):** the form sent `vitals.bloodPressure: "120/80"` (a string), but `vitalsSchema` is `.strict()` and expects `bloodPressureSystolic`/`bloodPressureDiastolic` (ints) — so **every medical record with a blood pressure was rejected 400 "Invalid vitals"** (same class as the prescriptions `dose`/`route` F-P5-5 bug). Now sends the correct keys. Verified live: old shape → 400, new shape → 201.
- **BUG #2 (`decryptJson` crash on JSONB round-trip):** once valid vitals reached the insert, **create 500'd** (`value.startsWith is not a function`). In dev (no `FIELD_ENCRYPTION_KEY`) `encryptJson` passes plaintext through, and the `vitals` JSONB column round-trips as an **already-parsed object**, but `decryptJson` assumed a string. Fixed `decryptJson`/`decryptJsonNullable` to return non-string (already-parsed) values as-is; the decrypt+parse path still runs for the encrypted strings prod always produces. This was unreachable before (vitals always 400'd first), so no medical record with vitals had ever saved. Verified live: 201 with vitals round-tripping correctly.
- **Verify:** monorepo typecheck clean; frontend 45/45 (9 new EN/AR keys); backend 487/487 (incl. `field-encryption.test.ts`); live create with structured vitals → 201.

## New Medical Record — searchable Patient/Doctor pickers (2026-06-15)

Swapped the Patient and Doctor `<Select>` dropdowns in the New Medical Record dialog for the shared `SearchSelect` combobox (patient searchable by name / MRN / ID card; doctor by name), matching New Appointment. Removed the now-unused `Select` import. Verify: clinic typecheck clean, frontend 45/45.

## Triage shelved behind a "Coming Soon" placeholder (2026-06-15)

Per product decision, Triage is paused until its workflow is finalized. `Triage.tsx`'s default export now renders a reusable `components/ComingSoon.tsx` (Bayan-styled: amber clock + "Coming Soon" badge + message). The existing kanban implementation is **kept intact** in the same file, renamed `TriageWorkflow` (unrendered) — re-enabling is a one-line switch (export it as default again). New EN/AR keys `comingSoon`, `comingSoonMessage`. The `/triage` route + nav item are unchanged (still navigable; they just land on the placeholder). Verify: clinic typecheck clean, frontend 45/45.

## Schedule page — new "Day" appointment dashboard (2026-06-15)

Added a day-view appointment dashboard to the Schedule page (modeled on a "MedSchedule" reference), built entirely with the Bayan design system (`.card`, `.btn`, `.badge-*`, `--ink`/`--surface`/`--line` + accent vars; logical `ms/me/border-s`; no shadcn `bg-card`/`text-muted-foreground`/Tailwind color tokens). The existing weekly availability-template editor is preserved behind a second tab.

- **Schedule.tsx** now renders a `Day | Weekly Template` segmented toggle (default **Day**). The previous component is unchanged as `WeeklyTemplate`; the new default `Schedule` wraps both. Nothing lost.
- **`components/ScheduleDayView.tsx`** (new): date nav (prev/next/Today) + searchable-free doctor filter + day summary; an hour-grouped timeline of appointment cards (start time, doctor avatar of colored initials + specialty, patient name + MRN + age, reason, status badge, an Emergency tag for `triagePriority='critical'`); and a right sidebar with **Overview** (six stat cards + top-7 Doctor Load bars + emergency banner) and **Upcoming** tabs. Auto-refreshes every 30 s.
- **Domain mapping** (our data ≠ the mockup's): appointments have no duration/type, so cards show **start time + free-text `reason`** (not a fake end-time). Status buckets map our 10-state machine → Confirmed(`scheduled`) / Pending(`checked_in`) / In Progress(`in_triage…pending_payment`) / Completed / Cancelled(`cancelled`+`no_show`); **Emergency** = `triagePriority='critical'`. Status is a **read-only badge** (stage-advancing stays on the Appointments page, since ours is a state machine).
- **Backend (no contract change):** widened the `listAppointments` select to include `patient.dateOfBirth` (→ age) and `doctor.specialty`. Both were already in the `Appointment` OpenAPI type (`$ref Patient`/`User`) but weren't being selected. `seed.ts` doctors now carry specialties (Cardiology / Pediatrics) so cards populate on next seed.
- **Click-to-expand appointment cards:** clicking a card in the Day view expands it inline (chevron flips) into a 3-column detail panel — Patient Info (name, DOB, phone, MRN, insurance), Appointment (reason, time, status, booking source), and Notes. Also widened the `listAppointments` select to carry `patient.phone`/`insuranceProvider` and `bookingSource`/`triagePriority` (the latter was missing, so the "Emergency" bucket + booking-source badge now actually populate). Room/Location and a duration field don't exist in our model, so those mockup fields are intentionally omitted rather than faked.
- **Weekly Template tab — polished to match:** extracted a shared `components/DoctorAvatar.tsx` (colored initials, used by both views); added doctor avatars to the template's doctor list + header; converted the weekly-template `<table>` into cleaner day cards (day + hours, slot/capacity chips, status toggle/badge, edit/delete; inactive days dimmed). All functionality preserved; the week calendar's per-day workload bars were already present.
- **Verify:** monorepo typecheck clean; frontend 45/45 (incl. EN/AR i18n parity for 15 new keys); backend 487/487.

## CRITICAL: every edit/update endpoint was a 404 — spec said PUT, routes are PATCH (2026-06-15)

Root cause of "Route not found" on save (surfaced once the patient-edit `onError` was fixed to show the real message). The OpenAPI spec declared **9 update operations as `put:`** — `updateUser`, `updatePatient`, `updateAppointment`, `updateMedicalRecord`, `updateXrayRecord`, `updateLabTest`, `updateInvoice`, `updateOperation`, `updateInventoryItem` — so the Orval-generated client issued **`PUT`**. But **every** Express route is `router.patch(...)` and there are **zero `router.put` handlers**. So all 9 client calls hit no route → `notFoundHandler` → **404 "Route not found."** Every edit form in the app (patients, users, appointments, medical records, X-ray, lab, invoices, operations, inventory) was silently broken from the UI — never caught because no test asserts spec-method ↔ route-method alignment, and the app is undeployed/only now being click-tested.

- **Fix:** changed all 9 `put:` → `patch:` in `lib/api-spec/openapi.yaml` (the routes are the consistent, correct implementation — PATCH is right for partial, role-scoped updates; there were no PUT handlers to honor). Re-ran Orval — generated client now issues `PATCH` for all 9 (verified: **0** `method: "PUT"` remain). The 2 operations already declared `patch:` (ultrasound, prescriptions) were always correct.
- **Verify:** monorepo typecheck clean; frontend 45/45; live `PATCH /api/patients/5` (the client's new method) → 200, incl. with browser `Origin :5174`.
- **Guard added (so this never ships again):** `contract-routes.test.ts` statically parses `paths:` from openapi.yaml and `router.<method>("<path>")` from every route file, then asserts **every** OpenAPI operation has a matching Express route+method (116 ops checked, all green). Pure file-read unit test (no DB/app build), runs in the standard suite → fails CI on any spec↔route method/path drift. Proven to catch the regression: temporarily flipping `updatePatient` back to `put:` fails the test with `PUT /patients/:p` → "no matching Express route+method". (Reverse direction — routes absent from the spec — is reported informationally only; 9 are intentional internal endpoints: jwks, health, SSE stream, search, etc.)

## Edit-Patient save: error toast now shows the real reason (2026-06-15)

The Edit Patient dialog (`PatientDetail.tsx`) `onError` read `err.response?.data?.error` — a path that never exists on our `custom-fetch` `ApiError` (which carries the canonical envelope on `err.data`, reason in `message`). So every failed save showed a bare "Failed" with no detail, making the cause undiagnosable. Now reads `err.data.message` and shows it as the toast description; also added the standard up-front required-field check (Name/DOB/Phone) before mutating. NOTE: the PATCH itself was verified working server-side from every angle (no-origin, browser `Origin :5174`, edge-case DOB, blood type → all 200); the browser failures were the masked error + the earlier CSRF `:5174` origin bug (fixed separately).

## Blood Type is now a dropdown, not free text (2026-06-15)

Both patient forms — **Register** (`Patients.tsx`) and **Edit** (`PatientDetail.tsx`) — took Blood Type as a free-text `<Input>` (typo-prone: "o+", "A positive", etc.). Replaced with a `<Select>` of the 8 standard ABO/Rh types from a shared `lib/constants.ts` `BLOOD_TYPES`, plus a "Not specified" option (sentinel `"none"` → stored as empty) so the field stays optional and clearable. New EN/AR keys `selectBloodType`, `notSpecified`. Verify: clinic typecheck clean, frontend 45/45 (incl. i18n parity). Existing free-text values still display fine; only the input control changed.

## New Appointment — Patient & Doctor pickers are now searchable comboboxes (2026-06-15)

The New Appointment dialog's Patient and Doctor fields were plain `<Select>` dropdowns; with a long patient list that's slow to use. Replaced both with a type-to-filter combobox.

- New reusable `components/SearchSelect.tsx` (shadcn `Command` + `Popover`, **no new deps** — both primitives already vendored). Case-insensitive substring filter over `label` + an optional `search` field, so a **patient is findable by name OR MRN**; a check-mark marks the current selection. Trigger styled with Bayan vars (`--line`/`--surface`/`--ink`) to match the existing inputs.
- `Appointments.tsx`: both pickers swapped to `SearchSelect`. Patient option label `"{fullName} ({mrn})"` + `search: "{fullName} {mrn}"`; doctor by name. cmdk's `onSelect` lowercases its arg, so the component closes over the real option `value` (id) rather than trusting that string.
- i18n: new EN/AR keys `searchPatient`, `searchDoctor`, `noDoctorsFound` (reuses existing `selectPatient`/`selectDoctor`/`noPatientsFound`).
- Verify: clinic typecheck clean; frontend 45/45 (incl. i18n EN/AR parity).
- **Focus-ring polish:** the combobox search input no longer shows the global teal `:focus-visible` box (it auto-focuses on open inside an already-bordered popover, so the ring looked like a stray green box). Suppressed via an unlayered `[cmdk-input]:focus-visible { outline: none }` rule in `index.css` (higher specificity than the global `input:focus-visible`, so it wins the cascade) — also tidies any cmdk command-palette input.
- **Patient search also matches ID card number** (in addition to name + MRN); the ID card stays a search key only — the list still displays `Name (MRN)` (national ID is sensitive PII; minimize on-screen display + stay consistent with the rest of the app, which keys on MRN).
- **Fixed: "Save does nothing" on New Appointment.** The Save handler built the payload with `new Date(form.scheduledAt).toISOString()`, which **throws `RangeError: Invalid time value` synchronously** when Scheduled At is empty — so `mutate()` never ran, with no request and no toast. Save now validates required fields first (patient/doctor/scheduled-at/reason) and shows a toast naming what's missing (`fillRequiredFields`), guards the date parse, and the `onError` toast surfaces the server envelope `message`. Same silent-failure class as the patient form.
- **Known limit (unchanged from before):** the dialog still loads patients with `limit: 200`, so search filters that client-side window. If clinics exceed ~200 active patients, wire `SearchSelect` to server-side `listPatients({ search })` (debounced) — a future enhancement, not a regression.

## Patient registration now captures a required, per-clinic-unique ID card number (2026-06-15)

Added a national **ID card number** to patient registration — a required field, stored plaintext, **unique per clinic** (blocks duplicate patient records on the same identity). New across every layer; reported as "patient registration failed … there should be the ID card numbers."

- **DB:** `patients.id_card_number text NOT NULL` + `CREATE UNIQUE INDEX patient_clinic_idcard_uq ON patients (clinic_id, id_card_number)` (migration `0029_complex_micromacro.sql`). Plaintext (not field-encrypted) so it can be searched and uniquely constrained — treated as an identifier like `mrn`/`phone`, not clinical PHI.
- **Contract:** `idCardNumber` added to `CreatePatientBody` (in `required[]`), `UpdatePatientBody` (optional), and the `Patient` response (`required[]`). Orval regen'd (`api-zod` + `api-client-react`).
- **Service:** `createPatient` requires + trims `idCardNumber` and does a per-clinic duplicate pre-check → `ConflictError` (clear 409 instead of a raw 23505); the DB unique index is the backstop. `updatePatient` (admin/super_admin branch) accepts + dup-checks it.
- **Frontend:** required ID Card field at the top of the Register-Patient dialog; new ID Card column in the patient table + CSV export. EN/AR i18n key `idCardNumber`. **Save button stays clickable** — on click it validates required fields and, if any are empty, shows a toast naming them (`fillRequiredFields` + field list) rather than going dead. (An earlier revision *disabled* Save until all required fields were filled, which read as "Save does nothing" — a silent disabled button. Reverted to enabled-with-feedback.)
- **Data:** existing 3 test patients were dump/test data (owner-authorized) — `TRUNCATE patients … CASCADE`, migration applied on the empty table, then reseeded (seed now supplies `idCardNumber`). All `*.integration-db.test.ts` patient fixtures + the cross-tenant seed helper updated so the NOT-NULL column doesn't break the constraint-specific `expectDbReject` assertions.
- **Verify:** monorepo typecheck clean (4 projects); DB-verified (NOT NULL text column, unique index present, duplicate `(clinic_id, id_card_number)` rejected with 23505); **484/484 backend** + **45/45 frontend** tests green (incl. `i18n.test.ts` EN/AR parity).
- **Runtime "registration failed" — root-caused & fixed (the same session, via live-API repro):** driving `POST /api/patients` against the running server returned **500 `"(intermediate value) is not iterable"`** even with a valid body. Cause: `generateMRN()` did `const [{ nextval }] = await db.execute(sql...)` — but `db` is `drizzle-orm/node-postgres`, whose `.execute()` returns a pg `QueryResult` (`{ rows, … }`), **not an array** — so the array-destructure threw on *every* `createPatient` call. This is a **pre-existing defect** (unrelated to the ID-card work): masked because the seed hardcodes MRNs (never calls `generateMRN`) and no test exercises `createPatient` against a real DB (unit tests mock `db`; integration-db tests insert patients with literal `mrn`). Fix: read `.rows` (`const { rows } = await db.execute(...); const nextval = rows[0].nextval`). Re-verified live: `POST /patients` with `idCardNumber` → **201** (`mrn: MRN-202606-01002`).
- **Frontend must be rebuilt/restarted:** the running API (`:5000`, tsx-watch) reloaded the new required-field contract, but the Vite dev server (`:5173`) was **not running** — so a stale frontend (old form, no ID field) posts without `idCardNumber` → **400 `idCardNumber: Required`** = "Save does nothing." Start it: `pnpm --filter @workspace/clinic run dev` (or `.\start-dev.ps1`).
- **Regression test added:** `registration.integration-db.test.ts` drives the full HTTP path against real Postgres (route → `validate` → `createPatient` → `generateMRN` → insert) — 201 + MRN-pattern assertion (would have caught the 500), 400 on missing `idCardNumber`, 409 on per-clinic duplicate. This is the first test to exercise `createPatient` against a real DB (the gap that let the bug ship). All 3 green.
- **Latent prod risk — FIXED (migration 0030):** `mrn_seq`/`invoice_seq` were created only by the **dev seed**, never by a migration. The seed truncates all data, so it is not run in prod — a freshly-migrated prod DB had **no `mrn_seq`**, and the first registration (and first invoice) would have failed with `relation "mrn_seq" does not exist`. Fixed by declaring both as `pgSequence` in `lib/db/src/schema/sequences.ts` → `db:generate` emitted `0030_unknown_the_leader.sql` (hand-edited to `CREATE SEQUENCE IF NOT EXISTS` so it's a no-op on already-seeded environments; the snapshot is unchanged so `migration-drift` stays clean — verified `db:generate` → "No schema changes"). The integration test no longer creates `mrn_seq` itself, so it now proves the fresh-migrated-unseeded path works (3/3 green).
- **CSRF dev-origin bug — FIXED (the actual browser failure):** once the toast surfaced the real error it read `AUTH_CSRF_ORIGIN_REJECTED` — the kernel's CSRF origin check (`policy.ts originAllowed`) hardcoded the dev allowlist to `http://localhost:5173`, but the Vite dev server was serving on **:5174** (5173 was taken), so every browser mutation was rejected (1020). The node repro passed only because curl/no-`Origin` requests skip the check. Fixed: in non-production, `originAllowed` now trusts **any** `localhost` / `127.0.0.1` port (matches the documented dev CORS policy `localhost:*`); production still trusts only `ALLOWED_ORIGINS`. Verified live (`POST` with `Origin: http://localhost:5174` → 201) + regression test in `policy.unit.test.ts` (35/35).
- **Diagnostic gap — FIXED:** the registration `onError` toast now surfaces the canonical envelope `message` as the toast description (`error?.data?.message`), so the real reason shows ("A patient with this ID card number already exists", "idCardNumber: Required") instead of a bare "Failed to register patient". This is what made the original failure undiagnosable from the UI.

## List-endpoint response contract restored — 5 clinical lists return bare arrays again (2026-06-15)

Fixed a latent response-shape regression on the five doctor-bound clinical **list** endpoints. Their `list*` service functions (`listMedicalRecords`, `listLabTests`, `listXrays`, `listUltrasounds`, `listPrescriptions`) return `{ data, nextCursor }`, but the OpenAPI contracts declare a **bare `type: array`** (openapi.yaml lines 719/859/921/1006/1091) and every frontend consumer treats them as arrays. The route GET handlers passed the service object straight through (`res.json(await listX(...))`), so each endpoint emitted `{ data, nextCursor }` instead of `[…]` — a silent contract break.

- **User-visible impact:** `Reports.tsx` (`labTests?.filter(...)`) and `MedicalRecords.tsx` (`(records ?? []).filter(...)`) call `.filter` on the object → `TypeError` → page crash; `DoctorDashboard`/`PatientDetail` counts (`labResults?.length`, `medicalRecords?.length`) silently read `undefined`.
- **Fix:** all five route GET handlers now unwrap `res.json(result.data)` (the unused `nextCursor` is intentionally dropped — these lists are not cursor-paged on the client). The working tree already carried 4 of 5 (lab/prescriptions/xray/ultrasound, uncommitted); this session completed the straggler **medical_records.ts**.
- **Not affected:** `/patients`, `/appointments`, `/clinic-notices` correctly keep `{ data, nextCursor }` — their contracts are `Paginated*` and their routes intentionally do not unwrap. (8 services return the object shape; only these 3 map to `Paginated*` contracts.)
- **Verify:** api-server typecheck clean; **484/484 unit/integration tests green** (incl. `route-access.contract.test.ts` exercising GET /medical-records). No test asserted the broken shape, so none required changes.
- **Follow-up (optional):** if client-side cursor pagination is ever wanted on these five, promote the contracts to `Paginated*` + regen Orval + return `result` from the routes and read `.data` on the pages — do not re-broaden the response piecemeal.

## Principal zero-trust re-audit — 8.4/10, no open criticals; jti control found unarmed (2026-06-14)

Independent whole-system re-audit under a zero-trust documentation policy (code is evidence, docs are not): 3 read-only explore passes + first-hand re-verification of ~12 load-bearing files. Corroborates the existing honest scorecard. Full report: [AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md](AUDIT_FINDINGS_2026-06-14_PRINCIPAL.md); handoff + approved remediation plan: `../HANDOFF.md`.

- **20 security/architecture claims VERIFIED first-hand** (auth kernel, dormant RLS + `medicore_app`, break-glass read-only `0024`, AES-256-GCM prod-fail-closed, batched audit outbox, **daily** integrity verification wired in `cron.ts:127-142`, ESLint service/route + raw-`db` boundary, login CSRF-exempt-by-design).
- **F-Z1 (Medium, net-new) — jti replay defense is UNARMED:** `policy.ts:169` checks `isJtiUsed()` but **nothing in prod calls `markJtiUsed()`** (grep: stores+tests only) → protects zero live routes. ADR-007 acknowledges "latent." Decide arm-vs-remove (→ ADR-014).
- **Doc-truth (low):** "All tables use serial PKs" is false (mixed serial+uuidV7, F-Z2); stale test counts (F-Z3); empty `minimumReleaseAgeExclude` vs "except @replit" (F-Z4); **REPLIT_DOMAINS removal is already code-complete** — `policy.ts:70-79` reads only `ALLOWED_ORIGINS` (F-Z5, corrects ROADMAP line 10); `tenant-context.ts:86` "sql.raw" comment vs the safer parameterized `set_config` (F-Z6).
- **Re-affirmed risk register:** never deployed (H-1), Postgres SPOF/RPO≈24h (H-2), alert/probe *delivery* deploy-gated (H-3), real-DB test breadth for business-logic services (H-4).
- **Honesty note:** two of the audit's own sub-agent findings were false positives caught by reading source (`.npmrc` "missing minimumReleaseAge" → it's in `pnpm-workspace.yaml:28`; "REPLIT still in policy.ts" → already gone). No source/code/migration changes were made — audit + docs only.

## Restore drill runtime-verified on real PG16 + F-P6-8 probe bug fixed (2026-06-07)

Ran the actual `backup-verify.mjs --restore` drill end-to-end against local PostgreSQL 16 (fresh fully-migrated source DB → scratch target), **exit 0**. Verified: pg_dump→gzip→psql replay (with the F-P6-4 `transaction_timeout` strip working across a pg_dump v18.4 → server PG16 skew), patient sanity, erasure-blackout check, audit-integrity check, and **F-P6-8** (`medicore_app usability verified: non-superuser, RLS-binding, reads tenant tables`).

- **Bug found by running it:** `checkAppRoleUsability` probed the role via SQL `||` concatenation, which renders booleans as `false` → it produced `medicore_app,false,false` and the assertion `== "medicore_app,f,f"` failed even though the role was correctly NOSUPERUSER/NOBYPASSRLS. Fixed to `format('%s,%s,%s', current_user, rolsuper, rolbypassrls)` (boolean output function → `f`). Re-ran → drill green. F-P6-8 is now runtime-verified, not just `node --check`'d.
- Also confirmed **Replit code/config refs are gone**: a repo-wide grep for `REPLIT_DOMAINS` / `@replit/` imports hits only docs + harmless `// @replit` shadcn provenance comments — no `.ts`, `pnpm-workspace.yaml`, or `package.json` usage (the AUDIT_REPORT §5 checklist + "still read in policy.ts" notes are stale history). CLAUDE.md CORS/env doc lines still mention `REPLIT_DOMAINS` (doc-only drift).
- Note: the dev `clinic_db` is on a divergent migration state and won't `db:migrate` to head (relation conflict) — environment data issue, not a code defect; fresh DBs migrate cleanly (the drill + 62 integration tests prove it).
- **Monitoring configs validated with the real tools** (pinned versions): `promtool check rules prometheus-alerts.yml` → SUCCESS (18 rules, incl. the new `ServiceDown`/`EdgeProbeDown`); `amtool check-config monitoring/alertmanager/alertmanager.yml` → SUCCESS (global config + route + 1 inhibit rule + 2 receivers — confirms the F-P6-5 `smtp_auth_password_file` rewrite is structurally valid). Still deploy-gated: live SMTP *delivery*, blackbox edge probe, `k6 run` (need the running stack).

## audit_logs append-only is now self-healing across partitions — migration 0028 (2026-06-07)

Upgraded the audit append-only guard from a RUNBOOK note to an automatic DB control (op follow-up to F-P4-3). Migration 0026 revoked UPDATE/DELETE on audit_logs + existing partitions from `medicore_app`, but 0020's `ALTER DEFAULT PRIVILEGES` silently re-grants them on any *new* partition — so a future monthly partition would quietly become tamperable.

- **Migration 0028** — `audit_partition_append_only()` + `audit_partition_append_only_trg` event trigger on `ddl_command_end`: any newly-created partition whose parent is `audit_logs` is immediately `REVOKE`d UPDATE/DELETE from `medicore_app`, regardless of how it was created (migration, helper, manual psql). Strict no-op for all other CREATE TABLE; no-op if `medicore_app` is absent (dev). `SECURITY DEFINER` so the revoke always has privilege. Plus an idempotent backstop re-revoke on all current partitions.
- **`audit-append-only.integration-db.test.ts`** — proves it on real PG16: creates a 2037 partition and asserts `medicore_app` has no UPDATE/DELETE (but keeps SELECT/INSERT), and that every existing partition is append-only. **Full integration-db suite 8 files / 62 tests green** (was 7/60).
- RUNBOOK §11.4 `AuditPartitionLow` playbook updated: the re-revoke is now automatic; operators just verify with `has_table_privilege`.

This turns the "re-run the REVOKE when new partitions are created" manual step into a non-regressable, self-healing control.

## Phase 7 hardening — regression tests + analytics route gate (2026-06-07)

Closed the optional Phase 7 follow-ups (all in-repo, no live env needed):
- **`/analytics` route-layer gate (F-P7-2 follow-up)** — `routes/analytics.ts` now `requireRole` at the route (list `super_admin/admin`; per-doctor `super_admin/admin/doctor`) in addition to the existing service-layer enforcement (`analytics.service.ts:323`,`:290-294`). Defense-in-depth; api-server typecheck clean.
- **F-P7-4 logout CSRF test** — `auth-logout-csrf.test.tsx`: asserts `logout()` POSTs `/api/auth/logout` with `X-CSRF-Token` from the `_csrf` cookie (guards the 2026-05-13 regression).
- **F-P7-3 DischargeSheet escaping test** — `discharge-sheet-xss.test.tsx`: feeds `<script>`-laden PHI, asserts no live `<script>` node + escaped serialized HTML (the print path copies `el.innerHTML`).

Frontend suite **45/45 green** (was 43). Both tests run in the existing `frontend-test` CI job.

## Audit campaign close-out — AUDIT_REPORT.md reconciled (2026-06-07)

Reconciled the 2026-06-06 consolidated `AUDIT_REPORT.md` with the Phase 5–8 results (plan §6 step 6 / §7 DoD). Added a status banner + new **§7 Reconciliation**: per-phase outcomes, reconciled dimension scores with deltas, carried accepted risks (F-P2-4 fph, F-P3-3 orders), and an updated remediation roadmap. **Headline honesty correction:** the report's Operational Resilience / Deployment Safety scores had over-credited an alerting stack that was actually **inert** (Alertmanager couldn't deliver email; restore drill unproven for the app role) — now genuinely earned after F-P6-5/6/8, so the scores hold but were provisional until the Phase 6 fixes. Recorded the process lesson (Phases 6/7 rubber-stamped; Phase 8's re-checked sign-off held). With this, **all 8 audit phases are independently verified**; remaining work is runtime-verifies at deploy + the F-P8-1 `CLAUDE.md:437` one-liner + optional F-P7-3/4 tests.

## Real k6 load test — booking + dashboard (F-P6-9 / §8.5) (2026-06-07)

Rewrote `scripts/load-test.js` from a smoke test (it only GET'd `/healthz/ready` + `/metrics`, default port 3000 = Grafana) into a real clinical load test. `setup()` logs in with seed creds, captures the `clinic_token` + `_csrf` cookies, and discovers a patient/doctor id; each VU exercises the **dashboard** (`/dashboard/summary`, `/dashboard/recent-activity`), clinical **reads** (`/patients`, `/appointments`, `/appointments/today`, `/schedule/doctors`), and the **booking** write (`POST /appointments` with `X-CSRF-Token`) under a 0→20→0 VU ramp. Thresholds: reads `p(95)<500ms`, booking `p(95)<1500ms`, `http_req_failed<1%`, `booking_hard_errors<1%` (5xx/401/403). Booking counts 201/409/422 as acceptable outcomes so the run measures latency/stability, not seed-specific success. `node --check` clean; runtime-verify with `k6 run scripts/load-test.js` against a live stack (k6 not installed in this session). Closes the last open audit engineering item (F-P6-9 / §8.5).

## Audit Phase 8 — re-verified the "complete" sign-off (2026-06-07)

Re-checked Phase 8's "all passed, no defects" against the actual config (Phases 6/7 were rubber-stamped). **Phase 8's claims hold up** — first accurate sign-off of the three: pool math (`pgbouncer.ini`: pool_size=20, reserve=5, max_client_conn=200, Postgres max_connections=100 default), SSE caps (`notifications.ts:29-31` → 503+Retry-After), non-PHI caching including the real `doctor_scope:<id>` Redis cache (`scope.ts:29-47`, 60s TTL, invalidated on appointment mutations), N+1 batching (`computeKPIsForDoctorIds`), bundle splitting. Two minor opens:

- **F-P8-1 (LOW, doc drift)** — `.claude/CLAUDE.md:437` Doctor Scope Rule says `getDoctorPatientScope` is "no cache — fresh on each call"; it's actually `doctor_patients`-table-backed and Redis-cached 60s. Could mislead an access-revocation assumption (≤60s staleness). The corrected text is in `AUDIT_FINDINGS_2026-06-07_PHASE8.md` — **needs a manual CLAUDE.md edit** (the agent was permission-blocked from editing the config file).
- **§8.5 load test (= F-P6-9)** — not delivered; `scripts/load-test.js` is a smoke test (health + metrics only). Bundle-splitting half is fine.

No code changed (verification + doc only).

## Audit Phase 7 — re-verified the "complete" sign-off (2026-06-07)

Applied the same scrutiny that exposed Phase 6's hollow "complete" to Phase 7. **Security is sound — no live vuln found** — but the sign-off's evidence was inaccurate. Findings in `docs/AUDIT_FINDINGS_2026-06-07_PHASE7.md`.

- **F-P7-2 (MEDIUM) — RBAC parity "PASS" cited a non-existent test.** The doc credited `route-access.contract.test.ts`; that file doesn't exist, and the real `route-access.test.ts` only checks client-side consistency, never client↔server parity. Spot-checked the 4 sensitive routes manually (users/audit/analytics/settings) → no authz gap (backend is the real gate; `/analytics` is gated in the service layer — `analytics.service.ts:323`/`:290-294` — not the route). The actual parity contract test still needs writing (the non-regressable fix). INFO: add a route-layer `authGate` on `/analytics` for defense-in-depth.
- **F-P7-3 (LOW) — "zero innerHTML" was false.** `DischargeSheet.tsx:98` writes `${el.innerHTML}`. Safe (React-rendered subtree, auto-escaped, no `dangerouslySetInnerHTML`), but the cited `escapeHtml/safeUrl` evidence was wrong — real safety = React escaping.
- **F-P7-4 (LOW) — CSRF inventory wrong.** Four manual `fetch()` calls, not two; logout (`auth.tsx:72`) is a POST (the doc said all manual calls are GET-only). No defect — logout correctly double-submits `X-CSRF-Token` — but it's the path that regressed 2026-05-13, so it's now listed + a test recommended.
- F-P7-1 (Billing `createdById`) verified genuinely fixed: removed from `Billing.tsx`, server sets `createdById = req.user!.userId` (`billing.service.ts:114`).

Phase 7 demoted ✅→🟡 pending the contract test (since written — see next entry).

## Phase 7 follow-up — wrote the real RBAC contract test (F-P7-2) (2026-06-07)

Created `artifacts/clinic/src/test/route-access.contract.test.ts` — the file the first pass falsely cited as already verifying parity. It encodes a hand-verified backend-gate snapshot (per-route `routes/*.ts:line` sources) and asserts across all 24 nav routes: (1) every client route has a declared backend contract (no orphan), (2) client `navItems.roles` ⊆ backend roles (no client-more-permissive), (3) all-roles-visible routes are backed by an `ANY_AUTH` endpoint. Parity holds — **43/43 frontend tests pass** (was 40). Runs in the existing `frontend-test` CI job, so widening a client nav role set without a matching backend gate now fails CI. Limitation documented: the backend column is a maintained snapshot (Express role sets aren't introspectable without a registry). Phase 7 → 🟢. INFO follow-up: add a route-layer `authGate` on `/analytics` (currently service-layer-gated only) for defense-in-depth.

## Audit close-out — carried-over LOW/DOC/ops items (2026-06-07)

Cleared the "close regardless of phase order" backlog from `AUDIT_PLAN_PHASE_5-8.md` §1.

- **F-P3-2 status corrected** — `AUDIT_FINDINGS_2026-06-03_PHASE3.md` showed it OPEN, but `hasActiveConsent(patientId, consentType, clinicId, tx?)` already takes `clinicId` and filters on it (`consent.service.ts:24,34`). Verified fixed; status line + resolution note updated.
- **F-P3-3 decision recorded** — diagnostic orders (lab/xray/ultrasound) stay **ungated** on treatment consent (orders ≠ treatment; gating would block triage/work-up). Rationale documented in `SECURITY.md` → "Patient Consent — Enforcement Scope"; finding marked DECIDED/accepted.
- **Audit-partition append-only re-revoke (operational)** — there is no partition-creation cron (`cron.ts` only counts headroom for the gauge); new partitions arrive via follow-up migrations. Added an `AuditPartitionLow` row to RUNBOOK §11.4 stating the new-partition migration MUST re-run the 0026 `REVOKE UPDATE, DELETE … FROM medicore_app` (migration 0020's default privileges silently re-grant them) or audit append-only-ness regresses.
- **Alert playbooks** — added `ServiceDown` + `EdgeProbeDown` rows to RUNBOOK §11.4 so the new Phase 6 alerts are actionable, not just pages with no runbook.

## Audit Phase 6 — observability second pass: alert delivery was inert (2026-06-07)

Re-audited the deployment/observability stack against the "documented-active but inert" class (cf. F-01, F-P4-1). The first Phase 6 pass (F-P6-1..4) fixed script portability + added an SSE alert but did not audit the alert *delivery* path or process *liveness*. Five new findings; CRITICAL + HIGH + MEDIUM fixed. Evidence in `docs/AUDIT_FINDINGS_2026-06-07_PHASE6.md`.

- **F-P6-5 (CRITICAL) — Alertmanager delivered ZERO alert emails.** `alertmanager.yml` used `${SMTP_*}`/`${ALERT_EMAIL_TO}` and compose passed them as `environment:` vars, but Alertmanager does **not** env-expand its config file (prometheus/alertmanager#2818) and there was no `envsubst` entrypoint — so `smtp_smarthost` was the literal `"${SMTP_SMARTHOST}"` and every alert (incl. `AuditLogPermanentLoss`, `AuditIntegrityMismatch`, `BackupStale`) fired in the UI but reached no human. CLAUDE.md even enshrined the false belief. **Fix (Mike's call: hardcode + `_file`):** non-secret SMTP fields hardcoded in `alertmanager.yml`; password via `smtp_auth_password_file: /run/secrets/smtp_auth_password`; new `smtp_auth_password` Docker secret; dropped the inert `environment:` block; corrected CLAUDE.md.
- **F-P6-6 (HIGH) — no process-down alert.** Added `ServiceDown` (`up{job=~"medicore-api|medicore-worker"}==0`, critical). A full crash serves zero requests, so `HighErrorRate` (a ratio) could never fire — a dead process paged no one.
- **F-P6-7 (MEDIUM) — SSL/edge probe inert.** `prometheus.yml` used `${BLACKBOX_TARGET}` (Prometheus also doesn't env-expand, #2357) → cert-expiry monitoring dead. Hardcoded the edge URL; added `EdgeProbeDown` (`probe_success==0`) so RUNBOOK §7's "stop Caddy → alert in 5 min" criterion is achievable.
- **F-P6-8 (MEDIUM-HIGH) FIXED — restore drill proves bytes, not usability.** `pg_dump --no-acl` strips `medicore_app` grants and the role is absent in a fresh cluster, but the drill/restore validated only as `postgres` superuser → after a real DR restore api/worker get permission-denied. **Fix:** `backup-verify.mjs --restore` now runs `checkAppRoleUsability()` — recreates the role + re-applies 0020 grants / 0026 audit_logs REVOKE on the restored DB, connects **as `medicore_app`**, and asserts non-superuser + RLS-binding + can read `patients` (drill fails otherwise). RUNBOOK §2.2 step 6 documents the same for a real DR restore; §12.2 documents the drill check.
- **F-P6-9 (LOW, defer to 8.5) — `load-test.js` is a smoke test** (only `/healthz/ready` + `/metrics`, wrong default port).
- **Non-regressable guard:** new blocking CI job `monitoring-config` runs `promtool check rules prometheus-alerts.yml`; corrected the stale "exporters NOT yet deployed" comment (they're in compose since 2026-06-03). Go-live checklist now includes an `amtool` synthetic-alert **delivery** check (rule reload ≠ delivery).

Validation: all four edited YAML/compose files parse clean. promtool + live SMTP/blackbox are runtime-verified at deploy (no Docker/SMTP in session). No app code touched — 484/484 unit, 60/60 integration-db unaffected.

## Audit Phase 5 complete — 5.2–5.5 (2026-06-07)

Finished the Phase 5 backend audit (5.1 + the 0027 hardening landed earlier). 5.2–5.5 are PASS with minor cleanups; full evidence in `.claude/AUDIT_FINDINGS_2026-06-06_PHASE5.md`.

- **Sweep correction** — the 5.1 `dbUnsafe` grep was single-line and missed wrapped calls (`await db\n.select`). Re-ran multiline; surfaced raw reads in `schedule.service` (×4) and `audit.service` (×3), **all already clinic-scoped** (`eq(clinicId)`). No new defects. (Migration 0027 now makes every clinic-bearing *insert* compiler-guaranteed to set `clinicId`, so only reads need manual review going forward.)
- **5.2 deep-read services** — dashboard/schedule/analytics/reports/search/notifications/audit all clinic-scoped; PHI reads call `logRead`, aggregate dashboards intentionally don't, cache wraps only non-PHI aggregates. Removed an unused `dbUnsafe as db` dead import from `dashboard.service.ts`; added the missing justification comment to `schedule.service.ts`; corrected a misleading header comment in `audit.service.ts`.
- **5.3 transactions/races** — booking double-book is closed by the partial unique index `appt_no_double_book_idx` (concurrent insert → 23505 → ConflictError); invoice counter uses atomic `UPDATE…RETURNING`/`onConflictDoUpdate`; pay/cancel use status-guarded `UPDATE…RETURNING`; erasure is single-transaction. No findings.
- **5.4 error envelope** — `globalErrorHandler` never leaks stack traces in prod (generic message; dev-only detail); canonical 7-field envelope; 23505→CONFLICT/23503→VALIDATION. No findings.
- **5.5 authz depth** — kernel scope is method-derived (GET→read, mutations→write), so a scope inversion is structurally impossible. No findings.

Validation: typecheck + lint clean, **484/484** unit, **60/60** integration-db.

## Eradicate the `clinic_id DEFAULT 1` footgun — migration 0027 (2026-06-07)

Follow-up to F-P5-1: removed the `clinic_id integer NOT NULL DEFAULT 1` default from all **20** clinic-bearing tables so a forgotten `clinicId` on an insert now fails loudly (`NOT NULL`, SQLSTATE 23502) instead of silently mislabeling the row as clinic 1.

- **Schema** — dropped `.default(1)` from the 20 clinic-bearing schema files (`lib/db/src/schema/*`); `clinicId` is now a required field in Drizzle's insert type.
- **Compiler-driven blast radius** — removing the default turned every insert that relied on it into a compile error. `tsc` surfaced exactly **9** sites, all bootstrap/system (zero PHI service paths — those already set `clinicId`):
  - `auth.service.ts` ×3 — direct `audit_logs` writes for login/logout/password-change. Set `SYSTEM_CLINIC_ID` for pre-tenant session events (with `TODO(multi-clinic)`), real `user.clinicId` for CHANGE_PASSWORD. (These were wrapped in empty `catch {}`, so without the typecheck they'd have started silently dropping login/logout audit events — a HIPAA gap.)
  - `scripts/seed.ts` ×6 — bootstrap inserts; now capture `clinic.id` from `.returning()` and thread `clinicId` through users/patients/appointments/inventory/notifications.
- **Migration 0027** (`0027_mean_maddog.sql`) — `ALTER TABLE … ALTER COLUMN clinic_id DROP DEFAULT` on all 20 tables (idempotent; metadata-only). Tables that never had the default (`doctor_schedules`, `schedule_overrides`) and `clinic_invoice_counters` (clinic_id is PK) are untouched. `clinic_id > 0` CHECK (0014) + NOT NULL remain.
- **Regression coverage** — `clinic-id-check.integration-db.test.ts`: NOT-NULL rejection when `clinic_id` is omitted on `patients`/`notifications`, plus a symmetry test asserting no clinic-bearing table carries a `clinic_id` default (proves 0027 reached the DB).

Validation: typecheck + lint clean, **484/484** unit, **60/60** integration-db (was 57; +3).

## Audit Phase 5.1 — backend tenant-scope / `dbUnsafe` sweep (2026-06-06)

Executed the Phase 5.1 exhaustive `dbUnsafe`/`clinicId` sweep (the item flagged twice as not-yet-done). Audited every raw `db.<select|insert|update|delete>` call site across 32 services; full verdict table + evidence in `.claude/AUDIT_FINDINGS_2026-06-06_PHASE5.md`. Five findings, all fixed and validated on real Postgres 16.

- **F-P5-5 (HIGH) — prescription creation was broken end-to-end.** The backend medication guard `medicationItemSchema` (`jsonb-schemas.ts`) was `.strict()` with `dose`/`route`, but the frontend, OpenAPI `CreatePrescriptionBody`, and every reader (`print.ts`, `DischargeSheet`, `DoctorConsult`) use `dosage`/`instructions`. Since WS3's `validate()` doesn't transform the body, every real create hit the service schema and 422'd. Aligned the schema to the contract (`name, dosage, frequency, duration?, instructions?`). The old `jsonb-schemas.test.ts` had locked in the wrong `dose`/`route` shape — rewritten + added a legacy-shape regression guard.
- **F-P5-1 (MEDIUM) — raw inserts defaulted child rows to clinic 1.** `invoice_items` (billing) and `notifications` (lab/xray/ultrasound) were inserted via `dbUnsafe` without `clinicId`; the `clinic_id … DEFAULT 1` column silently tagged them clinic 1. Correct by accident for the seed clinic, but non-clinic-1 invoices returned zero line items and those users never saw lab/xray/ultrasound notifications. Set `clinicId` explicitly at all four sites. New `tests/clinic-id-default-leak.integration-db.test.ts` (real PG, drives a non-default clinic).
- **F-P5-4 (MEDIUM) — `createPrescription` patient check missing `clinicId`.** Allowed referencing a foreign-clinic patient (only incidentally blocked by the consent gate, with a misleading 422). Added the clinic filter → foreign patient now 404s. New cross-tenant write test case (the suite previously covered invoice/appointment but not prescriptions).
- **F-P5-2 (LOW) — billing cancel/pay `UPDATE` omitted `clinicId`.** Not exploitable (preceded by a clinic-scoped SELECT + global PK) but a defense-in-depth gap; added `eq(clinicId)` to both.
- **F-P5-3 (INFO) — dead `dbUnsafe as db` import** in `reports`/`search` (pure tenant-context services) with a misleading comment; removed.

Validation: typecheck + lint clean, **484/484** unit, **57/57** integration-db (7 files; +3 new tests over the prior 54). F-P5-1/4/5 each verified fails-before / passes-after.

## WS3 — Zod request validation at the route boundary (2026-06-06)

Wired the Orval-generated Zod schemas from `@workspace/api-zod` into a `validate()` middleware on every mutation route, giving HTTP-boundary input validation backed by the OpenAPI contract.

- **`middlewares/validate.ts`** — `validate(schema, source="body")` runs a schema's `safeParse` against `req.body`/`query`/`params`. Two deliberate choices: (1) **validate only, never transform** — it does NOT replace `req[source]` with the parsed value, so the generated schemas' unknown-key stripping and coercions (`coerce.date`) never alter what the service receives (services keep their own `Number(...)`/JSONB/encryption handling, and routes that pass extra fields like xray/ultrasound `findingsAr` keep working); (2) **emits the canonical 400 `DOMAIN_VALIDATION` envelope directly** via `buildEnvelope`, because middleware runs before the asyncHandler that maps domain errors (a `next(err)` here would 500). Zod-version-agnostic (structural `safeParse`). Unit test in `validate.test.ts` (incl. a no-mutation assertion).
- **Wired 12 route files** (create/update mutations): patients, appointments, medical_records, prescriptions, lab, xray, ultrasound, inventory, operations, users, schedule, **billing**. No hand-written schemas — imported `Create*Body`/`Update*Body` etc. from `@workspace/api-zod`. The frontend error shape is unaffected (it shows a generic toast; never reads `.error`/`.details`).
- **Pruned redundant service presence-checks** in `createMedicalRecord`, `createPrescription`, `createAppointment`, `createInvoice` (the pure `if (!field) throw ValidationError("Missing...")` guards `validate()` now covers). **Kept all business rules** (date-parseable check, `doctor.role` check, `hasActiveConsent`, `itemsSchema`/JSONB guards, cancel-reason ≥30) and clinicId belt-and-braces.
- **Billing spec fix + wiring:** `CreateInvoiceBody`/`UpdateInvoiceBody` had modeled **server-set/computed fields as required client input** — `createdById` (set from `req.user.userId`) and `items[].total` (computed `quantity*unitPrice`). Corrected `openapi.yaml`: added an `InvoiceItemInput` request schema (`{description, quantity, unitPrice}`, no `total`), dropped `createdById` from `CreateInvoiceBody` (`required: [patientId, items]`), pointed both invoice request bodies at `InvoiceItemInput`. Regenerated (`api-zod` + `api-client-react`). The frontend was already decoupled (it sends `createdById`/`total` via `as any` casts and `validate()` strips unknown keys without mutating the body, so the server still ignores them). Then wired `validate()` on POST create, PATCH update, and POST pay (`PayInvoiceBody`; the frontend always sends `amountReceived`). Cross-tenant invoice test now reaches its intended 404. _(Pre-existing UX oddity, not changed: the Billing page has a "created by" picker whose value the server ignores.)_
- **Test harness:** the parallel-fork local-PG integration runner needed a cluster-wide advisory lock around `CREATE DATABASE` + migration-0020 role/default-privilege setup (parallel forks on a shared cluster raced with `tuple concurrently updated`). Serialized just the global-catalog setup; tests still run in parallel.
- Verification: **482 unit** (incl. validate.test.ts), **54 integration-db** (exit 0), typecheck + lint clean.

## Integration-db suite: now passes end-to-end (first time ever) + no-Docker path (2026-06-05)

The real-Postgres integration suite — the cross-tenant/PHI-isolation safety net — had **never actually executed** (no Docker locally, and latent bugs + config issues would have failed it under Docker too). It now runs green end-to-end: **6 files / 54 tests, exit 0**, validating the audit fixes (booking F-P1-1, break-glass F-P2-1, erasure F-P3-1, `clinic_invoice_counters` F-P1-3, cross-tenant + doctor-scope isolation).

- **No-Docker runs.** `tests/_helpers/realDb.ts` gained opt-in `INTEGRATION_PG_ADMIN_URL`: when set to a local Postgres superuser URL, `startRealDb()` creates a uniquely-named scratch DB, applies all migrations, provisions `medicore_app` (re-applying the 0026 append-only revoke), and DROPs it on teardown — instead of a Testcontainer. Default (Testcontainers) unchanged → CI unaffected.
- **Stabilization (these are why it never passed):**
  - `cross-tenant.integration-db.test.ts` statically imported `@workspace/db` → threw at collection (DATABASE_URL unset). Made the imports dynamic in `beforeAll`.
  - Assertions matched `error.message`, but drizzle wraps Postgres errors as `"Failed query: …"` with the real text on `.cause`. Added `tests/_helpers/expectDbError.ts` (matches message + cause) and applied it across the WITH-CHECK / CHECK assertions.
  - The `clinic-id-check` symmetry test looked for `{t}_clinic_id_positive`, but 0021 renamed `audit_logs`'s CHECK to `audit_logs_clinic_id_check` — now accepts either name and also covers the newer tables (`doctor_schedules`, `schedule_overrides`, `clinic_invoice_counters`). The `audit_outbox` insert was missing the NOT NULL `ip_address` (tripped that before the clinic_id CHECK) — provided it.
  - Cross-tenant WRITE tests POSTed without CSRF (would 403) — added `_csrf` cookie + `X-CSRF-Token`.
  - `rls-tenant-context` called `startRealDb()` twice (a STEP-0 probe + main); since `@workspace/db`'s pool is a process-singleton, the probe's teardown poisoned the main tests. Folded the probe's non-superuser guard into the single main harness (the probe was explicitly marked "remove once Phase 1 lands" — it has).
  - **`vitest.config.integration.ts`: process-per-file isolation.** `@workspace/db` creates its pg Pool eagerly from `process.env.DATABASE_URL` at module load, so a shared fork (`singleFork`) pinned the singleton pool to the first file's DB → later files hit "database does not exist" / "Cannot use a pool after end". Switched to one process per file (`maxWorkers: 2`).
- Unit suite **479/479**, typecheck + lint clean.

## Audit fix — activate audit-integrity verification (F-P4-1/2/3) (2026-06-05)

Phase 4 (data integrity & audit chain) found the audit outbox, snapshot redaction, and partitioning all solid, but the tamper-evidence hash-chain was **recorded daily and never verified in production** — `verifyIntegrity` ran only in tests, so the `AuditIntegrityMismatch` alert could never fire.

- **F-P4-1 — verification now scheduled.** The daily 02:00 integrity cron calls `recordDailyIntegrity` and then **`verifyRecentIntegrity()`** (re-derives + compares the last `AUDIT_VERIFY_WINDOW_DAYS` days, default 7). Tampering of recent `audit_logs` rows is now caught within a day.
- **F-P4-2 — chain linkage validated.** New `verifyChainLinkage()` walks the stored daily records asserting each `prevHash` == the prior calendar day's `rootHash` (gaps skipped). Catches a historical `rootHash` rewrite that `verifyIntegrity` alone (which re-derives from the *stored* prevHash) would miss. Also wired into the daily cron. Both increment `audit_integrity_check_failures_total` on failure → `AuditIntegrityMismatch` alert.
- **F-P4-3 — `audit_logs` is now append-only for the app role.** Migration `0026_audit_logs_append_only.sql` revokes UPDATE+DELETE on `audit_logs` (parent + partitions) from `medicore_app`; it keeps SELECT+INSERT (all the code needs). Documented that new partitions re-acquire the grant via 0020's default privileges and must be re-revoked.
- New env: `AUDIT_VERIFY_WINDOW_DAYS` (default 7). Tests: `audit-integrity.test.ts` +4 (chain intact/broken/gap, recent-skip). Verification: **479/479** unit, typecheck + lint clean. **Integration-db (incl. migration 0026) not executed (no Docker).** Working tree, uncommitted.

## Audit fix — complete right-to-erasure (F-P3-1) (2026-06-04)

Phase 3 (HIPAA control verification) found all §164.312(a)–(e) safeguards PASS, with one substantive gap: `executeErasure` claimed to "anonymize all PHI" but only scrubbed patients + medical_records — prescriptions were soft-deleted with the encrypted `medications` ciphertext retained, and lab/xray/ultrasound PHI (plaintext) was untouched. The audit log overstated coverage.

- **`executeErasure` now scrubs every clinical table** in the erasure transaction: `prescriptions.medications` overwritten to `[ERASED]`; `lab_tests` results/notes nulled; `xray_records` + `ultrasound_records` report/imageUrl/imageFileName/notes nulled; all three soft-deleted; `appointments` reason→`[ERASED]` + notes/cancellationReason nulled; medical_records Arabic free-text also nulled.
- **Accurate audit evidence:** `erasedEntities` + new `erasedCounts` are derived from the rows actually scrubbed (`.returning()` counts), not a hard-coded list.
- **Tests:** mocked `erasure.service.test.ts` updated for the new `.returning()` chains + table mocks; new `erasure.integration-db.test.ts` seeds one PHI row per clinical table and asserts none survives execution.
- Verification: api-server unit suite **475/475**, monorepo typecheck clean. **Integration-db not executed (no Docker)** — run `test:integration-db` to prove the scrub before merge. Working tree, uncommitted.

## Audit fixes — Phase 2 auth hardening (F-P2-2/3/5) (2026-06-04)

Closes the remaining Phase 2 (auth/session) findings. All three are low-risk code fixes with no default-behavior change.

- **F-P2-2 — strict password policy now applies uniformly.** Only `password-reset` used `validatePasswordStrictAsync`; change-password (`auth.service.ts:232`), create-user (`users.service.ts:107`) and admin-reset (`:251`) used the sync validator, so even with `PHASE2_STRICT_PASSWORD_POLICY=true` they'd skip the HIBP breach check. All three now call `validatePasswordStrictAsync`. **No default change** — when the flag is off the async validator returns the identical sync result; flipping the flag stays an ops decision.
- **F-P2-3 — timing-safe legacy password compare.** `verifyLegacyPassword` (the HMAC migration path) now uses `crypto.timingSafeEqual` (length-guarded) instead of `===`. Behavior-identical result; existing legacy-path tests still pass.
- **F-P2-5 — method-based scope for the auth shims.** `requireAuth`/`requireRole` now pick the kernel scope by HTTP method: `read` for GET/HEAD (ADR-010 bounded fail-open on a revocation-store blip), `write` for mutations (CSRF + fail-closed). Central one-line change instead of a 23-file route sweep; safe because CSRF is method-gated, so a GET under `write` never enforced CSRF anyway.
- Not addressed (by design): F-P2-4 (`fph` weak binding — INFO/accepted) and the `REPLIT_DOMAINS` origin in `policy.ts` (Replit-removal §6 cleanup, tracked separately).
- Verification: api-server unit suite **475/475**, monorepo typecheck + lint clean. Working tree, uncommitted.

## Audit fixes — Phase 1 RLS consistency + no-show audit (F-P1-2/3/4) (2026-06-04)

Closes the remaining Phase 1 findings (the non-headline ones) from the 2026-06-03 audit. All via one new migration + a cron audit hook.

- **F-P1-2 — `doctor_schedules`/`schedule_overrides` RLS realigned to the dormant standard.** Migration 0022 had shipped a strict, non-dormant `tenant_isolation` policy (no `app.rls_enforce` gate, no `nullif` guard, no `WITH CHECK`) — the root of the F-P1-1 zero-rows break and a crash risk on an empty GUC. **Migration `0025_rls_policy_consistency.sql`** drops and recreates both policies with the exact 0015 dormant shape. RLS stays `FORCE`d; only the expression changes.
- **F-P1-3 — `clinic_invoice_counters` now has the RLS backstop.** Migration 0025 adds `ENABLE`/`FORCE ROW LEVEL SECURITY` + the dormant `tenant_isolation` policy + `CHECK (clinic_id > 0)` — it was the only clinic-bearing table without it. **Dormant by design:** `billing.service.generateInvoiceNumber` uses bare `db`, so a strict policy would have broken invoice numbering; dormant keeps that path working while enforcing inside `runInTenantContext`. Integration test added to `rls-tenant-context.integration-db.test.ts`.
- **F-P1-4 — no-show cron now leaves an audit trail.** The hourly `scheduled → no_show` bulk transition (`cron.ts`) wrote no audit (§164.312(b) gap). It now emits one summary `SYSTEM_NO_SHOW` entry per run via the existing system-actor `logAudit` fallback (`SYSTEM_USER_ID`/`SYSTEM_CLINIC_ID`), with affected `{ id, clinicId }` pairs in `details`. The cross-tenant write itself is unchanged (intended, tenant-uniform).
- Verification: api-server unit suite **475/475**, monorepo typecheck + lint clean. **Integration-db not executed (no Docker)** — run `test:integration-db` to verify 0025's dormant policies + the counter isolation before merge. Working tree, uncommitted.

## Audit fixes — booking RLS break (F-P1-1) + break-glass clinical-PHI access (F-P2-1) (2026-06-04)

Closes the two launch-blocker findings from the 2026-06-03 production audit (Phases 1–2). Both were half-wired controls in the uncommitted working tree.

- **F-P1-1 (CRITICAL) — booking no longer broken by FORCE-RLS.** Migration 0022 put `FORCE ROW LEVEL SECURITY` + a non-dormant policy on `doctor_schedules`/`schedule_overrides`, but `lib/schedule-validator.ts` read them via `dbUnsafe` (no tenant context) → RLS hid every row → every appointment create/reschedule failed `409 "No schedule for this day"`. Fixed by running the validator's reads inside `runInTenantContext`: `checkDoctorAvailability(actor, doctorId, scheduledDate, existingTx?)` opens a tenant context (or reuses the caller's `tx` in `updateAppointment` to avoid a nested transaction). Callers updated in `appointments.service.ts`. Regression test added to `cross-tenant.integration-db.test.ts` (`[BOOKING]`: same-clinic booking succeeds; no-schedule day still 409).
- **F-P2-1 (MEDIUM–HIGH) — break-glass now delivers clinical PHI.** Break-glass granted app-layer access but migration 0017's `RESTRICTIVE doctor_scope` RLS still hid the 5 doctor-bound clinical tables, so emergency access surfaced demographics only. Fixed with a **patient-scoped, read-only** bypass: migration **0024** extends the 0017 `USING` clause with `OR patient_id = ANY(app.break_glass_patient_ids)` (CSV GUC; `WITH CHECK` unchanged so break-glass cannot write); `runInTenantContext(user, fn, { breakGlassPatientIds })` sets the GUC; `break-glass.service.getActiveBreakGlassPatientIds()` + `scope.ts` (`getDoctorListScope`, break-glass-aware `assertMedicalRecordInScope`) drive it; all 5 doctor-scoped services (medical-records, lab, xray, ultrasound, prescriptions) wire list + getById to pass the GUC and audit `BREAK_GLASS_ACCESS`. Tests: `scope.test.ts` +1, `doctor-scope-rls.integration-db.test.ts` +4 (bypass works, read-only, no over-grant).
- Verification: api-server unit suite **475/475** green, monorepo typecheck + lint clean. **Integration-db tests not executed in the fix session (no Docker)** — run `pnpm --filter @workspace/api-server run test:integration-db` before merge to runtime-verify the 0024 RLS bypass and the booking regression. Changes are in the working tree, uncommitted. Detail in [AUDIT_FINDINGS_2026-06-03_PHASE1.md](AUDIT_FINDINGS_2026-06-03_PHASE1.md) / [PHASE2](AUDIT_FINDINGS_2026-06-03_PHASE2.md).

## Compliance UIs + change-history (Consent, Break-Glass, Erasure, before→after) (2026-06-02)

Closes the three "fully-built backend, zero frontend" HIPAA/compliance gaps (Consent, Break-Glass, Right-to-Erasure) and adds a "who did what, when, previous→new data" change-history surface. All three backends already had routes + services + tables but were absent from `openapi.yaml` (no generated hooks) and unreferenced in `clinic/src`. Integrated into existing pages (no new routes).

- **Change-history (Stream D).** `audit_logs.beforeState`/`afterState` (already columns + `logAudit` params) are now **exposed**: added them to the `AuditLog` OpenAPI schema (also fixed `entityId` `integer`→`string` to match the `text` column) and surfaced the pre-existing `GET /audit-logs/entity/{entityType}/{entityId}` route in the spec (operationId `getAuditLogsByEntity`). `auditRowSelect` now selects before/after. New frontend: `lib/auditDiff.ts` (pure field-diff), `components/ChangeHistory.tsx` (`BeforeAfterDiff` + timeline + card) — the AuditLog detail modal renders a before→after diff, and `PatientDetail` shows a change-history card (gated to super_admin/compliance_officer, matching the route guard).
- **Capture backfill (5 PHI entities).** `patients` (update+delete), `medical_records` (update — also fixed a pre-existing raw-ciphertext before/after dump), `prescriptions` (void), `appointments` (update), `invoices` (notes update) now pass before/after via the new **`auditSnapshot()`** helper. **PHI policy:** `auditSnapshot` redacts the five field-encrypted columns (`diagnosis`, `vitals`, `medications`, `allergies`, `emergencyContact`) to `"[redacted]"` and drops noise columns — change-history shows real values for non-encrypted fields and changed-field *names* for encrypted ones, without creating a second cleartext-PHI store. Helper lives in db-free `lib/audit-snapshot.ts` (re-exported from `lib/audit.ts`) so it's unit-testable without `DATABASE_URL`.
- **Consent (Stream A).** Spec: `GET`/`POST /patients/{id}/consents`, `DELETE .../{consentId}` (`Consent`, `GrantConsentBody`). UI: `components/PatientConsentCard.tsx` on `PatientDetail` — list (view-roles), grant form (nurse/front_desk/admin/super_admin), revoke (admin/compliance/super_admin); front_desk (grant-only, not in GET roles) gets the form without the list. The `ConsentRequiredError` (3010) path in `Prescriptions`/`MedicalRecords` create now shows a targeted "treatment consent required" toast — closes the prior dead-end.
- **Break-Glass (Stream B).** Spec: `activate`/`approve`/`revoke` + `GET /break-glass/sessions` (`BreakGlassSession`, `ActivateBreakGlassBody`). UI: `components/BreakGlassButton.tsx` (emergency-access modal on `PatientDetail`, reasonCategory enum + justification ≥30, doctor/nurse/admin/super_admin) and `components/BreakGlassQueue.tsx` (approval/revoke queue).
- **Erasure (Stream C).** Spec: `GET`/`POST /erasure-requests`, `review`, `execute` (`ErasureRequest`, `CreateErasureBody`, `ReviewErasureBody`). UI: `components/ErasurePanel.tsx` — create + pending list with approve/reject (super_admin/compliance), and **execute (super_admin only) behind a typed patient-ID confirmation** (irreversible).
- **Placement note.** `ComplianceDashboard` is shown only to `compliance_officer`; super_admin/admin fall through to the default admin dashboard. So `BreakGlassQueue`+`ErasurePanel` render on **both** ComplianceDashboard and (gated by `isAdminRole`) the admin Dashboard, so admin can approve break-glass and super_admin can execute erasure. All action buttons gate by exact role internally.
- Verification: monorepo typecheck clean, `pnpm run build` clean, api-server **469/469** (+6 `audit-snapshot.test.ts`), clinic **40/40** (+7 `auditDiff.test.ts`), api-server lint clean.

## Security — auth-kernel inert-control hardening (F-03, F-06) (2026-06-02)

Follow-up to the `/security-review` run. Closes two "documented-active but inert" findings; F-02 (jti replay) intentionally left latent per ADR-007 (naive wiring would break multi-action admin sessions).

- **F-03 — revocation read fail-open → bounded fail-open.** `lib/policy.ts` step 5b previously degraded (fail-open) for the *entire* duration of a revocation-store (Redis) outage on `read` scope, leaving a revoked session able to read PHI for up to the token TTL (≤ 4 h). Now reads degrade **only** within `REVOCATION_READ_GRACE_MS` (default 30 s) of the last healthy store contact; a sustained outage past that window fails **closed** (`AUTH_REVOKED`, 1003). `write`/`privileged` still fail closed unconditionally. Caps worst-case revoked-read exposure from ≤ 4 h to ≈ 30 s while staying resilient to transient blips. Operator lever: raise `REVOCATION_READ_GRACE_MS` during a declared incident if availability must win; `0` forces immediate fail-closed. Decision recorded in **ADR-010**; refines ADR-007 §2. Regression tests added to `policy.unit.test.ts` (transient-within-grace → degrade; sustained/grace-exceeded → fail-closed 1003).
- **F-06 — `requireStepUp` mounted on the privileged routes.** The Phase 2 step-up re-auth middleware (`middlewares/step-up.ts`) was defined but mounted on zero routes. Now wired onto all four `privileged`-scope routes — `PATCH /users/:userId` (`update_user`), `DELETE /users/:userId` (`delete_user`), `POST /users/:userId/reset-password` (`reset_password`), and `POST /auth/admin-reset/:userId` (`admin_reset`) — establishing a clean "privileged scope ⇒ step-up" invariant. No behavior change today (no-op while `PHASE2_STEP_UP_ENABLED` is off); active password re-prompt on these destructive actions the moment Phase 2 is enabled.
- Verification: `pnpm --filter @workspace/api-server run test` → **462/462 green** (1 net-new revocation test); api-server typecheck clean. (Pre-existing unrelated clinic typecheck break in WIP `ComplianceDashboard.tsx` → missing `@/components/ErasurePanel` is out of scope for this change.)

## Security — F-01 print/report DOM-XSS fixed (2026-06-02)

Closes F-01 (HIGH, P0) from the 2026-06-02 audit and the independent re-confirmation in the `/security-review` run. Stored DOM-based XSS on a PHI path: staff-entered free-text was interpolated into a same-origin print window via `document.write()` with no HTML escaping, so a payload stored in a patient/clinical field (e.g. `fullName = Jon<img src=x onerror=…>`) executed under the app origin when staff clicked Print — enabling forged authenticated `/api/*` calls (the `_csrf` cookie is non-HttpOnly) and PHI exfiltration.

- **`artifacts/clinic/src/lib/print.ts`** — added exported `escapeHtml()` (encodes `< > & " '`) and `safeUrl()` (http/https scheme allowlist; drops `javascript:`/`data:` etc.). Applied `escapeHtml()` to every dynamic interpolation across all five builders (`prescriptionHtml`, `labReportHtml`, `xrayReportHtml`, `ultrasoundReportHtml`, `invoiceHtml`) — patient name/MRN/gender/blood type, allergies, medication name/dosage/frequency/duration/instructions, lab params/test name/notes, X-ray & ultrasound findings/impression/bodyPart/examType, invoice line-item description/number — and to the `openPrintWindow` `<title>`. `imageUrl` now passes through `safeUrl()` for both `href` and link text. Numeric/date helpers (`fmtCur`, `fmtDate`) left as-is (non-injectable).
- **`artifacts/clinic/src/components/DischargeSheet.tsx`** — the print `<title>` no longer interpolates `data.patient.fullName` into the written HTML string (which let `</title><img …>` break out). Title is now static in the markup and the patient name is applied after `document.close()` via `win.document.title = …` (DOM API treats it as text, not markup). The body path was already safe (React-rendered `el.innerHTML`).
- **Regression test** `artifacts/clinic/src/test/print-xss.test.ts` (8 cases) — feeds `<img onerror>` into every builder field and asserts no live `<img`/`<script>` tag survives, plus `javascript:`/`data:` `imageUrl` schemes are dropped while legitimate `https:` URLs are preserved. Fails loudly if any field's escaping is ever removed.
- **CI guard** `ci.yml` (lint job) — new "Block new document.write sinks in clinic src" grep step bans `document.write(` anywhere under `artifacts/clinic/src/` except the two reviewed-and-escaped sinks (`lib/print.ts`, `components/DischargeSheet.tsx`). Any new sink must be consciously allowlisted, forcing review — closes the broader regression surface beyond the print path. Regex requires the call paren so comments mentioning the API don't false-positive.
- Verification: frontend `pnpm --filter @workspace/clinic run test` → **33/33 green**; `typecheck` clean; new CI guard verified locally (passes on clean tree, flags a planted violation).

## Phase 3 — Scaling & Ops Hardening (2026-06-02)

Closes F-05 (MED) from the 2026-06-01 principal audit (connection ceiling) and the open ops items from the risk register (unpartitioned audit_logs, unscheduled restore drill). All three sub-streams shipped in one PR.

### 3a — PgBouncer connection pooler

- **`pgbouncer` service** added to `docker-compose.prod.yml` (transaction pooling, `default_pool_size=20` → Postgres, `max_client_conn=200` ← app). Pinned by digest via `PGBOUNCER_IMAGE` env var. `pg_isready` healthcheck. Pool size tunable via `PGBOUNCER_DEFAULT_POOL_SIZE` / `PGBOUNCER_MAX_CLIENT_CONN` env vars.
- **`pgbouncer/pgbouncer.ini`** — config template documenting pool math and correctness notes.
- **api + worker** — `DATABASE_URL` host changed from `postgres:5432` to `pgbouncer:6432`. Both services add `pgbouncer: condition: service_healthy` to `depends_on`.
- **`server_reset_query = DISCARD ALL`** — session state never bleeds across transaction-mode borrowers. SET LOCAL GUCs in `runInTenantContext` are transaction-scoped and already rollback-safe.
- **`statement_timeout` moved to role level** — removed from `lib/db/src/index.ts` pool config (session-level SET leaks under PgBouncer transaction pooling). Migration 0021 adds `ALTER ROLE medicore_app SET statement_timeout = '30000ms'` and `idle_in_transaction_session_timeout = '60000ms'` — per-backend defaults that survive `DISCARD ALL / RESET ALL` correctly.
- **RUNBOOK §11.6** — PgBouncer pool math, prepared-statement warning, second-replica procedure.

### 3b — audit_logs monthly partitioning

- **Migration `0021_audit_logs_partition.sql`** (hand-authored DDL, journaled at idx 21):
  - Creates `audit_logs_part` as `PARTITION BY RANGE (created_at)` with composite PK `(id, created_at)`.
  - Pre-creates 132 monthly partitions (2026-01 → 2036-12) + DEFAULT catch-all in a single DO block — no runtime DDL needed by `medicore_app`.
  - Re-applies RLS `tenant_isolation` policy + FORCE ROW LEVEL SECURITY from migration 0015 (doesn't auto-inherit on rename).
  - Re-applies `CHECK (clinic_id > 0)` from migration 0014.
  - Re-grants `medicore_app` DML (grants don't follow a rename to a different relation).
  - Copies all existing rows from `audit_logs`, advances sequence, renames tables + sequences atomically.
  - Verifies row counts match before dropping the legacy table (fails the migration on mismatch).
  - Sets `statement_timeout = '30000ms'` and `idle_in_transaction_session_timeout = '60000ms'` on `medicore_app` role.
- **`audit_partition_months_remaining` Prometheus gauge** — added to `metrics.ts`; emitted by the monthly data-retention cron (folded into the existing `0 3 1 * *` schedule in `cron.ts`). Queries `pg_class` for future partition names; no-ops gracefully on pre-migration schemas.
- **`AuditPartitionLow` Prometheus alert** — fires warning when headroom drops below 24 months; prompts an operator to land a follow-up migration before rows overflow into DEFAULT.
- **ADR-009-audit-partitioning.md** — documents partition-now decision, monthly vs yearly trade-offs, composite PK rationale, F-01 non-superuser boundary preservation, hash-chain correctness, and verification checklist.

### 3c — Restore drill enhancements

- **`backup-verify.mjs --restore`** — `checkAuditIntegrity()` function added; called after `checkErasureBlackouts()`. Queries `audit_integrity_checks` for any `status='mismatch'` rows in the restored DB; fails the drill if found.
- **RUNBOOK §12** — Full quarterly restore drill procedure: provision ephemeral DB, run `backup-verify.mjs --restore`, record measured RTO, spot-check patient/audit row counts, optional deep `verifyIntegrity()` call, teardown, ops log entry. §12.5 notes that partitioned `audit_logs` round-trips correctly through `pg_dump`/`psql`. §12.6 documents accepted RTO (4h) and RPO (24h) with upgrade paths.
- **RUNBOOK §2.3** — Updated cadence table to reflect automated nightly backup (the backup service loop) and enhanced quarterly drill (now includes audit integrity check).

**Test impact:** Typecheck clean. Lint clean. Backend 461/461 unaffected (no test-harness changes — 3a/3b/3c are infrastructure/ops). Migration-drift CI passes (0021 journaled at idx 21).

---

## Phase 2 Remediation — Frontend Test Harness (2026-06-02)

Closes **F-03 (MEDIUM)** from the 2026-06-01 principal audit: frontend had zero tests across 117 TSX files.

### What landed

- **Test tooling** — added to `@workspace/clinic`: `vitest ^3.2.2`, `@testing-library/react ^16.3.0`, `@testing-library/dom ^10.4.0`, `@testing-library/jest-dom ^6.6.3`, `@testing-library/user-event ^14.5.2`, `jsdom ^26.1.0`. Vitest `test` block added directly to `vite.config.ts` (inherits `@` alias + React plugin — no duplicate config). `test` + `test:watch` scripts added to `package.json`.
- **`src/test/setup.ts`** — imports `@testing-library/jest-dom` matchers; clears `localStorage` before each test to prevent state bleed.
- **`src/test/route-access.test.ts`** (19 tests) — pure logic coverage of `canAccessRoute`, `getLandingRoute`, `navItems`, `navPinnedByRole`. Asserts: super_admin bypass invariant for every nav route; full 10-role × N-route access matrix matching `navItems.roles`; dashboard aliasing (`/` ≡ `/dashboard`); sub-route prefix matching (`/patients/123` inherits `/patients`); each role's landing route is the correct path AND is accessible to that role; every pinned key is a real `navItems.key` AND is accessible to the pinning role.
- **`src/test/i18n.test.ts`** (2 tests) — key parity guard: fails immediately if any key exists in EN but not AR or vice versa. Bilingual is a hard product requirement; silent AR fallback to EN would previously ship with no error.
- **`src/test/Guard.test.tsx`** (4 tests) — render smoke for the `Guard` pattern. Tests: denied role sees `data-testid="page-access-denied"`; denied in Arabic locale sees Arabic heading text; allowed role sees children; `super_admin` sees children on any route (bypass invariant).
- **tsconfig.json** — removed `**/*.test.ts` from `exclude` so test files are included in typecheck; added `vitest/globals` and `@testing-library/jest-dom` to `types`.
- **CI** — new blocking `frontend-test` job (job 9) added to `.github/workflows/ci.yml`; wired into `ci-gate`.
- **`hooks/i18n.tsx`** — `translations` const exported so the parity test can import it directly.

**Test result: 25/25 green. Typecheck clean. Backend 461/461 unaffected.**

---

## Security — Phase 1 Remediation: Real DB-Enforced Tenancy (2026-06-02)

Closes **F-01 (HIGH)** from the 2026-06-01 principal audit: RLS was inert in production
because api/worker connected as the Postgres bootstrap superuser (which unconditionally
bypasses RLS). Migration 0015's `tenant_isolation` policies were valid SQL but effectively
dead. Cross-tenant isolation rested only on hand-written `eq(clinicId)` filters.

### What landed

- **Migration 0020** (`0020_create_app_role.sql`) — creates `medicore_app` role as
  `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` and grants it DML on all current and
  future tables via `GRANT ... ON ALL TABLES` + `ALTER DEFAULT PRIVILEGES`.
- **Docker secret `app_db_password`** — new secret in `./secrets/app_db_password`. Generate:
  `openssl rand -base64 48 | tr -d '\n' > ./secrets/app_db_password`.
- **migrate container** — sets `medicore_app` password from the secret after db:migrate;
  runs a smoke gate verifying the role is non-superuser and can SELECT on `patients`. A
  failing smoke gate prevents api/worker from starting (clean fail instead of crash-loop).
- **api + worker** — `DATABASE_URL` now uses `medicore_app:$(app_db_password)` instead of
  the bootstrap superuser. `postgres_password` removed from api/worker secrets lists.
- **`dbUnsafe` export** — added to `@workspace/db` as a named alias of `db`. Services with
  legitimately non-tenant DB access (pre-auth paths, tables without `clinicId`) import
  `dbUnsafe` with a one-line justification comment instead of the banned `db` export.
- **`break-glass.service.ts`** — the one confirmed unwrapped clinic-bearing service is now
  fully wrapped in `runInTenantContext()`. All clinic DB ops run inside a single
  transaction per function. Belt-and-braces `eq(clinicId)` filters kept in place.
- **ESLint guard (F-07)** — `eslint.config.mjs` extended with a `src/services/**` rule
  that blocks the named `db` import from `@workspace/db`. New service authors get a lint
  error with a message directing them to `runInTenantContext` or `dbUnsafe` + justification.
  The ignores list no longer exempts `src/services/**`.
- **Integration-db test harness** — `_helpers/realDb.ts` now creates `medicore_app` after
  applying migrations and switches `DATABASE_URL` to the app role URI before `@workspace/db`
  is dynamically imported. The STEP-0 PROBE assertion `rolsuper || rolbypassrls === false`
  is now a real green test, not a documented but permanently-failing probe.
- **ADR-008-app-db-role.md** — documents the owner-runs-migrations / app-runs-as-medicore_app
  split, the rollback caveat for migration 0020, and the follow-up needed for `schedule.service.ts`.
- **RUNBOOK §0** — DB role architecture, password rotation procedure, and verification command.
- **`realDb.ts` comment corrected** (F-04) — stale "only tracks 0000-0009" claim removed;
  journal now tracks 0000-0020.

### What is still needed (F-02 ground-truth run)

Run `pnpm --filter @workspace/api-server run test:integration-db` and confirm the STEP-0
PROBE now reports `rolsuper=false, rolbypassrls=false`. The probe assertion was written to
document the gap — it should be a green test after this landing.

## Documentation (2026-05-31)

- Added ADR-007 documenting jti replay-defense scope: single-use jti enforcement is scoped to `privileged` requests only, fails closed on store unavailability (error 1003), and is latent-but-ready pending a consuming one-shot token flow.

## Phase 6 — Strategic Features (2026-05-31)

Implements the two remaining Phase 6 strategic feature gaps. All 461/461 tests passing, monorepo typecheck clean.

### Work Stream 1: Multi-Language Clinical Content

- **Schema (migration 0019)** — Added `locale` + `timezone` to `clinics`; Arabic text columns to `medical_records` (`chiefComplaintAr`, `diagnosisAr`, `treatmentAr`), `prescriptions` (`notesAr`), `lab_tests` (`testNameAr`, `resultsAr`, `notesAr`), `xray_records` (`bodyPartAr`, `reportAr`, `notesAr`), `ultrasound_records` (`bodyPartAr`, `reportAr`, `notesAr`), `services_catalog` (`nameAr`, `descriptionAr`). All columns nullable — neither language is required.
- **Backend services** — All five clinical services (`medical-records`, `prescriptions`, `lab`, `xray`, `ultrasound`) accept and return Arabic fields on create/update/list.
- **Frontend forms** — `MedicalRecords.tsx`, `Lab.tsx`, `XRay.tsx`, `Ultrasound.tsx`, `Prescriptions.tsx` all include an expandable "Arabic / العربية" section (ع toggle button). Neither EN nor AR is required; the section is collapsed by default.
- **Print templates** (`lib/print.ts`) — All four report types (`prescriptionHtml`, `labReportHtml`, `xrayReportHtml`, `ultrasoundReportHtml`) render Arabic text blocks (`dir=rtl`, `text-align:right`) when populated, alongside their English counterparts.
- **i18n** — 34 new keys added (EN + AR) covering Arabic field labels + analytics.

### Work Stream 2: Doctor Performance Analytics

- **Backend** (`analytics.service.ts`, `routes/analytics.ts`, registered in `routes/index.ts`) — Already fully built with: per-doctor KPIs (patient volume, no-show rate, avg consult time, revenue, lab/X-ray order rate, cancellation rate), clinic-wide peer benchmarking (clinic average returned alongside each doctor's values), and 6-month monthly trend data.
- **Frontend** — New `DoctorAnalytics.tsx` page with:
  - **Doctor view**: 6 KPI metric cards with directional delta chips vs. clinic average; 6-month `LineChart` trend (completed appointments + no-shows).
  - **Admin/super_admin view**: 4 clinic-aggregate KPI cards + ranked leaderboard with progress bars.
  - Date range picker (defaults to last 30 days).
- **Routing** — `/analytics` route added to `App.tsx` (lazy-loaded); nav item added to `route-access.ts` (roles: `super_admin`, `admin`, `doctor`); pinned to doctor quick-nav.

## Phase 4 — Operational Hardening (2026-05-31)

Closes the four operational gaps that left the platform blind in production. All 461/461 tests passing post-landing, monorepo typecheck clean.

### Monitoring stack ([docker-compose.prod.yml](Clinic-Hub/docker-compose.prod.yml), [monitoring/](Clinic-Hub/monitoring/))
- New containers: `prometheus` (v2.53.0, 30d/5GB TSDB), `alertmanager` (v0.27.0, email receiver), `grafana` (11.1.0).
- `prometheus.yml` scrapes `api:5000` + `worker:5001` `/metrics` with Bearer auth via the existing `metrics_token` secret. Loads alert rules from the existing `prometheus-alerts.yml`.
- `alertmanager.yml` emits email via SMTP — env-interpolated (`SMTP_SMARTHOST`, `SMTP_FROM`, `SMTP_AUTH_USER`, `SMTP_AUTH_PASS`, `ALERT_EMAIL_TO`). Separate `critical` route with `repeat_interval: 1h`; `inhibit_rules` suppress matching warnings while a critical fires.
- Grafana **SSH-tunnel-only** (decision 2026-05-31). Binds `127.0.0.1:3000` on the host — no Caddy route, no `frontend` network attachment. Access via `ssh -L 3000:localhost:3000 deploy@host`. Provisioned datasource + dashboard provider; pre-built `MediCore Overview` dashboard with 13 panels (RPS, error %, p95, DB pool utilization + waiting, audit outbox depth, audit integrity failures, audit write losses, SSE active, cache hit rate, RSS, event-loop lag p99, last-backup age).
- New secret: `grafana_password` (file-mounted via `GF_SECURITY_ADMIN_PASSWORD__FILE`).
- Resource footprint: prometheus 512m + alertmanager 256m + grafana 512m ≈ +1.3 GB RAM.

### Automated DB backups ([docker-compose.prod.yml](Clinic-Hub/docker-compose.prod.yml))
- New `backup` service: shares the api image (build target `build`), runs `scripts/backup-verify.mjs` at 02:00 UTC daily inside an idempotent in-container loop (last-run-day guard prevents double execution if the loop wakes inside the same minute). Retention 30 days.
- Offsite: **rsync over SSH** to `BACKUP_RSYNC_TARGET` (chosen 2026-05-31 over Backblaze B2 — owner-controlled external server). SSH key file-mounted as the new `backup_ssh_key` secret; `StrictHostKeyChecking=accept-new` pins on first run.
- GPG public key for `BACKUP_GPG_RECIPIENT` mounted read-only from `${GNUPG_HOME:-/root/.gnupg}`. The private key remains on the restore host only.
- After each successful run, `monitoring/backup-metrics.sh` writes `backup_last_success_timestamp_seconds` to a shared `backup_metrics` volume for the future node_exporter textfile collector.
- New alerts in `prometheus-alerts.yml`: `BackupStale` (>26 h since success, critical) and `BackupMissingTextfile` (>6 h absent series, warning).

### Rollback procedure ([docker-compose.prod.yml](Clinic-Hub/docker-compose.prod.yml), [.github/workflows/ci.yml](Clinic-Hub/.github/workflows/ci.yml), [RUNBOOK.md](Clinic-Hub/RUNBOOK.md))
- `api` and `worker` services now resolve `image: ${API_IMAGE:-medicore-api:latest}` / `${WORKER_IMAGE:-${API_IMAGE:-medicore-api:latest}}`, keeping `build:` as a fallback. Deploys flip the tag in `.env` and `docker compose up -d --no-build`.
- CI gained an `Emit deploy tag` step on main that writes `API_IMAGE=registry/medicore-api:<short-sha>` to the GitHub Actions step summary — copy-paste into `.env` to deploy. PRs skip this step.
- RUNBOOK §10 (Deployment & Rollback) documents the env-snapshot workflow, migration-direction check (Drizzle has no down migrations — rolling back a destructive migration is roll-forward-hotfix or restore-from-backup), and explicitly notes blue-green is deferred to D2.
- RUNBOOK §11 (Monitoring & Alerting) documents Grafana SSH-tunnel access, Prometheus `wget`-via-`docker exec` for ad-hoc queries, `amtool` silence recipes, a per-alert playbook table, and the emergency manual-backup recipe to clear `BackupStale`.

### Redis health check ([artifacts/api-server/src/services/health.service.ts](Clinic-Hub/artifacts/api-server/src/services/health.service.ts))
- `checkReadiness()` now performs a Redis SET+GET roundtrip via `runtime.scopeCache` and reports `checks.redis = { status, latencyMs, store }`. Failure flips `ok` to `false` so Docker's healthcheck on the api container fires a restart.
- Memory-mode dev (no Redis): `scopeCache` is undefined → reports `{ status: "ok", store: "memory" }` without an I/O call.

### Deferred
- **node_exporter** (host-level filesystem + backup textfile collector). Required for `BackupStale` and `DiskSpaceCritical` to actually fire. Trigger to land: when the first node-level outage happens.
- **PagerDuty/Slack channels**. Email confirmed sufficient for the current ops rotation (2026-05-31).
- **Caddy-fronted Grafana**. Decision was explicit — admin-only tool, internet-exposed app surface kept minimal.

### Verification
- Monorepo typecheck clean.
- 461/461 tests passing.
- All new YAML/JSON files parse cleanly.
- `docker compose -f docker-compose.prod.yml config` not run on this Windows host — must run on the prod host before cutover.

### Required-before-boot
- `.env`: `API_IMAGE`, `SMTP_SMARTHOST`, `SMTP_FROM`, `SMTP_AUTH_USER`, `SMTP_AUTH_PASS`, `ALERT_EMAIL_TO`, `BACKUP_GPG_RECIPIENT`, `BACKUP_RSYNC_TARGET`. Compose will reject on missing `:?` vars.
- Secrets: `./secrets/grafana_password` (mode 0600), `./secrets/backup_ssh_key` + `.pub` added to offsite host's `authorized_keys`.
- GPG public key for `BACKUP_GPG_RECIPIENT` imported on the host.

---

## Phase 3 — Scalability Improvements (2026-05-31)

Removes scalability bottlenecks identified for moderate growth without over-engineering for hypothetical load. Pgbouncer and full SSE Redis Streams migration intentionally deferred (revisit if a patient portal lands).

### DB Pool Tuning ([lib/db/src/index.ts](Clinic-Hub/lib/db/src/index.ts))
- `DB_POOL_MAX` default raised 10 → 40 (env-overridable).
- `DB_POOL_MIN=2` warm connections to eliminate cold-start latency.
- `allowExitOnIdle: true` so graceful shutdown isn't blocked by idle clients.
- `statement_timeout=30000` (env: `DB_STATEMENT_TIMEOUT`) — runaway queries can no longer hold pool slots indefinitely.
- Synced defaults across `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, `.env.prod.example`.
- Note: with 40-per-process API + worker, Postgres `max_connections=100` leaves no headroom for a second API replica — that's the trigger to raise `max_connections` or introduce PgBouncer.

### Read-Path Cache ([lib/runtime/cache-service.ts](Clinic-Hub/artifacts/api-server/src/lib/runtime/cache-service.ts))
- New `CacheService` on `Runtime` with two implementations: Redis (`SETEX` + `SCAN`/`UNLINK`) and in-memory (lazy TTL eviction). Redis path is best-effort — cache failures never block the request.
- Wrapped non-PHI dashboard aggregations only: `getDashboardSummary` (30 s), `getDepartmentLoad` (30 s), `getRecentActivity` (15 s). TTLs hardcoded with a `TODO: move to env vars if patient portal is added` comment.
- **Intentionally NOT cached**: `getPatientSummary` and `billing.getDailySummary`. Both call `logRead` — caching would skip audit on cache hits (HIPAA gap). `getPatientSummary` would also place decrypted PHI in Redis.
- **No proactive invalidation**: 15–30 s TTL gives an acceptable staleness window; mutation-site `invalidatePattern()` calls were skipped to avoid touching every write path. Add them only if freshness becomes a real complaint.
- New Prom metrics: `cache_hit_total{key_prefix}`, `cache_miss_total{key_prefix}`.

### SSE Safety Net ([lib/sse.ts](Clinic-Hub/artifacts/api-server/src/lib/sse.ts))
- Per-process cap `SSE_MAX_CONNECTIONS=500` — over-cap connections rejected with `503 + Retry-After: 30`. Capacity check moved BEFORE `flushHeaders()` so the 503 actually delivers.
- Per-user cap `SSE_MAX_PER_USER=10` — at the limit the oldest connection for that user is evicted (handles tab-leaks without exiling the latest tab).
- New Prom gauge: `sse_active_connections`.
- `addSSEClient()` signature changed from `void` to `boolean` (false = at cap). Existing tests ignore the return value — no test breakage.

### Deferred
- **PgBouncer**: not needed at 1 replica + 20 internal users. Trigger to land it: when scaling API to ≥2 replicas (combined connection count would exceed Postgres `max_connections`).
- **SSE → Redis Streams**: current Redis Pub/Sub fan-out is already correct for multi-replica; the gap was observability + memory protection, which the caps + gauge close. Revisit only if a patient portal pushes connection counts to thousands.

### Verification
- Monorepo typecheck clean across all workspaces.
- 461/461 tests passing.

---

## Phase 2.3 — Architecture Corrections (2026-05-31)

Closes four major architectural gaps identified in the system audit to ensure correct isolation, database performance, outbox efficiency, and process decoupling:

### Gaps Closed

1. **Postgres RLS Full Rollout**: Completed service-by-service migration to Postgres Row-Level Security via `runInTenantContext()`, enforcing database-level multi-tenant boundaries across all clinical and operational backend systems. All read and write queries now run inside a transaction with `app.rls_enforce='on'`.
2. **Composite DB Performance Indexes**: Added compound index definitions on high-traffic clinical columns (`patients`, `appointments`, `medical_records`, `prescriptions`, `billing`, `lab_tests`, `xray`, `ultrasound`) in migration `0018_performance_indexes.sql` to eliminate full-table scans. Programmatically reconciled migrations journal drift.
3. **Batch Audit Outbox Drain**: Refactored `drainAuditOutbox()` in `lib/audit.ts` to perform a single batch `insert` into `auditLogsTable` and a single batch `delete` from `auditOutboxTable` using `inArray`, reducing DB round-trips from 200 per cycle to exactly 2.
4. **Decoupled Background Worker Extraction**: Extracted background cron schedules and audit outbox draining from the Express HTTP process into a dedicated `worker.ts` process. Configured esbuild entrypoints for both `index.mjs` and `worker.mjs`. Updated dev/production `docker-compose` topologies with identical hardened security profiles (`read_only: true`, `cap_drop: [ALL]`, `no-new-privileges: true`). Removed `stopCronJobs()` and `stopAuditDrain()` from API `index.ts` to prevent ReferenceErrors at runtime.

### Verification
- Monorepo typechecks and builds clean.
- All 461/461 tests passing successfully.

---

## Phase 2.2 — PHI read paths converted to runInTenantContext (2026-05-31)

Service-by-service rollout of the Phase 2.1 RLS helper. Converts the **read methods** (`list*`, `get*`) across the seven major PHI services, so each tenant-scoped read now runs inside a transaction with `app.rls_enforce='on'`. RLS becomes load-bearing for these endpoints — even if a future bug removes the app-layer `eq(table.clinicId, …)` filter, the DB refuses cross-tenant rows.

### Services converted

| Service | Methods | Notes |
|---|---|---|
| [patients.service.ts](Clinic-Hub/artifacts/api-server/src/services/patients.service.ts) | `listPatients`, `getPatient` (Phase 2.2 demo), `getPatientSummary` | Also fixed a pre-existing leak in `listPatients`'s `count(*)` query — missing clinic filter; now scoped at both app + DB layers. `getPatientSummary`'s five-table fan-out runs entirely inside one tenant transaction. |
| [medical-records.service.ts](Clinic-Hub/artifacts/api-server/src/services/medical-records.service.ts) | `listMedicalRecords`, `getMedicalRecord` | RLS doctor_scope policy (0017) intersects with tenant_isolation on this table. |
| [prescriptions.service.ts](Clinic-Hub/artifacts/api-server/src/services/prescriptions.service.ts) | `listPrescriptions`, `getPrescription` | doctor_scope-bound. |
| [lab.service.ts](Clinic-Hub/artifacts/api-server/src/services/lab.service.ts) | `listLabTests`, `getLabTest` | doctor_scope-bound. |
| [xray.service.ts](Clinic-Hub/artifacts/api-server/src/services/xray.service.ts) | `listXrays`, `getXray` | doctor_scope-bound. |
| [ultrasound.service.ts](Clinic-Hub/artifacts/api-server/src/services/ultrasound.service.ts) | `listUltrasounds`, `getUltrasound` | doctor_scope-bound. |
| [appointments.service.ts](Clinic-Hub/artifacts/api-server/src/services/appointments.service.ts) | `listAppointments`, `getAppointment` (signature changed) | **Bug fix surfaced by the conversion**: `getAppointment(id)` previously took no `req` and ran `db.select().from(appointmentsTable).where(eq(id))` with NO clinic filter — anyone with an appointment ID could fetch any tenant's row. Now `getAppointment(req, id)`, clinic-scoped, runs inside `runInTenantContext`. Caller in [routes/appointments.ts:37](Clinic-Hub/artifacts/api-server/src/routes/appointments.ts#L37) updated. |
| [billing.service.ts](Clinic-Hub/artifacts/api-server/src/services/billing.service.ts) | `listInvoices`, `getInvoice` | Tenant-scoped. |

### What this changes operationally

- Every read on the seven tables above now opens a transaction, runs `SELECT set_config('app.rls_enforce','on', true)` + per-tenant GUCs, executes the query, COMMITs. Per-request overhead: ~one extra round-trip for the GUC setup; the read itself is unchanged.
- A future regression that drops the `eq(table.clinicId, req.user!.clinicId)` filter would still pass mocked tests but **fail the cross-tenant integration test** in CI's `integration-db` job (zero rows returned, not the leak that mocked tests would silently allow).
- The existing app-layer `eq(t.clinicId, …)` filters remain in place as belt-and-braces. They become removable in a follow-up cleanup PR once **every** read+write path is converted and the `tenant_isolation` policy is flipped from permissive-with-GUC-gate to a hard `clinic_id = current_setting('app.clinic_id')::int`.

### What's NOT in this PR

- **Write methods** (`create*`, `update*`, `delete*`, state-machine transitions). RLS's WITH CHECK clause is already in place on inserts/updates, so the DB refuses cross-tenant writes today — the conversion is mechanical and tracked for a follow-up.
- **Service files not in the table above**: `dashboard.service.ts`, `notifications.service.ts`, `clinic-notices.service.ts`, `patient_consents.service.ts`, `operations.service.ts`, `inventory.service.ts`, `audit.service.ts`, `erasure.service.ts`, `break-glass.service.ts`, `schedule.service.ts`, `users.service.ts`. Each is a separate, small follow-up PR.
- **The redundant-filter cleanup** described above. Wait until the rollout completes.

### Verification

- Typecheck clean.
- Fast suite: **461/461** (no behavioural change for any existing test — the helper preserves the same query semantics).
- The cross-tenant + doctor-scope + RLS tenant-context integration-db tests already in CI continue to cover the new paths; the patients/medical-records/lab/xray/ultrasound endpoints participate in `cross-tenant.integration-db.test.ts`'s endpoint matrix.

---

## Phase 2/3/4 bundle — RLS rollout, audit + break-glass hardening, edge WAF + DAST, KMS scaffold (2026-05-31)

Continuing the 2026-05-30 board-review remediation roadmap. Lands six related changes in a single PR so they can be reviewed and verified together.

### Phase 2.3 — doctor-scope RLS

**Migration `0017_doctor_scope_rls.sql`** adds a RESTRICTIVE `doctor_scope` policy to the five doctor-bounded PHI tables: `medical_records`, `prescriptions`, `lab_tests`, `xray_records`, `ultrasound_records`. Restrictive intersects (AND) with the permissive `tenant_isolation` from 0015, so a row must satisfy BOTH clinic and doctor scope. Doctors only see rows for patients in their `doctor_patients` materialized table; non-doctor roles bypass via `current_setting('app.role') IS DISTINCT FROM 'doctor'`. WITH CHECK rejects cross-scope INSERT/UPDATE.

Test: `tests/doctor-scope-rls.integration-db.test.ts` proves doctor-A only sees patient-A's records, doctor-B only sees patient-B's, nurse sees all (in-clinic), and a doctor-A INSERT for patient-B is refused by the DB.

### Phase 2.2 — patients.service.ts demo conversion

`getPatient()` now wraps its read in `runInTenantContext(req.user!, async (tx) => …)`. The DB enforces clinic isolation via RLS; the existing `eq(patientsTable.clinicId, req.user!.clinicId)` remains belt-and-braces until the full service rollout. This is the first real-service consumer of the Phase 2.1 helper — a template for the remaining ~25 service methods that will convert incrementally.

### Phase 3.1 — typed `req.user` everywhere

**`src/types/express-augment.ts`** declares `Express.Request.user` and `Express.Request.id` on the global namespace. Removes all `(req as any).user` / `(req as any).id` casts:
- `lib/audit.ts:25` — `req.user?.userId` directly typed
- `middlewares/correlationId.ts:18` — `req.id = id` directly typed
- `services/billing.service.ts:172` — `req.user?.userId` directly typed

Closes the foot-gun the board flagged: `(req as any).user?.userId` silently returned `undefined` for any future bug that strips the auth gate; the typed access surfaces such bugs at compile time.

### Phase 3.2 — audit no longer silently skips on missing user

`logAudit()` used to early-return when `req.user` was absent — events emitted from system-initiated paths (cron, internal jobs, error handlers) were silently dropped. Phase 3.2 routes those events to a `SYSTEM_USER_ID = -1` actor with `SYSTEM_CLINIC_ID = 1` and increments `audit_system_actor_total{action,entity_type}`. A sustained non-zero rate of this counter is now actionable — find the unauthenticated call path. Added two new tests to `audit.failure.test.ts` covering the system-actor path and the counter increment.

### Phase 3.4 — break-glass compliance approval gate

**Migration `0016_break_glass_approval.sql`** adds `approved_at` + `approved_by_user_id` columns. The service-layer change at `break-glass.service.ts`:

- Activation immediately grants access for a **5-minute grace window** (`BREAK_GLASS_GRACE_MS`) — emergencies aren't blocked on synchronous approval.
- A `compliance_officer` / `admin` / `super_admin` must call **`POST /break-glass/sessions/:id/approve`** within the grace window to extend access to the full 15-minute TTL.
- Self-approval is forbidden (activator can't approve their own session).
- An unapproved session that hits the grace deadline silently auto-expires.
- Compliance-officer revoke of an unapproved session now logs `BREAK_GLASS_DENIED` (distinct from end-of-session `BREAK_GLASS_REVOKED`).
- SSE alert payload now includes `requiresApproval: true` + `graceExpiresAt` so the compliance UI can render a one-click approve/deny action.

This converts break-glass from purely-detective (alert fires, but access proceeds) to preventive-with-grace (alert fires, access proceeds for 5 min max unless explicitly approved).

### Phase 4.3 — edge WAF + DAST CI

**`.github/workflows/security-dast.yml`** runs OWASP ZAP baseline scan nightly (04:00 UTC) and on-demand against `STAGING_URL` (repo variable). Findings are uploaded as SARIF to the Security tab + opened as GitHub issues. Skips gracefully if `STAGING_URL` is unset. Per-rule false-positive overrides live in `.zap/rules.tsv`. Closes the "no DAST" board finding.

**Caddyfile** edge hardening:
- New `@scan_paths` matcher blocks common probe paths (`.env*`, `wp-admin*`, `phpmyadmin*`, `xmlrpc.php`, `actuator*`, `backup.*`, etc.) with 403 — keeps probe noise out of api logs.
- `@bad_method` rejects non-allowlisted HTTP methods (TRACE / CONNECT etc.) with 405.
- Added `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Cross-Origin-Embedder-Policy` security headers.

### Phase 4.4 scaffolding — pluggable key-provider abstraction

**`src/lib/key-provider.ts`** defines a `KeyProvider` interface and ships `LocalEnvKeyProvider` (current behavior — keys from `FIELD_ENCRYPTION_KEY` / `_NEXT` env vars) and a `KmsKeyProvider` stub. The stub throws on construction with a documented rollout playbook for swapping to AWS KMS / GCP Cloud KMS / Azure Key Vault when the cloud deployment lands.

Scaffolding only — `field-encryption.ts` is untouched in this PR so the 19-test field-encryption suite stays green. The KMS migration becomes a single-line provider swap when the cloud account is provisioned and the team has chosen a vendor.

### Verification

- Typecheck clean across all workspaces.
- Fast suite: **461/461** (was 460/460; +2 audit-system-actor tests, -1 obsolete silent-skip test).
- New integration-db tests will run in CI's `integration-db` job: `doctor-scope-rls.integration-db.test.ts` joins the existing cross-tenant + clinic-id-check + rls-tenant-context suite.

### Still deferred

- **Phase 2.2 full rollout** — converting ~25 more service methods to `runInTenantContext`. Each conversion is small; landing them as one PR per service keeps blast radius bounded.
- **Phase 3.3 (audit hash-chain WORM)** — depends on KMS for the chain-head signing key.
- **Phase 4.1 / 4.2** — managed Postgres + Redis provisioning requires a HIPAA-eligible cloud account with signed BAA.
- **Phase 4.4 cloud impl** — wiring `KmsKeyProvider` to a real KMS requires the cloud account from 4.1.
- **Phase 5** — HIPAA gap analysis, BAA, pentest, DAST findings remediation. Procurement, not code.
- **Phase 6** — SSO/SCIM, per-tenant DEK, governance separation.

---

## Phase 2.1 — Row Level Security foundation (dormant-by-default) (2026-05-31)

Adds Postgres RLS as a DB-enforced tenant boundary, designed to roll out incrementally without changing existing service-layer behaviour.

**Migration `lib/db/migrations/0015_enable_rls.sql`** runs `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on all 20 clinic-bearing tables and creates a `tenant_isolation` policy on each. The policy USING + WITH CHECK expression:

```sql
coalesce(current_setting('app.rls_enforce', true), 'off') <> 'on'
OR clinic_id = nullif(current_setting('app.clinic_id', true), '')::int
```

When the session GUC `app.rls_enforce` is unset (default state for the whole app today), the first branch is TRUE and the policy is permissive — every row is visible, identical to behaviour before this migration. When the GUC is set to `'on'`, the second branch enforces `clinic_id = <tenant>`.

`FORCE` makes the policy apply to the table owner too, so dev/test (where the connecting user is often the owner) matches prod (where a non-superuser `medicore_app` role connects). Without FORCE, owners bypass RLS and dev would silently diverge from prod.

**`lib/db/src/tenant-context.ts`** exports `runInTenantContext(user, fn)`:

```ts
import { runInTenantContext } from "@workspace/db";

await runInTenantContext({ userId, clinicId, role }, async (tx) => {
  // tx.select(), tx.insert(), tx.update(), tx.delete() — all tenant-scoped by Postgres
  return tx.select().from(patientsTable);
});
```

Opens a Drizzle transaction, runs `SELECT set_config('app.rls_enforce','on', true)` + per-tenant GUCs (`app.clinic_id`, `app.user_id`, `app.role`) — all session-local so they revert at COMMIT/ROLLBACK and never leak to another request when the connection returns to the pool. Validates `clinicId > 0` defensively before opening the tx.

**Rollout strategy (service-by-service):**

1. Service migrates from `db.select().from(t).where(eq(t.clinicId, req.user!.clinicId))` to `runInTenantContext(req.user!, (tx) => tx.select().from(t))`. The DB now enforces the filter.
2. The existing app-layer `eq(t.clinicId, ...)` filter remains belt-and-braces — both layers coexist safely.
3. Once every service file has been converted, a follow-up cleanup PR removes the redundant `eq(clinicId, ...)` filters and turns the policy from permissive-with-GUC-gate into a hard `clinic_id = current_setting('app.clinic_id')::int`.

This iteration converts zero services — the foundation is in place, the integration test below proves it works, and individual services convert incrementally so each can be reviewed against its own routes.

**Integration test `tests/rls-tenant-context.integration-db.test.ts`** proves all three halves of the design:
- Outside `runInTenantContext`: rows from every clinic visible (RLS dormant, backward-compatible).
- Inside `runInTenantContext({clinicId: A, …})`: SELECT returns only clinic-A rows even without any `eq(t.clinicId, …)` filter. A forgotten clinic filter inside a tenant context is now harmless.
- Inside a clinic-A context, INSERT with `clinic_id = B` is rejected by the WITH CHECK clause — the DB refuses cross-tenant writes.

**Production note (Phase 2.2 follow-up):** create a non-superuser `medicore_app` role and make the API connect as that role. Superusers and table owners bypass RLS even with `FORCE` set unless they aren't the policy target. The `FORCE` clause in 0015 plus the role-switch in 2.2 gives the full belt-and-braces.

**Verification:** 460/460 fast suite still passes (RLS is dormant for existing code paths). Typecheck clean. The new integration-db test will run in the CI `integration-db` job.

---

## Phase 2.0 — clinic_id CHECK constraint at the DB layer (2026-05-31)

First of two Phase 2 changes from the board-review remediation roadmap. Moves the "clinic_id must be a positive integer" invariant from the app layer (already enforced by the policy kernel since 2026-05-30) into Postgres itself.

**Migration `lib/db/migrations/0014_clinic_id_check_constraint.sql`** adds `CHECK (clinic_id > 0)` to all 20 clinic-bearing tables. Pattern: `ADD CONSTRAINT … NOT VALID` followed by `VALIDATE CONSTRAINT` — short ACCESS EXCLUSIVE lock on the catalog, then a non-blocking scan under SHARE UPDATE EXCLUSIVE. Idempotent via `DO $$ … END $$` guards (reads `pg_constraint`). Pre-flight `UPDATE` normalizes any historical bad rows to clinic 1 before the constraint is added; on a sane DB these should touch zero rows.

Tables covered: `appointments`, `audit_logs`, `audit_outbox`, `break_glass_sessions`, `clinic_notices`, `doctor_patients`, `erasure_requests`, `inventory`, `invoice_items`, `invoices`, `lab_tests`, `medical_records`, `notifications`, `operations`, `patient_consents`, `patients`, `prescriptions`, `ultrasound_records`, `users`, `xray_records`.

**Why now**: the 16-agent board review (2026-05-30) called tenant isolation "a decoration" because nothing below the app layer enforced it. Phase 0.2 removed the `payload.clinicId ?? 1` kernel fallback (auth now fail-closes on missing clinicId). Phase 2.0 closes the remaining "0 means no clinic / 1 means everyone's clinic" foot-gun at the schema level — even if the app drifts, the DB refuses the row.

**Integration test**: `tests/clinic-id-check.integration-db.test.ts` spins up postgres:16-alpine via testcontainers, applies every migration including 0014, and asserts that INSERT with `clinic_id = 0` or `-1` fails with the CHECK violation across all 20 tables.

**Harness change**: `_helpers/realDb.ts` now applies ALL migrations in lexical order (not just journal-tracked ones) — fixes a latent gap where the Phase 1 cross-tenant + doctor-scope tests would have been missing migrations 0010-0013 against a fresh DB. The drizzle `_journal.json` tracks only 0000-0009; 0010+ are hand-authored (pre-existing project tech debt). Production must apply hand-authored tail via psql; the test harness now matches.

**Note**: this migration is hand-authored (no schema-side `.default(1)` removal) and not in `_journal.json` — matches the project's existing pattern for 0010-0013. The 460/460 fast suite still passes; the integration-db suite includes the new test.

**Deferred to a follow-up PR (Phase 2.1+):**
- `withRequestContext` helper + per-request middleware (`SET LOCAL app.clinic_id = $1` inside a tx so RLS policies can read it).
- Migration `0015_enable_rls.sql` — `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy.
- Doctor-scope RLS via `doctor_patients` EXISTS subquery.

Reason for split: 2.1+ touches ~30 service files (replaces direct `db` imports with `req.tx`); landing it without the per-request tx in place would either crash the app or be a no-op policy. Doing it as its own PR keeps each change reviewable and reversible.

---

## Per-role session timeout warning (2026-05-30)

Fixes silent 401 for `super_admin` (15m JWT) — warning now fires 2 minutes before the actual JWT expiry for every role, not at a hardcoded 28-minute idle threshold.

**Root cause**: `useSessionTimeout` had a `jwtExpUnix` param designed for per-role TTL, but `App.tsx` was not passing it. Fallback: hardcoded 28/30m defaults. super_admin (15m TTL) would get a 401 with zero warning on any active session beyond 15 minutes.

**Changes:**
- `src/middlewares/auth-gate.ts` — adds `jwtExpUnix` to `AuthRequest.user` (computed from `d.meta.sessionTtl` returned by the policy kernel's `extractTokenTtl`).
- `src/routes/auth.ts` — `GET /auth/me` now spreads `jwtExpUnix` into the response alongside the user object.
- `artifacts/clinic/src/hooks/auth.tsx` — `AuthUser.jwtExpUnix?: number` field added.
- `artifacts/clinic/src/App.tsx` — `useSessionTimeout` now receives `jwtExpUnix: user?.jwtExpUnix`; idle/warning timers are derived from actual JWT TTL (2 min lead, with a 60s floor).

**Behaviour per role after fix:**
| Role | JWT TTL | Warning fires at | Auto-logout |
|---|---|---|---|
| super_admin | 15 min | 13 min | 15 min |
| admin | 1 h | 58 min | 1 h |
| clinical (doctor/nurse) | 2 h | 1h 58m | 2 h |
| operational | 4 h | 3h 58m | 4 h |

**454/454 tests passing. All 4 workspaces typecheck clean.**

---

## audit_logs.entity_id widened to text; Retry-After header (2026-05-30)

Completes the UUIDv7 PK story: audit trails now carry UUID entity IDs natively.

**`audit_logs.entity_id` / `audit_outbox.entity_id` → `text`**
- Migration `lib/db/migrations/0013_audit_entity_id_text.sql` — `ALTER COLUMN entity_id TYPE text USING entity_id::text`. All existing integer IDs preserved as strings; no data loss.
- Schema: `audit_logs.ts` and `audit_outbox.ts` changed from `integer("entity_id")` to `text("entity_id")`.
- `audit.ts` (`logAudit`): `entityId: entityId != null ? String(entityId) : null` — call sites passing integers still work; UUID strings work natively.
- `clinic-notices.service.ts`: `logAudit` calls now pass `notice.id` / `noticeId` directly as `entityId`; the `details: { id }` workaround removed.
- `auth.service.ts` (3 sites): `entityId: userId → String(userId)` / `userId != null ? String(userId) : null`.
- `audit.service.ts`: `getAuditLogsByEntity(entityType, entityId: number)` → `entityId: string`; `isNaN` check replaced with truthiness check.
- `routes/audit.ts`: `parseInt(req.params.entityId)` → `String(req.params.entityId)`.
- `audit-integrity.ts`: `AuditRow.entityId` type updated to `string | null`.
- `tests/audit-integrity.test.ts`: `makeRow` fixture `entityId: 42` → `"42"`.
- `tests/clinic-notices.service.test.ts`: `deleteClinicNotice` audit assertion updated to pass UUID directly.

**`Retry-After` header on login 429**
- `routes/auth.ts`: `res.set("Retry-After", String(err.retryAfterSecs))` added before the 429 JSON body. Standard RFC 7231 header — HTTP clients and API gateways can now back off automatically.

**454/454 tests passing. All 4 workspaces typecheck clean.**

---

## UUIDv7 PK infrastructure (2026-05-29)

Adds time-sortable UUID v7 primary key support as the standard for new tables going forward. All legacy serial-PK tables are unchanged.

**Files changed:**
- **`lib/db/src/uuid-v7.ts`** — Pure-function `uuidV7()` generator. No external dependency — uses Node's `crypto.randomBytes`. Embeds 48-bit millisecond timestamp (bits 0–47) + 12-bit rand_a + 62-bit rand_b. Lexicographic order equals chronological order; safe for Postgres `ORDER BY id` cursor pagination.
- **`lib/db/src/index.ts`** — Exports `uuidV7`.
- **`lib/db/package.json`** — Adds `"./uuid-v7": "./src/uuid-v7.ts"` export for direct sub-path imports (avoids triggering the DB connection in tests).
- **`lib/db/src/schema/clinic_notices.ts`** — First UUID-PK table: `id: uuid("id").$defaultFn(uuidV7).primaryKey()`.
- **`lib/db/migrations/0012_clinic_notices_uuid_pk.sql`** — Drops serial `id`, adds `uuid DEFAULT gen_random_uuid() PRIMARY KEY`. Safe: no FK references from other tables; no prod data at this stage.
- **`artifacts/api-server/src/services/clinic-notices.service.ts`** — All ID fields updated to `string`; cursor pagination is lexicographic (correct for UUIDv7); audit `entityId` stays `undefined` (audit_logs.entity_id is integer); UUID passed in `details` instead.
- **`artifacts/api-server/src/routes/clinic_notices.ts`** — Removed `safeParseInt`; `noticeId` validated against UUID regex.
- **`lib/api-spec/openapi.yaml`** — `ClinicNotice.id`, `PaginatedClinicNotices.nextCursor`, and `DELETE /clinic-notices/{noticeId}` param all updated to `type: string, format: uuid`.
- **`artifacts/api-server/src/tests/uuid-v7.test.ts`** — 5 new tests: format, version nibble, variant bits, monotonicity, uniqueness.
- **`artifacts/api-server/src/tests/clinic-notices.service.test.ts`** — All ID literals updated to UUID strings.

**Pattern for all future tables:** `id: uuid("id").$defaultFn(uuidV7).primaryKey()`. Audit entityId: pass `undefined` + `{ id }` in details until `audit_logs.entity_id` is widened to `text`.

**454/454 tests passing.** Typecheck clean.

---

## REDIS_PASSWORD → Docker secrets (2026-05-29)

Completes the P0-3 secrets story. `REDIS_URL` was the last secret visible via `docker inspect` on the api container.

**Changes:**
- **Redis container** (`docker-compose.prod.yml`): switched from `command: >` (compose-interpolated `${REDIS_PASSWORD}`) to `entrypoint: ["sh", "-c"]` + `command:` that reads `$$(cat /run/secrets/redis_password)`. Healthcheck updated to the same pattern. Added `secrets: [redis_password]`.
- **Api container** (`docker-compose.prod.yml`): removed `REDIS_URL` from `environment:`. Added `redis_password` to the entrypoint `for s in ...` pre-flight check and `export REDIS_URL="redis://:$$(cat /run/secrets/redis_password)@redis:6379"`. Added `redis_password` to `secrets:` list.
- **Top-level `secrets:`** (`docker-compose.prod.yml`): added `redis_password: { file: ./secrets/redis_password }` entry and generator comment (`openssl rand -base64 48`).
- **`secrets/README.md`**: added `redis_password` to required-files table; updated "Why files instead of env vars" section.
- **`.env.prod.example`**: replaced `REDIS_PASSWORD=...` inline var with a note that `REDIS_URL` is assembled from the secret file; added `redis_password` to the secrets list.

**Deploy note:** requires `./secrets/redis_password` (mode 0600) before next `docker compose up -d`. Entrypoint fails fast with `FATAL: /run/secrets/redis_password missing or empty` if the file is absent.

**454/454 tests passing** (infra-only change; no code paths affected).

---

## Codegen post-step fix — `write-zod-index.mjs` (2026-05-29)

The `lib/api-spec` codegen script used an inline `node -e "..."` one-liner to write `lib/api-zod/src/index.ts` after every Orval run. Due to JSON + shell escaping layering, the shell command produced the literal characters `\n` (backslash + n) in the file instead of a real newline. TypeScript then reported `TS1127: Invalid character` and `TS2304: Cannot find name 'n'` on the first line, requiring a manual correction after every codegen run.

**Fix:** Replaced the inline command with a tiny standalone script [`lib/api-spec/write-zod-index.mjs`](../lib/api-spec/write-zod-index.mjs). The `codegen` entry in `lib/api-spec/package.json` now reads:
```
orval --config ./orval.config.ts && node write-zod-index.mjs && pnpm -w run typecheck:libs
```

No shell escaping required; the newline is a literal character in the `.mjs` source. Works identically on sh, cmd.exe, and PowerShell.

**449/449 tests passing.**

---

## P3-2 — Service worker for SPA shell (2026-05-29)

Adds an offline-resilient service worker to the SPA. No new npm dependency — hand-written SW in `public/sw.js` so build output and bundle size are unaffected.

**Caching strategies:**
| Request type | Strategy | Rationale |
|---|---|---|
| `/api/*` | Network-only | PHI must never enter CacheStorage |
| Navigation | Network-first + stale fallback | Users get latest HTML when online; SW serves shell offline |
| `script/style/font/image/manifest` | Cache-first | Vite output is content-hashed — cached entry is always correct for its URL |
| Mutations (POST/PATCH/DELETE/…) | Passthrough (not intercepted) | SW only intercepts GET |

**Files changed:**
- **`artifacts/clinic/public/sw.js`** — New service worker. Cache version `medicore-v1` (bump on strategy changes). Activate handler prunes stale caches. `self.skipWaiting()` on install for immediate activation.
- **`artifacts/clinic/src/main.tsx`** — Registers `/sw.js` on `window.load`. Registration is gated on `import.meta.env.PROD` — Vite dev server (HMR) is unaffected.
- **`nginx.conf`** — Exact-match `location = /sw.js` block with `Cache-Control: no-store` inserted before the generic `.js` regex rule. Without this, nginx would serve `sw.js` with `expires 1y, immutable` — preventing SW updates from ever deploying.

**449/449 tests passing** (no new tests — SW is a browser runtime artifact; unit testing requires a full browser environment).

---

## P3-1 — Deduplicate `cookie-signature` (2026-05-29)

`cookie-parser@1.4.7` declared an exact dep on `cookie-signature@1.0.6` while Express 5, `express-rate-limit`, and `supertest` all use `1.2.2`. Added `pnpm.overrides` to root `package.json`:

```json
"pnpm": {
  "overrides": { "cookie-signature": "^1.2.2" }
}
```

After `pnpm install`, `pnpm-lock.yaml` shows `cookie-parser@1.4.7` resolved to `cookie-signature: 1.2.2`. The `@1.0.6` resolution entry is gone from the lockfile. **449/449 tests passing.**

---

## P2-6 — Extract `medical_records.isGlobal` into `clinic_notices` (2026-05-29)

`isGlobal: boolean` and `globalReason: text` columns removed from `medical_records`. A dedicated `clinic_notices` table replaces the overloaded boolean flag. Closes the domain-model smell where a "clinic-wide advisory" was represented as a flag on a patient-specific PHI row.

| Item | Change |
|---|---|
| **`lib/db/src/schema/clinic_notices.ts`** | New table `clinic_notices`: `id`, `clinicId`, `title`, `content`, `createdBy`, `reason`, `deletedAt`, `createdAt`, `updatedAt`. Two indexes: `cn_clinic_idx`, `cn_created_idx`. |
| **`lib/db/src/schema/medical_records.ts`** | Removed `isGlobal` (boolean) and `globalReason` (text) columns. |
| **`lib/db/migrations/0011_clinic_notices.sql`** | Creates `clinic_notices` table; migrates any existing `is_global = true` records to notices (via `INSERT … SELECT`); drops `is_global` and `global_reason` columns from `medical_records`. |
| **`artifacts/api-server/src/lib/scope.ts`** | `assertMedicalRecordInScope`: removed Rule 1 (isGlobal bypass). Only rule remaining: `record.doctorId === req.user.userId`. Deny reason changed from `"record_not_owned_or_global"` to `"record_not_owned"`. `isGlobal` dropped from the SELECT projection. |
| **`artifacts/api-server/src/services/medical-records.service.ts`** | Removed `setGlobalFlag()` and its Zod schema. Removed `isGlobal` from `listMedicalRecords` SELECT. Removed unused `z` import. |
| **`artifacts/api-server/src/services/clinic-notices.service.ts`** | New — `listClinicNotices()` (cursor-paginated), `createClinicNotice()` (Zod validation: title 5–200, content 10+, reason 20+), `deleteClinicNotice()` (soft-delete + 404 guard). All functions log audit entries. |
| **`artifacts/api-server/src/routes/medical_records.ts`** | Removed `setGlobalFlag` import and `PATCH /medical-records/:id/global-flag` route. |
| **`artifacts/api-server/src/routes/clinic_notices.ts`** | New — `GET /clinic-notices` (all roles), `POST /clinic-notices` (super_admin), `DELETE /clinic-notices/:noticeId` (super_admin). |
| **`artifacts/api-server/src/routes/index.ts`** | Registered `clinicNoticesRouter`. |
| **`artifacts/api-server/src/tests/scope.test.ts`** | Updated: removed two `isGlobal` tests (Rule 1 tests), updated mock to exclude `isGlobal`, updated deny-reason expectation. |
| **`artifacts/api-server/src/tests/clinic-notices.service.test.ts`** | New — 9 tests: `listClinicNotices` (paginated/nextCursor/audit), `createClinicNotice` (creates+audit, 3 validation paths), `deleteClinicNotice` (soft-delete, 404). |

**Net test count: 449/449 passing** (was 442; +9 clinic-notices, −2 removed isGlobal scope tests).

---

## P2-2 — Remove `style-src 'unsafe-inline'` from CSP (2026-05-29)

`'unsafe-inline'` dropped from `style-src` in both the Helmet CSP header and the Vite production meta-tag string.

**Root cause analysis**: The comment `unsafe-inline retained: React style={} props + chart.tsx dangerouslySetInnerHTML` was misleading on both counts:
1. React `style={}` props use `element.style.*` (DOM API) — browsers do not apply `style-src` to JavaScript-set inline styles from already-trusted scripts; only static HTML `style` attributes and `<style>` elements are governed by `style-src`.
2. `ChartStyle` in `chart.tsx` was the one real `<style>` block injector — but `ChartContainer` is never imported or used in any production page (all pages import Recharts directly).

| Item | Change |
|---|---|
| **`artifacts/api-server/src/lib/csp.ts`** | `styleSrc` array: removed `'unsafe-inline'`; updated comment. |
| **`artifacts/clinic/vite.config.ts`** | `STRICT_CSP` string: removed `'unsafe-inline'` from `style-src`. |
| **`artifacts/clinic/src/components/ui/chart.tsx`** | `ChartStyle` (which returned a `<style dangerouslySetInnerHTML>` block) replaced with a no-op. `ChartContainer` now computes chart CSS custom properties as inline styles on the container `<div>` via a `useMemo`; `propStyle` merged correctly. Dark-mode `theme.dark` values are documented as unsupported via this approach (use `index.css` CSS vars instead). |
| **`artifacts/api-server/src/tests/csp.test.ts`** | New regression guard: `style-src does not allow 'unsafe-inline'` — prevents re-introduction. |

**Test count: 442/442 passing** (was 441; +1 new in `csp.test.ts`).

---

## Audit-log hash chain (2026-05-29)

Nightly SHA-256 hash chain over `audit_logs` rows. Detects silent row-level tampering. HIPAA §164.312(b) integrity verification.

| Item | Change |
|---|---|
| **`lib/db/src/schema/audit_integrity.ts`** | New — `auditIntegrityChecksTable`: `checkedDate` (DATE UNIQUE), `rowCount`, `rootHash`, `prevHash`, `status` (`ok`/`empty`/`mismatch`), `verifiedAt`, `createdAt`. |
| **`lib/db/migrations/0010_audit_integrity_chain.sql`** | New — `CREATE TABLE audit_integrity_checks` + unique index on `checked_date`. |
| **`artifacts/api-server/src/lib/audit-integrity.ts`** | New — `computeHashFromRows()` (pure SHA-256 over prevHash + rows ordered by id ASC), `recordDailyIntegrity(date?)` (idempotent upsert; defaults yesterday UTC), `verifyIntegrity(date)` (re-derives from stored prevHash; updates `status=mismatch` + fires counter on divergence). |
| **`artifacts/api-server/src/lib/metrics.ts`** | `auditIntegrityMismatchTotal` counter (`audit_integrity_check_failures_total`) added. |
| **`artifacts/api-server/src/cron.ts`** | New `"0 2 * * *"` (02:00 UTC daily) cron task — calls `recordDailyIntegrity(yesterday)`. |
| **`prometheus-alerts.yml`** | `AuditIntegrityMismatch` alert — `increase(audit_integrity_check_failures_total[1h]) > 0`, severity critical, no grace period. |
| **`artifacts/api-server/src/tests/audit-integrity.test.ts`** | New — 13 tests: `computeHashFromRows` (determinism, order-sensitivity, null fields, 64-char hex), `recordDailyIntegrity` (status ok/empty, genesis prevHash, omitted date, stable rootHash), `verifyIntegrity` (ok=true, mismatch + counter, missing record throws). |

**How the chain works:** at 02:00 each day, the cron hashes the previous day's rows as `SHA-256(prevHash || rows...)` where each row contributes `id:userId:clinicId:action:entityType:entityId:createdAt`. The `prevHash` is the stored `rootHash` from the prior record, or `"genesis"` for the first. Tampering with any row changes the hash; `verifyIntegrity()` will detect and record the mismatch.

**Querying for anomalies:**
```sql
SELECT checked_date, row_count, status, verified_at
FROM audit_integrity_checks
WHERE status = 'mismatch'
ORDER BY checked_date DESC;
```

**Test count: 441/441 passing** (was 428; +13 new in `audit-integrity.test.ts`).

---

## P2-4 — OpenTelemetry distributed tracing (2026-05-29)

OTel tracer wired into the API. HTTP server spans on every request; `withSpan()` helper for manual service-layer instrumentation. Zero overhead when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (noop API provider default).

| Item | Change |
|---|---|
| **`artifacts/api-server/src/lib/tracer.ts`** | New — `initTracer()` (SDK setup, OTLP exporter, `BatchSpanProcessor`), `getTracer()`, `withSpan<T>()` helper (OK/ERROR status, exception recording, context propagation), `httpSpanMiddleware` (HTTP server spans, path-only — no PHI in attributes). |
| **`artifacts/api-server/src/app.ts`** | `httpSpanMiddleware` mounted after `correlationId` so `req.id` is available as `app.request_id` span attribute; context propagates through all downstream middleware. |
| **`artifacts/api-server/src/index.ts`** | `initTracer()` called before `app` import (no-op without endpoint, zero impact on existing boot). |
| **`artifacts/api-server/build.mjs`** | `"@opentelemetry/*"` removed from `external` list — packages bundle into `dist/index.mjs` so the minimal runtime Docker image needs no extra `node_modules`. |
| **`artifacts/api-server/src/tests/tracer.test.ts`** | New — 9 tests: `initTracer` (noop + idempotent), `getTracer` (returns Tracer), `withSpan` (return value, error propagation, span passed to callback), `httpSpanMiddleware` (next() called, finish listener registered). |
| **`artifacts/api-server/src/tests/phase2.flagON.integration.test.ts`** | `mockActiveUser` extended with `isOnShift`, `phone`, `specialty`, `department` fields + `role: "doctor" as const` — TypeScript schema drift fix unrelated to OTel but surfaced by typecheck. |
| **`lib/db`** | Declarations rebuilt (`pnpm exec tsc -p lib/db/tsconfig.json`) to include `doctor_patients.d.ts` — necessary for typecheck after Flow 2 schema addition. |

**Configuration (production):**
```
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io   # or Tempo / Jaeger / Grafana Cloud
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<api-key>  # backend-specific auth header
```

**PHI rule**: span names and attributes MUST NOT contain patient data. Paths are safe (numeric IDs only); query params and request bodies are excluded from all span attributes.

**`withSpan()` usage pattern** (for service-layer instrumentation):
```typescript
const rows = await withSpan("patients.list", { "db.operation": "select" }, async (span) => {
  const result = await db.select()...;
  span.setAttribute("result.count", result.length);
  return result;
});
```

**Test count: 428/428 passing** (was 419; +9 new in `tracer.test.ts`).

---

## Flow 2 — Materialized `doctor_patients` scope table (2026-05-29)

O(N) `SELECT DISTINCT patientId FROM appointments WHERE doctorId = ?` replaced with O(1) indexed lookup on a dedicated 2-column scope table.

| Item | Change |
|---|---|
| **`lib/db/src/schema/doctor_patients.ts`** | New — `doctorPatientsTable` with composite PK `(doctorId, patientId)`, `clinicId`, `lastSeenAt`, and two indexes (`dp_doctor_idx`, `dp_clinic_idx`). |
| **`lib/db/src/schema/index.ts`** | Added `export * from "./doctor_patients"`. |
| **`lib/db/migrations/0009_smooth_hellfire_club.sql`** | New — `CREATE TABLE doctor_patients` + FK constraints + indexes + backfill `INSERT ... SELECT DISTINCT ON` from `appointments` with idempotent `ON CONFLICT DO UPDATE`. |
| **`artifacts/api-server/src/lib/scope.ts`** | `getDoctorPatientScope` now queries `doctorPatientsTable` (was `db.selectDistinct` on `appointmentsTable`). New export `recordDoctorPatientLink(clinicId, doctorId, patientId, lastSeenAt?)` — idempotent upsert using `onConflictDoUpdate`. |
| **`artifacts/api-server/src/services/appointments.service.ts`** | `createAppointment` + `patchAppointment` both call `recordDoctorPatientLink` after commit, before `invalidateDoctorScope`. `cancelAppointment` unchanged — historical relationships are preserved. |
| **`artifacts/api-server/src/tests/scope.test.ts`** | Mock updated: `appointmentsTable` → `doctorPatientsTable`, `selectDistinct` → `select`, `insert` added. 2 new `recordDoctorPatientLink` tests (correct args + default lastSeenAt). |

**Design decisions:**
- The table is append-only — `cancelAppointment` does NOT remove entries. A cancelled appointment is still a historical clinical relationship and should keep the doctor's PHI access scope intact.
- Redis cache (60s TTL, `doctor_scope:<doctorId>`) is now optional rather than required — the underlying DB lookup is O(1) indexed.
- `recordDoctorPatientLink` is idempotent: `ON CONFLICT (doctorId, patientId) DO UPDATE SET lastSeenAt = excluded.last_seen_at`.
- Backfill migration picks the most recent `scheduled_at` per `(doctor_id, patient_id)` pair as `lastSeenAt`, with `ON CONFLICT DO UPDATE` for idempotency on re-run.

**Test count: 419/419 passing** (was 417; +2 new in `scope.test.ts` for `recordDoctorPatientLink`).

---

## P2-3 — Additional Prometheus alerts + metrics endpoint test suite (2026-05-29)

7 new alert rules added to `prometheus-alerts.yml`; 9-test `metrics.test.ts` suite added.

| Item | Change |
|---|---|
| **`prometheus-alerts.yml`** | 7 new rules across 2 groups (see below). Total: 11 alert rules. |
| **`artifacts/api-server/src/tests/metrics.test.ts`** | New — 9 tests: 4 bearer-token protection tests + 5 custom-metric-name presence tests. |

**New alert rules:**

*Group `medicore-api-alerts` (4 new — no extra exporter required):*
- `AuditLogPermanentLoss` — CRITICAL, `for: 0m`: fires immediately when `increase(audit_log_write_failures_total[5m]) > 0`. PHI accessed without durable audit entry; HIPAA incident-class event.
- `AuditOutboxBacklog` — WARNING, `for: 10m`: `audit_outbox_depth > 100` sustained. Drain worker stuck or Postgres under pressure.
- `HighNodeMemory` — WARNING, `for: 5m`: `process_resident_memory_bytes > 805306368` (768 MB). Possible memory leak.
- `HighEventLoopLag` — WARNING, `for: 2m`: `nodejs_eventloop_lag_p99_seconds > 0.5`. CPU starvation or blocking sync I/O.

*Group `medicore-infrastructure-alerts` (3 new — require external exporters, documented inline):*
- `RedisHighMemory` — WARNING (`redis_memory_used_bytes / redis_maxmemory_bytes > 0.85`). Needs `redis_exporter`.
- `DiskSpaceCritical` — CRITICAL (`node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.10`). Needs `node_exporter`.
- `SSLCertificateExpiringSoon` — WARNING (`(probe_ssl_earliest_cert_expiry - time()) / 86400 < 14`). Needs `blackbox_exporter`.

**Infrastructure-alert rules are safe to commit** — Prometheus silently skips rules with no active series. They will have no matching metric until the relevant exporter is scraped; they won't generate false alerts. Alert routing and notification channels can be configured before the exporters are live.

**Test count: 417/417 passing** (was 408; +9 new in `metrics.test.ts`).

---

## Phase 2 flag-ON integration test suite (2026-05-28)

11-test `phase2.flagON.integration.test.ts` covering the 4 flag-ON behaviors listed in the roadmap. `debug-phase2.test.ts` (temp debugging file) deleted.

| Item | Change |
|---|---|
| **`artifacts/api-server/src/tests/phase2.flagON.integration.test.ts`** | New — 11 tests across 4 describe blocks (see below). |
| **`artifacts/api-server/src/tests/debug-phase2.test.ts`** | Deleted (temp debugging file from integration work). |

**Test groups:**
- `POST /auth/verify-device` (flag ON): token not found → 400 `{error:"invalid"}`; fingerprint mismatch → 400 `{error:"fingerprint_mismatch"}`; already-consumed token → 400 `{error:"expired_or_consumed"}` (atomicity); valid token + matching fingerprint → 200 with user + session cookie.
- `POST /auth/wasnt-me` (flag ON): expired/consumed token → 400; valid kill-switch click → 200 `{status:"revoked"}`.
- `POST /auth/login` role-branched (flag ON): privileged role on new device → 202 `{status:"pending_verification"}`, no `clinic_token` cookie; non-privileged role on new device → 200, `clinic_token` cookie set.
- `POST /auth/reset-password` strict policy (`PHASE2_DEVICE_TRUST_ENABLED=true` + `PHASE2_STRICT_PASSWORD_POLICY=true`): < 12 chars → 400 WEAK_PASSWORD; missing special char → 400 WEAK_PASSWORD; HIBP-known password (global `fetch` mocked) → 400 WEAK_PASSWORD.

**Key gotchas captured:**
- `isStrictPasswordPolicyEnabled()` is **gated by the master flag** (`isPhase2Enabled() && ...`). Setting only `PHASE2_STRICT_PASSWORD_POLICY=true` does nothing unless `PHASE2_DEVICE_TRUST_ENABLED=true` is also set.
- Zod's `resetSchema` enforces `newPassword: z.string().min(8)` — use 8+ char passwords in tests to avoid VALIDATION_ERROR instead of WEAK_PASSWORD.
- HIBP test stubs `globalThis.fetch` with `vi.stubGlobal` and computes the correct SHA-1 suffix from the test password to trigger the match.

**Test count: 408/408 passing** (was 397 before flag-OFF suite; +11 flag-ON; -1 debug deletion = net 408).

---

## Phase 2 OpenAPI sync + integration test suite (2026-05-28)

All 8 Phase 2 routes that were code-landed flag-OFF are now declared in the OpenAPI spec, codegen re-run, and covered by a new integration test suite (24 tests).

| Item | Change |
|---|---|
| **`lib/api-spec/openapi.yaml`** | Added 8 paths (`POST /auth/verify-device`, `POST /auth/wasnt-me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/admin-reset/{userId}`, `GET /account/devices`, `DELETE /account/devices/{deviceId}`, `POST /csp-report`). Added `PendingVerificationResponse`, `DeviceTokenBody`, `VerifyDeviceResponse`, `Device`, `DeviceListResponse`, `ForgotPasswordBody`, `ForgotPasswordResponse`, `ResetPasswordBody`, `AdminResetResponse` schemas. Renamed existing `ResetPasswordBody` (password-only, admin use) to `UserPasswordResetBody` to resolve duplicate key collision. |
| **`lib/api-zod/src/generated/api.ts`** | Regenerated by Orval. |
| **`lib/api-client-react/src/generated/api.ts`** | Regenerated by Orval. |
| **`artifacts/api-server/src/routes/csp-report.ts`** | Fixed path bug: route was registered at `/api/csp-report` but apiRouter is already mounted at `/api`, making effective URL `/api/api/csp-report`. Fixed to `/csp-report`. |
| **`artifacts/api-server/src/routes/index.ts`** | Phase 2 routers (`devicesRouter`, `passwordResetRouter`, `cspReportRouter`) moved to register BEFORE `usersRouter`. All other domain routers mount a global `router.use(requireAuth)` catch-all; Phase 2 anonymous routes (forgot-password, reset-password, verify-device, wasnt-me, csp-report) must appear before that catch-all to avoid being blocked with 403. |
| **`artifacts/api-server/src/tests/phase2.integration.test.ts`** | New — 24 tests across 8 describe blocks covering enumeration prevention, token validation, privilege gating, Phase 2 flag-off behavior, device management auth, UUID validation, and CSP report path. |

**Key test design notes:**
- `evaluate()` checks CSRF **before** token presence for `write`/`privileged` scopes on mutation methods. Tests that assert 401 (no token) must supply a CSRF double-submit pair first.
- Mock upgraded from non-thenable chainable proxy to thenable-resolves-to-`[]`, so `listDevicesForUser` returns an empty array and `rows.map(...)` returns `[]`.
- `POST /auth/verify-device` and `POST /auth/wasnt-me` return 503 immediately (`phase2_disabled`) before any DB interaction — no CSRF token needed.

**Test count:** 398/398 passing. Typecheck clean.

---

## P0-4 — clinic_id enforcement: service-layer multi-tenant isolation (2026-05-28)

Closes the "clinic_id is decorative" critical risk. The column existed on PHI tables since Phase 4 (default=1) but was never read by service queries or embedded in JWTs — cross-tenant reads were possible the moment a second clinic onboarded.

| Item | Change |
|---|---|
| **`lib/db/src/schema/users.ts`** | Added `clinic_id integer NOT NULL DEFAULT 1` — users now carry a clinic association that propagates into the JWT. |
| **`lib/db/src/schema/inventory.ts`** | Added `clinic_id integer NOT NULL DEFAULT 1` (column was absent; other PHI tables already had it). |
| **`lib/db/src/schema/operations.ts`** | Added `clinic_id integer NOT NULL DEFAULT 1` (same). |
| **`lib/db/migrations/0008_acoustic_cassandra_nova.sql`** | `ALTER TABLE users / operations / inventory ADD COLUMN clinic_id integer DEFAULT 1 NOT NULL` — three-statement migration, no downtime. |
| **`artifacts/api-server/src/lib/auth.ts`** | Added `clinicId?: number` to `TokenPayload` (optional — backward-compat with existing JWTs; kernel fills gap with `?? 1`). |
| **`artifacts/api-server/src/lib/policy.ts`** | Added `clinicId: number` to `AuthUser` (required). Kernel fills `clinicId: payload.clinicId ?? 1`. Public scope gets `clinicId: 0`. |
| **`artifacts/api-server/src/middlewares/auth-gate.ts`** | `AuthRequest.user` extended with `clinicId: number` (required). |
| **`artifacts/api-server/src/services/auth.service.ts`** | `loginUser()` includes `clinicId: user.clinicId` in the JWT payload. |
| **8 PHI service files** | `patients`, `appointments`, `medical-records`, `prescriptions`, `lab`, `xray`, `ultrasound`, `billing` — every SELECT / INSERT / UPDATE / DELETE now includes `eq(table.clinicId, req.user!.clinicId)` in its conditions array. |
| **`operations.service.ts`** | Clinic filter added to all 4 functions. |
| **`inventory.service.ts`** | `listInventory` signature gains `req: AuthRequest`; clinic filter added to all 4 functions. |
| **`routes/inventory.ts`** | `GET /inventory` handler updated to pass `req` to `listInventory(req, ...)`. |

**Backward compatibility:** `clinicId` is optional in `TokenPayload` — existing JWTs without the claim are accepted; the kernel fills `clinicId = 1`. Once sessions rotate (max 4h TTL), every active JWT carries the claim.

**Test count:** 379/379 (unchanged — existing test mocks use `as unknown as AuthRequest` / `as any` casts so the new required `clinicId` field causes no test failures). Typecheck clean.

**Migration:** Apply `pnpm --filter @workspace/db run db:migrate` (`0008_acoustic_cassandra_nova.sql`). All three `ALTER TABLE` statements use `DEFAULT 1 NOT NULL` — instant metadata-only change, zero downtime, existing rows get value `1`.

---

## P1-8 — SSE graceful drain on SIGTERM (2026-05-28)

Closes the "SSE drops on every deploy" risk. Previously SIGTERM caused `closeAllSSEClients()` to send `event: shutdown` and immediately terminate every SSE connection; all clients reconnected simultaneously (thundering herd). New SSE connections during shutdown received no special handling.

| Item | Change |
|---|---|
| **`lib/sse.ts`** | `closeAllSSEClients()` now sends `retry: <jitter>` + `event: reconnect\ndata: {reason, retryAfter}\n\n` per connection (jitter 5 000–15 000 ms, randomized per connection). Clients spread their reconnects rather than all hitting at once. |
| **`routes/notifications.ts`** | `GET /notifications/stream` checks `isShuttingDown()` and returns `503 + Retry-After: 10` immediately, refusing new SSE connections during drain. |
| **`index.ts`** | New `SSE_DRAIN_MS` constant (default 10 000 ms in prod, 0 in tests). Shutdown sequence holds existing SSE connections for `SSE_DRAIN_MS` before closing them, giving clients time to migrate to a new pod. `SHUTDOWN_TIMEOUT_MS` raised from 25 000 to 30 000 ms. Sequence comment renumbered. |
| **`docker-compose.prod.yml`** + **`docker-compose.yml`** | `stop_grace_period: 35s` added to api service — Docker's default 10s stop timeout was killing the process mid-drain before any graceful work could complete. |
| **`hooks/use-notifications-stream.ts`** | Added `reconnect` event listener — reads `data.retryAfter` and uses it as the reconnect delay. Existing `onerror` → fixed 5s reconnect remains as fallback for network errors. |
| **`tests/sse.test.ts`** (new) | 10 tests covering `closeAllSSEClients()` behavior (reconnect event shape, jitter range, per-connection variance, error tolerance, map clear) and the 503 drain guard on the SSE endpoint. |

**Test count:** 379 / 379 (was 369 — +10 new). Typecheck clean.

**Deploy note:** `SSE_DRAIN_MS` defaults to 10s; override via env var. `SHUTDOWN_TIMEOUT_MS` is now 30s — ensure the host process manager / orchestrator gives the process at least 35s before SIGKILL. Docker Compose `stop_grace_period: 35s` handles this.

---

## Build fix — mockup-sandbox vite.config.ts (2026-05-28)

`artifacts/mockup-sandbox/vite.config.ts` threw at config-load time when `PORT` or `BASE_PATH` env vars were absent. Both are only used by the `server` and `preview` configs — the `vite build` output doesn't depend on them. Changed both to optional with defaults (`PORT` → `"3000"`, `BASE_PATH` → `"/"`). Eliminates a pre-existing CI build failure that blocked `pnpm run build`.

---

## P1-9 — Erasure ↔ backup blackout coordination (2026-05-28)

Restoring from a pg_dump backup taken before a patient erasure's blackout window expires silently revives pre-erasure PHI. This change closes that gap: the erasure execution now records when the backup retention window clears, and both the restore drill script and RUNBOOK enforce re-anonymization.

| Item | Change |
|---|---|
| **`lib/db/src/schema/erasure_requests.ts`** | Added `erasureBlackoutUntil timestamp` (nullable) — set at execution time to `executedAt + BACKUP_RETENTION_DAYS`. |
| **`lib/db/migrations/0007_wide_zarda.sql`** | `ALTER TABLE "erasure_requests" ADD COLUMN "erasure_blackout_until" timestamp;` |
| **`artifacts/api-server/src/services/erasure.service.ts`** | `executeErasure()` now computes `erasureBlackoutUntil = now + BACKUP_RETENTION_DAYS` (from `process.env.BACKUP_RETENTION_DAYS`, default 7) and writes it inside the transaction when marking the request as `"executed"`. |
| **`scripts/backup-verify.mjs`** | New `checkErasureBlackouts()` step runs after `runRestoreTest()` in `--restore` mode. Queries the restored DB for rows where `status='executed' AND erasure_blackout_until > now()`. If any exist, logs each affected patient ID with their blackout window and **fails** the restore drill, preventing accidental promotion of a tainted restore. |
| **`RUNBOOK.md §2.2`** | New step 5 — "CRITICAL — Erasure re-application" — with the detection query, per-patient re-anonymization SQL block, and a note that `backup-verify.mjs --restore` runs the check automatically. Old steps 5–8 renumbered 6–9. |

**Test count:** 369 / 369 (unchanged — no new tests; existing erasure service tests continue to pass). Typecheck clean.

**Pre-migration note:** `pnpm --filter @workspace/db run db:migrate` to apply migration `0007_wide_zarda.sql`. Adds one nullable column to `erasure_requests` — instant metadata-only change, zero downtime.

---

## P1-1 — Audit transactional outbox (2026-05-28)

The audit write path changed from fire-and-forget (direct `INSERT INTO audit_logs`, lose on failure) to a transactional outbox pattern (write to an unindexed `audit_outbox` queue, drain to `audit_logs` with exponential backoff retry). Under a Postgres outage PHI reads still succeed and audit events are now **delayed**, not permanently lost.

| Item | Change |
|---|---|
| **`lib/db/src/schema/audit_outbox.ts`** (new) | `audit_outbox` table — same columns as `audit_logs` minus indexes, plus `attempts integer DEFAULT 0` and `next_attempt_at timestamp`. No FK references (intentional — allows writes to succeed even if user record changes before drain). |
| **`lib/db/migrations/0006_odd_machine_man.sql`** | `CREATE TABLE "audit_outbox" (…)` — no indexes, no FKs. |
| **`lib/db/src/schema/index.ts`** | Added `export * from "./audit_outbox"`. |
| **`artifacts/api-server/src/lib/audit.ts`** rewrite | `logAudit()` now inserts into `audit_outbox` (not `audit_logs`). On outbox-insert failure the counter + Pino log still fire (log key changed from `audit_write_failed` → `audit_outbox_write_failed`). New `drainAuditOutbox()` function: fetches up to 100 ready rows (attempts < 5, nextAttemptAt NULL or past), inserts each into `audit_logs`, deletes on success. Failure path: increment `attempts`, set `nextAttemptAt = now + backoff` (5 s, 30 s, 2 min, 10 min). Row exhausted after 5 attempts: increments `audit_log_write_failures_total` counter + logs `audit_outbox_row_exhausted`. |
| **`artifacts/api-server/src/lib/metrics.ts`** | Added `auditOutboxDepthGauge` Prometheus gauge (`audit_outbox_depth` — sampled at each drain tick). Updated `auditLogWriteFailuresTotal` help text to reflect permanent-loss semantics (exhausted rows, not temporary failures). |
| **`artifacts/api-server/src/cron.ts`** | Added `startAuditDrain()` / `stopAuditDrain()` — `setInterval` every 5 s, `.unref()`'d so it doesn't prevent process exit. Imports `drainAuditOutbox` from `./lib/audit`. |
| **`artifacts/api-server/src/index.ts`** | Imports `startAuditDrain`, `stopAuditDrain` (start alongside cron jobs; stop in graceful shutdown step 2b). Imports `drainAuditOutbox` for final flush (step 6b, before `pool.end()`). Shutdown sequence comment updated. |
| **Test file updates** | `audit.failure.test.ts` updated: mock changed from `auditLogsTable` → `auditOutboxTable`, log-message assertion updated to `"audit_outbox_write_failed"`. Five test files (`auth-flow.integration.test.ts`, `routes.envelope.integration.test.ts`, `route-access.contract.test.ts`, `trust-proxy.test.ts`, `audit.failure.test.ts`) all have `auditOutboxTable: {}` added to their `vi.mock("@workspace/db")` stubs. |

**Test count:** 369 / 369 (unchanged — existing tests updated, no new tests added). Typecheck clean.

**Pre-migration note:** `pnpm --filter @workspace/db run db:migrate` to apply migration `0006_odd_machine_man.sql`. The `audit_outbox` table will be created (no schema changes to existing tables).

---

## M8 — Drop `invoices.items` JSONB dual-write (2026-05-28)

The `invoices.items` JSONB column has been removed. `invoice_items` (normalized table, present since Phase 3) is now the single source of truth for invoice line-items.

| Item | Change |
|---|---|
| **`lib/db/src/schema/billing.ts`** | Removed `items: jsonb("items").notNull()` from `invoicesTable`. Removed `jsonb` from the import. |
| **`artifacts/api-server/src/services/billing.service.ts`** | Removed dual-write: `createInvoice()` no longer writes `parsedItems.data` to the `items` column. Added two private helpers: `fetchInvoiceItems(invoiceId)` (single invoice, for get/update/cancel/pay) and `fetchInvoiceItemsBatch(invoiceIds[])` (batch fetch keyed by invoiceId, for list). All six returning functions now include `items: InvoiceItem[]` sourced from the normalized table. API response shape is unchanged. |
| **`lib/db/migrations/0005_charming_psynapse.sql`** | `ALTER TABLE "invoices" DROP COLUMN "items";` — single statement, no cascade risk. |

**Pre-migration note**: Running this migration on a live DB is instant (metadata-only column drop in PostgreSQL 16). Apply with `pnpm --filter @workspace/db run db:migrate` before restarting the api.

**Test count:** 369 / 369 (unchanged — no new tests; existing billing/jsonb-schemas tests continue to pass). Typecheck clean.

---

## M3 — EdDSA + JWKS (2026-05-28)

JWT signing migrated from HS256 symmetric (`SESSION_SECRET`) to Ed25519 asymmetric with a JWKS public endpoint and key rotation overlap support.

| Item | Change |
|---|---|
| **`lib/jwt-secret.ts` rewrite** | Exports `signingKey` (Ed25519 `KeyObject`), `jwksDocument` (public-keys-only JWKS with no `d` component), `jwksVerify` (`createLocalJWKSet` factory for `jwtVerify`), `CURRENT_KID` (from `JWT_KID` env var, default `"1"`). `JWT_SECRET: Uint8Array` export preserved from `SESSION_SECRET` for backward compat with `device-fingerprint.ts` HMAC. Dev fallback: ephemeral `generateKeyPairSync("ed25519")` with a logged warning. Production fail-closed if `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` unset. Previous-key overlap: `JWT_PREV_PUBLIC_KEY` + `JWT_PREV_KID` allow old tokens to verify while new writes use the current key. |
| **`lib/auth.ts`** | Import updated to `signingKey`, `jwksVerify`, `CURRENT_KID`. `SignJWT` header changed from `{ alg: "HS256" }` to `{ alg: "EdDSA", kid: CURRENT_KID, typ: "JWT" }`. `.sign(signingKey)`. `jwtVerify` updated to `(token, jwksVerify, { algorithms: ["EdDSA"] })`. |
| **`lib/policy.ts`** | Import updated to `jwksVerify`. `parseToken` uses `jwtVerify(token, jwksVerify, { algorithms: ["EdDSA"], clockTolerance: 30 })`. |
| **`routes/jwks.ts` (new)** | `GET /.well-known/jwks.json` — returns `jwksDocument` with `Cache-Control: public, max-age=3600`. No auth required (public keys are safe by definition). |
| **`routes/index.ts`** | `jwksRouter` imported and mounted before `healthRouter`. |
| **`tests/jwt-secret.test.ts` (new)** | 9 tests via `vi.resetModules()` + dynamic import pattern. Covers: JWKS structure (OKP/Ed25519, no `d` component), sign + verify round-trip, unknown kid rejected, `JWT_SECRET` is `Uint8Array` from `SESSION_SECRET`, key rotation overlap invariant (`JWT_PREV_PUBLIC_KEY` allows old tokens to verify). |
| **`docker-compose.prod.yml`** | Entrypoint loop extended to include `jwt_private_key` + `jwt_public_key`. Two new `export` lines. Both added to api service `secrets:` list and top-level `secrets:` declaration. Pre-flight comment block updated with atomic key pair generator. |
| **`SECURITY.md`** | Secret table updated (`session_secret` now "HMAC for device fingerprinting", two new `jwt_*` rows). Rotation cost table updated (`session_secret` is now gradual; `jwt_private_key/public_key` is gradual via overlap). New §"JWT key rotation" with 6-step quarterly rotation procedure and emergency rotation path. |
| **`.env.example`** | `SESSION_SECRET` comment corrected (HMAC only, no longer JWT signing). New block: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KID`, `JWT_PREV_PUBLIC_KEY`, `JWT_PREV_KID` with dev atomic-pair generator command. |
| **`.env.prod.example`** | Secrets block updated to include `jwt_private_key` + `jwt_public_key`. `JWT_KID` + `JWT_PREV_KID` documented as non-secret control vars. |
| **`secrets/README.md`** | Two new rows (`jwt_private_key`, `jwt_public_key`) with atomicity note and pair generator script. |

**Breaking change**: All existing HS256 JWT sessions are invalidated on deploy. Users will see a 401 and be prompted to re-login. Expected and one-time.

**Test count:** 360 → **369** (9 new in `jwt-secret.test.ts`). All 22 test files pass. Typecheck clean across all 4 workspaces.

---

## Security Hardening Bundle (2026-05-27)

Six remediation items from the principal-architect review board's 30-day launch-readiness plan, executed sequentially.

| Item | Change |
|---|---|
| **P0-7 — Express trust proxy** | `app.set("trust proxy", "loopback, linklocal, uniquelocal")` added to `app.ts` before all middleware. Behind Caddy on the docker bridge network `req.ip` previously resolved to the Caddy container IP — rate-limit keys, login-shield buckets, and audit IP fields all collapsed to one identity. 5 regression tests in `trust-proxy.test.ts`. |
| **Audit logs compound index** | `audit_entity_time_idx` on `(entity_type, entity_id, created_at)` added to `audit_logs`. Missing compound index would degrade HIPAA compliance queries as 7-year retention fills. Migration `0004_sudden_spectrum.sql` generated via `drizzle-kit generate`. |
| **P0-1 — Cursor pagination fully wired (frontend)** | OpenAPI spec updated: `offset` param → `cursor` (opaque string) on `/patients` and `/appointments`. New `PaginatedAppointments` schema aligns spec to the actual backend response shape `{ data, nextCursor }`. All 12 call sites in `pages/**` and `components/CommandPalette.tsx` migrated. `Appointments.tsx` and `DoctorDashboard.tsx` unwrapped `.data` — fixed a latent runtime bug where `.map()` was called on a `{ data, nextCursor }` object. CI grep guard added to `ci.yml` to block `offset:N` in clinic pages (`AuditLog.tsx` intentionally excluded). |
| **P0-3 — Secrets out of `environment:`** | `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `METRICS_TOKEN` removed from the api service `environment:` block in `docker-compose.prod.yml` and file-mounted via Docker secrets (`/run/secrets/*`). Entrypoint uses `set -eu` + `test -s` to fail-close before `exec node` if any secret file is missing. Dead `JWT_SECRET` env var also removed. `REDIS_PASSWORD` still env-passed (compose interpolates it into `REDIS_URL` at parse time — tracked separately). `.env.prod.example`, `.env.example`, `secrets/README.md`, and `SECURITY.md` updated. **Deploy action required before next prod restart**: create `./secrets/session_secret`, `./secrets/field_encryption_key`, `./secrets/metrics_token` (mode 0600). |
| **P1-5 — Route-access contract test** | New `route-access.contract.test.ts` (67 tests). Reads `lib/route-access.ts` navItems at test time; for each page × allowed role makes a supertest GET to the page's primary backend endpoint and asserts status ≠ 403. Found and fixed active production bug: `pharmacist` was missing from `GET /prescriptions` and `GET /prescriptions/:id` — pharmacists were redirected to `/prescriptions` on login and immediately got 403. Fixed in `routes/prescriptions.ts`. |
| **P1-4 — CI security tooling** | Three new GitHub Actions workflows: `codeql.yml` (CodeQL SAST, javascript-typescript, `security-and-quality` queries), `security-scan.yml` (Trivy fs scan, `vuln,config`, HIGH/CRITICAL, `ignore-unfixed: true`, SARIF → Security tab), `sbom.yml` (Anchore Syft CycloneDX-JSON, archived per push/release). |
| **M2 — KID in field-encryption envelope** | `lib/field-encryption.ts` rewritten. New write path: `enc:v2:<kid>:<iv>:<tag>:<data>`. Legacy `enc:v1:` envelopes still decrypt via `kid="1"`. Key registry (`Map<kid, Buffer>`) populated from `FIELD_ENCRYPTION_KEY` (kid=1) + optional `FIELD_ENCRYPTION_KEY_NEXT` (kid=2). `FIELD_ENCRYPTION_KEY_WRITE_KID` controls which kid new writes use (default `"1"`; set to `"2"` to promote during rotation). Production fail-closed if write kid has no registered key. Field-encryption test suite rewritten: 19 tests. `SECURITY.md` updated with six-step key rotation procedure. |

**Test count progression:** 278 (baseline) → 286 (trust proxy +5) → 286 (pagination, no new tests) → 353 (route-access contract +67) → 360 (field-encryption +7)

---

## Bayan Design Port — Phases 4 + 5 (2026-05-27)

Completed the page rewrite and a11y phases. After this entry the visual port is feature-complete; only font self-hosting remains as a deferred optimization (Google Fonts CDN is the current source).

| Phase | Change |
|---|---|
| **Phase 4 — Page rewrites** | All 28 existing pages reskinned to Bayan classes (`.page`, `.card`, `.card-pad`, `.btn`, `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.badge`, `.badge-teal/sage/sand/rose/blue`). Zero remaining old-theme tokens (`text-muted-foreground`, `bg-card`, `bg-primary`, etc.) in `src/pages/**`. |
| **Phase 4 — Net-new pages** | Added 5 pages: `DoctorConsult.tsx` (tabbed EHR — Summary/History/Orders/Notes/Rx with deep-link `?p=<id>` via `useUrlSync`, dirty-state guard on tab change), `DoctorOrders.tsx` (consolidated lab/xray/ultrasound DataTable filtered by `requestedById`), `DoctorInbox.tsx` (doctor-scoped notifications), `NurseVitals.tsx` (rapid-entry form with `VitalChip` live preview + pain slider), `FrontDeskCheckin.tsx` (today queue with check-in button). |
| **Phase 4 — Routes** | Added 6 routes to `App.tsx`: `/today`, `/consult`, `/orders`, `/inbox`, `/checkin`, `/vitals`. Extended `lib/route-access.ts` with new `navItems` and `navPinnedByRole`: doctor pinned to `[today, schedule, patients, consult, orders, inbox]`; front_desk pinned to `[checkin, appointments, patients, billing]`; nurse adds `vitals`. `getLandingRoute` now sends doctor → `/today`, front_desk → `/checkin`. |
| **Phase 4 — Per-route ErrorBoundary** | New `RouteErrorReset` wrapper in `App.tsx` keyed by `useLocation()` so an error on one page is cleared when the user navigates away. |
| **Phase 4 — Quick fixes** | `.btn-outline` CSS class defined in `index.css` (was referenced but undefined). Triage.tsx hardcoded English toast strings replaced with `t("failed")`. |
| **Phase 5 — A11y sweep** | Global `:focus-visible` outline rule added in `index.css` (2px solid teal-500, 2px offset) — covers `a`, `button`, `input`, `select`, `textarea`, `[role=button|tab|menuitem]`, `[tabindex]`. ARIA on all new pages: `role="status"` on loading + empty states, `aria-label` on icon-only buttons. Layout sidebar already had `aria-current="page"` on active nav and `aria-label` on topbar icon buttons. |
| **Phase 5 — i18n** | ~60 new keys added to `hooks/i18n.tsx` for doctor pages, nurse vitals, front-desk checkin, doctor orders — full EN + AR coverage. Duplicates removed. |

**Deferred:** Self-hosted fonts. Google Fonts CDN is in use with `display=swap`. Migration to `public/fonts/*.woff2` + `@font-face` requires downloading binary assets and is tracked as a follow-up optimization for offline clinic networks.

**Verification:** `pnpm --filter @workspace/clinic run typecheck` passes clean.

---

## Bayan Design Port — Phases 0-3 (2026-05-26)

Full frontend visual overhaul porting the Bayan Clinic OS design system into MediCore. All data bindings are unchanged (real API hooks); only the UI layer was modified.

| Phase | Change |
|---|---|
| **Phase 0 — Token foundation** | Rewrote `index.css` with Bayan mint/sage editorial token system. `@theme inline` maps all vars to Tailwind semantic tokens. Supports `[data-palette]`, `[data-voice]`, `[data-density]`, `[dir="rtl"]` and full dark mode. Google Fonts imports for Newsreader, Geist, Geist Mono, Noto Naskh Arabic, Noto Kufi Arabic, Cormorant Garamond, IBM Plex. |
| **Phase 1 — Shared primitives** | `Metric`, `Sparkline`, `MiniBars`, `SearchPicker`, `VitalChip`, `PatientHeaderStrip`, `LiveActivityFeed` components added. `StatusBadge` extended with shape + tone tables (40+ statuses). `SkeletonRow`, `SkeletonMetric`, `SkeletonCard` skeleton variants added. Hooks: `usePendingId`, `useFirstMountLoading`, `useUrlSync`, `useCurrentPatientId`, `useTweaks`, `useSimpleToast`. |
| **Phase 2 — App shell** | `Layout.tsx` rewritten: 248px white sidebar + 64px topbar, Bayan `.nav-item` + `.is-active`, grouped sections for admin/super_admin, user pill + tweaks gear in footer, topbar with ⌘K pill + live clock + copy-link + notifications bell. `CommandPalette.tsx` created: ⌘K/Ctrl+K global overlay, nav + patient fuzzy search, keyboard nav. `TweaksPanel.tsx` created: Radix Popover with palette/voice/density chip groups. `Login.tsx` rewritten: split-screen art panel + quick-login dev chips. |
| **Phase 3 — RTL audit** | Replaced all directional Tailwind classes in pages/components with logical equivalents: `ml-*` → `ms-*`, `mr-*` → `me-*`, `pl-*` → `ps-*`, `pr-*` → `pe-*`, `text-left` → `text-start`, `text-right` → `text-end`, `border-l-*` → `border-s-*`. 15 new i18n keys added (EN + AR) for palette, command palette, login. |

---

## Phase 2 — Auth Hardening (flag-gated, default OFF) (2026-05-25)

All changes ship behind `PHASE2_DEVICE_TRUST_ENABLED` (default false). With the flag off, login behavior is byte-identical to pre-Phase-2. Run `pnpm --filter @workspace/db db:generate` to produce the migration before flipping the flag.

| Change | Details |
|---|---|
| Kill-switch helpers | `isPhase2Enabled()`, `isEmailVerifyEnabled()`, `isStepUpEnabled()`, `isStrictPasswordPolicyEnabled()`, `isCspReportEnabled()` in `lib/auth-constants.ts`. Master flag short-circuits every Phase 2 codepath. |
| `user_devices` table | (user_id, device_id) composite PK + fingerprint_hash + trusted/trust_source/trust_expires_at + revoked_at. Match logic: cookie → fingerprint → new. |
| `device_verification_tokens` table | Single-use, 15-min TTL, fingerprint-bound, atomic consume via `UPDATE … WHERE consumed_at IS NULL RETURNING`. Stores token_hash only. |
| `password_reset_tokens` table | Single-use, 30-min TTL, atomic consume. Sources: `self_service`, `admin_reset`. |
| `csp_reports` table | Ingests legacy `csp-report` + Reporting API shapes at `POST /api/csp-report`. |
| Device fingerprint | HMAC-SHA256 keyed by server secret, salted by user_id. UA-family + platform + client hints only. ASN/country deliberately excluded. |
| `__Host-device_id` cookie | 1-year TTL, HttpOnly, Secure, SameSite=Strict, host-only. Set on every successful login. |
| Device-trust dispatcher | `evaluateDeviceTrust()` returns `trusted` / `allow_unverified` / `blocked`. Blocks super_admin/admin/compliance_officer/doctor on new devices; non-privileged roles get `dvu=true` JWT claim instead. First-ever login auto-trusts (`trust_source: 'first_login'`). |
| Email service (Resend) | `services/email.service.ts` — Resend client + console-log fallback when `RESEND_API_KEY` is unset. Tags: `device_verify`, `device_alert`, `password_reset`, `compliance_alert`. |
| SMS service (Twilio stub) | `services/sms.service.ts` — provider-pluggable. Twilio wired; stubs to console when `SMS_PROVIDER` unset. |
| Routes | `POST /auth/verify-device`, `POST /auth/wasnt-me`, `GET/DELETE /account/devices/:id`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/admin-reset/:userId`, `POST /api/csp-report`. |
| Step-up middleware | `requireStepUp(action)` — re-verifies password via `X-Step-Up` header for destructive actions when `PHASE2_STEP_UP_ENABLED=true`. Audits `STEP_UP_OK` / `STEP_UP_FAILED`. |
| Device-scope middleware | `denyIfDeviceUnverified()` returns 403 `DEVICE_UNVERIFIED` when JWT carries `dvu=true`. Mount on bulk-PHI / export / settings routes during ramp. |
| Password policy hardening | Strict mode adds: 12-char minimum, special-char requirement, HIBP k-anonymity check, dictionary blocklist. Async `validatePasswordStrictAsync()` wraps it. |
| Self-service password reset | Anonymous endpoint with byte-identical response — no enumeration oracle. 30-min token TTL, atomic consume, revokes all sessions on success. |
| Admin reset | Returns short-lived raw token to compliance_officer/super_admin for out-of-band delivery. |
| Login response | New shape `{ user, deviceUnverified }` on success or `{ status: "pending_verification", message }` (HTTP 202) when blocked. |
| `useSessionTimeout` rewire | Now consumes `jwtExpUnix` so the warning lead matches per-role TTL instead of hardcoded 28/30 min. |
| Frontend pages | `ForgotPassword`, `VerifyDevice`, `AccountDevices` — wired in `App.tsx`. Public routes resolve before the unauthenticated `<Login />` fallback. |
| CSP report-uri | When `PHASE2_CSP_REPORT_ENABLED=true`, helmet emits `report-uri /api/csp-report` and reports are persisted. |
| Login route audit | New audit action `LOGIN_PENDING_VERIFICATION` for new-device blocks on privileged roles. |
| Test count | unchanged this PR — Phase 2 lands code under flag; tests + DB-migration verification follow in next PR before flipping the flag. |

**Follow-ups before flag-flip:** OpenAPI spec sync (new routes + `pending_verification` response + `dvu` claim) + codegen; `pnpm --filter @workspace/db db:generate` to produce the migration; Resend domain verification; CI runs the suite with the flag both on and off.

---

## Phase 6 (partial) — Cursor Pagination + Redis Doctor-Scope Cache (2026-05-25)

| Change | Details |
|---|---|
| Cursor pagination on all list endpoints | `patients`, `appointments`, `lab`, `xray`, `ultrasound`, `prescriptions`, `medical-records`. Query param `?cursor=<id>` replaces `?offset=<n>`. Hard max 100 rows per page. Response shape: `{ data, nextCursor }` (patients: `{ patients, total, nextCursor }`). |
| Ordering consistent | All paginable lists order by `id DESC` — monotonically correct for serial PKs, eliminates offset drift on inserts. |
| Redis doctor-scope cache | `getDoctorPatientScope(doctorId)` caches in `doctor_scope:<id>` with 60s TTL via `runtime.scopeCache` (optional). `invalidateDoctorScope` on appointment create/cancel. In-memory dev, Redis prod (no config change needed). |
| Phase 6 UUID/clinic_id reverted | Multi-tenancy additions (UUID PKs, `clinics` table, `clinic_id` FK, `clinicId` in auth) rolled back — single-tenant system remains integer PKs. Only pagination and scope cache are kept. |
| Phase 6 typecheck + parseInt fixes | All `No overload matches` errors from `req.query` string params passed to integer Drizzle columns — fixed with `parseInt()` guards across 9 service list/create functions. |
| **Test count** | 278 → **278** passing (unchanged — no DB integration tests for pagination) |

---

## Phase 5 — Compliance / HIPAA / GDPR (2026-05-25)

| Change | Details |
|---|---|
| `patient_consents` table | Consent types: treatment, data_sharing, research, marketing. `grantedAt`, `revokedAt`, `documentVersion`, `ipAddress`. Composite index on `(patientId, consentType)`. |
| Consent enforcement | `createMedicalRecord` + `createPrescription` check `hasActiveConsent(patientId, "treatment")` — throws `ConsentRequiredError` (HTTP 422) if no active consent. |
| Consent service + routes | `GET/POST /patients/:id/consents`, `DELETE /patients/:id/consents/:id` with per-role RBAC. |
| `lib/field-encryption.ts` | AES-256-GCM. Envelope: `enc:v1:<iv_hex>:<tag_hex>:<data_base64>`. `FIELD_ENCRYPTION_KEY` = 64 hex chars. Prod hard-fails without key; dev warns + runs unencrypted. Backward-compat on decrypt. |
| Field encryption wired | `diagnosis` + `vitals` on `medical_records`; `medications` on `prescriptions`; `allergies` + `emergencyContact` on `patients`. Encrypted at write, decrypted at read. JSONB columns store encrypted string literals. |
| Break-glass sessions | Any user can activate a 15-min emergency session. Immediate SSE alert to all `compliance_officer` users (`alertSentAt` recorded). Every PHI access during session logs `BREAK_GLASS_ACCESS`. |
| Break-glass service + routes | `POST /break-glass/patients/:id/activate`, `POST /break-glass/sessions/:id/revoke`, `GET /break-glass/sessions`. Owner or compliance_officer can revoke. |
| Right-to-erasure | Three-step: request → approve → execute. Execution anonymizes patient demographics + medical records (`[ERASED]`), soft-deletes prescriptions — all in a DB transaction. Irreversible (ADR-005). |
| Erasure service + routes | `GET/POST /erasure-requests`, `POST /erasure-requests/:id/review`, `POST /erasure-requests/:id/execute` (super_admin only). |
| Data retention cron | Monthly (1st @ 03:00). Reports audit logs >7yr + open erasure requests. SSE alerts compliance_officers if overdue. |
| Drizzle migration | `0001_free_moira_mactaggert.sql` — adds `patient_consents`, `break_glass_sessions`, `erasure_requests` tables + `consent_type` + `erasure_status` enums. |
| `ConsentRequiredError` + E.3010 | Error code 3010 in compliance range (3010–3019). HTTP 422. |
| **Test count** | 237 → **278** passing |

---

## Phase 0 + Phase 1 Remediation (2026-05-24)

| Change | Details |
|---|---|
| `credentials-backup.md` deleted | Contained plaintext staff passwords — removed from disk |
| `fix-db.ts` deleted | One-off MFA cleanup script had no business in the production source tree |
| `artifacts/clinic/src/lib/auth.tsx` deleted | Empty stub (`export {}`) — dead file |
| `scripts/post-merge.sh` deleted | Was running `pnpm --filter db push` on every merge — dangerous schema push shortcut |
| `temp_dashboard_ref/` deleted | Abandoned Next.js reference app with its own `package-lock.json` (violated pnpm-only guard) |
| `lib/jwt-secret.ts` created | Single source of truth for `JWT_SECRET`; both `auth.ts` and `policy.ts` now import from it |
| `auth-constants.ts` extended | `ROLE_TTL` (jose strings) + `COOKIE_TTL_MS` (ms) co-located — drift between JWT expiry and cookie maxAge is now structurally impossible |
| `/metrics` bearer-token gated | `METRICS_TOKEN` env var; open in dev, enforced in prod — operational intelligence no longer publicly readable |
| `@opentelemetry/api` removed | Was in prod dependencies with zero SDK/instrumentation wired — dead weight |
| `.nvmrc` + `engines.node >=24` added | Node version pinned at repo level, not just in CI |
| DB indexes added | `appointments`: `(doctorId, scheduledAt)` compound + partial unique (double-booking prevention) + `updatedAt`; `patients.phone`; `audit_logs.createdAt` |
| React `ErrorBoundary` added | Root-level error boundary — rendering crash in any page no longer kills the entire clinic app |
| Route-level code splitting | All 22 pages converted to `React.lazy()` + `Suspense` — separate chunk per route |
| **Test count** | 173 → **235** passing |

---

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
