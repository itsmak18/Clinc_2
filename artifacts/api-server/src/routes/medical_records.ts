import { Router } from "express";
import { db } from "@workspace/db";
import { medicalRecordsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { isDoctorScoped, getDoctorPatientScope, assertMedicalRecordInScope } from "../lib/scope";
import { vitalsSchema } from "../lib/jsonb-schemas";


const router = Router();
router.use(requireAuth);

// ── Read list: doctors, nurses, admins only ───────────────────────────────
// Front desk is BLOCKED from medical records entirely
router.get("/medical-records",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  async (req: AuthRequest, res) => {
    const { patientId, doctorId } = req.query;

    const conditions: any[] = [isNull(medicalRecordsTable.deletedAt)];

    if (isDoctorScoped(req.user?.role)) {
      const allowed = await getDoctorPatientScope(req.user!.userId);
      if (allowed.length === 0) {
        void logAudit(req, "READ_LIST", "medical_record", undefined, { count: 0 });
        res.json([]); return;
      }
      conditions.push(inArray(medicalRecordsTable.patientId, allowed));
    }

    if (patientId) {
      const pid = safeParseInt(patientId as string);
      if (!pid) { res.status(400).json({ error: "Invalid patientId" }); return; }
      conditions.push(eq(medicalRecordsTable.patientId, pid));
    }
    if (doctorId) {
      const did = safeParseInt(doctorId as string);
      if (!did) { res.status(400).json({ error: "Invalid doctorId" }); return; }
      conditions.push(eq(medicalRecordsTable.doctorId, did));
    }

    const results = await db.select({
      id: medicalRecordsTable.id,
      patientId: medicalRecordsTable.patientId,
      doctorId: medicalRecordsTable.doctorId,
      appointmentId: medicalRecordsTable.appointmentId,
      chiefComplaint: medicalRecordsTable.chiefComplaint,
      diagnosis: medicalRecordsTable.diagnosis,
      treatment: medicalRecordsTable.treatment,
      notes: medicalRecordsTable.notes,
      vitals: medicalRecordsTable.vitals,
      isGlobal: medicalRecordsTable.isGlobal,
      createdAt: medicalRecordsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName },
      doctor: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(medicalRecordsTable)
      .leftJoin(patientsTable, eq(medicalRecordsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(medicalRecordsTable.doctorId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(medicalRecordsTable.createdAt));

    void logAudit(req, "READ_LIST", "medical_record", undefined, { count: results.length });
    res.json(results);
  }
);

// ── Create: ONLY doctors and admins ───────────────────────────────────────
router.post("/medical-records",
  requireRole("super_admin", "admin", "doctor"),
  async (req: AuthRequest, res) => {
    const { patientId, doctorId, appointmentId, chiefComplaint, diagnosis, treatment, notes, vitals } = req.body;
    if (!patientId || !doctorId || !chiefComplaint || !diagnosis || !treatment) {
      res.status(400).json({ error: "Missing required fields: patientId, doctorId, chiefComplaint, diagnosis, treatment" });
      return;
    }

    const parsedVitals = vitalsSchema.safeParse(vitals);
    if (!parsedVitals.success) {
      res.status(400).json({ error: "Invalid vitals", details: parsedVitals.error.flatten() });
      return;
    }

    const pid = safeParseInt(String(patientId));
    if (!pid) { res.status(400).json({ error: "Invalid patientId" }); return; }
    const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.id, pid));
    if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

    const did = safeParseInt(String(doctorId));
    if (!did) { res.status(400).json({ error: "Invalid doctorId" }); return; }
    const [doctor] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, did));
    if (!doctor || doctor.role !== "doctor") { res.status(400).json({ error: "doctorId must reference a user with doctor role" }); return; }

    const [record] = await db.insert(medicalRecordsTable).values({
      patientId: pid, doctorId: did, appointmentId, chiefComplaint, diagnosis, treatment, notes, vitals: parsedVitals.data ?? null,
    }).returning();
    await logAudit(req, "CREATE", "medical_record", record.id);
    res.status(201).json(record);
  }
);

// ── Read single record ────────────────────────────────────────────────────
router.get("/medical-records/:recordId",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  async (req: AuthRequest, res) => {
    const recordId = safeParseInt(req.params.recordId);
    if (!recordId) { res.status(400).json({ error: "Invalid record ID" }); return; }

    // Doctor scope: Rule 1 (isGlobal) → Rule 2 (ownership) → Rule 3 (deny 403)
    if (!await assertMedicalRecordInScope(req, recordId)) {
      res.status(403).json({ error: "access_denied", reason: "record_not_owned_or_global" });
      return;
    }

    const [record] = await db.select().from(medicalRecordsTable).where(eq(medicalRecordsTable.id, recordId));
    if (!record) { res.status(404).json({ error: "Not found" }); return; }

    void logRead(req, "medical_record", recordId);
    res.json(record);
  }
);

