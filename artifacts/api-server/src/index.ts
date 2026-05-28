import app from "./app";
import { logger } from "./lib/logger";
import { startCronJobs, stopCronJobs, startAuditDrain, stopAuditDrain } from "./cron";
import { drainAuditOutbox } from "./lib/audit";
import { runtime } from "./lib/runtime";
import { beginShutdown } from "./lib/lifecycle";
import { closeAllSSEClients } from "./lib/sse";

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
  startAuditDrain();
});

// ── Graceful Shutdown (H7) ────────────────────────────────────────────────────
// Sequence — every step is bounded by SHUTDOWN_TIMEOUT_MS as a backstop.
//
//   1. beginShutdown()       — flip the readiness flag so /healthz/ready 503s
//                              AND new SSE connections return 503.
//   2. stopCronJobs()        — prevent new cron writes against a closing pool.
//   2b. stopAuditDrain()     — stop the 5-second drain interval.
//   3. drainGracePeriodMs    — wait so Caddy / LB sees the 503 before we cut
//                              connections (default 3s in prod, 50ms in test).
//   4. SSE_DRAIN_MS hold     — keep existing SSE connections alive while new
//                              connections are already blocked; gives clients
//                              time to be served by a new pod (default 10s).
//   5. closeAllSSEClients()  — send per-connection jittered reconnect event
//                              (retry: 5–15s) and end every long-lived SSE
//                              response so server.close() can actually finish.
//   6. server.close()        — refuse new HTTP, wait for in-flight to finish.
//   7. runtime.dispose()     — Redis client, scope cache, revocation store.
//   7b. drainAuditOutbox()   — final pass to flush any rows written during the
//                              drain window, before the pool closes.
//   8. pool.end()            — drain Postgres pool (must run AFTER cron stops
//                              and HTTP drains, or in-flight queries break).
//   9. process.exit(0).
//
// SHUTDOWN_TIMEOUT_MS (default 30_000) force-kills if any step hangs. Raised
// from 25 000 to cover SSE_DRAIN_MS (10 s) + DRAIN_GRACE_MS (3 s) + headroom.
// docker-compose stop_grace_period must be > SHUTDOWN_TIMEOUT_MS — set to 35s.
// The failsafe is .unref()'d so it doesn't itself keep the loop alive.

const isTest = process.env.NODE_ENV === "test";
// Default raised from 25 000 to 30 000 to accommodate SSE_DRAIN_MS (10 s) on
// top of DRAIN_GRACE_MS (3 s). Total expected path: ~15 s; 30 s is comfortable.
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? (isTest ? 2000 : 30_000));
const DRAIN_GRACE_MS = Number(process.env.SHUTDOWN_DRAIN_GRACE_MS ?? (isTest ? 50 : 3000));
// How long to hold existing SSE connections open after beginShutdown() before
// sending the reconnect event. During this window new SSE connections get 503.
// Set to 0 in tests so the shutdown sequence completes instantly.
const SSE_DRAIN_MS = Number(process.env.SSE_DRAIN_MS ?? (isTest ? 0 : 10_000));

let shutdownInProgress = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) {
    logger.warn({ signal }, "Shutdown already in progress, ignoring repeated signal");
    return;
  }
  shutdownInProgress = true;

  logger.info({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, `Received ${signal}, starting graceful shutdown`);

  // Failsafe — runs in parallel; whichever fires first wins.
  const failsafe = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  failsafe.unref();

  try {
    // 1. Readiness flag → /healthz/ready starts returning 503.
    beginShutdown();
    logger.info("Shutdown flag set — /healthz/ready will now report draining");

    // 2. Stop scheduled work BEFORE draining the pool.
    stopCronJobs();
    stopAuditDrain();

    // 3. Brief grace so the edge proxy sees the 503 and stops sending new
    //    traffic before we start cutting connections.
    if (DRAIN_GRACE_MS > 0) {
      await new Promise<void>((r) => setTimeout(r, DRAIN_GRACE_MS).unref());
    }

    // 4. Hold existing SSE connections while new ones are already blocked.
    //    This gives connected clients a chance to migrate to a new pod before
    //    we send the jittered reconnect and close their connections.
    if (SSE_DRAIN_MS > 0) {
      await new Promise<void>((r) => setTimeout(r, SSE_DRAIN_MS).unref());
    }

    // 5. Close SSE — sends a per-connection jittered reconnect event (5–15s)
    //    so clients spread their reconnects instead of all hitting at once.
    const closedSse = closeAllSSEClients();
    if (closedSse > 0) logger.info({ closedSse }, "SSE clients drained");

    // 6. Stop accepting new HTTP, wait for in-flight requests to finish.
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          logger.error({ err }, "Error during HTTP server closure");
          reject(err);
        } else {
          logger.info("HTTP server closed");
          resolve();
        }
      });
    });

    // 7. Runtime adapters (Redis, scope cache, revocation, rate-limit store).
    await runtime.dispose();
    logger.info("Runtime disposed");

    // 7b. Final audit outbox flush — drain any rows queued during the shutdown
    //     window before the pool closes.
    await drainAuditOutbox();
    logger.info("Audit outbox flushed");

    // 7. Postgres pool — must come AFTER cron stops + HTTP drains.
    const { pool } = await import("@workspace/db");
    await pool.end();
    logger.info("PostgreSQL pool drained");

    logger.info("Graceful shutdown complete. Exiting process.");
    process.exit(0);
  } catch (shutdownErr) {
    logger.error({ err: shutdownErr }, "Error during shutdown sequence");
    process.exit(1);
  }
}

process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
process.on("SIGINT",  () => { void gracefulShutdown("SIGINT");  });
