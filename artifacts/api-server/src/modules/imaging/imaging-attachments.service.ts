// dbUnsafe: reads/writes run inside runInTenantContext (RLS-enforced); the few
// raw db calls carry explicit eq(clinicId) filters (belt-and-braces). dbUnsafe
// acknowledges the intentional bypass for those call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import {
  imagingAttachmentsTable, xrayRecordsTable, ultrasoundRecordsTable,
} from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { logAudit, logRead } from "../../lib/audit";
import { auditBreakGlass } from "../../lib/break-glass-audit";
import { isDoctorScoped, getDoctorPatientScope } from "../../lib/scope";
import { getActiveBreakGlassPatientIds } from "../compliance/break-glass.service";
import { NotFoundError, ForbiddenError, ValidationError } from "../../services/errors";
import { encryptBuffer, decryptBuffer } from "../../lib/field-encryption";
import {
  type Modality, newStorageKey, writeImageFile, readImageFile, deleteImageFile, sha256Hex,
  listStoredFiles,
} from "../../lib/imaging-storage";
import { logger } from "../../lib/logger";
import type { AuthRequest } from "../../middlewares/auth";

// â”€â”€ allowed image types (sniffed from magic bytes â€” client MIME is not trusted) â”€â”€
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB â€” keep in sync with the multer route limit

type ImageRow = { url: string; fileName?: string; caption?: string };

/** Inspect the leading bytes and return the real content-type, or null if unsupported. */
function sniffImageMime(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function tableFor(modality: Modality) {
  return modality === "xray" ? xrayRecordsTable : ultrasoundRecordsTable;
}

/** Strip path segments and control chars from a client-supplied filename. */
function sanitizeFileName(name: string | undefined, mime: string): string {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const base = (name ?? "")
    .replace(/[\\/]/g, "_")
    .replace(/[\x00-\x1f]/g, "")
    .trim()
    .slice(0, 120);
  return base || `image.${ext}`;
}

function downloadUrl(modality: Modality, recordId: number, attId: string): string {
  return `/api/${modality}/${recordId}/images/${attId}`;
}

function projection(att: typeof imagingAttachmentsTable.$inferSelect) {
  return {
    id: att.id,
    fileName: att.fileName,
    mimeType: att.mimeType,
    sizeBytes: att.sizeBytes,
    caption: att.caption,
    url: downloadUrl(att.modality as Modality, att.recordId, att.id),
    createdAt: att.createdAt,
  };
}

// â”€â”€ upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function uploadAttachment(
  req: AuthRequest,
  modality: Modality,
  recordId: number,
  file: { buffer: Buffer; originalname?: string; size: number } | undefined,
  caption?: string,
) {
  if (!file || !file.buffer?.length) throw new ValidationError("No file uploaded");
  if (file.size > MAX_FILE_BYTES) throw new ValidationError("File exceeds the 25 MB limit");

  const mime = sniffImageMime(file.buffer);
  if (!mime) throw new ValidationError("Unsupported file type â€” only PNG, JPEG and WEBP images are allowed");

  const recTable = tableFor(modality);
  const clinicId = req.user!.clinicId;

  // Verify the parent study exists in this clinic (load before touching disk).
  const record = await runInTenantContext(req.user!, async (tx) => {
    const [row] = await tx.select({
      id: recTable.id, patientId: recTable.patientId, status: recTable.status,
      imageUrl: recTable.imageUrl, images: recTable.images,
    }).from(recTable).where(and(
      eq(recTable.id, recordId), eq(recTable.clinicId, clinicId), isNull(recTable.deletedAt),
    ));
    return row;
  });
  if (!record) throw new NotFoundError(`${modality} record`, recordId);

  // Per-clinic storage quota (F-M4). Opt-in: IMAGING_CLINIC_QUOTA_BYTES=0 (default)
  // disables the check so existing deployments are unaffected; operators set a cap
  // (e.g. 10 GB) to stop one tenant filling the imaging volume. Sum of LIVE
  // attachment sizes for the clinic; checked BEFORE touching disk so a rejected
  // upload writes nothing.
  // Intentional direct process.env read (NOT via lib/config): this must be
  // re-read at call time because the imaging-quota test overrides the env var
  // dynamically after module import, and `config` is evaluated once and frozen.
  // eslint-disable-next-line no-restricted-properties
  const quotaBytes = Number(process.env.IMAGING_CLINIC_QUOTA_BYTES) || 0;
  if (quotaBytes > 0) {
    const usedBytes = await runInTenantContext(req.user!, async (tx) => {
      const [row] = await tx
        .select({ total: sql<number>`coalesce(sum(${imagingAttachmentsTable.sizeBytes}), 0)` })
        .from(imagingAttachmentsTable)
        .where(and(
          eq(imagingAttachmentsTable.clinicId, clinicId),
          isNull(imagingAttachmentsTable.deletedAt),
        ));
      return Number(row?.total ?? 0);
    });
    if (usedBytes + file.size > quotaBytes) {
      throw new ValidationError("Clinic imaging storage quota exceeded");
    }
  }

  const fileName = sanitizeFileName(file.originalname, mime);
  const sha256 = sha256Hex(file.buffer);
  const env = encryptBuffer(file.buffer);
  const storageKey = newStorageKey(clinicId, modality);

  // Write the (encrypted) bytes to disk first; if the DB write fails, unlink it.
  await writeImageFile(storageKey, env.data);

  try {
    const att = await runInTenantContext(req.user!, async (tx) => {
      const [inserted] = await tx.insert(imagingAttachmentsTable).values({
        clinicId, modality, recordId, patientId: record.patientId,
        uploadedById: req.user!.userId,
        fileName, mimeType: mime, sizeBytes: file.size, sha256, storageKey,
        encKid: env.kid, encIv: env.iv, encTag: env.tag,
        caption: caption?.trim() || null,
      }).returning();

      // Mirror into the parent record's images jsonb (the existing read/print
      // projection). The url points at the authenticated download endpoint.
      const url = downloadUrl(modality, recordId, inserted.id);
      const existing = (record.images as ImageRow[] | null) ?? [];
      const nextImages: ImageRow[] = [...existing, { url, fileName, caption: caption?.trim() || undefined }];
      const nextStatus = record.status === "requested" ? "in_progress" : record.status;

      await tx.update(recTable).set({
        images: nextImages,
        imageUrl: record.imageUrl ?? url, // first image becomes the cover
        status: nextStatus as any,
        updatedAt: new Date(),
      }).where(and(eq(recTable.id, recordId), eq(recTable.clinicId, clinicId)));

      return inserted;
    });

    await logAudit(req, "CREATE", `${modality}_image`, att.id, { recordId });
    return projection(att);
  } catch (err) {
    await deleteImageFile(storageKey).catch(() => {});
    throw err;
  }
}

