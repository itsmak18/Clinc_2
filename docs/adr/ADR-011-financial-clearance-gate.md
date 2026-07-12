# ADR-011 — Financial Clearance Gate (Phase A)

**Status:** Accepted — implemented 2026-07-05, behind `CLEARANCE_GATE_ENABLED` (default OFF)
**Context owner:** Mike
**Related:** workflow audit 2026-07-04 (business-process review), ADR-008 (app DB role), migrations 0041/0042

## Context

The 2026-07-04 workflow audit confirmed MediCore performed every diagnostic before any payment existed: `lab_tests` / `xray_records` / `ultrasound_records` had no billing linkage, department queues received orders instantly at `requested`, invoices were manual and decoupled, and a visit could complete with nothing ever billed. Consequences: walkout revenue leakage on every diagnostic, no ordered↔paid↔performed reconciliation possible, and consumables spent before payment.

Business rule adopted: **no chargeable diagnostic is performed before financial clearance exists.** Clearance ≠ cash: today it is payment or an audited clinical emergency override; the model leaves room for insurance/deposit/credit sources later (Phase E) without reshaping the schema.

## Decision

### 1. Clearance is an orthogonal financial state, not a workflow state

Order tables gain `clearance_status` (`pending | cleared | overridden | expired`, default `'cleared'`) + `invoice_item_id` FK instead of new values inside the workflow enums. Reasons:

- Clinical workflow (`requested → in_progress → completed`) and financial clearance are independent dimensions; conflating them would double the state space.
- Avoids `ALTER TYPE … ADD VALUE` + default-change coupling inside transactional migrations (see MIGRATION_NOTES 0032/0041 rules).
- Existing UI (StatusBadge, ImagingDashboard first/second/third counts, state machine, analytics) keeps working untouched.
- Default `'cleared'` grandfathers every existing row and makes flag-OFF inserts byte-identical.

### 2. Per-patient basket invoice

`invoices.kind` (`manual | order_basket`). Every order create (flag ON) runs in ONE `runInTenantContext` transaction: insert order (`clearance_status='pending'`) → find-or-create the patient's open basket (`kind='order_basket'`, `status='pending'`) → append an `invoice_items` line priced from `services_catalog` by code (`LAB_DEFAULT` / `XRAY_DEFAULT` / `US_DEFAULT`; **`serviceId` is finally populated**) → link `invoice_item_id`. An order awaiting payment can never exist without its charge.

