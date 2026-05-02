import { Router } from "express";
import { db } from "@workspace/db";
import { labTestsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);

router.get("/lab/tests", async (req, res) => {
  const { status, patientId } = req.query;
  const rows = await db.select({
    id: labTestsTable.id,
    patientId: labTestsTable.patientId,
    requestedById: labTestsTable.requestedById,
    performedById: labTestsTable.performedById,
    testName: labTestsTable.testName,
    results: labTestsTable.results,
    status: labTestsTable.status,
    notes: labTestsTable.notes,
    createdAt: labTestsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    requestedBy: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(labTestsTable)
    .leftJoin(patientsTable, eq(labTestsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(labTestsTable.requestedById, usersTable.id))
    .where(isNull(labTestsTable.deletedAt))
    .orderBy(desc(labTestsTable.createdAt));

  let results = rows;
  if (status) results = results.filter(r => r.status === status);
  if (patientId) results = results.filter(r => r.patientId === parseInt(patientId as string));
  res.json(results);
});

router.post("/lab/tests", async (req: AuthRequest, res) => {
  const { patientId, requestedById, testName, notes } = req.body;
  if (!patientId || !requestedById || !testName) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [test] = await db.insert(labTestsTable).values({
    patientId, requestedById, testName, notes,
  }).returning();
  await logAudit(req, "CREATE", "lab_test", test.id);
  res.status(201).json(test);
});

router.get("/lab/tests/:testId", async (req, res) => {
  const [test] = await db.select().from(labTestsTable).where(eq(labTestsTable.id, parseInt(req.params.testId)));
  if (!test) { res.status(404).json({ error: "Not found" }); return; }
  res.json(test);
});

router.patch("/lab/tests/:testId", async (req: AuthRequest, res) => {
  const { results, status, performedById } = req.body;
  const [test] = await db.update(labTestsTable)
    .set({ results, status, performedById, updatedAt: new Date() })
    .where(eq(labTestsTable.id, parseInt(req.params.testId)))
    .returning();

  if (status === "completed") {
    await db.insert(notificationsTable).values({
      userId: test.requestedById,
      title: "Lab Results Ready",
      message: `${test.testName} results are ready for review`,
      type: "lab_ready",
    }).catch(() => {});
  }

  await logAudit(req, "UPDATE", "lab_test", test.id);
  res.json(test);
});

export default router;
