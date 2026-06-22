# Patient-Flow 6-State UX — Full Implementation Plan

> **Status:** proposed, not started. Author handoff: 2026-06-20.
> **Decision basis:** keep the existing **10-state** appointment machine (locked 2026-06-20, patient-flow review 8.5/10). Deliver the "6-state" workflow the operator wants as a **presentation + automation layer over** the machine — NOT by collapsing the enum.
> **Net schema impact:** **zero migrations** for Phases 1–3 (Phase 4 optional, additive).

---

## 0. Why this shape (and what we are explicitly NOT doing)

A proposal circulated to collapse the flow to 6 core states
(`CHECKED_IN / WAITING / WITH_NURSE / WAITING_FOR_DOCTOR / IN_DOCTOR_ROOM / COMPLETED` + `NO_SHOW / CANCELLED`).
Mapped against the real enum, 7 of 8 proposed states are **renames** of states we already run; it adds one cosmetic state (`WAITING`) and deletes three that do real work:

| Proposed | Existing (`appointment_status`) | Verdict |
|---|---|---|
| `CHECKED_IN` | `checked_in` | rename |
| `WAITING` | *(none — derivable)* | the one new idea |
| `WITH_NURSE` | `in_triage` | rename |
| `WAITING_FOR_DOCTOR` | `ready_for_doctor` | rename |
| `IN_DOCTOR_ROOM` | `in_consultation` | rename |
| `COMPLETED` | `completed` | rename |
| `NO_SHOW` / `CANCELLED` | `no_show` / `cancelled` | rename |
| — | `scheduled` | **dropped — but `NO_SHOW` requires it** |
| — | `awaiting_diagnostics` | **dropped — this is the Lab/X-ray/US loop** |
| — | `pending_payment` | **dropped — this is the billing gate** |

**Rejected: collapsing the enum.** Reasons (file-level):
- `complete` only fires `from: ["pending_payment"]` — dropping it removes the billing gate (`appointment-state-machine.ts:98-102`).
- `no_show` fires `from: ["scheduled","checked_in"]` — dropping `scheduled` makes the proposal internally inconsistent (`appointment-state-machine.ts:108-112`).
- `getAppointmentFlow` derives `avgArrivalToTriage / avgTriageToConsultation / avgConsultationToPayment` from per-transition timestamps (`appointments.service.ts:166-182`); fewer transitions = worse analytics.
- Postgres has no `ALTER TYPE … DROP VALUE`; removal = new enum + `USING` cast every row + re-apply RLS `tenant_isolation` + `appt_clinic_scheduled_status_idx` + the partial unique index `appt_no_double_book_idx … WHERE status NOT IN ('cancelled','no_show')` (`appointments.ts:49-50`). Drizzle has no down-migrations (RUNBOOK §10) → irreversible.
- Discards the 2026-06-20 CAS + cancel-routing fixes and `appointment-lifecycle.integration-db.test.ts`.

**The operator's real fear is valid** — "if staff don't update statuses, the workflow becomes fiction." The fix is **auto-transitions** (Phase 2), which make the two "extra" states cost zero manual clicks, + **friendly labels** (Phase 1). The 6-column board becomes a *view*, the machine stays the system of record.

---

## 1. Current-state inventory (ground truth)

**Enum / machine**
- Enum: `appointments.ts:9-20` — `scheduled → checked_in → in_triage → ready_for_doctor → in_consultation → awaiting_diagnostics → pending_payment → completed` (+ `cancelled`, `no_show`).
- Transition table: `appointment-state-machine.ts:67-113`; validator `validateTransition()` `:125-166` (returns `{ok}` discriminated union, 403/409).
- Service: `transitionAppointment(req, id, action, extraFields?)` — already used by route handlers; `triage` passes `{triageStartedAt}`, `consult` passes `{consultationStartedAt}` (`routes/appointments.ts:74-132`). CAS landed 2026-06-20 (`appointments.service.ts:371-375`).

**Transition endpoints (`routes/appointments.ts`)**: `checkin :65`, `triage :74`, `ready :85`, `consult :94`, `diagnostics :105`, `payment :116`, `complete :127`. No `reconsult` yet.

**Rendering**
- `components/StatusBadge.tsx` — single render point. `TONES :8-58` + `SHAPES :60-101` already cover all 10 statuses (a11y shape-coding). Accepts `label?` prop `:105`, fallback title-cases status `:112`.
- i18n status labels: EN `hooks/i18n.tsx:68-73`, AR `:949-954`.
- Boards consuming status: `ScheduleDayView.tsx`, `DoctorDashboard.tsx`, `NurseDashboard.tsx`, `FrontDeskCheckin.tsx`, `Triage.tsx`, `Appointments.tsx`, `Reports.tsx`.

