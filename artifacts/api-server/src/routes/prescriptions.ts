import { Router } from "express";
import { db } from "@workspace/db";
import { prescriptionsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, and, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";

const router = Router();
router.use(requireAuth);

// ── Read: nurses and lab staff can also read prescriptions ────────────────
router.get("/prescriptions",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"),
  async (req: AuthRequest, res) => {
    const { patientId } = req.query;
    const lim = Math.min(parseInt((req.query.limit as string) ?? "50") || 50, 200);
    const off = parseInt((req.query.offset as string) ?? "0") || 0;

    // Build SQL conditions BEFORE .limit() — no JS post-filtering (C-05)
    const conditions: any[] = [isNull(prescriptionsTable.deletedAt)];

    // Doctor scope applied at SQL level
    if (isDoctorScoped(req.user?.role)) {
      const allowed = await getDoctorPatientScope(req.user!.userId);
      if (allowed.length === 0) { res.json([]); return; }
      conditions.push(inArray(prescriptionsTable.patientId, allowed));
    }

    if (patientId) {
      const pid = safeParseInt(patientId as string); // N-04: safeParseInt
      if (!pid) { res.status(400).json({ error: "Invalid patientId" }); return; }
      conditions.push(eq(prescriptionsTable.patientId, pid));
    }

    const rows = await db.select({
      id: prescriptionsTable.id,
      patientId: prescriptionsTable.patientId,
      doctorId: prescriptionsTable.doctorId,
      recordId: prescriptionsTable.recordId,
      medications: prescriptionsTable.medications,
      notes: prescriptionsTable.notes,
      createdAt: prescriptionsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName },
      doctor: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(prescriptionsTable)
      .leftJoin(patientsTable, eq(prescriptionsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(prescriptionsTable.doctorId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(prescriptionsTable.createdAt))
      .limit(lim)
      .offset(off);

    res.json(rows);
  }
);

// ── Create: ONLY doctors and admins ───────────────────────────────────────
router.post("/prescriptions",
  requireRole("super_admin", "admin", "doctor"),
  async (req: AuthRequest, res) => {
    const { patientId, doctorId, recordId, medications, notes } = req.body;
    if (!patientId || !doctorId || !medications?.length) {
      res.status(400).json({ error: "Missing required fields: patientId, doctorId, medications" });
      return;
    }

    // Validate patient exists
    const pid = safeParseInt(String(patientId));
    if (!pid) { res.status(400).json({ error: "Invalid patientId" }); return; }
    const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.id, pid));
    if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

    const [prescription] = await db.insert(prescriptionsTable).values({
      patientId: pid, doctorId, recordId, medications, notes,
    }).returning();
    await logAudit(req, "CREATE", "prescription", prescription.id);
    res.status(201).json(prescription);
  }
);

// ── Read single ──────────────────────────────────────────────────────────
router.get("/prescriptions/:prescriptionId",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"),
  async (req, res) => {
    const id = safeParseInt(req.params.prescriptionId);
    if (!id) { res.status(400).json({ error: "Invalid prescription ID" }); return; }
    const [prescription] = await db.select().from(prescriptionsTable).where(eq(prescriptionsTable.id, id));
    if (!prescription) { res.status(404).json({ error: "Not found" }); return; }
    res.json(prescription);
  }
);

// ── Prescriptions are IMMUTABLE medical documents ─────────────────────────
// No PATCH endpoint. Admins can soft-delete with a reason for corrections.
router.delete("/prescriptions/:prescriptionId",
  requireRole("super_admin", "admin"),
  async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.prescriptionId);
    if (!id) { res.status(400).json({ error: "Invalid prescription ID" }); return; }

    const { reason } = req.body;
    if (!reason) {
      res.status(400).json({ error: "A reason is required to void a prescription" });
      return;
    }

    await db.update(prescriptionsTable)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(prescriptionsTable.id, id));
    await logAudit(req, "VOID_PRESCRIPTION", "prescription", id, { reason });
    res.json({ success: true });
  }
);

export default router;
