import { Router } from "express";
import { db } from "@workspace/db";
import { ultrasoundRecordsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, and, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";

const router = Router();
router.use(requireAuth);
// front_desk removed: matrix gives them NONE on imaging
router.use("/ultrasound", requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"));

router.get("/ultrasound", async (req: AuthRequest, res) => {
  const { status, patientId } = req.query;
  const lim = Math.min(parseInt((req.query.limit as string) ?? "50") || 50, 200);
  const off = parseInt((req.query.offset as string) ?? "0") || 0;

  // Build SQL conditions — no JS post-filtering (C-05)
  const conditions: any[] = [isNull(ultrasoundRecordsTable.deletedAt)];

  // Doctor scope applied at SQL level
  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) {
      void logAudit(req, "READ_LIST", "ultrasound", undefined, { count: 0 });
      res.json([]); return;
    }
    conditions.push(inArray(ultrasoundRecordsTable.patientId, allowed));
  }

  if (status) conditions.push(eq(ultrasoundRecordsTable.status, status as any));
  if (patientId) {
    const pid = safeParseInt(patientId as string);
    if (!pid) { res.status(400).json({ error: "Invalid patientId" }); return; }
    conditions.push(eq(ultrasoundRecordsTable.patientId, pid));
  }

  const rows = await db.select({
    id: ultrasoundRecordsTable.id,
    patientId: ultrasoundRecordsTable.patientId,
    requestedById: ultrasoundRecordsTable.requestedById,
    performedById: ultrasoundRecordsTable.performedById,
    examType: ultrasoundRecordsTable.examType,
    bodyPart: ultrasoundRecordsTable.bodyPart,
    imageUrl: ultrasoundRecordsTable.imageUrl,
    report: ultrasoundRecordsTable.report,
    status: ultrasoundRecordsTable.status,
    notes: ultrasoundRecordsTable.notes,
    createdAt: ultrasoundRecordsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    requestedBy: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(ultrasoundRecordsTable)
    .leftJoin(patientsTable, eq(ultrasoundRecordsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(ultrasoundRecordsTable.requestedById, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(ultrasoundRecordsTable.createdAt))
    .limit(lim)
    .offset(off);

  void logAudit(req, "READ_LIST", "ultrasound", undefined, { count: rows.length });
  res.json(rows);
});

router.post("/ultrasound", async (req: AuthRequest, res) => {
  const { patientId, requestedById, examType, bodyPart, notes } = req.body;
  if (!patientId || !requestedById || !examType || !bodyPart) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [record] = await db.insert(ultrasoundRecordsTable).values({
    patientId, requestedById, examType, bodyPart, notes,
  }).returning();
  await logAudit(req, "CREATE", "ultrasound", record.id);
  res.status(201).json(record);
});

router.get("/ultrasound/:ultrasoundId",
  requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"),
  async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.ultrasoundId);
    if (!id) { res.status(400).json({ error: "Invalid ultrasound ID" }); return; }
    const [record] = await db.select().from(ultrasoundRecordsTable).where(eq(ultrasoundRecordsTable.id, id));
    if (!record) { res.status(404).json({ error: "Not found" }); return; }

    if (isDoctorScoped(req.user?.role)) {
      const allowed = await getDoctorPatientScope(req.user!.userId);
      if (!allowed.includes(record.patientId)) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    void logRead(req, "ultrasound", id);
    res.json(record);
  }
);

router.patch("/ultrasound/:ultrasoundId", requireRole("super_admin", "admin", "xray_staff"), async (req: AuthRequest, res) => {
  const id = safeParseInt(req.params.ultrasoundId);
  if (!id) { res.status(400).json({ error: "Invalid ultrasound ID" }); return; }

  const { imageUrl, imageFileName, report, status, performedById } = req.body;

  const [record] = await db.update(ultrasoundRecordsTable)
    .set({ imageUrl, imageFileName, report, status, performedById, updatedAt: new Date() })
    .where(eq(ultrasoundRecordsTable.id, id))
    .returning();

  if (!record) {
    res.status(404).json({ error: "Ultrasound record not found" });
    return;
  }

  if (status === "reviewed") {
    const notifData = {
      userId: record.requestedById,
      title: "Ultrasound Report Ready",
      message: `Ultrasound report for ${record.examType} — ${record.bodyPart} is ready for review`,
      type: "ultrasound_ready" as const,
    };
    const [notif] = await db.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
    if (notif) emitToUser(record.requestedById, "notification", notif);
  }

  await logAudit(req, "UPDATE", "ultrasound", record.id);
  res.json(record);
});

export default router;
