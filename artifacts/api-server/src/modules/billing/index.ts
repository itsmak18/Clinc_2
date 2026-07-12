/**
 * Billing module — public surface (barrel).
 *
 * Owns invoicing (incl. the atomic createInvoice transaction + per-clinic
 * invoice counter, SoD/anti-fraud pay gate, reconciliation summary) and the
 * services price catalog. Import the module ONLY through this barrel.
 *
 * Both routers are authenticated. `billing.service` depends on `autoAdvanceVisit`
 * cross-module, imported via the clinical module's barrel (`../clinical`), not a
 * deep `../clinical/appointments.service` path (2026-07-02 architecture audit, F4).
 */
export { default as billingRouter } from "./billing.routes";
export { default as servicesCatalogRouter } from "./services-catalog.routes";
export { default as paymentsRouter } from "./payments.routes";

// Financial clearance gate (Phase A, ADR-011). The clinical/imaging order
// services call these inside their create/cancel transactions; cron.ts runs
// the expiry sweep. All are hoisted function declarations, so the
// clinical ⇄ billing barrel cycle this creates resolves safely under ESM
// live bindings (same class of cycle as billing.service → clinical's
// autoAdvanceVisit, now bidirectional).
// Only what outside-module consumers actually import lives here; same-module
// siblings (billing.service, payments.service, billing.routes) and the tests
// import ./clearance.service directly.
export {
  isClearanceGateEnabled,
  appendOrderCharge,
  removeOrderCharge,
  clearanceBlocksProgress,
  parseClearanceStatusFilter,
  orderChargeFromLine,
  expirePendingClearances,
} from "./clearance.service";
