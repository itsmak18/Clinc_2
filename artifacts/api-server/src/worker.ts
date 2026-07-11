import { initTracer } from "./lib/tracer";
initTracer(); // Must run before any database or queue handling; noop when OTEL_EXPORTER_OTLP_ENDPOINT unset

import http from "http";
import { logger } from "./lib/logger";
import {
  startCronJobs, stopCronJobs,
  startAuditDrain, stopAuditDrain,
  startBgAuditReconcile, stopBgAuditReconcile,
  startAuditOutboxReconcile, stopAuditOutboxReconcile,
} from "./cron";
import { drainAuditOutbox } from "./lib/audit";
import { reconcileBreakGlassAuditFallback } from "./lib/break-glass-audit";
import { reconcileAuditOutboxFallback } from "./lib/audit-outbox-fallback";
import { checkMetricsAuth, renderMetrics } from "./lib/metrics";
import { config } from "./lib/config";
import { runtime } from "./lib/runtime";

logger.info("Starting background worker process...");

// Start background services
startCronJobs();
startAuditDrain();
startBgAuditReconcile();
startAuditOutboxReconcile();

// AUD-OPS-04: the worker has no Express app (it's a pure setInterval process),
// so Prometheus's "medicore-worker" scrape job (monitoring/prometheus/
// prometheus.yml — worker:5001/metrics) had no listener to hit, permanently
// firing ServiceDown and leaving the worker-only audit-loss/break-glass
// metrics with no scrapeable target. This is a minimal raw http.Server, not a
// second Express app — reuses the exact auth check the api route uses
// (checkMetricsAuth) so the two paths can't drift, and the exact rendering
// logic (renderMetrics) so the output is identical in shape.
const metricsServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "GET" && req.url === "/metrics") {
    const { authorized, unauthorizedStatus } = checkMetricsAuth(req.headers.authorization);
    if (!authorized) { res.writeHead(unauthorizedStatus); res.end(); return; }
    renderMetrics()
      .then(({ contentType, body }) => {
        res.writeHead(200, { "Content-Type": contentType });
        res.end(body);
      })
      .catch((err) => {
        logger.error({ err }, "worker_metrics_render_failed");
        res.writeHead(500);
        res.end();
      });
    return;
  }
  res.writeHead(404);
  res.end();
});
metricsServer.listen(config.workerMetricsPort, () => {
  logger.info({ port: config.workerMetricsPort }, "Worker metrics/healthz listener started");
});

let shutdownInProgress = false;
const isTest = process.env.NODE_ENV === "test";
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? (isTest ? 2000 : 30_000));

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) {
    logger.warn({ signal }, "Shutdown already in progress, ignoring repeated signal");
    return;
  }
  shutdownInProgress = true;

  logger.info({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, `Received ${signal}, starting worker graceful shutdown`);

  // Failsafe timer
  const failsafe = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Graceful worker shutdown timed out. Forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  failsafe.unref();

  try {
    // 1. Stop cron triggers, audit outbox drain, and break-glass audit reconcile
    stopCronJobs();
    stopAuditDrain();
    stopBgAuditReconcile();
    stopAuditOutboxReconcile();
    logger.info("Background intervals and crons stopped");

    // 1b. Close the metrics/healthz listener so Prometheus sees a clean
    // connection-refused (not a hung scrape) during the drain window.
    await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
    logger.info("Worker metrics/healthz listener closed");

    // 2. Dispose of runtime adapters (Redis scope cache, revocation, etc.)
    await runtime.dispose();
    logger.info("Runtime disposed");

    // 3. Final audit outbox flush + break-glass fallback reconcile + audit
    // outbox write-failure fallback reconcile (AUD-SEAM-01) — same reasoning
    // as break-glass: drain whatever accumulated in the last interval window
    // before the pool closes.
    await drainAuditOutbox();
    await reconcileBreakGlassAuditFallback();
    await reconcileAuditOutboxFallback();
    logger.info("Final audit outbox flush and fallback reconciles complete");

    // 4. Drain the database pool
    const { pool } = await import("@workspace/db");
    await pool.end();
    logger.info("PostgreSQL pool drained");

    logger.info("Graceful worker shutdown complete. Exiting.");
    process.exit(0);
  } catch (shutdownErr) {
    logger.error({ err: shutdownErr }, "Error during worker shutdown sequence");
    process.exit(1);
  }
}

process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
process.on("SIGINT",  () => { void gracefulShutdown("SIGINT");  });
