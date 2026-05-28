import { db } from "@workspace/db";
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
  const rows = await db.select().from(erasureRequestsTable);
  void logAudit(req, "READ_LIST", "erasure_request", undefined, { count: rows.length });
  return rows;
}

export async function createErasureRequest(req: AuthRequest, body: Record<string, unknown>) {
  const patientId = typeof body.patientId === "number" ? body.patientId : Number(body.patientId);
  if (!patientId || isNaN(patientId)) {
    throw new ValidationError("patientId is required");
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10) throw new ValidationError("reason must be at least 10 characters");

  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId));
  if (!patient) throw new NotFoundError("patient", String(patientId));

  const [request] = await db.insert(erasureRequestsTable).values({
    patientId,
    requestedByUserId: req.user!.userId,
    reason,
  }).returning();

  await logAudit(req, "ERASURE_REQUESTED", "erasure_request", request.id, { patientId, reason });
  return request;
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

  const [request] = await db
    .select()
    .from(erasureRequestsTable)
    .where(eq(erasureRequestsTable.id, requestId));
  if (!request) throw new NotFoundError("erasure request", requestId);
  if (request.status !== "pending") throw new ConflictError("Request is not in pending status");

  const newStatus = action === "approve" ? "approved" : "rejected";
  const [updated] = await db.update(erasureRequestsTable)
    .set({
      status: newStatus,
      reviewedByUserId: req.user!.userId,
      reviewedAt: new Date(),
      reviewNotes: typeof body.notes === "string" ? body.notes : null,
      updatedAt: new Date(),
    })
    .where(eq(erasureRequestsTable.id, requestId))
    .returning();

  await logAudit(req, `ERASURE_${action.toUpperCase()}D`, "erasure_request", requestId, {
    patientId: request.patientId, newStatus,
  });
  return updated;
}

// Execute erasure: anonymize all PHI for the patient.
// Irreversible. Must be called by super_admin only.
// Runs in a transaction so the patient remains readable (as [ERASED]) but PHI is gone.
export async function executeErasure(req: AuthRequest, requestId: number) {
  if (req.user!.role !== "super_admin") {
    throw new ForbiddenError("Only super_admin can execute an erasure");
  }

  const [request] = await db
    .select()
    .from(erasureRequestsTable)
    .where(eq(erasureRequestsTable.id, requestId));
  if (!request) throw new NotFoundError("erasure request", requestId);
  if (request.status !== "approved") {
    throw new ConflictError("Erasure request must be approved before execution");
  }
  if (request.executedAt) throw new ConflictError("Erasure has already been executed");

  const patientId = request.patientId;
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS ?? "7", 10);
  const erasureBlackoutUntil = new Date(Date.now() + retentionDays * 86_400_000);

  await db.transaction(async (tx) => {
    // Anonymize patient demographics (keep record shell for audit trail)
    await tx.update(patientsTable).set({
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
    }).where(eq(patientsTable.id, patientId));

    // Anonymize medical records (keep shells)
    await tx.update(medicalRecordsTable).set({
      chiefComplaint: ERASED,
      diagnosis: ERASED,
      treatment: ERASED,
      notes: null,
      vitals: null,
      updatedAt: new Date(),
    }).where(eq(medicalRecordsTable.patientId, patientId));

    // Soft-delete prescriptions
    await tx.update(prescriptionsTable).set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(prescriptionsTable.patientId, patientId), isNull(prescriptionsTable.deletedAt)));

    // Mark erasure request as executed.
    // erasureBlackoutUntil marks the window during which backups still contain
    // this patient's pre-erasure PHI — see RUNBOOK §2.2 for restore procedure.
    await tx.update(erasureRequestsTable).set({
      status: "executed",
      executedByUserId: req.user!.userId,
      executedAt: new Date(),
      erasureBlackoutUntil,
      updatedAt: new Date(),
    }).where(eq(erasureRequestsTable.id, requestId));
  });

  // Immutable audit entry outside the transaction — must survive even if something goes wrong post-tx
  await logAudit(req, "ERASURE_EXECUTED", "erasure_request", requestId, {
    patientId,
    erasedEntities: ["patient", "medical_records", "prescriptions"],
  });

  return { ok: true, requestId, patientId };
}
