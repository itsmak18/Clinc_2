import { initTracer } from "./lib/tracer";
initTracer(); // Must run before any database or queue handling; noop when OTEL_EXPORTER_OTLP_ENDPOINT unset

import { logger } from "./lib/logger";
import { startCronJobs, stopCronJobs, startAuditDrain, stopAuditDrain } from "./cron";
import { drainAuditOutbox } from "./lib/audit";
import { runtime } from "./lib/runtime";

logger.info("Starting background worker process...");

// Start background services
startCronJobs();
startAuditDrain();

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
    // 1. Stop cron triggers and the audit outbox drain interval
    stopCronJobs();
    stopAuditDrain();
    logger.info("Background intervals and crons stopped");

    // 2. Dispose of runtime adapters (Redis scope cache, revocation, etc.)
    await runtime.dispose();
    logger.info("Runtime disposed");

    // 3. Final audit outbox flush — ensure no lingering outbox items remain
    await drainAuditOutbox();
    logger.info("Final audit outbox flush complete");

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