**Appointment linkage (decides Phase 2 design)**
| Source row | `appointmentId` column? | Service create fn |
|---|---|---|
| `medical_records` (vitals) | ✅ nullable (`medical_records.ts:14`) — but `NurseVitals` never sends it | `createMedicalRecord` |
| `lab_tests` | ✅ nullable (`lab_tests.ts:22`) | `lab.service.ts:70` |
| `xray_records` | ✅ nullable (`xray.ts:17`) | `xray.service.ts:72` |
| `ultrasound_records` | ❌ **none** (`ultrasound.ts:13`) | `ultrasound.service.ts:76` |
| `invoices` | ❌ **none** (`billing.ts:14`) | `billing.service.ts:110` |

`NurseVitals` posts only `patientId`+`doctorId`+`vitals` (`NurseVitals.tsx:66-76`). **Conclusion:** an FK-based auto-advance is impossible for ultrasound/invoices without a migration and unreliable for vitals. Use `resolveActiveVisit(patientId)` instead (Phase 2) → migration-free and uniform.

---

## 2. Phase 1 — Friendly-label projection (frontend only)

**Goal:** staff see `Booked | Waiting | With Nurse | Waiting for Doctor | With Doctor | Checkout/Done`. No backend change.

### 2.1 Relabel statuses
`hooks/i18n.tsx` EN `:68-73` + AR `:949-954` (keep keys; change values):

| status | EN | AR |
|---|---|---|
| `scheduled` | Booked | محجوز |
| `checked_in` | Waiting | في الانتظار |
| `in_triage` | With Nurse | مع الممرض |
| `ready_for_doctor` | Waiting for Doctor | بانتظار الطبيب |
| `in_consultation` | With Doctor | مع الطبيب |
| `awaiting_diagnostics` | Awaiting Results | بانتظار النتائج |
| `pending_payment` | Checkout | الدفع |
| `completed` | Done | منتهي |

> `checked_in → "Waiting"` is deliberate: in this system a checked-in patient *is* waiting for the nurse (there is no data to split `CHECKED_IN` from `WAITING`). Inventing a separate state would be the exact over-distinction the proposal warns against.

### 2.2 Board-grouping helper — `lib/appointment-flow.ts` (new)
```ts
// 6 visible columns; awaiting_diagnostics folds under "With Doctor" as a sub-row.
export const FLOW_COLUMNS = [
  { key: "booked",   statuses: ["scheduled"] },
  { key: "waiting",  statuses: ["checked_in"] },
  { key: "nurse",    statuses: ["in_triage"] },
  { key: "for_doc",  statuses: ["ready_for_doctor"] },
  { key: "with_doc", statuses: ["in_consultation", "awaiting_diagnostics"] },
  { key: "checkout", statuses: ["pending_payment", "completed"] },
] as const;
// terminal cancelled/no_show shown as filter chips, not columns.
export function columnForStatus(s: string) { /* reverse lookup */ }
```
`StatusBadge` already supports `label`; callers pass `t(status)`. No component edit required (tone/shape already mapped).

### 2.3 Wire the boards
Point `ScheduleDayView.tsx`, `DoctorDashboard.tsx`, `NurseDashboard.tsx`, `FrontDeskCheckin.tsx` at `FLOW_COLUMNS` so all four agree on the 6-column grouping. `awaiting_diagnostics` renders inside the "With Doctor" column with an "Awaiting Results" sub-label.

### 2.4 Tests
- Frontend i18n EN/AR parity test must stay green (every relabeled key exists in both).
- Add a unit test for `columnForStatus()` mapping all 10 statuses (incl. terminal → no column).

**Effort:** ~0.5 day. **Risk:** trivial, fully reversible (label-only).

---

## 3. Phase 2 — Auto-transitions (the anti-fiction engine)

