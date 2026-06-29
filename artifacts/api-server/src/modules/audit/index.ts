/**
 * Audit module — public surface (barrel).
 *
 * Owns the audit-log READ side (GET /audit-logs, per-entity change history, CSV
 * export) and CSP-report ingestion + retention purge. Note: the audit WRITE path
 * (logAudit → audit_outbox → drain) lives in lib/audit.ts as a platform concern,
 * NOT here — this module is the query/ingest surface only.
 *
 * cron.ts calls csp-report.service.purgeOldCspReports (retention) directly.
 * `auditRouter` is authed; `cspReportRouter` is anonymous (public report sink).
 */
export { default as auditRouter } from "./audit.routes";
export { default as cspReportRouter } from "./csp-report.routes";
