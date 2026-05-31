import { pool } from "@workspace/db";
import { isShuttingDown } from "../lib/lifecycle";
import { runtime } from "../lib/runtime";

export interface HealthChecks {
  db: Record<string, unknown>;
  redis: Record<string, unknown>;
  memory: Record<string, unknown>;
  process: Record<string, unknown>;
  shutdown?: Record<string, unknown>;
}

export interface ReadinessResult {
  ok: boolean;
  checks: HealthChecks;
}

export async function checkReadiness(): Promise<ReadinessResult> {
  const checks: HealthChecks = {} as HealthChecks;
  let ok = true;

  // H7: report 503 immediately on SIGTERM so the LB drains us before any
  // other shutdown step starts cutting connections.
  if (isShuttingDown()) {
    ok = false;
    checks.shutdown = { status: "draining" };
  }

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

  // Redis SET+GET roundtrip — proves the session/rate-limit/event-bus store
  // is actually reachable, not just that the process started. In memory mode
  // scopeCache is undefined and the check reports store:"memory" / status:"ok"
  // so dev environments without Redis still pass readiness.
  const redisStart = Date.now();
  try {
    if (runtime.scopeCache) {
      await runtime.scopeCache.set("health:ping", "1", "EX", 5);
      const val = await runtime.scopeCache.get("health:ping");
      if (val !== "1") throw new Error("Redis SET/GET mismatch");
      checks.redis = {
        status: "ok",
        latencyMs: Date.now() - redisStart,
        store: "redis",
      };
    } else {
      checks.redis = { status: "ok", store: "memory" };
    }
  } catch (err: unknown) {
    ok = false;
    checks.redis = {
      status: "error",
      error: err instanceof Error ? err.message : "unknown",
      latencyMs: Date.now() - redisStart,
      store: "redis",
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
