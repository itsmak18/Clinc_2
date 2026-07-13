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

<!-- §10 (department visibility — own line only) lands with the feat/clearance-visibility branch. -->

### 11. Invoice writer serialization (added 2026-07-12)

The 2026-07-12 external audit found two holes in §9's lock coverage, both confirmed in code and reproduced by failing tests before fixing:

- **`cancelInvoice` was not a basket writer.** It flipped the invoice and expired linked orders without taking `lockBasket`, so an order created concurrently landed its charge line after `settleInvoiceOrders` scanned the basket — stranding the order at `clearance_status='pending'` on a *cancelled* invoice until the TTL sweep (a 48h-stuck, unpayable order).
- **Manual invoices had no serialization at all.** The advisory lock is keyed per (clinic, patient) basket, so on `kind='manual'` neither payment path held any lock: two concurrent payments read the same ledger `SUM`, both validated against it, and the append-only ledger exceeded the invoice total.

Rule now enforced in all three invoice writers (`payInvoice`, `recordPayment`, `cancelInvoice`):

1. initial in-tx read is a **plain select** (learns `kind`/`patientId`; never locks);
2. `lockBasket` if `kind='order_basket'`;
3. re-read the invoice **`FOR UPDATE`** (all kinds); every subsequent validation — status, ledger `SUM`, amount checks — runs under that row lock.

Lock order is invariantly **advisory → row**; taking the row lock first would deadlock against a payment holding the advisory lock and waiting on the row. The losing side of a serialized payment race blocks on the row lock, re-reads a ledger that now covers the total, and fails with the documented overpayment `ValidationError` (clean 400) — never a lock timeout or serialization error.

Two deliberate semantics, recorded so they are not re-reported as bugs:

- **Cancel-after-append expires the fresh order.** If an order append serializes *before* a basket cancel, the cancel's expiry scan sees the new line and expires that just-created order — intended: a cancelled bill expires its orders; re-ordering opens a fresh basket. (Appends serializing *after* the cancel land on a new basket.)
- **`payInvoice` settles the outstanding balance, not the face total.** Under the row lock it sums the ledger and records `total − paid` (nothing when the ledger already covers). Previously it stacked the full total on top of any prior partial payment — the ledger exceeded the invoice even without concurrency. `amountReceived` is validated against the outstanding balance accordingly.

## Consequences

- Ordered↔paid↔performed reconciliation becomes structurally possible (every gated order carries `invoice_item_id`); the three-way exception report is Phase D.
- Imaging orders are now cancellable at all (`cancelled` enum value, migration 0041 — previously imaging had no cancel state).
- Invoice numbers now embed the clinic id (`INV-<clinic>-<YYYYMM>-<seq>`) — fixing a latent multi-tenant collision the basket path exposed (global unique `invoice_number` vs per-clinic counters).
- Known deviations recorded: results-text edits (without status change) are not blocked pre-clearance, only workflow progress; doctor self-cancel of own mistaken orders remains staff/admin-gated (Phase D candidate).

## Verification

`clearance-gate.integration-db.test.ts` (6/6 on real Postgres): pending+auto-charge, shared basket across modalities, 3020 guard block → pay (as front_desk) → cleared → progress, front_desk 403 on manual invoices, override happy/short-reason/cross-tenant-404 with invoice-stays-pending, cancel→line-withdrawn→basket auto-cancel, TTL expiry sweep, parallel-create basket uniqueness, imaging `cancelled` writable. `clearance.service.test.ts` (6/6 unit): flag-OFF control-plane refusal + data-plane sweep + override validation. Full backend suite 590/590 unit + integration-db suite green (one pre-existing broken test file fixed en route — see MIGRATION_NOTES).

§11: `billing-concurrency.integration-db.test.ts` (3/3 on real Postgres) — concurrent double payment on a manual invoice (loser must be the clean overpayment 400, ledger == total), payInvoice racing a partial recordPayment (ledger == total in both serialization orders), and a 50-iteration append-vs-cancel loop asserting no order is ever `pending` on a cancelled invoice. **Red-run proof:** all three were first observed failing on the pre-fix code (`[201, 201]` double payment; ledger 160 > 100; stranded x-ray order on iteration 1) before being trusted green.
