/**
 * Imaging orphan-file reconciliation — REAL Postgres (F-M5).
 *
 * `reconcileOrphanImagingFiles` deletes encrypted image files with no LIVE
 * imaging_attachments row (crash-between-write-and-insert, or a failed unlink on
 * delete). This pins:
 *   - an orphan past the grace window is deleted;
 *   - a fresh orphan (within grace) is kept (protects in-flight uploads);
 *   - a SOFT-DELETED row's old file is reclaimed;
 *   - **SAFETY:** a LIVE row's old file survives. This is the guard against a
 *     non-dormant RLS regression on imaging_attachments — if the dbUnsafe live
 *     query were silently RLS-filtered to zero rows, the live file would be
 *     wrongly deleted and this test would fail (it doesn't, because the policy is
 *     dormant outside runInTenantContext).
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
let reconcileOrphanImagingFiles: any;
let writeImageFile: any;
let readImageFile: any;
let imagingAttachmentsTable: any;

let summary: { scanned: number; deleted: number; skippedRecent: number };

const KEYS = {
  liveOld: "",
  orphanOld: "",
  orphanRecent: "",
  softDeletedOld: "",
};

const exists = async (key: string): Promise<boolean> => {
  try { await readImageFile(key); return true; } catch { return false; }
};

beforeAll(async () => {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "medicore-orphan-"));
  process.env.IMAGING_STORAGE_DIR = storageDir;

  harness = await startRealDb();

  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);

  ({ imagingAttachmentsTable } = (await import("@workspace/db")) as any);
  ({ reconcileOrphanImagingFiles } = await import("../services/imaging-attachments.service"));
  ({ writeImageFile, readImageFile } = await import("../lib/imaging-storage"));

  const c = seed.clinicA.id;
  KEYS.liveOld = `${c}/xray/live-old.enc`;
  KEYS.orphanOld = `${c}/xray/orphan-old.enc`;
  KEYS.orphanRecent = `${c}/xray/orphan-recent.enc`;
  KEYS.softDeletedOld = `${c}/xray/softdel-old.enc`;

  // Write all four files on disk.
  for (const key of Object.values(KEYS)) {
    await writeImageFile(key, Buffer.from(`bytes-${key}`));
  }

  // Age three of them past the 24h grace window (orphanRecent keeps its fresh mtime).
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  for (const key of [KEYS.liveOld, KEYS.orphanOld, KEYS.softDeletedOld]) {
    await fs.utimes(path.join(storageDir, ...key.split("/")), old, old);
  }

  const baseRow = (storageKey: string, deletedAt: Date | null) => ({
    clinicId: seed.clinicA.id, modality: "xray", recordId: 1, patientId: seed.patientA.id,
    uploadedById: seed.superAdminA.id, fileName: "f.png", mimeType: "image/png",
    sizeBytes: 1, sha256: "deadbeef", storageKey, deletedAt,
  });
  // liveOld → a live row (must survive). softDeletedOld → a soft-deleted row
  // (file should be reclaimed). orphanOld / orphanRecent → no row at all.
  await harness.db.insert(imagingAttachmentsTable).values(baseRow(KEYS.liveOld, null));
  await harness.db.insert(imagingAttachmentsTable).values(baseRow(KEYS.softDeletedOld, new Date()));

  summary = await reconcileOrphanImagingFiles(24);
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
  if (storageDir) await fs.rm(storageDir, { recursive: true, force: true }).catch(() => {});
});

describe("Imaging orphan-file reconciliation (F-M5)", () => {
  it("reports scanned=4, deleted=2 (orphan-old + soft-deleted-old), skippedRecent=1", () => {
    expect(summary.scanned).toBe(4);
    expect(summary.deleted).toBe(2);
    expect(summary.skippedRecent).toBe(1);
  });

  it("[SAFETY] a LIVE row's old file is NOT deleted", async () => {
    expect(await exists(KEYS.liveOld)).toBe(true);
  });

  it("an orphan past the grace window is deleted", async () => {
    expect(await exists(KEYS.orphanOld)).toBe(false);
  });

  it("a fresh orphan within the grace window is kept (protects in-flight uploads)", async () => {
    expect(await exists(KEYS.orphanRecent)).toBe(true);
  });

  it("a soft-deleted row's old file is reclaimed", async () => {
    expect(await exists(KEYS.softDeletedOld)).toBe(false);
  });
});
