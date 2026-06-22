/**
 * Login token mint — REAL Postgres (F-M6).
 *
 * Two multi-clinic-correctness gaps closed at the auth mint:
 *   1. The JWT now carries the clinic's `timezone` (from clinics.timezone) so
 *      server-side date math uses the clinic's business day, not the single env
 *      CLINIC_TZ fallback. Pinned by decoding the minted token.
 *   2. Resolved-user session audits (LOGIN_SUCCESS) now land in the user's real
 *      clinic, not the SYSTEM_CLINIC_ID(1) sentinel. Pinned against audit_logs.
 *
 * Drives the real `loginUser` service (rate limiter + device-trust dispatch) so
 * the mint path is exercised exactly as production does it. A dedicated clinic
 * with a NON-default timezone proves the value comes from the clinic row.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { decodeJwt } from "jose";
import { eq, and } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";

const CLINIC_TZ = "America/New_York"; // deliberately NOT the env/default Europe/Istanbul
const PASSWORD = "login_mint_pw_123!";

let harness: RealDbHarness;
let loginUser: any;
let clinicsTable: any;
let usersTable: any;
let auditLogsTable: any;

let clinicId: number;
let userId: number;
const username = "login_mint_user";

beforeAll(async () => {
  harness = await startRealDb();

  const db = (await import("@workspace/db")) as any;
  ({ clinicsTable, usersTable, auditLogsTable } = db);
  const { hashPassword } = await import("../lib/password");
  ({ loginUser } = await import("../services/auth.service"));
  await import("../app"); // ensure runtime (rate store, device trust) is wired

  const [clinic] = (await harness.db.insert(clinicsTable).values({
    name: "TZ Clinic", timezone: CLINIC_TZ,
  }).returning()) as any[];
  clinicId = clinic.id;

  const pw = await hashPassword(PASSWORD);
  const [user] = (await harness.db.insert(usersTable).values({
    username, fullName: "Login Mint User", passwordHash: pw, role: "doctor", clinicId,
  }).returning()) as any[];
  userId = user.id;
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("Login token mint (F-M6)", () => {
  it("mints the clinic timezone + clinicId into the JWT", async () => {
    const result = await loginUser(username, PASSWORD, {
      ip: "203.0.113.50", userAgent: "mint-test-UA", acceptLanguage: "en",
    });
    expect(result.outcome).toBe("success");

    const claims = decodeJwt(result.token) as Record<string, unknown>;
    expect(claims.timezone).toBe(CLINIC_TZ);
    expect(claims.clinicId).toBe(clinicId);
    expect(claims.userId).toBe(userId);
  });

  it("lands the LOGIN_SUCCESS audit in the user's real clinic (not SYSTEM_CLINIC_ID)", async () => {
    // A fresh login (distinct IP) to isolate this assertion from the first test.
    await loginUser(username, PASSWORD, {
      ip: "203.0.113.51", userAgent: "mint-test-UA", acceptLanguage: "en",
    });

    const rows = (await harness.db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.userId, userId),
      eq(auditLogsTable.action, "LOGIN_SUCCESS"),
    ))) as any[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.clinicId === clinicId)).toBe(true);
    expect(clinicId).not.toBe(1); // the SYSTEM_CLINIC_ID sentinel — proves the fix
  });
});
