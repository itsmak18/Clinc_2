import { db, runInTenantContext } from "@workspace/db";
import {
  erasureRequestsTable, patientsTable, medicalRecordsTable,
  prescriptionsTable,
} from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { logAudit } from "../lib/audit";
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
    // We already run inside a transaction block in runInTenantContext,
    // so nested transaction creates savepoints.
    await tx.transaction(async (nestedTx) => {
      // Anonymize patient demographics (keep record shell for audit trail)
      await nestedTx.update(patientsTable).set({
        fullName: ERASED,
        fullNameAr: ERASED,
        phone: ERASED,
        address: null,
        allergies: ERASED,
        emergencyContact: null,
        dateOfBirth: ERASED_DOB,
        bloodType: null,
        isActive: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(patientsTable.id, patientId), eq(patientsTable.clinicId, clinicId)));

      // Anonymize medical records (keep shells)
      await nestedTx.update(medicalRecordsTable).set({
        chiefComplaint: ERASED,
        diagnosis: ERASED,
        treatment: ERASED,
        notes: null,
        vitals: null,
        updatedAt: new Date(),
      }).where(and(eq(medicalRecordsTable.patientId, patientId), eq(medicalRecordsTable.clinicId, clinicId)));

      // Soft-delete prescriptions
      await nestedTx.update(prescriptionsTable).set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(prescriptionsTable.patientId, patientId), eq(prescriptionsTable.clinicId, clinicId), isNull(prescriptionsTable.deletedAt)));

      // Mark erasure request as executed.
      // erasureBlackoutUntil marks the window during which backups still contain
      // this patient's pre-erasure PHI — see RUNBOOK §2.2 for restore procedure.
      await nestedTx.update(erasureRequestsTable).set({
        status: "executed",
        executedByUserId: req.user!.userId,
        executedAt: new Date(),
        erasureBlackoutUntil,
        updatedAt: new Date(),
      }).where(and(eq(erasureRequestsTable.id, requestId), eq(erasureRequestsTable.clinicId, clinicId)));
    });

    // Immutable audit entry outside the transaction — must survive even if something goes wrong post-tx
    await logAudit(req, "ERASURE_EXECUTED", "erasure_request", requestId, {
      patientId,
      erasedEntities: ["patient", "medical_records", "prescriptions"],
    });

    return { ok: true, requestId, patientId };
  });
}
