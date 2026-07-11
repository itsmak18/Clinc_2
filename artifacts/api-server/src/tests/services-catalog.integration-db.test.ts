/**
 * Services catalog (price list) — REAL Postgres.
 *
 * Closes audit finding F-H2: the services-catalog CRUD shipped with no test.
 * Pins the tenant-isolation + validation + RBAC invariants:
 *
 *   1. A service created in clinic A is invisible to clinic B (list scope), and
 *      clinic B cannot update/delete clinic A's row (→ 404, not a silent edit).
 *   2. Negative prices are rejected.
 *   3. seedDefaultServices is idempotent (re-run inserts 0).
 *   4. RBAC at the HTTP layer: front_desk may READ prices but not WRITE them;
 *      billing_manager may READ.
 *
 * CRUD is driven at the service layer with a minimal `{ user, headers, ip }`
 * request; the two RBAC checks go through the real Express stack (supertest).
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let harness: RealDbHarness;
let seed: CrossTenantSeed;
let app: any;
let signToken: any;

let listServices: any;
let createService: any;
let updateService: any;
let deleteService: any;
let seedDefaultServices: any;
let NotFoundError: any;
let ValidationError: any;

let serviceAId: number;

const csrf = "services-catalog-csrf-token";
const reqOf = (user: object) => ({ user, headers: {}, ip: "127.0.0.1" } as any);
const rejection = (p: Promise<unknown>) => p.then(() => null, (e) => e);

const actorA = () => reqOf({ userId: seed.superAdminA.id, username: "admin_a", role: "admin", clinicId: seed.clinicA.id });
const actorB = () => reqOf({ userId: seed.superAdminB.id, username: "admin_b", role: "admin", clinicId: seed.clinicB.id });

beforeAll(async () => {
  harness = await startRealDb();

  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);
  ({ listServices, createService, updateService, deleteService, seedDefaultServices } = await import(
    "../modules/billing/services-catalog.service"
  ));
  ({ NotFoundError, ValidationError } = await import("../services/errors"));
  ({ default: app } = await import("../app"));
  ({ signToken } = await import("../lib/auth"));
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("Tenant isolation", () => {
  it("a clinic-A service is invisible to clinic B", async () => {
    const svc = await createService(actorA(), { name: "Premium MRI", defaultPrice: 250, category: "imaging" });
    expect(svc.id).toBeTruthy();
    serviceAId = svc.id;

    const listA = await listServices(actorA(), {});
    expect(listA.data.some((s: any) => s.id === serviceAId)).toBe(true);

    const listB = await listServices(actorB(), {});
    expect(listB.data.some((s: any) => s.id === serviceAId)).toBe(false);
  });

  it("clinic B cannot update or delete clinic A's service (→ NotFound)", async () => {
    expect(await rejection(updateService(actorB(), serviceAId, { defaultPrice: 1 }))).toBeInstanceOf(NotFoundError);
    expect(await rejection(deleteService(actorB(), serviceAId))).toBeInstanceOf(NotFoundError);

    // ...and the row is untouched in clinic A.
    const listA = await listServices(actorA(), {});
    const still = listA.data.find((s: any) => s.id === serviceAId);
    expect(still).toBeTruthy();
    expect(Number(still.defaultPrice)).toBe(250);
  });
});

describe("Validation + idempotent seeding", () => {
  it("rejects a negative price", async () => {
    expect(await rejection(createService(actorA(), { name: "Bad", defaultPrice: -10 }))).toBeInstanceOf(ValidationError);
  });

  it("seedDefaultServices is idempotent", async () => {
    const first = await seedDefaultServices(actorA());
    expect(first.inserted).toBeGreaterThan(0);
    const second = await seedDefaultServices(actorA());
    expect(second.inserted).toBe(0);
  });
});

describe("RBAC at the HTTP layer", () => {
  it("front_desk may NOT create a service (403)", async () => {
    const token = await signToken({ userId: seed.superAdminA.id, username: "fd", role: "front_desk", clinicId: seed.clinicA.id });
    const res = await request(app)
      .post("/api/services-catalog")
      .set("Cookie", [`clinic_token=${token}`, `_csrf=${csrf}`])
      .set("X-CSRF-Token", csrf)
      .send({ name: "Sneaky", defaultPrice: 5 });
    expect(res.status).toBe(403);
  });

  it("billing_manager may read the catalog (200)", async () => {
    const token = await signToken({ userId: seed.superAdminA.id, username: "bm", role: "billing_manager", clinicId: seed.clinicA.id });
    const res = await request(app)
      .get("/api/services-catalog")
      .set("Cookie", [`clinic_token=${token}`]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
