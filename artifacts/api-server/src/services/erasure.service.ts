// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import {
  erasureRequestsTable, patientsTable, medicalRecordsTable,
  prescriptionsTable, labTestsTable, xrayRecordsTable,
  ultrasoundRecordsTable, appointmentsTable, vitalsTable,
  imagingAttachmentsTable,
} from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { logger } from "../lib/logger";
import { deleteImageFile } from "../lib/imaging-storage";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

const ERASED = "[ERASED]";
const ERASED_DOB = "1900-01-01";

export async function listErasureRequests(req: AuthRequest) {
  return runInTenantContext(req.user!, async (tx) => {
    const rows = await tx
      .select()
      .from(erasureRequestsTable)
      .where(eq(erasureRequestsTable.clinicId, req.user!.clinicId));
    void logAudit(req, "READ_LIST", "erasure_request", undefined, { count: rows.length });
    return rows;
  });
}

export async function createErasureRequest(req: AuthRequest, body: Record<string, unknown>) {
  const patientId = typeof body.patientId === "number" ? body.patientId : Number(body.patientId);
  if (!patientId || isNaN(patientId)) {
    throw new ValidationError("patientId is required");
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10) throw new ValidationError("reason must be at least 10 characters");

  return runInTenantContext(req.user!, async (tx) => {
    const [patient] = await tx
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.clinicId, req.user!.clinicId)));
    if (!patient) throw new NotFoundError("patient", String(patientId));

    const [request] = await tx.insert(erasureRequestsTable).values({
      clinicId: req.user!.clinicId,
      patientId,
      requestedByUserId: req.user!.userId,
      reason,
    }).returning();

    await logAudit(req, "ERASURE_REQUESTED", "erasure_request", request.id, { patientId, reason });
    return request;
  });
}

export async function reviewErasureRequest(
  req: AuthRequest,
  requestId: number,
  body: Record<string, unknown>,
) {
  const action = body.action;
  if (action !== "approve" && action !== "reject") {
    throw new ValidationError("action must be 'approve' or 'reject'");
  }

  return runInTenantContext(req.user!, async (tx) => {
    const [request] = await tx
      .select()
      .from(erasureRequestsTable)
      .where(and(eq(erasureRequestsTable.id, requestId), eq(erasureRequestsTable.clinicId, req.user!.clinicId)));
    if (!request) throw new NotFoundError("erasure request", requestId);
    if (request.status !== "pending") throw new ConflictError("Request is not in pending status");

    const newStatus = action === "approve" ? "approved" : "rejected";
    const [updated] = await tx.update(erasureRequestsTable)
      .set({
        status: newStatus,
        reviewedByUserId: req.user!.userId,
        reviewedAt: new Date(),
        reviewNotes: typeof body.notes === "string" ? body.notes : null,
        updatedAt: new Date(),
      })
      .where(and(eq(erasureRequestsTable.id, requestId), eq(erasureRequestsTable.clinicId, req.user!.clinicId)))
      .returning();

    await logAudit(req, `ERASURE_${action.toUpperCase()}D`, "erasure_request", requestId, {
      patientId: request.patientId, newStatus,
    });
    return updated;
  });
}

