/**
 * Unit tests for lib/metrics.ts's checkMetricsAuth (AUD-OPS-04) — the shared
 * Bearer-token check now used by both the api's Express route (app.ts) and
 * the worker's raw http listener (worker.ts), so the two paths can't drift.
 *
 * Covers all four branches, including "production + no token configured →
 * 404 fail-closed", which existed in app.ts before this extraction but was
 * never actually exercised by metrics.test.ts (which only ever ran with
 * NODE_ENV=test).
 */
import { describe, it, expect, afterEach, vi } from "vitest";

// metrics.ts imports `pool` from @workspace/db at module load; the real
// module throws if DATABASE_URL is unset. checkMetricsAuth never touches
// pool, so a minimal stand-in is enough to satisfy the import.
vi.mock("@workspace/db", () => ({
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

import { checkMetricsAuth } from "../lib/metrics";

describe("checkMetricsAuth", () => {
  afterEach(() => {
    delete process.env.METRICS_TOKEN;
    delete process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  it("no token configured, not production → authorized (dev/test convenience)", () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = "test";
    const result = checkMetricsAuth(undefined);
    expect(result.authorized).toBe(true);
  });

  it("[fail-closed] no token configured, production → unauthorized with 404", () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = "production";
    const result = checkMetricsAuth(undefined);
    expect(result.authorized).toBe(false);
    expect(result.unauthorizedStatus).toBe(404);
  });

  it("token configured, correct bearer header → authorized with 401 as the unauthorized status", () => {
    process.env.METRICS_TOKEN = "secret-abc";
    const result = checkMetricsAuth("Bearer secret-abc");
    expect(result.authorized).toBe(true);
    expect(result.unauthorizedStatus).toBe(401);
  });

  it("token configured, missing Authorization header → unauthorized with 401", () => {
    process.env.METRICS_TOKEN = "secret-abc";
    const result = checkMetricsAuth(undefined);
    expect(result.authorized).toBe(false);
    expect(result.unauthorizedStatus).toBe(401);
  });

  it("token configured, wrong bearer value → unauthorized with 401", () => {
    process.env.METRICS_TOKEN = "secret-abc";
    const result = checkMetricsAuth("Bearer wrong-value");
    expect(result.authorized).toBe(false);
    expect(result.unauthorizedStatus).toBe(401);
  });

  it("token configured, wrong-length bearer value → unauthorized (no length-mismatch throw)", () => {
    process.env.METRICS_TOKEN = "secret-abc";
    const result = checkMetricsAuth("Bearer x");
    expect(result.authorized).toBe(false);
  });
});
