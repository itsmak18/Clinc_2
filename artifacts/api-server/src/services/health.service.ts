import { pool } from "@workspace/db";

export interface HealthChecks {
  db: Record<string, unknown>;
  memory: Record<string, unknown>;
  process: Record<string, unknown>;
}

export interface ReadinessResult {
  ok: boolean;
  checks: HealthChecks;
}

export async function checkReadiness(): Promise<ReadinessResult> {
  const checks: HealthChecks = {} as HealthChecks;
  let ok = true;

  const dbStart = Date.now();
  try {
    await pool.query("SELECT 1");
    checks.db = {
      status: "ok",
      latencyMs: Date.now() - dbStart,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  } catch (err: unknown) {
    ok = false;
    checks.db = {
      status: "error",
      error: err instanceof Error ? err.message : "unknown",
      latencyMs: Date.now() - dbStart,
    };
  }

  const mem = process.memoryUsage();
  checks.memory = {
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    rssMb: Math.round(mem.rss / 1024 / 1024),
  };

  checks.process = {
    uptimeSecs: Math.round(process.uptime()),
    nodeVersion: process.version,
  };

  return { ok, checks };
}