// ── Update: original doctor (vitals-only for nurse), admin anytime ────────
router.patch("/medical-records/:recordId",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  async (req: AuthRequest, res) => {
    const recordId = safeParseInt(req.params.recordId);
    if (!recordId) { res.status(400).json({ error: "Invalid record ID" }); return; }

    const [existing] = await db.select().from(medicalRecordsTable).where(eq(medicalRecordsTable.id, recordId));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const role = req.user!.role;
    const isAdmin = ["super_admin", "admin"].includes(role);

    // Nurse: vitals-only update, no ownership or lock checks
    if (role === "nurse") {
      const parsedVitals = vitalsSchema.safeParse(req.body.vitals);
      if (!parsedVitals.success) {
        res.status(400).json({ error: "Invalid vitals", details: parsedVitals.error.flatten() });
        return;
      }
      const [record] = await db.update(medicalRecordsTable)
        .set({ vitals: parsedVitals.data ?? null, updatedAt: new Date() })
        .where(eq(medicalRecordsTable.id, recordId))
        .returning();
      await logAudit(req, "UPDATE", "medical_record", record.id, { fields: ["vitals"] });
      res.json(record);
      return;
    }

    // Ownership check: only the original doctor or admin can edit
    const isOwner = existing.doctorId === req.user!.userId;
    if (!isOwner && !isAdmin) {
      await logAudit(req, "UNAUTHORIZED_EDIT_ATTEMPT", "medical_record", recordId, {
        ownerId: existing.doctorId,
        attemptedBy: req.user!.userId,
      });
      res.status(403).json({ error: "Only the original doctor or an admin can edit this record" });
      return;
    }

    // S-02: 24-hour edit lock
    const LOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
    const isLocked = Date.now() - new Date(existing.createdAt).getTime() > LOCK_WINDOW_MS;
    if (isLocked && !isAdmin) {
      await logAudit(req, "EDIT_LOCKED_DENIED", "medical_record", existing.id, {
        createdAt: existing.createdAt,
        attemptedAt: new Date(),
      });
      res.status(403).json({
        error: "Medical record is read-only after 24 hours.",
        lockedSince: new Date(new Date(existing.createdAt).getTime() + LOCK_WINDOW_MS),
        canRequestEdit: "Contact admin to request an amendment.",
      });
      return;
    }

    const { chiefComplaint, diagnosis, treatment, notes, vitals } = req.body;

    const parsedVitals = vitalsSchema.safeParse(vitals);
    if (!parsedVitals.success) {
      res.status(400).json({ error: "Invalid vitals", details: parsedVitals.error.flatten() });
      return;
    }

    const before = { ...existing };
    const [record] = await db.update(medicalRecordsTable)
      .set({ chiefComplaint, diagnosis, treatment, notes, vitals: parsedVitals.data ?? null, updatedAt: new Date() })
      .where(eq(medicalRecordsTable.id, recordId))
      .returning();

    if (!record) { res.status(404).json({ error: "Medical record not found" }); return; }
    await logAudit(req, "UPDATE", "medical_record", record.id, { before, after: record });
    res.json(record);
  }
);

// ── Set global flag: super_admin only ────────────────────────────────────
const globalFlagSchema = z.object({
  isGlobal: z.boolean(),
  reason: z.string().min(20, "reason must be at least 20 characters"),
});

router.patch("/medical-records/:recordId/global-flag",
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const recordId = safeParseInt(req.params.recordId);
    if (!recordId) { res.status(400).json({ error: "Invalid record ID" }); return; }

    const parsed = globalFlagSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }

    const [existing] = await db.select({ id: medicalRecordsTable.id }).from(medicalRecordsTable)
      .where(and(eq(medicalRecordsTable.id, recordId), isNull(medicalRecordsTable.deletedAt)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [record] = await db.update(medicalRecordsTable)
      .set({ isGlobal: parsed.data.isGlobal, globalReason: parsed.data.reason, updatedAt: new Date() })
      .where(eq(medicalRecordsTable.id, recordId))
      .returning();

    await logAudit(req, "UPDATE", "medical_record", record.id, {
      isGlobal: parsed.data.isGlobal,
      reason: parsed.data.reason,
    });
    res.json(record);
  }
);

export default router;
