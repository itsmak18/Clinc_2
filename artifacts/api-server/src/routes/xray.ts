import { Router } from "express";
import { db } from "@workspace/db";
import { xrayRecordsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, and, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";

const router = Router();
router.use(requireAuth);
router.use("/xray", requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"));

router.get("/xray", async (req: AuthRequest, res) => {
  const { status, patientId } = req.query;
  const lim = Math.min(parseInt((req.query.limit as string) ?? "50") || 50, 200);
  const off = parseInt((req.query.offset as string) ?? "0") || 0;

  // Build SQL conditions BEFORE .limit() — no JS post-filtering (C-05)
  const conditions: any[] = [isNull(xrayRecordsTable.deletedAt)];

  // Doctor scope applied at SQL level
  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) { res.json([]); return; }
    conditions.push(inArray(xrayRecordsTable.patientId, allowed));
  }

  if (status) conditions.push(eq(xrayRecordsTable.status, status as any));
  if (patientId) {
    const pid = safeParseInt(patientId as string); // N-04: safeParseInt
    if (!pid) { res.status(400).json({ error: "Invalid patientId" }); return; }
    conditions.push(eq(xrayRecordsTable.patientId, pid));
  }

  const rows = await db.select({
    id: xrayRecordsTable.id,
    patientId: xrayRecordsTable.patientId,
    requestedById: xrayRecordsTable.requestedById,
    performedById: xrayRecordsTable.performedById,
    bodyPart: xrayRecordsTable.bodyPart,
    imageUrl: xrayRecordsTable.imageUrl,
    report: xrayRecordsTable.report,
    status: xrayRecordsTable.status,
    notes: xrayRecordsTable.notes,
    createdAt: xrayRecordsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    requestedBy: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(xrayRecordsTable)
    .leftJoin(patientsTable, eq(xrayRecordsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(xrayRecordsTable.requestedById, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(xrayRecordsTable.createdAt))
    .limit(lim)
    .offset(off);

  void logAudit(req, "READ_LIST", "xray", undefined, { count: rows.length });
  res.json(rows);
});

router.post("/xray", async (req: AuthRequest, res) => {
  const { patientId, requestedById, bodyPart, notes, appointmentId } = req.body; // M-05: accept appointmentId
  if (!patientId || !requestedById || !bodyPart) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [xray] = await db.insert(xrayRecordsTable).values({
    patientId, requestedById, bodyPart, notes,
    appointmentId: appointmentId ?? null, // M-05: persist FK when provided
  }).returning();
  await logAudit(req, "CREATE", "xray", xray.id);
  res.status(201).json(xray);
});

router.get("/xray/:xrayId",
  requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"),
  async (req: AuthRequest, res) => {
    const xrayId = safeParseInt(req.params.xrayId);
    if (!xrayId) { res.status(400).json({ error: "Invalid xray ID" }); return; }
    const [xray] = await db.select().from(xrayRecordsTable).where(eq(xrayRecordsTable.id, xrayId));
    if (!xray) { res.status(404).json({ error: "Not found" }); return; }

    if (isDoctorScoped(req.user?.role)) {
      const allowed = await getDoctorPatientScope(req.user!.userId);
      if (!allowed.includes(xray.patientId)) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    void logRead(req, "xray", xrayId);
    res.json(xray);
  }
);

router.patch("/xray/:xrayId", requireRole("super_admin", "admin", "xray_staff"), async (req: AuthRequest, res) => {
  const xrayId = safeParseInt(req.params.xrayId);
  if (!xrayId) { res.status(400).json({ error: "Invalid xray ID" }); return; }

  const { imageUrl, imageFileName, report, status, performedById } = req.body;

  const [xray] = await db.update(xrayRecordsTable)
    .set({ imageUrl, imageFileName, report, status, performedById, updatedAt: new Date() })
    .where(eq(xrayRecordsTable.id, xrayId))
    .returning();

  if (!xray) {
    res.status(404).json({ error: "X-ray record not found" });
    return;
  }

  if (status === "reviewed") {
    const notifData = {
      userId: xray.requestedById,
      title: "X-Ray Report Ready",
      message: `X-ray report for ${xray.bodyPart} is ready for review`,
      type: "xray_ready" as const,
    };
    const [notif] = await db.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
    if (notif) emitToUser(xray.requestedById, "notification", notif);
  }

  await logAudit(req, "UPDATE", "xray", xray.id);
  res.json(xray);
});

export default router;
