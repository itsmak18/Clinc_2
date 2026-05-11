import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

const startedAt = new Date().toISOString();

/**
 * GET /healthz
 *
 * Lightweight liveness probe — used by Replit and load balancers.
 * Returns 200 immediately without DB probe. Never fails.
 */
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/**
 * GET /healthz/ready
 *
 * Readiness probe — verifies the application can serve real traffic:
 *   - DB connectivity (SELECT 1)
 *   - Connection pool stats
 *   - Process memory
 *
 * Returns 200 if ready, 503 if not (safe for load balancer health checks).
 * Does NOT require authentication — must be reachable before login.
 */
router.get("/healthz/ready", async (_req, res) => {
  const checks: Record<string, unknown> = {};
  let overallOk = true;

  // ── DB connectivity check ───────────────────────────────────────────────────
  const dbStart = Date.now();
  try {
    await pool.query("SELECT 1");
    checks.db = {
      status: "ok",
      latencyMs: Date.now() - dbStart,
      pool: {
        total: pool.totalCount,
        idle:  pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  } catch (err: unknown) {
    overallOk = false;
    checks.db = {
      status: "error",
      error: err instanceof Error ? err.message : "unknown",
      latencyMs: Date.now() - dbStart,
    };
  }

  // ── Process memory ──────────────────────────────────────────────────────────
  const mem = process.memoryUsage();
  checks.memory = {
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    rssMb: Math.round(mem.rss / 1024 / 1024),
  };

  // ── Process info ────────────────────────────────────────────────────────────
  checks.process = {
    uptimeSecs: Math.round(process.uptime()),
    startedAt,
    nodeVersion: process.version,
  };

  const statusCode = overallOk ? 200 : 503;
  res.status(statusCode).json({
    status: overallOk ? "ready" : "not_ready",
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
