import app from "./app";
import { logger } from "./lib/logger";
import { startCronJobs } from "./cron";
import { runtime } from "./lib/runtime";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startCronJobs();
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string) {
  logger.info({ signal }, `Received ${signal}, starting graceful shutdown`);

  server.close(async (err) => {
    if (err) {
      logger.error({ err }, "Error during HTTP server closure");
    } else {
      logger.info("HTTP server closed");
    }

    try {
      // Dispose the runtime (flushes/closes Redis clients or clears memory stores)
      await runtime.dispose();
      logger.info("Runtime disposed");

      // Drain database connection pool
      const { pool } = await import("@workspace/db");
      await pool.end();
      logger.info("PostgreSQL database pool drained");

      logger.info("Graceful shutdown complete. Exiting process.");
      process.exit(0);
    } catch (shutdownErr) {
      logger.error({ err: shutdownErr }, "Error during dependencies shutdown");
      process.exit(1);
    }
  });

  // Failsafe: force kill if it takes too long (10s)
  setTimeout(() => {
    logger.error("Graceful shutdown timed out after 10s. Forcing exit.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
