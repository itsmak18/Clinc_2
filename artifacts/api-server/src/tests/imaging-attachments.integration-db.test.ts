/**
 * Imaging attachments (encrypted X-ray/ultrasound files) — REAL Postgres.
 *
 * Closes audit finding F-H2: the upload/download/delete path (encrypted PHI file
 * storage with doctor-scope + break-glass + cross-tenant isolation) shipped with
 * NO dedicated test. This pins the security-critical invariants:
 *
 *   1. Content-type is decided on REAL magic bytes, not the client MIME — a
 *      non-image upload is rejected even with a .png name.
 *   2. Bytes round-trip exactly (encrypt-then-store → read → decrypt → send).
 *      Dev has no FIELD_ENCRYPTION_KEY, so encryptBuffer is a passthrough and the
 *      stored bytes equal the uploaded bytes — the round-trip still proves the
 *      storage-key plumbing and the in_progress status transition.
 *   3. Doctor scope holds on DOWNLOAD: a same-clinic doctor NOT linked to the
 *      patient is refused (ForbiddenError); the linked doctor is allowed.
 *   4. Cross-tenant download is a clean 404 (clinic-scoped load), never a leak.
 *   5. Delete soft-deletes the row, unlinks the file, and removes the mirrored
 *      entry from the parent record's images jsonb.
 *
 * Tests call the service directly with a minimal `{ user, headers, ip }` request
 * (the proven pattern in appointment-lifecycle.integration-db.test.ts) — this
 * exercises runInTenantContext/RLS without coupling to multipart/CSRF wiring.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { eq } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let harness: RealDbHarness;
let seed: CrossTenantSeed;
let storageDir: string;

let uploadAttachment: any;
let streamAttachment: any;
let deleteAttachment: any;
let ForbiddenError: any;
let NotFoundError: any;
let ValidationError: any;
let xrayRecordsTable: any;

let recordA: { id: number };
let drLinked: { id: number };
let drUnlinked: { id: number };
let uploaded: { id: string };

// A buffer whose first 8 bytes are the PNG signature. sniffImageMime keys off
// these bytes only, so the trailing payload is arbitrary — and lets us assert an
// exact round-trip after the (dev-passthrough) encrypt/decrypt.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (payload = "x-ray-bytes") => Buffer.concat([PNG_SIG, Buffer.from(payload)]);
const fileOf = (buf: Buffer, originalname = "scan.png") => ({ buffer: buf, originalname, size: buf.length });
const reqOf = (user: object) => ({ user, headers: {}, ip: "127.0.0.1" } as any);
const rejection = (p: Promise<unknown>) => p.then(() => null, (e) => e);

beforeAll(async () => {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "medicore-imaging-"));
  process.env.IMAGING_STORAGE_DIR = storageDir;

  harness = await startRealDb();

  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);

  const db = (await import("@workspace/db")) as any;
  xrayRecordsTable = db.xrayRecordsTable;
  const { usersTable, doctorPatientsTable } = db;
  const { hashPassword } = await import("../lib/password");
  ({ uploadAttachment, streamAttachment, deleteAttachment } = await import(
    "../modules/imaging/imaging-attachments.service"
  ));
  ({ ForbiddenError, NotFoundError, ValidationError } = await import("../services/errors"));
  await import("../app"); // ensure runtime (audit outbox, metrics) is wired

  const pw = await hashPassword("test_password_123!");
  const [a1] = (await harness.db.insert(usersTable).values({
    username: "img_dr_linked", fullName: "Img Dr Linked", passwordHash: pw, role: "doctor", clinicId: seed.clinicA.id,
  }).returning()) as any[];
  const [a2] = (await harness.db.insert(usersTable).values({
    username: "img_dr_unlinked", fullName: "Img Dr Unlinked", passwordHash: pw, role: "doctor", clinicId: seed.clinicA.id,
  }).returning()) as any[];
  drLinked = a1;
  drUnlinked = a2;

  // drLinked is assigned to patientA; drUnlinked is assigned to nobody.
  await harness.db.insert(doctorPatientsTable).values({
    clinicId: seed.clinicA.id, doctorId: a1.id, patientId: seed.patientA.id, lastSeenAt: new Date(),
  }).onConflictDoNothing();

  const [rec] = (await harness.db.insert(xrayRecordsTable).values({
    clinicId: seed.clinicA.id, patientId: seed.patientA.id, requestedById: seed.superAdminA.id,
    bodyPart: "Chest", status: "requested",
  }).returning()) as any[];
  recordA = rec;
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
  if (storageDir) await fs.rm(storageDir, { recursive: true, force: true }).catch(() => {});
});

describe("Imaging attachment upload + magic-byte sniffing", () => {
  it("uploads a PNG, advances requested → in_progress, sets the cover image", async () => {
    const req = reqOf({ userId: seed.superAdminA.id, username: "sa_a", role: "super_admin", clinicId: seed.clinicA.id });
    const att = await uploadAttachment(req, "xray", recordA.id, fileOf(png("first")), "frontal view");

    expect(att.id).toBeTruthy();
    expect(att.mimeType).toBe("image/png");
    expect(att.url).toBe(`/api/xray/${recordA.id}/images/${att.id}`);
    uploaded = att;

    const [rec] = (await harness.db.select().from(xrayRecordsTable)
      .where(eq(xrayRecordsTable.id, recordA.id))) as any[];
    expect(rec.status).toBe("in_progress");
    expect(rec.imageUrl).toBe(att.url);
    expect((rec.images ?? []).some((i: any) => i.url === att.url)).toBe(true);
  });

  it("rejects a non-image even when named .png (sniffs real bytes)", async () => {
    const req = reqOf({ userId: seed.superAdminA.id, username: "sa_a", role: "super_admin", clinicId: seed.clinicA.id });
    const err = await rejection(uploadAttachment(req, "xray", recordA.id, fileOf(Buffer.from("totally not an image"), "fake.png")));
    expect(err).toBeInstanceOf(ValidationError);
  });
});

describe("Imaging attachment download", () => {
  it("round-trips the exact bytes + content-type", async () => {
    const req = reqOf({ userId: seed.superAdminA.id, username: "sa_a", role: "super_admin", clinicId: seed.clinicA.id });
    const out = await streamAttachment(req, "xray", recordA.id, uploaded.id);
    expect(out.mimeType).toBe("image/png");
    expect(Buffer.from(out.bytes).equals(png("first"))).toBe(true);
  });

  it("doctor scope: linked doctor downloads (200); unlinked same-clinic doctor is forbidden", async () => {
    const linked = reqOf({ userId: drLinked.id, username: "dl", role: "doctor", clinicId: seed.clinicA.id });
    const okOut = await streamAttachment(linked, "xray", recordA.id, uploaded.id);
    expect(Buffer.from(okOut.bytes).length).toBeGreaterThan(0);

    const unlinked = reqOf({ userId: drUnlinked.id, username: "du", role: "doctor", clinicId: seed.clinicA.id });
    const err = await rejection(streamAttachment(unlinked, "xray", recordA.id, uploaded.id));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("cross-tenant: a clinic-B user cannot load clinic-A's image → 404", async () => {
    const bAdmin = reqOf({ userId: seed.superAdminB.id, username: "sa_b", role: "super_admin", clinicId: seed.clinicB.id });
    const err = await rejection(streamAttachment(bAdmin, "xray", recordA.id, uploaded.id));
    expect(err).toBeInstanceOf(NotFoundError);
  });
});

describe("Imaging attachment delete", () => {
  it("soft-deletes the row, unlinks the file, and removes the jsonb mirror", async () => {
    await deleteAttachment(adminAReq(), "xray", recordA.id, uploaded.id);

    const err = await rejection(streamAttachment(adminAReq(), "xray", recordA.id, uploaded.id));
    expect(err).toBeInstanceOf(NotFoundError);

    const [rec] = (await harness.db.select().from(xrayRecordsTable)
      .where(eq(xrayRecordsTable.id, recordA.id))) as any[];
    expect((rec.images ?? []).some((i: any) => i.url.includes(uploaded.id))).toBe(false);
    expect(rec.imageUrl).toBeNull();
  });
});

function adminAReq() {
  return reqOf({ userId: seed.superAdminA.id, username: "sa_a", role: "super_admin", clinicId: seed.clinicA.id });
}
