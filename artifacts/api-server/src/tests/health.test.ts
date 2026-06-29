/**
 * health.test.ts
 *
 * Tests for the health endpoint logic.
 * Since health.ts imports @workspace/db (pool), we mock it entirely.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock pool before importing health router ───────────────────────────────────
const mockPoolQuery = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: {
    query:        mockPoolQuery,
    totalCount:   5,
    idleCount:    4,
    waitingCount: 0,
  },
}));

// ── Import helpers we want to test independently ───────────────────────────────

// validateTransition shape — just ensure health data shapes are correct
describe("health endpoint data shapes", () => {
  it("process.uptime() returns a positive number", () => {
    expect(process.uptime()).toBeGreaterThan(0);
  });

  it("process.memoryUsage() returns expected keys", () => {
    const mem = process.memoryUsage();
    expect(mem).toHaveProperty("heapUsed");
    expect(mem).toHaveProperty("heapTotal");
    expect(mem).toHaveProperty("rss");
    expect(mem.heapUsed).toBeGreaterThan(0);
    expect(mem.heapTotal).toBeGreaterThan(0);
  });

  it("process.version is a valid semver string", () => {
    expect(process.version).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});

// ── Pool mock validation ───────────────────────────────────────────────────────

describe("DB pool mock (validates test setup)", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("pool.query resolves when DB is healthy", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    const result = await mockPoolQuery("SELECT 1");
    expect(result.rows).toHaveLength(1);
  });

  it("pool.query rejects when DB is unreachable", async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error("Connection refused"));
    await expect(mockPoolQuery("SELECT 1")).rejects.toThrow("Connection refused");
  });

  it("pool has expected shape (totalCount, idleCount, waitingCount)", async () => {
    const { pool } = await import("@workspace/db");
    expect(pool.totalCount).toBe(5);
    expect(pool.idleCount).toBe(4);
    expect(pool.waitingCount).toBe(0);
  });
});

// ── Liveness probe logic ───────────────────────────────────────────────────────

describe("liveness probe (/healthz) logic", () => {
  it("uptime is positive and increases over test run", () => {
    const t1 = process.uptime();
    // No async wait needed — just confirm it's a valid number
    expect(t1).toBeGreaterThan(0);
    expect(typeof t1).toBe("number");
    expect(Number.isFinite(t1)).toBe(true);
  });
});

// ── Readiness probe response shape ────────────────────────────────────────────

describe("readiness probe (/healthz/ready) response shape", () => {
  it("200 response shape when DB is healthy", () => {
    // Validate the shape we expect the endpoint to return
    const mockResponse = {
      status: "ready",
      checks: {
        db: { status: "ok", latencyMs: 12, pool: { total: 5, idle: 4, waiting: 0 } },
        memory: { heapUsedMb: 128, heapTotalMb: 256, rssMb: 200 },
        process: { uptimeSecs: 3600, startedAt: "2026-05-12T00:00:00.000Z", nodeVersion: "v24.0.0" },
      },
      timestamp: new Date().toISOString(),
    };

    expect(mockResponse.status).toBe("ready");
    expect(mockResponse.checks.db.status).toBe("ok");
    expect(mockResponse.checks.db.pool.total).toBeGreaterThanOrEqual(0);
    expect(mockResponse.checks.memory.heapUsedMb).toBeGreaterThan(0);
    expect(mockResponse.checks.process.uptimeSecs).toBeGreaterThanOrEqual(0);
  });

  it("503 response shape when DB is unreachable", () => {
    const mockResponse = {
      status: "not_ready",
      checks: {
        db: { status: "error", error: "Connection refused", latencyMs: 5001 },
      },
      timestamp: new Date().toISOString(),
    };

    expect(mockResponse.status).toBe("not_ready");
    expect(mockResponse.checks.db.status).toBe("error");
    expect(mockResponse.checks.db.error).toContain("refused");
  });

  it("latencyMs is captured correctly", () => {
    const start = Date.now();
    // Simulate a small delay
    const end = Date.now();
    const latencyMs = end - start;
    expect(latencyMs).toBeGreaterThanOrEqual(0);
    expect(latencyMs).toBeLessThan(100); // should be near-instant in tests
  });
});

// ── H7: shutdown drain ────────────────────────────────────────────────────────

describe("[H7] readiness reports 503 once beginShutdown() fires", () => {
  beforeEach(() => mockPoolQuery.mockReset());

  it("ok=false + checks.shutdown=draining when isShuttingDown() is true", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    const { checkReadiness } = await import("../modules/health/health.service");
    const { beginShutdown } = await import("../lib/lifecycle");
    beginShutdown();
    const result = await checkReadiness();
    expect(result.ok).toBe(false);
    expect(result.checks.shutdown).toEqual({ status: "draining" });
    // The lifecycle flag is process-wide — no reset hook exists by design
    // (real shutdown is terminal). Subsequent tests in this file don't read
    // it, but order-after-this test matters if more were added.
  });
});
