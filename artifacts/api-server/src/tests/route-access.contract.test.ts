/**
 * route-access.contract.test.ts
 *
 * Cross-tier authorization drift guard.
 *
 * The frontend declares per-page role visibility in `artifacts/clinic/src/lib/route-access.ts`
 * via the `navItems` array. The backend enforces per-route role lists via
 * `requireRole(...)` / `authGate(scope, [roles])`. These are maintained
 * independently â€” there is no codegen between them.
 *
 * Drift symptom #1 (what this test catches):
 *   Frontend exposes a nav link to role X, but backend denies role X on the
 *   primary endpoint that page loads. User clicks the link, gets 403. Real
 *   UX bug, real authz bug.
 *
 * Drift symptom #2 (this test does NOT flag):
 *   Backend allows roles BEYOND what the frontend nav lists. Common for
 *   utility endpoints (e.g. GET /users is called from Appointments.tsx,
 *   XRay.tsx, etc. â€” many roles legitimately call it even though only
 *   super_admin/admin see the /users nav link). Flagging this direction
 *   produces false positives; leave it out.
 *
 * How it works:
 *   1. Reads `lib/route-access.ts` as text and extracts `(href, roles[])`
 *      tuples from `navItems`.
 *   2. For each entry in CONTRACTS below, looks up the frontend roles for
 *      that page.
 *   3. For each role in that list, signs a JWT and hits the backend endpoint
 *      via supertest. Asserts status !== 403.
 *
 * The DB is mocked (mirrors auth-flow.integration.test.ts) â€” the response
 * status from list endpoints may be 200/500/etc., but the AUTH boundary
 * decision is what we care about. 403 specifically means `requireRole` /
 * `authGate` denied; anything else means authz passed.
 *
 * Adding a new page-to-endpoint mapping: append to CONTRACTS. Removing a
 * page: remove from CONTRACTS and ensure the nav entry is gone from
 * route-access.ts.
 *
 * Pages without a single canonical GET endpoint (action pages like /checkin,
 * /vitals, doctor sub-routes /today /consult /orders /inbox, dashboards,
 * reports, settings, /triage) are not in CONTRACTS. Those pages compose
 * multiple endpoints â€” drift in those would surface in any subsequent
 * page-level test.
 */

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

// â”€â”€ DB mock (hoisted before app import) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Same pattern as auth-flow.integration.test.ts â€” routes import @workspace/db
// which throws if DATABASE_URL is unset. The proxy lets `db.select()...limit(n)`
// chain return *something* without crashing at import time. List endpoints
// may 500 at runtime when they try to iterate the proxy â€” that's fine: we are
// only asserting NOT 403.
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
  const mockDb = {
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    select: vi.fn(() => chainable()),
    update: vi.fn(() => chainable()),
    delete: vi.fn(() => chainable()),
    execute: vi.fn().mockResolvedValue([]),
  };
  const __m: any = {
    db: mockDb,
    runInTenantContext: vi.fn().mockImplementation((user, fn) => fn(mockDb)),
    patientsTable: {}, appointmentsTable: {}, medicalRecordsTable: {},
    prescriptionsTable: {}, xrayRecordsTable: {}, ultrasoundRecordsTable: {},
    labTestsTable: {}, invoicesTable: {}, invoiceItemsTable: {},
    operationsTable: {}, inventoryTable: {}, notificationsTable: {},
    auditLogsTable: {}, auditOutboxTable: {}, usersTable: {}, clinicsTable: {},
    doctorSchedulesTable: {}, scheduleOverridesTable: {}, servicesCatalogTable: {},
    patientConsentsTable: {}, breakGlassSessionsTable: {}, erasureRequestsTable: {},
    userDevicesTable: {}, deviceVerificationTokensTable: {}, cspReportsTable: {},
    passwordResetTokensTable: {}, loginAttemptsTable: {},
    eq: vi.fn(), isNull: vi.fn(), and: vi.fn(), inArray: vi.fn(), ilike: vi.fn(),
    or: vi.fn(), desc: vi.fn(), asc: vi.fn(), lt: vi.fn(), gt: vi.fn(),
    gte: vi.fn(), lte: vi.fn(), sql: vi.fn(), count: vi.fn(),
  };
  __m.dbUnsafe = __m.db;
  return __m;
});

// Import app AFTER the mock is registered.
import app from "../app";
import { signToken } from "../lib/auth";

