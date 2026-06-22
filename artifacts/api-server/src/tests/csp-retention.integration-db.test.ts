/**
 * CSP report retention purge — REAL Postgres (F-M2).
 *
 * csp_reports previously grew unbounded (the schema documents a 90-day retention
 * but nothing enforced it). `purgeOldCspReports(retentionDays)` + a daily cron
 * close that. This pins the delete window: old rows go, recent rows stay.
 *
 * csp_reports is a non-tenant table (no clinic_id, no RLS), so this seeds and
 * asserts directly via the harness; the purge runs through the service's
 * dbUnsafe pool (medicore_app), exactly as the cron will in production.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";

let harness: RealDbHarness;
let purgeOldCspReports: any;
let cspReportsTable: any;
let db: any;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  harness = await startRealDb();
  ({ cspReportsTable } = (await import("@workspace/db")) as any);
  ({ purgeOldCspReports } = await import("../services/csp-report.service"));
  db = harness.db;
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("CSP report retention purge (F-M2)", () => {
  it("deletes rows older than the retention window and keeps recent rows", async () => {
    const [oldRow] = (await db.insert(cspReportsTable).values({
      violatedDirective: "script-src", createdAt: daysAgo(100),
    }).returning()) as any[];
    const [recentRow] = (await db.insert(cspReportsTable).values({
      violatedDirective: "img-src", createdAt: daysAgo(10),
    }).returning()) as any[];

    const purged = await purgeOldCspReports(90);
    expect(purged).toBeGreaterThanOrEqual(1);

    const ids = ((await db.select().from(cspReportsTable)) as any[]).map((r) => r.id);
    expect(ids).not.toContain(oldRow.id);
    expect(ids).toContain(recentRow.id);
  });

  it("applies the default 90-day window when no arg is passed", async () => {
    const [veryOld] = (await db.insert(cspReportsTable).values({
      violatedDirective: "connect-src", createdAt: daysAgo(120),
    }).returning()) as any[];

    await purgeOldCspReports();

    const ids = ((await db.select().from(cspReportsTable)) as any[]).map((r) => r.id);
    expect(ids).not.toContain(veryOld.id);
  });
});
