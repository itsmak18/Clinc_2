/**
 * Patient registration create-path — REAL Postgres.
 *
 * Regression guard for the 2026-06-15 "registration failed" 500. `generateMRN()`
 * did `const [{ nextval }] = await db.execute(sql...)`, but `db` is
 * drizzle-orm/node-postgres whose `.execute()` returns a pg QueryResult
 * ({ rows, ... }) — NOT array-iterable. So EVERY createPatient threw
 * "(intermediate value) is not iterable". It shipped unnoticed because no test
 * exercised createPatient against a real DB: unit tests mock @workspace/db, and
 * the other integration-db tests insert patients with a literal `mrn` (bypassing
 * generateMRN). This drives the full HTTP path:
 *   route -> validate(CreatePatientBody) -> createPatient -> generateMRN -> insert.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let app: any;
let signToken: any;
let harness: RealDbHarness;
let seed: CrossTenantSeed;

beforeAll(async () => {
  harness = await startRealDb();

  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);

  // mrn_seq is created by the seed script, NOT by a migration — the harness only
  // applies migrations, so create it here (as the superuser harness.db; the
  // provision-time ALTER DEFAULT PRIVILEGES grants medicore_app USAGE on it, so
  // generateMRN's nextval() works when the service runs as medicore_app).
  await (harness.db as any).execute(sql`CREATE SEQUENCE IF NOT EXISTS mrn_seq START WITH 1001`);

  ({ default: app } = await import("../app"));
  ({ signToken } = await import("../lib/auth"));
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

// CSRF is enforced in the kernel on write-scope mutations — carry a matching
// _csrf cookie + X-CSRF-Token header (double-submit) or the POST 403s before
// reaching the handler.
const CSRF = "registration-create-csrf-token";

async function adminCookie(): Promise<string> {
  const u = seed.superAdminA;
  const token = await signToken({ userId: u.id, username: u.username, role: "super_admin", clinicId: u.clinicId });
  return `clinic_token=${token}`;
}

function postPatient(body: Record<string, unknown>, authCookie: string) {
  return request(app)
    .post("/api/patients")
    .set("Cookie", [authCookie, `_csrf=${CSRF}`])
    .set("X-CSRF-Token", CSRF)
    .send(body);
}

describe("Patient registration create-path (real Postgres)", () => {
  it("POST /api/patients with idCardNumber → 201 and assigns a generated MRN (generateMRN regression)", async () => {
    const cookie = await adminCookie();
    const res = await postPatient(
      { idCardNumber: "REG-IT-1001", fullName: "Reg IT One", dateOfBirth: "1990-01-01", gender: "male", phone: "+966500000101" },
      cookie,
    );
    expect(res.status).toBe(201);
    // The whole point: generateMRN ran without throwing → MRN-YYYYMM-NNNNN.
    expect(res.body.mrn).toMatch(/^MRN-\d{6}-\d{5}$/);
    expect(res.body.idCardNumber).toBe("REG-IT-1001");
  });

  it("POST /api/patients without idCardNumber → 400 VALIDATION_ERROR", async () => {
    const cookie = await adminCookie();
    const res = await postPatient(
      { fullName: "Reg IT NoId", dateOfBirth: "1990-01-01", gender: "male", phone: "+966500000102" },
      cookie,
    );
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe(3003); // DOMAIN_VALIDATION
  });

  it("POST /api/patients with a duplicate idCardNumber in the same clinic → 409 CONFLICT", async () => {
    const cookie = await adminCookie();
    const body = { idCardNumber: "REG-IT-DUP", fullName: "Reg IT Dup A", dateOfBirth: "1990-01-01", gender: "male", phone: "+966500000103" };

    const first = await postPatient(body, cookie);
    expect(first.status).toBe(201);

    const second = await postPatient({ ...body, fullName: "Reg IT Dup B", phone: "+966500000104" }, cookie);
    expect(second.status).toBe(409);
    expect(second.body.error_code).toBe(3002); // DOMAIN_CONFLICT
  });
});
