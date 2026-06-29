/**
 * Billing module — public surface (barrel).
 *
 * Owns invoicing (incl. the atomic createInvoice transaction + per-clinic
 * invoice counter, SoD/anti-fraud pay gate, reconciliation summary) and the
 * services price catalog. Import the module ONLY through this barrel.
 *
 * Both routers are authenticated. `billing.service` still depends on
 * `appointments.service` (autoAdvanceVisit) cross-module via ../../services/
 * until the clinical module migrates.
 */
export { default as billingRouter } from "./billing.routes";
export { default as servicesCatalogRouter } from "./services-catalog.routes";