// Execute erasure: anonymize all PHI for the patient.
// Irreversible. Must be called by super_admin only.
// Runs in a transaction so the patient remains readable (as [ERASED]) but PHI is gone.
export async function executeErasure(req: AuthRequest, requestId: number) {
  if (req.user!.role !== "super_admin") {
    throw new ForbiddenError("Only super_admin can execute an erasure");
  }

  return runInTenantContext(req.user!, async (tx) => {
    const [request] = await tx
      .select()
      .from(erasureRequestsTable)
      .where(and(eq(erasureRequestsTable.id, requestId), eq(erasureRequestsTable.clinicId, req.user!.clinicId)));
    if (!request) throw new NotFoundError("erasure request", requestId);
    if (request.status !== "approved") {
      throw new ConflictError("Erasure request must be approved before execution");
    }
    if (request.executedAt) throw new ConflictError("Erasure has already been executed");

    const patientId = request.patientId;
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS ?? "7", 10);
    const erasureBlackoutUntil = new Date(Date.now() + retentionDays * 86_400_000);

    const clinicId = req.user!.clinicId;
    const now = new Date();
    // Per-entity counts of rows actually scrubbed, so the audit record reflects
    // exactly what was erased (F-P3-1 — the old hard-coded list overstated it).
    const erasedCounts: Record<string, number> = {};
    // Physical image files to hard-delete AFTER the DB transaction commits
    // (filesystem unlink cannot participate in the SQL transaction).
    const imageFilesToPurge: string[] = [];

    // We already run inside a transaction block in runInTenantContext,
    // so nested transaction creates savepoints.
    await tx.transaction(async (nestedTx) => {
      // Anonymize patient demographics (keep record shell for audit trail).
      // Overwrites the encrypted allergies/emergencyContact ciphertext.
      // Insurance fields are named HIPAA identifiers (§164.514(e)(2)).
      const pt = await nestedTx.update(patientsTable).set({
        fullName: ERASED,
        fullNameAr: ERASED,
        phone: ERASED,
        address: null,
        allergies: ERASED,
        emergencyContact: null,
        dateOfBirth: ERASED_DOB,
        bloodType: null,
        insuranceProvider: null,
        insurancePolicyNum: null,
        insuranceMemberId: null,
        insuranceGroupNum: null,
        insuranceExpiry: null,
        isActive: false,
        deletedAt: now,
        updatedAt: now,
      }).where(and(eq(patientsTable.id, patientId), eq(patientsTable.clinicId, clinicId)))
        .returning({ id: patientsTable.id });
      erasedCounts.patient = pt.length;

      // Anonymize medical records (overwrite encrypted diagnosis/vitals; keep shells)
      const mr = await nestedTx.update(medicalRecordsTable).set({
        chiefComplaint: ERASED,
        chiefComplaintAr: null,
        diagnosis: ERASED,
        diagnosisAr: null,
        treatment: ERASED,
        treatmentAr: null,
        notes: null,
        vitals: null,
        updatedAt: now,
      }).where(and(eq(medicalRecordsTable.patientId, patientId), eq(medicalRecordsTable.clinicId, clinicId)))
        .returning({ id: medicalRecordsTable.id });
      erasedCounts.medical_records = mr.length;

      // Prescriptions — overwrite the encrypted `medications` ciphertext (not just
      // soft-delete, which previously left the PHI recoverable) and soft-delete.
      const rx = await nestedTx.update(prescriptionsTable).set({
        medications: ERASED,
        notes: null,
        notesAr: null,
        deletedAt: now,
        updatedAt: now,
      }).where(and(eq(prescriptionsTable.patientId, patientId), eq(prescriptionsTable.clinicId, clinicId), isNull(prescriptionsTable.deletedAt)))
        .returning({ id: prescriptionsTable.id });
      erasedCounts.prescriptions = rx.length;

      // Lab tests — results/notes are plaintext PHI; null them and soft-delete.
      const lab = await nestedTx.update(labTestsTable).set({
        results: null,
        resultsAr: null,
        notes: null,
        notesAr: null,
        deletedAt: now,
        updatedAt: now,
      }).where(and(eq(labTestsTable.patientId, patientId), eq(labTestsTable.clinicId, clinicId), isNull(labTestsTable.deletedAt)))
        .returning({ id: labTestsTable.id });
      erasedCounts.lab_tests = lab.length;

      // X-ray records — report + image (URL/filename/jsonb) + notes are plaintext PHI.
      const xray = await nestedTx.update(xrayRecordsTable).set({
        report: null,
        reportAr: null,
        imageUrl: null,
        imageFileName: null,
        images: null,
        notes: null,
        notesAr: null,
        deletedAt: now,
        updatedAt: now,
      }).where(and(eq(xrayRecordsTable.patientId, patientId), eq(xrayRecordsTable.clinicId, clinicId), isNull(xrayRecordsTable.deletedAt)))
        .returning({ id: xrayRecordsTable.id });
      erasedCounts.xray_records = xray.length;

      // Ultrasound records — same shape as x-ray.
      const us = await nestedTx.update(ultrasoundRecordsTable).set({
        report: null,
        reportAr: null,
        imageUrl: null,
        imageFileName: null,
        images: null,
        notes: null,
        notesAr: null,
        deletedAt: now,
        updatedAt: now,
      }).where(and(eq(ultrasoundRecordsTable.patientId, patientId), eq(ultrasoundRecordsTable.clinicId, clinicId), isNull(ultrasoundRecordsTable.deletedAt)))
        .returning({ id: ultrasoundRecordsTable.id });
      erasedCounts.ultrasound_records = us.length;

      // Imaging attachments — soft-delete the metadata rows and collect the
      // storage keys so the encrypted bytes on disk are purged after commit.
      // Hard-deleting the file is what makes the imaging PHI irrecoverable (the
      // iv/tag envelope lives on the row, so the bytes alone are useless once gone).
      const atts = await nestedTx.update(imagingAttachmentsTable).set({
        deletedAt: now,
        updatedAt: now,
      }).where(and(eq(imagingAttachmentsTable.patientId, patientId), eq(imagingAttachmentsTable.clinicId, clinicId), isNull(imagingAttachmentsTable.deletedAt)))
        .returning({ storageKey: imagingAttachmentsTable.storageKey });
      for (const a of atts) imageFilesToPurge.push(a.storageKey);
      erasedCounts.imaging_attachments = atts.length;

      // Vitals — encrypted JSONB PHI + free-text notes; overwrite + soft-delete.
      const vit = await nestedTx.update(vitalsTable).set({
        vitals: null,
        notes: null,
        deletedAt: now,
        updatedAt: now,
      }).where(and(eq(vitalsTable.patientId, patientId), eq(vitalsTable.clinicId, clinicId), isNull(vitalsTable.deletedAt)))
        .returning({ id: vitalsTable.id });
      erasedCounts.vitals = vit.length;

      // Appointments — reason/notes/cancellationReason are free-text that can hold
      // PHI. Scrub them but keep the workflow shell (status/timestamps) for the
      // care-timeline audit trail.
      const appt = await nestedTx.update(appointmentsTable).set({
        reason: ERASED,
        notes: null,
        cancellationReason: null,
        updatedAt: now,
      }).where(and(eq(appointmentsTable.patientId, patientId), eq(appointmentsTable.clinicId, clinicId)))
        .returning({ id: appointmentsTable.id });
      erasedCounts.appointments = appt.length;

      // Mark erasure request as executed.
      // erasureBlackoutUntil marks the window during which backups still contain
      // this patient's pre-erasure PHI — see RUNBOOK §2.2 for restore procedure.
      await nestedTx.update(erasureRequestsTable).set({
        status: "executed",
        executedByUserId: req.user!.userId,
        executedAt: now,
        erasureBlackoutUntil,
        updatedAt: now,
      }).where(and(eq(erasureRequestsTable.id, requestId), eq(erasureRequestsTable.clinicId, clinicId)));
    });

    // Purge the encrypted image bytes from disk now the DB rows are committed.
    // Best-effort: a failed unlink (already-gone/permissions) is logged, not
    // fatal — the metadata + jsonb pointers are already scrubbed.
    for (const key of imageFilesToPurge) {
      try {
        await deleteImageFile(key);
      } catch (err) {
        logger.error({ err, requestId, storageKey: key }, "erasure_image_unlink_failed");
      }
    }

    // Immutable audit entry outside the transaction — must survive even if something goes wrong post-tx.
    // erasedEntities is derived from rows actually scrubbed (accurate evidence).
    const erasedEntities = Object.keys(erasedCounts).filter((k) => erasedCounts[k] > 0);
    await logAudit(req, "ERASURE_EXECUTED", "erasure_request", requestId, {
      patientId,
      erasedEntities,
      erasedCounts,
    });

    return { ok: true, requestId, patientId, erasedCounts };
  });
}
