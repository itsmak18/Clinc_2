// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { operationsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { alias } from "drizzle-orm/pg-core";
import { eq, isNull, desc, lt, and, inArray } from "drizzle-orm";
import { logAudit } from "../../lib/audit";
import { emitToUser } from "../../lib/sse";
import { staffAssignedSchema, type StaffAssignedItem } from "../../lib/jsonb-schemas";
import { NotFoundError, ValidationError, ForbiddenError } from "../../services/errors";
import type { AuthRequest } from "../../middlewares/auth";

// Fan out an in-app notification (+ SSE) to several recipients. Mirrors the
// lab/x-ray "ready" and prescription send-to-pharmacy patterns. Uses the
// "general" notification type (no operation-specific enum value, like rx→pharmacy).
async function notifyUsers(clinicId: number, userIds: number[], title: string, message: string) {
  const recipients = [...new Set(userIds)].filter(id => id > 0);
  for (const userId of recipients) {
    const [notif] = await db
      .insert(notificationsTable)
      .values({ clinicId, userId, title, message, type: "general" })
      .returning()
      .catch(() => [null]);
    if (notif) emitToUser(userId, "notification", notif);
  }
}

export async function listOperations(req: AuthRequest, params: { status?: string; cursor?: string; limit?: string }) {
  const requester = alias(usersTable, "requester");
  return runInTenantContext(req.user!, async (tx) => {
    const lim = Math.min(parseInt(params.limit ?? "100") || 100, 100);
    const conditions: any[] = [isNull(operationsTable.deletedAt), eq(operationsTable.clinicId, req.user!.clinicId)];
    if (params.status) conditions.push(eq(operationsTable.status, params.status as any));
    if (params.cursor) {
      const cursorId = parseInt(params.cursor);
      if (!isNaN(cursorId)) conditions.push(lt(operationsTable.id, cursorId));
    }

    const rows = await tx
      .select({
        id: operationsTable.id,
        patientId: operationsTable.patientId,
        surgeonId: operationsTable.surgeonId,
        requestedById: operationsTable.requestedById,
        procedureName: operationsTable.procedureName,
        scheduledAt: operationsTable.scheduledAt,
        operatingRoom: operationsTable.operatingRoom,
        status: operationsTable.status,
        staffAssigned: operationsTable.staffAssigned,
        notes: operationsTable.notes,
        createdAt: operationsTable.createdAt,
        patient: { id: patientsTable.id, fullName: patientsTable.fullName },
        surgeon: { id: usersTable.id, fullName: usersTable.fullName },
        requestedBy: { id: requester.id, fullName: requester.fullName },
      })
      .from(operationsTable)
      .leftJoin(patientsTable, eq(operationsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(operationsTable.surgeonId, usersTable.id))
      .leftJoin(requester, eq(operationsTable.requestedById, requester.id))
      .where(and(...conditions))
      .orderBy(desc(operationsTable.id))
      .limit(lim);

    return { data: rows, nextCursor: rows.length === lim ? rows[rows.length - 1].id : null };
  });
}

export async function getOperation(req: AuthRequest, id: number) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(operationsTable.id, id), isNull(operationsTable.deletedAt), eq(operationsTable.clinicId, req.user!.clinicId)];
    const [operation] = await tx
      .select()
      .from(operationsTable)
      .where(and(...conditions));
    if (!operation) throw new NotFoundError("Operation not found");
    return operation;
  });
}

export async function createOperation(
  req: AuthRequest,
  body: {
    patientId?: string;
    surgeonId?: string;
    procedureName?: string;
    scheduledAt?: string;
    operatingRoom?: string;
    staffAssigned?: unknown;
    notes?: string;
  },
) {
  const { patientId, surgeonId, procedureName, scheduledAt, operatingRoom, staffAssigned, notes } = body;
  if (!patientId || !surgeonId || !procedureName || !scheduledAt || !operatingRoom) {
    throw new ValidationError("Missing required fields: patientId, surgeonId, procedureName, scheduledAt, operatingRoom");
  }

  const parsedStaff = staffAssignedSchema.safeParse(staffAssigned ?? []);
  if (!parsedStaff.success) {
    throw new ValidationError("Invalid staffAssigned format");
  }

  // Approval gate: a doctor's surgery request goes UP to admins for scheduling
  // approval (logistics: room/slot/resources). Admins coordinate directly, so an
  // admin-created operation is already "scheduled" — no self-approval loop.
  const needsApproval = req.user!.role === "doctor";
  const status = needsApproval ? "requested" : "scheduled";

  const operation = await runInTenantContext(req.user!, async (tx) => {
    const [row] = await tx
      .insert(operationsTable)
      .values({
        clinicId: req.user!.clinicId,
        patientId: Number(patientId),
        surgeonId: Number(surgeonId),
        requestedById: req.user!.userId,
        procedureName,
        scheduledAt: new Date(scheduledAt),
        operatingRoom,
        status,
        staffAssigned: parsedStaff.data,
        notes,
      })
      .returning();
    await logAudit(req, "CREATE", "operation", row.id);
    return row;
  });

  if (needsApproval) {
    // Route the request to clinic OR coordinators (admins / super_admins).
    const coordinators = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.clinicId, req.user!.clinicId),
        eq(usersTable.isActive, true),
        inArray(usersTable.role, ["admin", "super_admin"] as any),
      ));
    await notifyUsers(
      req.user!.clinicId,
      coordinators.map(c => c.id),
      "Surgery scheduling request",
      `${procedureName} (${operatingRoom}) needs scheduling approval`,
    );
  }

  return operation;
}

