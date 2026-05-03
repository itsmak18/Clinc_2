import { Router } from "express";
import { db } from "@workspace/db";
import { xrayRecordsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { emitToUser } from "../lib/sse";

const router = Router();
router.use(requireAuth);
router.use("/xray", requireRole("super_admin", "admin", "doctor", "xray_staff"));

router.get("/xray", async (req, res) => {
  const { status, patientId } = req.query;
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
    .where(isNull(xrayRecordsTable.deletedAt))
    .orderBy(desc(xrayRecordsTable.createdAt));

  let results = rows;
  if (status) results = results.filter(r => r.status === status);
  if (patientId) results = results.filter(r => r.patientId === parseInt(patientId as string));
  res.json(results);
});

router.post("/xray", async (req: AuthRequest, res) => {
  const { patientId, requestedById, bodyPart, notes } = req.body;
  if (!patientId || !requestedById || !bodyPart) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [xray] = await db.insert(xrayRecordsTable).values({
    patientId, requestedById, bodyPart, notes,
  }).returning();
  await logAudit(req, "CREATE", "xray", xray.id);
  res.status(201).json(xray);
});

router.get("/xray/:xrayId", async (req, res) => {
  const [xray] = await db.select().from(xrayRecordsTable).where(eq(xrayRecordsTable.id, parseInt(req.params.xrayId as string)));
  if (!xray) { res.status(404).json({ error: "Not found" }); return; }
  res.json(xray);
});

router.patch("/xray/:xrayId", async (req: AuthRequest, res) => {
  const { imageUrl, imageFileName, report, status, performedById } = req.body;
  const [xray] = await db.update(xrayRecordsTable)
    .set({ imageUrl, imageFileName, report, status, performedById, updatedAt: new Date() })
    .where(eq(xrayRecordsTable.id, parseInt(req.params.xrayId as string)))
    .returning();

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
