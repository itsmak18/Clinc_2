# Department Payment-Visibility Plan — "process it or send them to pay"

> **Status:** IMPLEMENTED 2026-07-12 (steps 1–8; Phase 2 SSE deliberately deferred). Recorded as ADR-011 §10; details in CHANGELOG 2026-07-12.
> Extends ADR-011 (financial clearance gate, Phase A — merged).
> **Problem owner:** the X-ray / ultrasound / lab technician looking at their queue.

---

## 1. The gap

Phase A **enforces** clearance (progressing an unpaid order → 409 `CLEARANCE_REQUIRED`) but only half-**shows** it:

| What the tech needs to know | Today |
|---|---|
| "Payment done — process this request" | **Invisible.** `ClearanceChip` renders *nothing* when `cleared` (deliberate quiet-happy-path). The tech gets no positive confirmation; absence of a warning is not a receipt. |
| "Not paid — send patient to front desk" | Partial. Amber "Awaiting payment" chip exists, but shows **no amount**. The tech can't tell the patient what *this request* costs. |
| "Overridden — process now, money still owed" | Chip exists ("Emergency override") but shows no amount for the request. |
| Price of the request | **Impossible for department roles.** `GET /billing/invoices*` is locked to `super_admin/admin/front_desk/billing_manager`. `lab_staff`/`xray_staff`/doctor/nurse cannot read any invoice. |

Ground truth already in place (verified in code, 2026-07-11):
- Order list/detail queries already LEFT-JOIN `invoice_items` and return `invoiceItemId` + `invoiceId` per row (`lab.service.ts:54-58`, xray/ultrasound mirror it).
- `payments` is an append-only integer-cents ledger with `payments_invoice_idx`; invoice `paid` is derived from `SUM(amount_cents) >= total`. Balance is computable in one aggregate.
- `clearanceStatus` list-filter query param exists on all three list endpoints (single value).
- Nothing in ROADMAP Phases B–E, `PATIENT_FLOW_6STATE_UX_PLAN`, or `IMPROVEMENT_PLAN_2026-07-08` covers this — no pre-existing plan.

## 2. Design decisions

**D1 — Line-scoped disclosure: the department user sees the payment state and price of *their own request only* — nothing else (Mike, 2026-07-11).**
No invoice totals, no basket balance, no other departments' lines, no partial-payment detail. A basket invoice aggregates the patient's whole visit (lab + imaging + future consult lines); exposing `totalCents/paidCents/balanceCents` to an X-ray tech would reveal the patient's entire bill across departments. Instead each order row carries only **its own line price** (`invoice_items.quantity × unit_price` for the row's `invoiceItemId`) — data that describes the request the department already owns. Opening `GET /billing/invoices/:id` to clinical roles is rejected for the same reason (whole billing history). SoD stays intact: departments *see their line*, only front-desk/billing see and settle the basket.

Consequences:
- **No "partially paid" state in departments.** Payment completeness is per-*invoice* (`SUM(payments) >= total`) and settle is atomic per basket — from the department's seat a request is simply paid (`cleared`) or not (`pending`). Partial-payment nuance stays on the Billing page where it belongs.
- **Per-order payment truth is already `clearance_status`** (settle flips it in the same tx as the payment; expiry/cancel map to `expired`). No invoices/payments join needed at all — only widen the existing `invoice_items` join by two columns.

**D2 — `invoiceItemId IS NOT NULL` is the "gate-managed row" discriminator.**
Grandfathered/flag-OFF rows are `cleared` with `invoiceItemId = NULL` — they have no invoice, chip stays silent, and **flag-OFF UI is byte-identical** (no new feature flag needed; the visibility rides only on rows the gate created).

**D3 — Positive PAID state.**
`cleared` + `invoiceItemId != null` → green check chip **"Paid"**. This is the tech's go-signal. (The 409 guard remains the enforcement; the chip is honest because settle flips clearance in the same tx as payment.)

## 3. Implementation steps