// â”€â”€ Frontend nav parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ROUTE_ACCESS_PATH = path.join(REPO_ROOT, "artifacts/clinic/src/lib/route-access.ts");

type FrontendRoles = Map<string, string[] | null>; // null = no roles = all roles allowed

function parseNavItems(): FrontendRoles {
  const src = fs.readFileSync(ROUTE_ACCESS_PATH, "utf8");
  // Limit parse window to the navItems array body to avoid false matches in
  // other helpers (canAccessRoute, getLandingRoute, navPinnedByRole).
  const start = src.indexOf("export const navItems");
  const end = src.indexOf("export function getLandingRoute");
  if (start < 0 || end < 0) {
    throw new Error("route-access.ts: could not locate navItems block");
  }
  const body = src.slice(start, end);

  // Match each `{ ... }` literal (no nested braces inside navItems entries).
  // Capture `href` value; presence of `roles: [...]` is detected separately.
  const map: FrontendRoles = new Map();
  const ENTRY_RE = /\{[^{}]*?\bhref:\s*"([^"]+)"[^{}]*?\}/g;
  const ROLES_RE = /\broles:\s*\[\s*([^\]]+)\s*\]/;

  for (const m of body.matchAll(ENTRY_RE)) {
    const [block, href] = m;
    const rolesMatch = block.match(ROLES_RE);
    if (!rolesMatch) {
      map.set(href, null);
    } else {
      const roles = rolesMatch[1]
        .split(",")
        .map(s => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      map.set(href, roles);
    }
  }
  return map;
}

// â”€â”€ Contracts: frontend page href â†’ backend primary GET endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Each entry pins which backend endpoint a page hits on first load. The roles
// the frontend allows for the page MUST not get 403 from that endpoint.
//
// Endpoints with no single primary list (dashboards, reports, action pages)
// are not in this table.

const CONTRACTS: Array<{ page: string; endpoint: string }> = [
  { page: "/patients",        endpoint: "/api/patients" },
  { page: "/appointments",    endpoint: "/api/appointments" },
  { page: "/medical-records", endpoint: "/api/medical-records" },
  { page: "/prescriptions",   endpoint: "/api/prescriptions" },
  { page: "/xray",            endpoint: "/api/xray" },
  { page: "/ultrasound",      endpoint: "/api/ultrasound" },
  { page: "/lab",             endpoint: "/api/lab/tests" },
  { page: "/billing",         endpoint: "/api/billing/invoices" },
  { page: "/operations",      endpoint: "/api/operations" },
  { page: "/inventory",       endpoint: "/api/inventory" },
  { page: "/audit",           endpoint: "/api/audit-logs" },
  { page: "/users",           endpoint: "/api/users" },
];

// â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("Route access drift â€” frontend roles must reach backend without 403", () => {
  const frontendRoles = parseNavItems();

  for (const { page, endpoint } of CONTRACTS) {
    const roles = frontendRoles.get(page);

    describe(`${page} -> ${endpoint}`, () => {
      it("frontend declares this page in navItems", () => {
        expect(
          frontendRoles.has(page),
          `route-access.ts: no navItems entry for href ${page}`,
        ).toBe(true);
      });

      if (!roles) {
        // No roles declared on frontend = all roles can see it. Backend should
        // also allow at least the common roles; we sanity-check one.
        it("backend does not 403 a common role when frontend has no restriction", async () => {
          const token = await signToken({ userId: 9000, username: "t_admin", role: "admin", clinicId: 1 });
          const res = await request(app).get(endpoint).set("Cookie", [`clinic_token=${token}`]);
          expect(res.status).not.toBe(403);
        });
        return;
      }

      for (const role of roles) {
        it(`${role} (frontend-allowed) must not get 403 from ${endpoint}`, async () => {
          const token = await signToken({ userId: 9000, username: `t_${role}`, role, clinicId: 1 });
          const res = await request(app).get(endpoint).set("Cookie", [`clinic_token=${token}`]);
          expect(
            res.status,
            `${role} got ${res.status} from ${endpoint}. Frontend lists ${role} as an allowed role ` +
            `for ${page}, but backend denied access. Either widen the backend's requireRole(...) ` +
            `to include ${role}, or remove ${role} from the navItems entry for ${page} in route-access.ts.`,
          ).not.toBe(403);
        });
      }
    });
  }
});
