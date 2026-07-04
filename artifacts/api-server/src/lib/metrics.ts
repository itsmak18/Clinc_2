import client from "prom-client";
import { timingSafeEqual } from "crypto";
import { pool } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";
import { fingerprintBypassActive } from "./fingerprint-lever";

// Create a Registry
const register = new client.Registry();

// Add standard Node.js metrics (memory, event loop, etc.)
client.collectDefaultMetrics({ register });

// Define custom HTTP metrics
export const httpRequestDurationMicroseconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10], // Buckets for P95 latency
});
register.registerMetric(httpRequestDurationMicroseconds);

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});
register.registerMetric(httpRequestsTotal);

export const auditLogWriteFailuresTotal = new client.Counter({
  name: "audit_log_write_failures_total",
  help: "Audit outbox rows exhausted after max retry attempts — permanent loss",
  labelNames: ["action", "entity_type"],
});
register.registerMetric(auditLogWriteFailuresTotal);

// V-03: a logout whose session-revocation write failed (revocation store outage).
// The local cookie is cleared, but the token stays valid server-side until its TTL
// — a stolen-token window. This is a security-control failure, not a warning: it
// must be visible so an operator can react (drain the store, force-rotate).
export const logoutRevocationFailuresTotal = new client.Counter({
  name: "logout_revocation_failures_total",
  help: "Logout attempts whose token revocation write failed — token remains valid until TTL",
});
register.registerMetric(logoutRevocationFailuresTotal);

export const auditOutboxDepthGauge = new client.Gauge({
  name: "audit_outbox_depth",
  help: "Number of audit events pending drain from the outbox (sampled at each drain tick)",
});
register.registerMetric(auditOutboxDepthGauge);

export const auditIntegrityMismatchTotal = new client.Counter({
  name: "audit_integrity_check_failures_total",
  help: "Count of daily audit-log integrity checks that detected a SHA-256 hash mismatch (possible tampering)",
});
register.registerMetric(auditIntegrityMismatchTotal);

// Phase 3.2 (2026-05-31): audit calls without a logged-in user are routed to a
// system actor instead of being silently dropped. This counter alerts on any
// such routing — most production calls SHOULD have a user; a sustained non-zero
// rate means something is calling logAudit from an unauthenticated path that
// needs investigation.
export const auditSystemActorTotal = new client.Counter({
  name: "audit_system_actor_total",
  help: "Audit events written under the system actor because req.user was absent — investigate the call path",
  labelNames: ["action", "entity_type"],
});
register.registerMetric(auditSystemActorTotal);

// Application cache hit/miss counters (read-path Redis cache)
export const cacheHitTotal = new client.Counter({
  name: "cache_hit_total",
  help: "Read-path cache hits",
  labelNames: ["key_prefix"],
});
register.registerMetric(cacheHitTotal);

export const cacheMissTotal = new client.Counter({
  name: "cache_miss_total",
  help: "Read-path cache misses (fetcher invoked)",
  labelNames: ["key_prefix"],
});
register.registerMetric(cacheMissTotal);

// SSE connection gauge — per-process count of active SSE clients
export const sseConnectionsGauge = new client.Gauge({
  name: "sse_active_connections",
  help: "Number of active SSE connections on this process",
});
register.registerMetric(sseConnectionsGauge);

// Partition headroom gauge — count of future monthly audit_logs partitions.
// Emitted by the monthly data retention cron in cron.ts. Alerts when headroom
// drops below 24 months so an operator can land a follow-up migration before
// the DEFAULT catch-all partition fills with un-prunable data.
export const auditPartitionMonthsRemainingGauge = new client.Gauge({
  name: "audit_partition_months_remaining",
  help: "Number of future monthly audit_logs partitions that exist (current month inclusive)",
});
register.registerMetric(auditPartitionMonthsRemainingGauge);

// Break-glass audit durability metrics (2026-06-27).
// Primary path: synchronous direct insert into audit_logs.
// Fallback path: durable local JSONL sink when primary fails.
export const breakGlassActivationsTotal = new client.Counter({
  name: "break_glass_activations_total",
  help: "Break-glass sessions activated — high rate per user indicates possible insider abuse",
  labelNames: ["user_id", "clinic_id"],
});
register.registerMetric(breakGlassActivationsTotal);

export const breakGlassAuditFallbackTotal = new client.Counter({
  name: "break_glass_audit_fallback_total",
  help: "Break-glass audit events that failed the primary audit_logs insert and were written to the local fallback sink",
  labelNames: ["action"],
});
register.registerMetric(breakGlassAuditFallbackTotal);

export const breakGlassAuditFailuresTotal = new client.Counter({
  name: "break_glass_audit_failures_total",
  help: "Break-glass audit events where BOTH the primary audit_logs insert AND the local fallback sink failed — HIPAA incident: event potentially unrecorded",
  labelNames: ["action"],
});
register.registerMetric(breakGlassAuditFailuresTotal);

export const breakGlassAuditFallbackPendingGauge = new client.Gauge({
  name: "break_glass_audit_fallback_pending",
  help: "Number of break-glass audit events in the local fallback JSONL sink awaiting reconcile into audit_logs",
});
register.registerMetric(breakGlassAuditFallbackPendingGauge);

// General audit-outbox write-failure durability (AUD-SEAM-01, 2026-07-02).
// logAudit()'s hot path inserts into audit_outbox; these track what happens
// when that very first INSERT fails (distinct from a drained-but-exhausted
// row, which is audit_log_write_failures_total above).
export const auditOutboxFallbackTotal = new client.Counter({
  name: "audit_outbox_fallback_total",
  help: "Audit events whose audit_outbox INSERT failed and were written to the local fallback sink",
  labelNames: ["action", "entity_type"],
});
register.registerMetric(auditOutboxFallbackTotal);