// â”€â”€ load one attachment (clinic-scoped) + doctor-scope guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadAttachmentScoped(req: AuthRequest, modality: Modality, recordId: number, attId: string) {
  const clinicId = req.user!.clinicId;
  const att = await runInTenantContext(req.user!, async (tx) => {
    const [row] = await tx.select().from(imagingAttachmentsTable).where(and(
      eq(imagingAttachmentsTable.id, attId),
      eq(imagingAttachmentsTable.clinicId, clinicId),
      eq(imagingAttachmentsTable.modality, modality),
      eq(imagingAttachmentsTable.recordId, recordId),
      isNull(imagingAttachmentsTable.deletedAt),
    ));
    return row;
  });
  if (!att) throw new NotFoundError(`${modality} image`, attId);

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    const breakGlass = await getActiveBreakGlassPatientIds(req.user!.userId, clinicId);
    const viaBreakGlass = breakGlass.includes(att.patientId);
    if (!allowed.includes(att.patientId) && !viaBreakGlass) throw new ForbiddenError();
    if (viaBreakGlass) {
      await auditBreakGlass(req, "BREAK_GLASS_ACCESS", `${modality}_image`, attId, { patientId: att.patientId, via: "download" });
    }
  }
  return att;
}

// â”€â”€ download / stream â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function streamAttachment(req: AuthRequest, modality: Modality, recordId: number, attId: string) {
  const att = await loadAttachmentScoped(req, modality, recordId, attId);
  const onDisk = await readImageFile(att.storageKey);
  const bytes = decryptBuffer(onDisk, { kid: att.encKid, iv: att.encIv, tag: att.encTag });
  await logRead(req, `${modality}_image`, attId);
  return { bytes, mimeType: att.mimeType, fileName: att.fileName };
}

