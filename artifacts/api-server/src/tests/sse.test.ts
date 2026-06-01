import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// â”€â”€ Mocks (hoisted before all imports) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Database mock â€” prevents DATABASE_URL require at module load.
vi.mock("@workspace/db", () => {
  const chainable = () => {
    const handler: ProxyHandler<object> = {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        return () => new Proxy({}, handler);
      },
    };
    return new Proxy({}, handler);
  };
  const __m: any = {
    db: {
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      select: vi.fn(() => chainable()),
      update: vi.fn(() => chainable()),
      delete: vi.fn(() => chainable()),
    },
    auditLogsTable: { id: "id" },
    auditOutboxTable: { id: "id" },
    usersTable: { id: "id" },
    notificationsTable: {},
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    inArray: vi.fn(),
    lt: vi.fn(),
    lte: vi.fn(),
    or: vi.fn(),
    sql: vi.fn(),
  };
  __m.dbUnsafe = __m.db;
  return __m;
});

// Lifecycle mock â€” allows toggling isShuttingDown() per test.
const mockIsShuttingDown = vi.fn(() => false);
vi.mock("../lib/lifecycle", () => ({
  isShuttingDown: () => mockIsShuttingDown(),
  beginShutdown: vi.fn(),
}));

// Auth middleware mock â€” injects a test user so the SSE endpoint's requireAuth
// passes without needing a real JWT.
vi.mock("../middlewares/auth", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req["user"] = { userId: 1, username: "test", role: "nurse" };
    next();
  },
  authGate: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req["user"] = { userId: 1, username: "test", role: "nurse" };
    next();
  },
}));

// Logger mock â€” suppress output during tests.
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// â”€â”€ Imports (after mocks) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { closeAllSSEClients, addSSEClient } from "../lib/sse";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
// Lazy-import the notifications router AFTER mocks are in place.
const { default: notificationsRouter } = await import("../routes/notifications");

// â”€â”€ Minimal mock Response for unit tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function mockRes() {
  const r = {
    written: [] as string[],
    ended: false,
    write(chunk: string) { this.written.push(chunk); },
    end() { this.ended = true; },
  };
  return r as unknown as import("express").Response & { written: string[]; ended: boolean };
}

// Build a minimal Express app that mounts only the notifications router.
function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use("/api", notificationsRouter);
  return app;
}

// â”€â”€ closeAllSSEClients() unit tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("closeAllSSEClients()", () => {
  beforeEach(() => {
    closeAllSSEClients(); // ensure map is empty
  });

  it("returns 0 when no clients are connected", () => {
    expect(closeAllSSEClients()).toBe(0);
  });

  it("sends a reconnect event â€” not the old shutdown event â€” to each client", () => {
    const res1 = mockRes();
    const res2 = mockRes();
    addSSEClient(1, res1);
    addSSEClient(2, res2);

    const count = closeAllSSEClients();
    expect(count).toBe(2);

    for (const res of [res1, res2]) {
      const written = res.written.join("");
      expect(written).toContain("event: reconnect");
      expect(written).not.toContain("event: shutdown");
    }
  });

  it("includes a retry: field in the SSE stream for each client", () => {
    const res = mockRes();
    addSSEClient(10, res);
    closeAllSSEClients();

    const written = res.written.join("");
    expect(written).toMatch(/retry: \d+/);
  });

  it("includes retryAfter in the event data payload", () => {
    const res = mockRes();
    addSSEClient(20, res);
    closeAllSSEClients();

    const written = res.written.join("");
    expect(written).toContain('"retryAfter"');

    // retry: field and data.retryAfter should match.
    const retryFieldMatch = written.match(/retry: (\d+)/);
    const dataMatch = written.match(/"retryAfter":(\d+)/);
    expect(retryFieldMatch).not.toBeNull();
    expect(dataMatch).not.toBeNull();
    expect(retryFieldMatch![1]).toBe(dataMatch![1]);
  });

  it("assigns jitter in the 5 000â€“15 000 ms range", () => {
    const res = mockRes();
    addSSEClient(30, res);
    closeAllSSEClients();

    const retryMs = Number(res.written.join("").match(/retry: (\d+)/)![1]);
    expect(retryMs).toBeGreaterThanOrEqual(5000);
    expect(retryMs).toBeLessThanOrEqual(15000);
  });

  it("assigns different jitter values across connections (probabilistic)", () => {
    const responses: Array<ReturnType<typeof mockRes>> = [];
    for (let i = 0; i < 20; i++) {
      const res = mockRes();
      responses.push(res);
      addSSEClient(i + 100, res);
    }
    closeAllSSEClients();

    const retryValues = new Set(
      responses.map((r) => Number(r.written.join("").match(/retry: (\d+)/)![1])),
    );
    // With 20 clients and a 10 000ms range the probability all values are
    // identical is effectively zero.
    expect(retryValues.size).toBeGreaterThan(1);
  });

  it("calls res.end() for every client", () => {
    const responses = [mockRes(), mockRes(), mockRes()];
    responses.forEach((r, i) => addSSEClient(i + 200, r));
    closeAllSSEClients();
    for (const r of responses) expect(r.ended).toBe(true);
  });

  it("tolerates a connection whose write() throws (already gone)", () => {
    const badRes = mockRes();
    // Override write to throw â€” simulates an already-closed connection.
    (badRes as unknown as { write: () => void }).write = () => {
      throw new Error("connection gone");
    };

    addSSEClient(999, badRes);
    expect(() => closeAllSSEClients()).not.toThrow();
  });

  it("clears the client map so a second call returns 0", () => {
    const res = mockRes();
    addSSEClient(42, res);
    closeAllSSEClients();
    expect(closeAllSSEClients()).toBe(0);
  });
});

// â”€â”€ SSE endpoint drain-guard tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("GET /api/notifications/stream â€” drain guard", () => {
  const testApp = buildTestApp();

  afterEach(() => {
    mockIsShuttingDown.mockReturnValue(false);
  });

  it("returns 503 with Retry-After: 10 when the server is draining", async () => {
    mockIsShuttingDown.mockReturnValue(true);

    const res = await request(testApp)
      .get("/api/notifications/stream")
      .set("Accept", "text/event-stream");

    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("10");
  });

});