export const auditOutboxFallbackWriteFailuresTotal = new client.Counter({
  name: "audit_outbox_fallback_write_failures_total",
  help: "Audit events where BOTH the audit_outbox INSERT and the local fallback sink write failed — event unrecorded (HIPAA incident)",
  labelNames: ["action", "entity_type"],
});
register.registerMetric(auditOutboxFallbackWriteFailuresTotal);

export const auditOutboxFallbackPendingGauge = new client.Gauge({
  name: "audit_outbox_fallback_pending",
  help: "Number of audit events in the local outbox-write fallback sink awaiting reconcile into audit_outbox",
});
register.registerMetric(auditOutboxFallbackPendingGauge);

// Fingerprint-binding emergency lever (AUD-SEC-07 / F13). 1 while
// `FINGERPRINT_BINDING=disabled` is ACTIVELY bypassing fph verification
// (in production this already accounts for the FINGERPRINT_BINDING_EXPIRES_AT
// TTL guard — an expired/absent-TTL lever reads 0 because it isn't honored).
// Set at scrape time in renderMetrics(). Drives the FingerprintBindingDisabled
// alert — any sustained 1 means token-theft protection is off and should page.
export const fingerprintBindingDisabledGauge = new client.Gauge({
  name: "fingerprint_binding_disabled",
  help: "1 when the FINGERPRINT_BINDING=disabled lever is actively bypassing fph verification, else 0",
});
register.registerMetric(fingerprintBindingDisabledGauge);

// Define custom DB metrics
const dbPoolTotal = new client.Gauge({
  name: "db_pool_total_connections",
  help: "Total connections in the database pool",
});
register.registerMetric(dbPoolTotal);

const dbPoolIdle = new client.Gauge({
  name: "db_pool_idle_connections",
  help: "Idle connections in the database pool",
});
register.registerMetric(dbPoolIdle);

const dbPoolWaiting = new client.Gauge({
  name: "db_pool_waiting_clients",
  help: "Clients waiting for a connection from the database pool",
});
register.registerMetric(dbPoolWaiting);

// Middleware to record HTTP metrics
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime();
  res.on("finish", () => {
    const elapsed = process.hrtime(start);
    const durationSec = elapsed[0] + elapsed[1] / 1e9;
    
    // Normalize route to avoid high cardinality (e.g., /api/users/123 -> /api/users/:id)
    const route = req.route ? req.route.path : req.path;
    
    httpRequestDurationMicroseconds
      .labels(req.method, route, res.statusCode.toString())
      .observe(durationSec);
      
    httpRequestsTotal
      .labels(req.method, route, res.statusCode.toString())
      .inc();
  });
  next();
};

/**
 * Render the current metrics snapshot. Framework-agnostic (no Express types)
 * so both the api's Express route and the worker's raw http.Server listener
 * (AUD-OPS-04 — the worker has no Express app) share one code path.
 */
export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  // Update DB pool gauges right before scraping. Each process (api, worker)
  // has its own @workspace/db pool singleton, so this correctly reports
  // whichever process's pool is calling it.
  dbPoolTotal.set(pool.totalCount);
  dbPoolIdle.set(pool.idleCount);
  dbPoolWaiting.set(pool.waitingCount);

  // Reflect the fph bypass lever's *effective* state (TTL-honored) at scrape.
  fingerprintBindingDisabledGauge.set(fingerprintBypassActive() ? 1 : 0);

  return { contentType: register.contentType, body: await register.metrics() };
}

// Endpoint to expose metrics to Prometheus (Express)
export const getMetrics = async (req: Request, res: Response) => {
  const { contentType, body } = await renderMetrics();
  res.set("Content-Type", contentType);
  res.end(body);
};

export interface MetricsAuthResult {
  authorized: boolean;
  /** 404 hides the endpoint's existence when unauthenticated in production
   *  with no token configured; 401 signals "wrong/missing bearer token" when
   *  one IS configured. */
  unauthorizedStatus: 404 | 401;
}

/**
 * Shared Bearer-token check for /metrics scrape auth — used by both the api's
 * Express route (app.ts) and the worker's raw http listener (worker.ts,
 * AUD-OPS-04) so the two auth paths cannot drift.
 *
 * Reads `process.env` directly rather than `config.metricsToken`/`config.isProd`
 * on purpose: `config` is evaluated once at module load, but metrics.test.ts
 * (and any future test) mutates `process.env.METRICS_TOKEN` per-test AFTER
 * that — the same dynamic-read rationale CLAUDE.md documents for the Phase 2
 * `auth-constants.ts` helpers. Fails CLOSED in production when no token is
 * configured (a missing token in prod is a misconfiguration, not "auth
 * disabled"); open in dev/test when no token is configured.
 */
export function checkMetricsAuth(authorizationHeader: string | undefined): MetricsAuthResult {
  const token = process.env.METRICS_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      return { authorized: false, unauthorizedStatus: 404 };
    }
    return { authorized: true, unauthorizedStatus: 401 };
  }
  const a = Buffer.from(authorizationHeader ?? "");
  const b = Buffer.from(`Bearer ${token}`);
  const authorized = a.length === b.length && timingSafeEqual(a, b);
  return { authorized, unauthorizedStatus: 401 };
}
