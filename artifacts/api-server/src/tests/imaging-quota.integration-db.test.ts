/**
 * Per-clinic imaging storage quota — REAL Postgres (F-M4).
 *
 * IMAGING_CLINIC_QUOTA_BYTES caps the total LIVE attachment bytes per clinic so
 * one tenant cannot fill the imaging volume. Opt-in (0 = disabled). Pins:
 *   - an upload within the remaining quota succeeds;
 *   - an upload that would exceed it is rejected BEFORE anything hits disk;
 *   - quota=0 disables the check entirely (non-breaking default).
 *
 * Each file is 13 bytes (8-byte PNG signature + 5-byte payload); the quota is set
 * to 20 so the first upload fits and the second (would be 26) does not.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let harness: RealDbHarness;
let seed: CrossTenantSeed;
let storageDir: string;
let uploadAttachment: any;
let ValidationError: any;
let recordA: { id: number };

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (payload = "first") => Buffer.concat([PNG_SIG, Buffer.from(payload)]); // 13 bytes
const fileOf = (buf: Buffer, originalname = "scan.png") => ({ buffer: buf, originalname, size: buf.length });
const reqOf = (user: object) => ({ user, headers: {}, ip: "127.0.0.1" } as any);
const rejection = (p: Promise<unknown>) => p.then(() => null, (e) => e);
const adminA = () => reqOf({ userId: seed.superAdminA.id, username: "sa_a", role: "super_admin", clinicId: seed.clinicA.id });

beforeAll(async () => {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "medicore-quota-"));
  process.env.IMAGING_STORAGE_DIR = storageDir;
  process.env.IMAGING_CLINIC_QUOTA_BYTES = "20";

  harness = await startRealDb();

  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);

  const db = (await import("@workspace/db")) as any;
  ({ uploadAttachment } = await import("../modules/imaging/imaging-attachments.service"));
  ({ ValidationError } = await import("../services/errors"));
  await import("../app");

  const [rec] = (await harness.db.insert(db.xrayRecordsTable).values({
    clinicId: seed.clinicA.id, patientId: seed.patientA.id, requestedById: seed.superAdminA.id,
    bodyPart: "Chest", status: "requested",
  }).returning()) as any[];
  recordA = rec;
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
  if (storageDir) await fs.rm(storageDir, { recursive: true, force: true }).catch(() => {});
});

describe("Per-clinic imaging storage quota (F-M4)", () => {
  it("allows an upload within the quota", async () => {
    const att = await uploadAttachment(adminA(), "xray", recordA.id, fileOf(png("first")));
    expect(att.id).toBeTruthy();
  });

  it("rejects an upload that would exceed the quota (before writing to disk)", async () => {
    const before = (await fs.readdir(path.join(storageDir, String(seed.clinicA.id), "xray"))).length;
    const err = await rejection(uploadAttachment(adminA(), "xray", recordA.id, fileOf(png("secnd"))));
    expect(err).toBeInstanceOf(ValidationError);
    // No file was written for the rejected upload.
    const after = (await fs.readdir(path.join(storageDir, String(seed.clinicA.id), "xray"))).length;
    expect(after).toBe(before);
  });

  it("quota=0 disables the check (non-breaking default)", async () => {
    const prev = process.env.IMAGING_CLINIC_QUOTA_BYTES;
    process.env.IMAGING_CLINIC_QUOTA_BYTES = "0";
    try {
      const att = await uploadAttachment(adminA(), "xray", recordA.id, fileOf(png("third")));
      expect(att.id).toBeTruthy();
    } finally {
      process.env.IMAGING_CLINIC_QUOTA_BYTES = prev;
    }
  });
});
