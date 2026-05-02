import { Router } from "express";
import { db } from "@workspace/db";
import { operationsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);
router.use("/operations", requireRole("super_admin", "admin", "doctor"));

router.get("/operations", async (req, res) => {
  const { status } = req.query;
  const rows = await db.select({
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
    .where(isNull(operationsTable.deletedAt))
    .orderBy(desc(operationsTable.scheduledAt));

  let results = rows;
  if (status) results = results.filter(r => r.status === status);
  res.json(results);
});

router.post("/operations", async (req: AuthRequest, res) => {
  const { patientId, surgeonId, procedureName, scheduledAt, operatingRoom, staffAssigned, notes } = req.body;
  if (!patientId || !surgeonId || !procedureName || !scheduledAt || !operatingRoom) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [operation] = await db.insert(operationsTable).values({
    patientId, surgeonId, procedureName,
    scheduledAt: new Date(scheduledAt),
    operatingRoom,
    staffAssigned: staffAssigned || [],
    notes,
  }).returning();
  await logAudit(req, "CREATE", "operation", operation.id);
  res.status(201).json(operation);
});

router.get("/operations/:operationId", async (req, res) => {
  const [operation] = await db.select().from(operationsTable).where(eq(operationsTable.id, parseInt(req.params.operationId)));
  if (!operation) { res.status(404).json({ error: "Not found" }); return; }
  res.json(operation);
});

router.patch("/operations/:operationId", async (req: AuthRequest, res) => {
  const { status, notes, staffAssigned } = req.body;
  const [operation] = await db.update(operationsTable)
    .set({ status, notes, staffAssigned, updatedAt: new Date() })
    .where(eq(operationsTable.id, parseInt(req.params.operationId)))
    .returning();
  await logAudit(req, "UPDATE", "operation", operation.id);
  res.json(operation);
});

export default router;
