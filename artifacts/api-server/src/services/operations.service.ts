import { db } from "@workspace/db";
import { operationsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, and } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { staffAssignedSchema } from "../lib/jsonb-schemas";
import { NotFoundError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listOperations(req: AuthRequest, status?: string) {
  const conditions: any[] = [isNull(operationsTable.deletedAt), eq(operationsTable.clinicId, req.user!.clinicId)];
  if (status) conditions.push(eq(operationsTable.status, status as any));

  return db
    .select({
      id: operationsTable.id,
      patientId: operationsTable.patientId,
      surgeonId: operationsTable.surgeonId,
      procedureName: operationsTable.procedureName,
      scheduledAt: operationsTable.scheduledAt,
      operatingRoom: operationsTable.operatingRoom,
      status: operationsTable.status,
      staffAssigned: operationsTable.staffAssigned,
      notes: operationsTable.notes,
      createdAt: operationsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName },
      surgeon: { id: usersTable.id, fullName: usersTable.fullName },
    })
    .from(operationsTable)
    .leftJoin(patientsTable, eq(operationsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(operationsTable.surgeonId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(operationsTable.scheduledAt));
}

export async function getOperation(req: AuthRequest, id: number) {
  const conditions: any[] = [eq(operationsTable.id, id), isNull(operationsTable.deletedAt), eq(operationsTable.clinicId, req.user!.clinicId)];
  const [operation] = await db
    .select()
    .from(operationsTable)
    .where(and(...conditions));
  if (!operation) throw new NotFoundError("Operation not found");
  return operation;
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

  const [operation] = await db
    .insert(operationsTable)
    .values({
      clinicId: req.user!.clinicId,
      patientId: Number(patientId),
      surgeonId: Number(surgeonId),
      procedureName,
      scheduledAt: new Date(scheduledAt),
      operatingRoom,
      staffAssigned: parsedStaff.data,
      notes,
    })
    .returning();

  void logAudit(req, "CREATE", "operation", operation.id);
  return operation;
}

export async function updateOperation(
  req: AuthRequest,
  id: number,
  body: { status?: string; notes?: string; staffAssigned?: unknown },
) {
  const { status, notes, staffAssigned } = body;

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (status !== undefined) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;

  if (staffAssigned !== undefined) {
    const parsedStaff = staffAssignedSchema.safeParse(staffAssigned);
    if (!parsedStaff.success) {
      throw new ValidationError("Invalid staffAssigned format");
    }
    updateData.staffAssigned = parsedStaff.data;
  }

  const conditions: any[] = [eq(operationsTable.id, id), isNull(operationsTable.deletedAt), eq(operationsTable.clinicId, req.user!.clinicId)];

  const [operation] = await db
    .update(operationsTable)
    .set(updateData)
    .where(and(...conditions))
    .returning();

  if (!operation) throw new NotFoundError("Operation not found");
  void logAudit(req, "UPDATE", "operation", operation.id);
  return operation;
}