### Step 1 — Backend: own-line charge on order rows
In `lab.service.ts` / `xray.service.ts` / `ultrasound.service.ts` (list + getById), the queries already LEFT-JOIN `invoice_items` for `invoiceItemId`/`invoiceId` — additionally select `quantity` + `unitPrice` from the *same joined row* and emit:

```ts
charge: null | { amountCents: number } // this order's own line: quantity × unit_price
```

Nothing from `invoices` or `payments` is read or exposed (D1). `unit_price` (numeric 10,2 string) → cents via `lib/money.ts`. All inside the existing `runInTenantContext`; no new routes, no role changes, no extra join.

### Step 2 — Multi-value clearance filter
Extend the `clearanceStatus` query param to accept a comma list (`cleared,overridden`), validated as an enum array (validate-don't-transform), `inArray()` in the service. Needed for the "Ready to process" tab (cleared + overridden together) under cursor pagination — client-side filtering would break page sizes.

### Step 3 — OpenAPI + codegen
`OrderCharge` schema (nullable, `{ amountCents }`) added to LabTest/XrayRecord/UltrasoundRecord; `clearanceStatus` param → array style form. `pnpm --filter @workspace/api-spec run codegen`. Never hand-edit generated dirs.

### Step 4 — `ClearanceChip` v2
Props gain `charge`. States (amount = this request's own price, formatted 2dp, both locales):
- `cleared` + charge → **green** ✓ "Paid — {amount}" — the tech's go-signal.
- `pending` → **amber** 🔒 "Awaiting payment — {amount}" (tooltip: "collect at front desk").
- `overridden` → **blue** shield "Emergency override — {amount} owed" (process now; debt tracked via `overridesOutstanding` on reconciliation).
- `expired` → unchanged rose chip.
- No `charge` (pre-gate row) → render nothing (unchanged).

### Step 5 — Queue tabs on Lab / XRay / Ultrasound pages
Filter chips above the table: **All** · **Ready to process** (`cleared,overridden`) · **Awaiting payment** (`pending`). Uses the Step-2 param; default **All** (no surprise row-hiding — enforcement is the guard, not the view).

### Step 6 — i18n (EN + AR, parity CI)
`paidAmount`, `awaitingPaymentAmount`, `overrideAmountOwed`, `collectAtFrontDesk`, `readyToProcess` (+ reuse existing clearance keys).

### Step 7 — Tests
- Unit: chip state matrix (5 states incl. pre-gate null).
- Integration-db: order row's `charge.amountCents` equals its own line only (a second order on the same basket must NOT change it — the D1 assertion); partial payment leaves order `pending` and `charge` unchanged; settling payment → order `cleared`; multi-value filter returns cleared+overridden only; cross-tenant join leak check.
- RBAC regression: `lab_staff` on `GET /billing/invoices` still 403 (proves D1 didn't widen the API).

### Step 8 — Docs (Task Completion Rule)
ADR-011 amendment §10 "Department visibility model" (D1–D3 + SoD note), CHANGELOG, CLAUDE.md clearance table row, this plan marked implemented.

### Phase 2 (optional, later) — push, not just pull
On `settleInvoiceOrders` success inside `payInvoice`/`recordPayment`, emit an SSE notification per affected modality ("Payment received — 2 X-ray orders ready"). Existing notifications/SSE infra; makes the queue update *announce itself* instead of waiting for a refresh. Skip until the pull version proves insufficient.

## 4. Non-goals
- No payment collection in department pages (SoD).
- No invoice totals, basket balance, payment history, or other departments' lines for clinical roles — **own-line price + own clearance state only** (D1, Mike's explicit constraint).
- No "partially paid" state outside the Billing page.
- No new feature flag (D2 makes it inert while `CLEARANCE_GATE_ENABLED` is off).

## 5. Effort
~¾ day (steps 1–5; no payments aggregation) + ~½ day tests/docs. Phase 2 SSE: +½ day. Sequencing: fine before or after improvement-plan Phase 2/3; if delayed past Phase 4, the billing/imaging feature moves will relocate these files — do it first to avoid double churn.
