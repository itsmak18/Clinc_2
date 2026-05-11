import { Router } from "express";
import { db } from "@workspace/db";
import { operationsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { staffAssignedSchema } from "../lib/jsonb-schemas";

const router = Router();
router.use(requireAuth);

// Nurses can view the OR schedule (read-only); only doctors/admins can create/update
router.get("/operations", requireRole("super_admin", "admin", "doctor", "nurse"), async (req, res) => {
  const { status } = req.query;
  const conditions: any[] = [isNull(operationsTable.deletedAt)];
  if (status) conditions.push(eq(operationsTable.status, status as any));

  const results = await db.select({
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
  }).from(operationsTable)
    .leftJoin(patientsTable, eq(operationsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(operationsTable.surgeonId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(operationsTable.scheduledAt));

  res.json(results);
});

router.post("/operations", requireRole("super_admin", "admin", "doctor"), async (req: AuthRequest, res) => {
  const { patientId, surgeonId, procedureName, scheduledAt, operatingRoom, staffAssigned, notes } = req.body;
  if (!patientId || !surgeonId || !procedureName || !scheduledAt || !operatingRoom) {
    res.status(400).json({ error: "Missing required fields: patientId, surgeonId, procedureName, scheduledAt, operatingRoom" });
    return;
  }

  // ── JSONB guard: validate staffAssigned before any DB write ───────────────
  const parsedStaff = staffAssignedSchema.safeParse(staffAssigned ?? []);
  if (!parsedStaff.success) {
    res.status(422).json({
      error: "Invalid staffAssigned format",
      details: parsedStaff.error.flatten(),
    });
    return;
  }

  const [operation] = await db.insert(operationsTable).values({
    patientId, surgeonId, procedureName,
    scheduledAt: new Date(scheduledAt),
    operatingRoom,
    staffAssigned: parsedStaff.data,
    notes,
  }).returning();
  await logAudit(req, "CREATE", "operation", operation.id);
  res.status(201).json(operation);
});

router.get("/operations/:operationId", requireRole("super_admin", "admin", "doctor", "nurse"), async (req, res) => {
  const id = safeParseInt(req.params.operationId);
  if (!id) { res.status(400).json({ error: "Invalid operation ID" }); return; }
  const [operation] = await db.select().from(operationsTable)
    .where(and(eq(operationsTable.id, id), isNull(operationsTable.deletedAt)));
  if (!operation) { res.status(404).json({ error: "Not found" }); return; }
  res.json(operation);
});

router.patch("/operations/:operationId", requireRole("super_admin", "admin", "doctor"), async (req: AuthRequest, res) => {
  const id = safeParseInt(req.params.operationId);
  if (!id) { res.status(400).json({ error: "Invalid operation ID" }); return; }

  const { status, notes, staffAssigned } = req.body;

  // ── JSONB guard on PATCH: validate staffAssigned if provided ──────────────
  let parsedStaff: ReturnType<typeof staffAssignedSchema.safeParse> | null = null;
  if (staffAssigned !== undefined) {
    parsedStaff = staffAssignedSchema.safeParse(staffAssigned);
    if (!parsedStaff.success) {
      res.status(422).json({
        error: "Invalid staffAssigned format",
        details: parsedStaff.error.flatten(),
      });
      return;
    }
  }

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (status !== undefined) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;
  if (parsedStaff !== null && parsedStaff.success) updateData.staffAssigned = parsedStaff.data;

  const [operation] = await db.update(operationsTable)
    .set(updateData)
    .where(and(eq(operationsTable.id, id), isNull(operationsTable.deletedAt)))
    .returning();
  if (!operation) { res.status(404).json({ error: "Not found" }); return; }
  await logAudit(req, "UPDATE", "operation", operation.id);
  res.json(operation);
});

export default router;