export async function updateOperation(
  req: AuthRequest,
  id: number,
  body: { status?: string; notes?: string; staffAssigned?: unknown },
) {
  const { status, notes, staffAssigned } = body;

  let parsedStaff: StaffAssignedItem[] | undefined;
  if (staffAssigned !== undefined) {
    const parsed = staffAssignedSchema.safeParse(staffAssigned);
    if (!parsed.success) {
      throw new ValidationError("Invalid staffAssigned format");
    }
    parsedStaff = parsed.data;
  }

  const operation = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(operationsTable.id, id), isNull(operationsTable.deletedAt), eq(operationsTable.clinicId, req.user!.clinicId)];

    const [existing] = await tx.select().from(operationsTable).where(and(...conditions));
    if (!existing) throw new NotFoundError("Operation not found");

    // Approving a request (requested → scheduled) is a coordinator action: only
    // admins/super_admins may confirm the booking. A doctor cannot approve.
    const isApproval = existing.status === "requested" && status === "scheduled";
    // Rejecting a request (requested → cancelled) is the decline counterpart to
    // approval — same admin-only gate.
    const isRejection = existing.status === "requested" && status === "cancelled";
    if ((isApproval || isRejection) && req.user!.role !== "admin" && req.user!.role !== "super_admin") {
      throw new ForbiddenError(`Only an admin can ${isRejection ? "reject" : "approve"} a surgery request`);
    }

    // Lifecycle advancement (scheduled → in_progress → completed): the operation's
    // own surgeon or an admin/super_admin may move it along — not any other doctor.
    const isLifecycle =
      (existing.status === "scheduled" && status === "in_progress") ||
      (existing.status === "in_progress" && status === "completed");
    if (isLifecycle) {
      const isAdmin = req.user!.role === "admin" || req.user!.role === "super_admin";
      const isSurgeon = req.user!.userId === existing.surgeonId;
      if (!isAdmin && !isSurgeon) {
        throw new ForbiddenError("Only an admin or the operation's surgeon can update its status");
      }
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (status !== undefined) updateData.status = status;
    if (parsedStaff !== undefined) updateData.staffAssigned = parsedStaff;

    const reason = isRejection ? notes?.trim() : undefined;
    if (isRejection) {
      // Preserve the original referral note; append the optional rejection reason
      // beneath it rather than overwriting clinical context.
      if (reason) {
        updateData.notes = existing.notes ? `${existing.notes}\n\n[Rejected] ${reason}` : `[Rejected] ${reason}`;
      }
    } else if (notes !== undefined) {
      updateData.notes = notes;
    }

    const [row] = await tx
      .update(operationsTable)
      .set(updateData)
      .where(and(...conditions))
      .returning();
    const action = isApproval ? "APPROVE"
      : isRejection ? "REJECT"
      : status === "in_progress" ? "START"
      : status === "completed" ? "COMPLETE"
      : "UPDATE";
    await logAudit(req, action, "operation", row.id);
    return { row, wasApproval: isApproval, wasRejection: isRejection, reason };
  });

  if (operation.wasApproval) {
    const team = (operation.row.staffAssigned as StaffAssignedItem[] | null) ?? [];
    await notifyUsers(
      req.user!.clinicId,
      [operation.row.surgeonId, ...team.map(m => m.userId)],
      "Operation scheduled",
      `${operation.row.procedureName} (${operation.row.operatingRoom}) has been approved and scheduled`,
    );
  } else if (operation.wasRejection) {
    // Notify the requester (and surgeon) that the request was declined.
    await notifyUsers(
      req.user!.clinicId,
      [operation.row.requestedById ?? 0, operation.row.surgeonId],
      "Surgery request declined",
      operation.reason
        ? `${operation.row.procedureName} (${operation.row.operatingRoom}) was declined: ${operation.reason}`
        : `${operation.row.procedureName} (${operation.row.operatingRoom}) was declined`,
    );
  }

  return operation.row;
}
