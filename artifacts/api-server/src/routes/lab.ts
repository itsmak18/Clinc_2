import { Router } from "express";
import { db } from "@workspace/db";
import { labTestsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, and, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";

const router = Router();
router.use(requireAuth);
router.use("/lab", requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"));

router.get("/lab/tests", async (req: AuthRequest, res) => {
  const { status, patientId } = req.query;
  const lim = Math.min(parseInt((req.query.limit as string) ?? "50") || 50, 200);
  const off = parseInt((req.query.offset as string) ?? "0") || 0;

  // Build SQL conditions BEFORE .limit() — no JS post-filtering (C-05)
  const conditions: any[] = [isNull(labTestsTable.deletedAt)];

  // Doctor scope applied at SQL level
  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) { res.json([]); return; }
    conditions.push(inArray(labTestsTable.patientId, allowed));
  }

  if (status) conditions.push(eq(labTestsTable.status, status as any));
  if (patientId) {
    const pid = safeParseInt(patientId as string); // N-04: safeParseInt
    if (!pid) { res.status(400).json({ error: "Invalid patientId" }); return; }
    conditions.push(eq(labTestsTable.patientId, pid));
  }

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
    .where(and(...conditions))
    .orderBy(desc(labTestsTable.createdAt))
    .limit(lim)
    .offset(off);

  void logAudit(req, "READ_LIST", "lab_test", undefined, { count: rows.length });
  res.json(rows);
});

router.post("/lab/tests", requireRole("super_admin", "admin", "doctor", "lab_staff"), async (req: AuthRequest, res) => {
  const { patientId, requestedById, testName, notes, appointmentId } = req.body; // M-05: accept appointmentId
  if (!patientId || !requestedById || !testName) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [test] = await db.insert(labTestsTable).values({
    patientId, requestedById, testName, notes,
    appointmentId: appointmentId ?? null, // M-05: persist FK when provided
  }).returning();
  await logAudit(req, "CREATE", "lab_test", test.id);
  res.status(201).json(test);
});

router.get("/lab/tests/:testId",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"),
  async (req: AuthRequest, res) => {
    const testId = safeParseInt(req.params.testId);
    if (!testId) { res.status(400).json({ error: "Invalid test ID" }); return; }
    const [test] = await db.select().from(labTestsTable).where(eq(labTestsTable.id, testId));
    if (!test) { res.status(404).json({ error: "Not found" }); return; }

    if (isDoctorScoped(req.user?.role)) {
      const allowed = await getDoctorPatientScope(req.user!.userId);
      if (!allowed.includes(test.patientId)) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    void logRead(req, "lab_test", testId);
    res.json(test);
  }
);

router.patch("/lab/tests/:testId", requireRole("super_admin", "admin", "lab_staff"), async (req: AuthRequest, res) => {
  const testId = safeParseInt(req.params.testId);
  if (!testId) { res.status(400).json({ error: "Invalid test ID" }); return; }

  const { results, status, performedById } = req.body;

  const [test] = await db.update(labTestsTable)
    .set({ results, status, performedById, updatedAt: new Date() })
    .where(eq(labTestsTable.id, testId))
    .returning();

  if (!test) {
    res.status(404).json({ error: "Lab test not found" });
    return;
  }

  if (status === "completed") {
    const notifData = {
      userId: test.requestedById,
      title: "Lab Results Ready",
      message: `${test.testName} results are ready for review`,
      type: "lab_ready" as const,
    };
    const [notif] = await db.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
    if (notif) emitToUser(test.requestedById, "notification", notif);
  }

  await logAudit(req, "UPDATE", "lab_test", test.id);
  res.json(test);
});

export default router;
