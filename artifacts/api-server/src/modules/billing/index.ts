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