**Goal:** the status advances as a side effect of work staff already do — no manual status clicks. All advances route through `validateTransition` + CAS (today's guarantees preserved) and are **idempotent + non-fatal** (never break the primary write; never surface a 409 for a redundant advance).

### 3.1 Core helper — `appointments.service.ts`
```ts
// Find the patient's single in-flight visit. 0 or >1 active → return null (never guess).
export async function resolveActiveVisit(tx, clinicId, patientId): Promise<number | null> {
  const rows = await tx.select({ id, status })
    .from(appointmentsTable)
    .where(and(
      eq(clinicId), eq(patientId),
      notInArray(status, ["completed","cancelled","no_show"]),
    ));
  return rows.length === 1 ? rows[0].id : null;   // ambiguity → caller no-ops
}

// Advance one step if currently in a valid `from` state; otherwise no-op.
// Wraps transitionAppointment; swallows ConflictError so a redundant call is silent.
export async function tryAdvanceVisit(req, apptId, action): Promise<void> { … }
```
Design notes:
- Runs inside the **same `runInTenantContext` / tx** as the triggering write where possible (atomic). Where the trigger is a separate request, call after the primary commit and never throw upward.
- `>1 active visit → skip` is the safe failure mode: status simply stays put and a human can advance it. We do **not** guess which appointment.
- Every auto-advance still emits its normal audit (`transitionAppointment` already does).

### 3.2 Triggers
| Trigger | Action | Source state → target | Insertion point | Migration? |
|---|---|---|---|---|
| Nurse saves vitals | `triage` then `ready` | `checked_in → in_triage → ready_for_doctor` | `createMedicalRecord` (service behind `NurseVitals.tsx:66`) | none (uses `resolveActiveVisit`) |
| Doctor creates lab order | `diagnostics` | `in_consultation → awaiting_diagnostics` | `lab.service.ts:70` | none |
| Doctor creates X-ray | `diagnostics` | `in_consultation → awaiting_diagnostics` | `xray.service.ts:72` | none |
| Doctor creates ultrasound | `diagnostics` | `in_consultation → awaiting_diagnostics` | `ultrasound.service.ts:76` | none (`resolveActiveVisit`, not FK) |
| Invoice created for visit | `payment` | `in_consultation`/`awaiting_diagnostics → pending_payment` | `billing.service.ts:110` | none (`resolveActiveVisit`) |

> Vitals advance walks **two** steps (`checked_in→in_triage→ready_for_doctor`) via two `tryAdvanceVisit` calls; the second stamps nothing extra, the first stamps `triageStartedAt` (preserve the `getAppointmentFlow` timestamp). If the visit is already `ready_for_doctor`+, both no-op.

### 3.3 Edge cases to encode as tests
- Redundant trigger (order created twice) → second is a silent no-op, not 409.
- Patient with two open appointments → `resolveActiveVisit` returns null → no advance, primary write still succeeds.
- Walk-in whose appt is still `scheduled` (never checked in) but vitals taken → `triage` invalid `from` → no-op (don't skip check-in).
- Auto-advance must not fire on a `cancelled`/`no_show` visit (excluded by `resolveActiveVisit`).
- Add cases to `appointment-lifecycle.integration-db.test.ts` (real Postgres) asserting fire-once + idempotency + audit row.

### 3.4 Optional hardening (separate, additive migration — NOT required)
Add nullable `appointment_id` to `ultrasound_records` + `invoices` (+ populate from `resolveActiveVisit` at create) so diagnostics/billing rows hard-link to the visit for reporting. Follows the new-clinic-table RLS pattern only if needed (these tables already exist & are tenant-scoped — a plain nullable FK + index is enough). Defer until reporting needs the join.

**Effort:** ~1 day (helper + 5 trigger sites + tests). **Risk:** medium — contained by "non-fatal, idempotent, skip-on-ambiguity." Feature-flag the auto-advance (`AUTO_ADVANCE_FLOW`, default on in dev) so it can be killed without a deploy if a board reacts badly.

---

## 4. Phase 3 — Close the review's open P1s

### 4.1 `reconsult` reversal (doctor resumes after results)
- Add to `TRANSITIONS` (`appointment-state-machine.ts:67`):
```ts
reconsult: {
  from: ["awaiting_diagnostics"],
  to: "in_consultation",
  allowedRoles: ["super_admin", "admin", "doctor"],
},
```
- Add `"reconsult"` to `AppointmentAction` (`:46-55`).
- Route: `POST /appointments/:appointmentId/reconsult` (`routes/appointments.ts`, mirror `:105` diagnostics) → `transitionAppointment(req, id, "reconsult")`.
- OpenAPI: add the path in `lib/api-spec/openapi.yaml`, run codegen; `contract-routes.test.ts` will assert route↔spec parity.
- Do **not** re-stamp `consultationStartedAt` (preserve original consult start for duration metrics) — document that `getAppointmentFlow` consult duration spans the diagnostics detour by design.
- Frontend: "Resume consult" button on the doctor's `awaiting_diagnostics` cards (`DoctorDashboard.tsx` / consult view).

### 4.2 Cross-role real-time (SSE on all transitions)
- Today `emitToUser` fires on only checkin+ready, doctor-only → other boards poll 30s.
- Broadcast a payload-light (**IDs only**, per SSE PHI rule) `appointment.transition` event to the relevant role/clinic on every `transitionAppointment` success. Reuse `runtime.eventBus`; respect `SSE_MAX_*` caps.
- Frontend boards invalidate the appointments query key on receipt (drop the 30s poll).

**Effort:** ~1 day. **Risk:** low; both are additive.

---

## 5. Phase 4 — `arrivedAt` + LWBS (optional)

Review P2: no avg-check-in metric (no distinct `arrivedAt`) and no "left without being seen" state.
- Additive migration: `appointments.arrived_at timestamp null` (follow MIGRATION_NOTES pattern; no RLS change — existing table).
- Stamp `arrivedAt` at front-desk arrival (distinct from `checkedInAt` if you want queue-wait vs admin-wait).
- LWBS: derive (checked_in/in_triage with no progression past a threshold) rather than a new enum value — keeps the machine stable.
- Surface in `getAppointmentFlow`.

**Effort:** ~0.5 day. **Risk:** low. Do only if the metric is actually wanted.

---

## 6. Cross-cutting requirements

- **Audit:** every auto-advance already audits via `transitionAppointment`. No new audit code, but verify the action name (`triage`/`ready`/`diagnostics`/`payment`) is what compliance expects to see for a *system-initiated* transition. Consider an `auto: true` detail flag so the audit distinguishes operator clicks from side-effects.
- **RBAC:** auto-advances run as the acting user (nurse saving vitals, doctor ordering). Their role must satisfy `allowedRoles` for that action — it does today (nurse→triage/ready, doctor→diagnostics, front_desk/nurse/doctor→payment). `super_admin`/`system` bypass. No role widening needed.
- **i18n:** all new UI strings (column headers, "Resume consult", "Awaiting Results") EN+AR; parity test enforces it.
- **Feature flag:** gate Phase 2 behind `AUTO_ADVANCE_FLOW` (helper in `lib/auth-constants.ts` style — never read `process.env` directly). Phase 1 needs no flag (pure labels). Phase 3 reconsult is a new endpoint (inherently opt-in).
- **No new state-machine docs churn in CLAUDE.md** — the enum is unchanged; only add the `reconsult` action to the state diagram comment.

---

## 7. Sequencing, effort, rollback

| Phase | Deliverable | Effort | Schema | Reversible |
|---|---|---|---|---|
| 1 | 6-column labels + `FLOW_COLUMNS` + 4 boards | 0.5d | none | trivially (labels) |
| 2 | `resolveActiveVisit` + `tryAdvanceVisit` + 5 triggers, flagged | 1d | none | flag off |
| 3 | `reconsult` transition+route+SSE broadcast | 1d | none | remove route (additive) |
| 4 | `arrivedAt` + LWBS (optional) | 0.5d | +1 nullable col | additive |

**Recommended order:** 1 → 2 → 3 (→ 4 if wanted). Phase 1 is independently shippable and gives the operator the visible win immediately; Phase 2 is the substantive correctness piece.

**Risk register**
- *Auto-advance fires on wrong visit* → mitigated by `resolveActiveVisit` skip-on-ambiguity + flag.
- *Auto-advance surfaces 409 to staff* → `tryAdvanceVisit` swallows ConflictError.
- *Board flicker from new SSE volume* → IDs-only payload + query-key invalidation, respects SSE caps.
- *Reconsult distorts consult-duration metric* → documented as intentional (spans detour).

---

## 8. Validation (per Task Completion Rule)

```bash
pnpm run typecheck
pnpm --filter @workspace/clinic run test          # i18n EN/AR parity + columnForStatus
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run test:integration-db   # auto-advance idempotency/audit
#   no Docker → $env:INTEGRATION_PG_ADMIN_URL=postgresql://postgres:<pw>@localhost:5432/postgres
pnpm --filter @workspace/api-spec run codegen     # after reconsult openapi edit
```
**Docs to update on completion:** CHANGELOG, HEALTH_STATUS, ROADMAP (mark P1 reconsult + SSE done), MIGRATION_NOTES (only if Phase 4), Obsidian note, CLAUDE.md state-diagram comment (reconsult action only).
