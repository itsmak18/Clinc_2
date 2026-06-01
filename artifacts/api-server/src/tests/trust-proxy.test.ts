/**
 * trust-proxy.test.ts
 *
 * Regression guard for Express `trust proxy` configuration.
 *
 * MediCore sits behind Caddy on the docker `frontend` bridge network. Caddy
 * forwards the real client IP via X-Forwarded-For. Without `trust proxy` set,
 * Express resolves `req.ip` to the upstream container IP and every rate-limit
 * bucket / login-shield key / audit IP field collapses to one identity â€” the
 * proxy's. The fix is `app.set("trust proxy", "loopback, linklocal, uniquelocal")`
 * in `src/app.ts`. This file pins that decision in place.
 *
 * What this test asserts:
 *   - The setting is configured (not the default `false`).
 *   - Loopback addresses are trusted (proxy + api on same host).
 *   - Unique-local docker bridge addresses are trusted (10/8, 172.16/12, 192.168/16).
 *   - Public-internet addresses are NOT trusted â€” a malicious client cannot
 *     spoof X-Forwarded-For and have it honored.
 */

import { describe, it, expect, vi } from "vitest";

// â”€â”€ DB mock (hoisted before app import) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Routes import @workspace/db which throws if DATABASE_URL is unset. Same
// pattern as auth-flow.integration.test.ts â€” this suite only inspects the
// trust-proxy setting on the Express app, so a minimal proxy mock is enough.
vi.mock("@workspace/db", () => {
  const chainable = () => {
    const obj: Record<string, unknown> = {};
    const handler: ProxyHandler<object> = {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        return () => new Proxy({}, handler);
      },
    };
    return new Proxy(obj, handler);
  };
  const __m: any = {
    db: {
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      select: vi.fn(() => chainable()),
      update: vi.fn(() => chainable()),
      delete: vi.fn(() => chainable()),
    },
    usersTable: {},
    auditLogsTable: {},
    auditOutboxTable: {},
    eq: vi.fn(),
    isNull: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
    sql: vi.fn(),
  };
  __m.dbUnsafe = __m.db;
  return __m;
});

// Import app AFTER the mock is registered (vitest hoists vi.mock above this).
import app from "../app";

type TrustProxyFn = (addr: string, hop: number) => boolean;

describe("Express trust proxy â€” regression guard", () => {
  it("is configured (not the default false)", () => {
    expect(app.get("trust proxy")).not.toBe(false);
    expect(app.get("trust proxy")).not.toBeUndefined();
  });

  it("trusts loopback addresses", () => {
    const fn = app.get("trust proxy fn") as TrustProxyFn;
    expect(typeof fn).toBe("function");
    expect(fn("127.0.0.1", 0)).toBe(true);
    expect(fn("::1", 0)).toBe(true);
  });

  it("trusts unique-local IPv4 addresses (docker bridge networks)", () => {
    const fn = app.get("trust proxy fn") as TrustProxyFn;
    expect(fn("10.0.0.5", 0)).toBe(true);
    expect(fn("172.17.0.5", 0)).toBe(true);
    expect(fn("192.168.1.5", 0)).toBe(true);
  });

  it("does NOT trust public-internet IPv4 addresses", () => {
    const fn = app.get("trust proxy fn") as TrustProxyFn;
    expect(fn("8.8.8.8", 0)).toBe(false);
    expect(fn("203.0.113.42", 0)).toBe(false);
    expect(fn("1.1.1.1", 0)).toBe(false);
  });

  it("does NOT trust public-internet IPv6 addresses", () => {
    const fn = app.get("trust proxy fn") as TrustProxyFn;
    expect(fn("2001:4860:4860::8888", 0)).toBe(false);
  });
});
