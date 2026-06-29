/**
 * Reporting module — public surface (barrel).
 *
 * Owns the clinic-wide dashboard summaries (non-PHI counts, some cache-backed
 * via runtime.cache), per-role dashboards, the reports endpoints (appointments
 * / revenue / diagnostics / operations summaries), and per-doctor analytics.
 * Import the module ONLY through this barrel.
 *
 * Fully self-contained: no cross-module service deps. All three routers authed.
 */
export { default as dashboardRouter } from "./dashboard.routes";
export { default as reportsRouter } from "./reports.routes";
export { default as analyticsRouter } from "./analytics.routes";