- **One open basket per patient** — `invoice_open_basket_uq` partial unique index is the DB backstop; creation is serialized by a `pg_advisory_xact_lock` per (clinic, patient) because an ON CONFLICT + re-select approach proved racy under parallel creates in the integration suite.
- One cashier stop settles all pending orders across modalities (the audit's "encounter basket" recommendation).
- Zero/missing catalog price → line charged at 0 + `clearance_zero_price_charge` warn log. Pricing the three codes per clinic is a **mandatory rollout step**; until then the gate is financially toothless by construction, loudly.

### 3. Settlement flips clearance in the same transaction

`payInvoice` and `recordPayment` (when the ledger fully covers) call `settleInvoiceOrders(tx, …)` inside the same tx that marks the invoice paid → linked orders flip `pending → cleared`. An order can never be observed cleared under an unpaid invoice. A refund that drops a paid invoice back to pending does **not** un-clear orders (service may already be underway; disputes use the cancel workflow).

### 4. Who settles: front desk for baskets, billing for everything

`front_desk` may `payInvoice` **order baskets only** (service-enforced kind check). Baskets are system-created with `createdById` = the ordering clinician, so front-desk settling never violates the creator≠payer rule, and the 30s anti-fraud gate still applies. Manual invoices keep the original SoD (front_desk creates / billing_manager+admin settle). This is the desk flow Mike specified: front desk marks the x-ray/lab request paid; the department sees the chip and knows it may process.

### 5. Workflow guard

`updateLabTest` / `updateXray` / `updateUltrasound` reject `in_progress`/`completed` while `clearance_status ∉ {cleared, overridden}` with **409 `CLEARANCE_REQUIRED` (3020)** — replacing the previous blind `.set({status})`. `cancelled` is always allowed; cancelling a pending order withdraws its basket line (`removeOrderCharge`: detach FK → delete line → recompute totals; an emptied basket auto-cancels) and sets clearance `expired`.

### 6. Emergency override

`POST /billing/invoices/:id/clearance-override` — roles `doctor`, `nurse`, `admin` (+super_admin), reason ≥ 30 chars. Flips the basket's pending orders to `overridden`; **the invoice deliberately stays pending** so the debt remains visible. Audited as `EMERGENCY_CLEARANCE_OVERRIDE`; `getBillingReconciliation` returns `overridesOutstanding` (overridden orders whose basket is still unpaid — exact by construction, no date approximation) as the daily admin review/collection surface. UI: override action on the order rows (Lab/XRay/Ultrasound expanders, where the clinician actually is at 2 a.m.) and on Billing basket rows.

### 7. Expiry

Hourly cron (`15 * * * *`) expires orders pending past `CLEARANCE_TTL_HOURS` (default 48), withdraws their lines, auto-cancels emptied baskets, and writes one `SYSTEM_CLEARANCE_EXPIRED` audit **per affected clinic**, attributed to that clinic under the system actor (amended 2026-07-07 — a single cross-tenant summary row landed under `SYSTEM_CLINIC_ID` = clinic 1 and exposed other clinics' order ids to clinic 1's compliance officers).

### 8. Feature flag — control plane vs data plane (amended 2026-07-07)

`CLEARANCE_GATE_ENABLED=false` default. The flag gates the **control plane**: creates write `'cleared'` with no basket, the workflow guard is inert, the override endpoint refuses with 3021 — byte-identical to pre-gate behavior (proven by the entire pre-existing suite running flag-OFF). The **data plane** — settle-on-pay (kind-guarded to baskets) and the expiry sweep — runs unconditionally: it only touches rows that can exist from flag-ON operation, so it is naturally a no-op on flag-OFF deployments, and after a rollback it keeps draining in-flight pending baskets/orders instead of orphaning them.

### 9. Basket concurrency (amended 2026-07-07)

Every basket **writer** — not just creation — serializes on the per-(clinic,patient) advisory lock (`lockBasket`): `appendOrderCharge` (via `findOrCreateBasket`) and both payment paths (`payInvoice`, `recordPayment`), which run fully in-tx and re-read the invoice under the lock before validating amounts and settling. Without this, a charge appended mid-payment was either cleared without the collected cash covering it, or stranded `pending` on an already-paid frozen invoice. Catalog `(clinic_id, code)` is UNIQUE among live rows (migration 0043) so the auto-charge price is deterministic.

### 10. Department visibility — own line only (added 2026-07-12)

The department user (lab/x-ray/ultrasound) must be able to answer "process this request, or send the patient to pay?" at a glance. Order rows therefore carry a `charge: { amountCents } | null` — **the order's own `quantity × unit_price` line and nothing else** (owner decision, 2026-07-11): no invoice totals, basket balance, payment history, or other departments' lines, because the basket aggregates the patient's whole visit and an x-ray tech must not see the patient's wider bill. `GET /billing/invoices*` stays locked to billing/front-desk roles. Per-order payment truth is `clearance_status` itself (settle flips it in the paying tx), so there is deliberately no "partially paid" state in departments — a request is paid or it isn't; partial-payment nuance lives on the Billing page. `charge` is null on pre-gate rows (`invoice_item_id` null), which keeps flag-OFF UI byte-identical with no extra flag. The `clearanceStatus` list filter accepts a comma list (`cleared,overridden` = the "ready to process" queue tab); unknown values 400.

## Consequences

- Ordered↔paid↔performed reconciliation becomes structurally possible (every gated order carries `invoice_item_id`); the three-way exception report is Phase D.
- Imaging orders are now cancellable at all (`cancelled` enum value, migration 0041 — previously imaging had no cancel state).
- Invoice numbers now embed the clinic id (`INV-<clinic>-<YYYYMM>-<seq>`) — fixing a latent multi-tenant collision the basket path exposed (global unique `invoice_number` vs per-clinic counters).
- Known deviations recorded: results-text edits (without status change) are not blocked pre-clearance, only workflow progress; doctor self-cancel of own mistaken orders remains staff/admin-gated (Phase D candidate).

## Verification

`clearance-gate.integration-db.test.ts` (7/7 on real Postgres — the 7th proves §10: own-line-only charge exposure, comma filter, unknown-value 400, department 403 on `/billing/invoices`, partial payment invisible to departments): pending+auto-charge, shared basket across modalities, 3020 guard block → pay (as front_desk) → cleared → progress, front_desk 403 on manual invoices, override happy/short-reason/cross-tenant-404 with invoice-stays-pending, cancel→line-withdrawn→basket auto-cancel, TTL expiry sweep, parallel-create basket uniqueness, imaging `cancelled` writable. `clearance.service.test.ts` (6/6 unit): flag-OFF control-plane refusal + data-plane sweep + override validation. Full backend suite 590/590 unit + integration-db suite green (one pre-existing broken test file fixed en route — see MIGRATION_NOTES).