// â”€â”€ delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function deleteAttachment(req: AuthRequest, modality: Modality, recordId: number, attId: string) {
  const att = await loadAttachmentScoped(req, modality, recordId, attId);
  const recTable = tableFor(modality);
  const clinicId = req.user!.clinicId;
  const url = downloadUrl(modality, recordId, attId);

  await runInTenantContext(req.user!, async (tx) => {
    await tx.update(imagingAttachmentsTable)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(imagingAttachmentsTable.id, attId), eq(imagingAttachmentsTable.clinicId, clinicId)));

    // Remove the mirrored entry from the parent record's images jsonb + cover.
    const [rec] = await tx.select({ imageUrl: recTable.imageUrl, images: recTable.images })
      .from(recTable).where(and(eq(recTable.id, recordId), eq(recTable.clinicId, clinicId)));
    if (rec) {
      const next = ((rec.images as ImageRow[] | null) ?? []).filter(im => im.url !== url);
      await tx.update(recTable).set({
        images: next,
        imageUrl: rec.imageUrl === url ? (next[0]?.url ?? null) : rec.imageUrl,
        updatedAt: new Date(),
      }).where(and(eq(recTable.id, recordId), eq(recTable.clinicId, clinicId)));
    }
  });

  await deleteImageFile(att.storageKey).catch(() => {});
  await logAudit(req, "DELETE", `${modality}_image`, attId, { recordId });
}

// â”€â”€ orphan reconciliation (F-M5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const DEFAULT_ORPHAN_GRACE_HOURS = 24;

/**
 * Delete encrypted image files on disk that no LIVE `imaging_attachments` row
 * references (F-M5). Two orphan classes are reclaimed:
 *   (a) a crash between `writeImageFile` and the DB insert in `uploadAttachment`
 *       (file written, row never committed), and
 *   (b) a soft-deleted row whose best-effort `deleteImageFile` failed.
 *
 * A grace window (default 24h, by file mtime) protects an in-flight upload whose
 * DB insert hasn't committed yet â€” a file written seconds ago is never touched.
 *
 * Safety: the live-key query runs via `dbUnsafe` OUTSIDE `runInTenantContext`,
 * where the dormant `tenant_isolation` RLS policy returns ALL clinics' rows (the
 * `app.rls_enforce <> 'on'` branch). If that policy were ever made non-dormant,
 * the query would return zero rows and this sweep would delete the whole store â€”
 * so we refuse to delete when the live set is empty but files exist (a state
 * that signals a visibility fault far more often than a genuinely empty catalog).
 * `imaging-orphan-reconcile.integration-db.test.ts` pins that a live row with an
 * old file survives.
 *
 * Best-effort; never throws (called from a cron tick). Returns the run summary.
 */
export async function reconcileOrphanImagingFiles(
  graceHours: number = DEFAULT_ORPHAN_GRACE_HOURS,
): Promise<{ scanned: number; deleted: number; skippedRecent: number }> {
  const result = { scanned: 0, deleted: 0, skippedRecent: 0 };
  try {
    const files = await listStoredFiles();
    result.scanned = files.length;
    if (files.length === 0) return result;

    // dbUnsafe: cross-tenant maintenance sweep, no request context. storageKey is
    // globally unique (uuid filename), so a flat key set needs no clinic scoping.
    const liveRows = await db
      .select({ storageKey: imagingAttachmentsTable.storageKey })
      .from(imagingAttachmentsTable)
      .where(isNull(imagingAttachmentsTable.deletedAt));
    const live = new Set(liveRows.map(r => r.storageKey));

    // Defense-in-depth: never mass-delete on a suspicious empty live set.
    if (live.size === 0) {
      logger.warn(
        { scanned: files.length },
        "imaging_orphan_reconcile_skipped_empty_live_set",
      );
      return result;
    }

    const cutoff = Date.now() - graceHours * 60 * 60 * 1000;
    for (const f of files) {
      if (live.has(f.storageKey)) continue;
      if (f.mtimeMs > cutoff) { result.skippedRecent++; continue; }
      await deleteImageFile(f.storageKey).catch(() => {});
      result.deleted++;
    }
    if (result.deleted > 0 || result.skippedRecent > 0) {
      logger.info({ ...result, graceHours }, "imaging_orphan_files_reconciled");
    }
    return result;
  } catch (err) {
    logger.warn({ err }, "imaging_orphan_reconcile_failed");
    return result;
  }
}
