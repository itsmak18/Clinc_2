import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";

// ── DB mock (hoisted before app import) ──────────────────────────────────────
// app → routes → services all import @workspace/db; module throws at load time
// if DATABASE_URL is unset. This suite only exercises the /metrics endpoint, so
// a full thenable-proxy mock is sufficient.
vi.mock("@workspace/db", () => {
  const chainable = () => {
    const handler: ProxyHandler<unknown[]> = {
      get: (_t, prop) => {
        if (prop === "then") {
          return (resolve: (v: unknown[]) => void) => resolve([]);
        }
        if (prop === "catch") return () => chainable();
        return () => new Proxy([] as unknown[], handler);
      },
    };
    return new Proxy([] as unknown[], handler);
  };
  return {
    pool: { totalCount: 5, idleCount: 3, waitingCount: 0 },
    db: {
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      select: vi.fn(() => chainable()),
      update: vi.fn(() => chainable()),
      delete: vi.fn(() => chainable()),
      execute: vi.fn().mockResolvedValue([{ nextval: "1" }]),
    },
    usersTable: {},
    auditLogsTable: {},
    auditOutboxTable: {},
    passwordResetTokensTable: {},
    userDevicesTable: {},
    deviceVerificationTokensTable: {},
    cspReportsTable: {},
    eq: vi.fn(),
    isNull: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
    gt: vi.fn(),
    lt: vi.fn(),
    sql: vi.fn(),
    desc: vi.fn(),
    or: vi.fn(),
  };
});

import app from "../app";

describe("GET /metrics — bearer-token protection", () => {
  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it("returns 200 with Prometheus text format when METRICS_TOKEN is unset (dev mode)", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
  });

  it("returns 401 when METRICS_TOKEN is set and no Authorization header is provided", async () => {
    process.env.METRICS_TOKEN = "test-secret-abc";
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(401);
  });

  it("returns 401 when METRICS_TOKEN is set and a wrong bearer token is provided", async () => {
    process.env.METRICS_TOKEN = "test-secret-abc";
    const res = await request(app).get("/metrics").set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("returns 200 when the correct bearer token is provided", async () => {
    process.env.METRICS_TOKEN = "test-secret-abc";
    const res = await request(app).get("/metrics").set("Authorization", "Bearer test-secret-abc");
    expect(res.status).toBe(200);
  });
});

describe("GET /metrics — custom metric names present in output", () => {
  it("includes audit_log_write_failures_total (HIPAA audit loss counter)", async () => {
    const res = await request(app).get("/metrics");
    expect(res.text).toContain("audit_log_write_failures_total");
  });

  it("includes audit_outbox_depth (outbox backlog gauge)", async () => {
    const res = await request(app).get("/metrics");
    expect(res.text).toContain("audit_outbox_depth");
  });

  it("includes db_pool_total_connections (pool utilisation gauge)", async () => {
    const res = await request(app).get("/metrics");
    expect(res.text).toContain("db_pool_total_connections");
  });

  it("includes http_requests_total (request throughput counter)", async () => {
    const res = await request(app).get("/metrics");
    expect(res.text).toContain("http_requests_total");
  });

  it("includes http_request_duration_seconds (latency histogram)", async () => {
    const res = await request(app).get("/metrics");
    expect(res.text).toContain("http_request_duration_seconds");
  });
});
