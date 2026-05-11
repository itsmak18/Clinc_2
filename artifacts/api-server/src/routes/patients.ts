import { Router } from "express";
import { db } from "@workspace/db";
import {
  patientsTable, appointmentsTable, medicalRecordsTable, xrayRecordsTable,
  labTestsTable, invoicesTable, usersTable
} from "@workspace/db";
import { eq, isNull, ilike, or, and, sql, desc, sum, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { isDoctorScoped, getDoctorPatientScope, assertPatientInScope } from "../lib/scope";

const router = Router();
router.use(requireAuth);

// ── MRN Generation (sequence bootstrapped in seed.ts, not here) ───────────
async function generateMRN(): Promise<string> {
  const [{ nextval }] = await db.execute(sql`SELECT nextval('mrn_seq') as nextval`) as any;
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `MRN-${ym}-${String(nextval).padStart(5, "0")}`;
}

// Strip clinical fields for roles that only get FIELD[pii] access (SEC-1, SEC-6)
function serializeForRole<T extends Record<string, any>>(patient: T, role: string): Omit<T, "allergies" | "bloodType"> | T {
  if (role === "front_desk") {
    const { allergies, bloodType, ...personalData } = patient;
    return personalData as Omit<T, "allergies" | "bloodType">;
  }
  return patient;
}

// ── List patients (all clinical roles can view basic info) ────────────────
router.get("/patients",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"),
  async (req: AuthRequest, res) => {
    const { search, limit = "50", offset = "0" } = req.query;
    const lim = Math.min(parseInt(limit as string) || 50, 200);
    const off = parseInt(offset as string) || 0;

    const conditions: any[] = [isNull(patientsTable.deletedAt)];

    if (isDoctorScoped(req.user?.role)) {
      const allowed = await getDoctorPatientScope(req.user!.userId);
      if (allowed.length === 0) { res.json({ patients: [], total: 0 }); return; }
      conditions.push(inArray(patientsTable.id, allowed));
    }

    if (search) {
      const q = `%${search}%`;
      conditions.push(
        or(
          ilike(patientsTable.fullName, q),
          ilike(patientsTable.fullNameAr, q),
          ilike(patientsTable.mrn, q),
          ilike(patientsTable.phone, q),
        )
      );
    }

    const whereClause = and(...conditions);
    const patients = await db.select().from(patientsTable)
      .where(whereClause)
      .limit(lim)
      .offset(off);

    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(patientsTable).where(whereClause);
    void logAudit(req, "READ_LIST", "patient", undefined, { count: patients.length });
    const role = req.user!.role;
    res.json({ patients: patients.map(p => serializeForRole(p, role)), total: Number(count) });
  }
);

// ── Create patient ────────────────────────────────────────────────────────
router.post("/patients",
  requireRole("super_admin", "admin", "nurse", "front_desk"),
  async (req: AuthRequest, res) => {
    const { fullName, fullNameAr, dateOfBirth, gender, phone, address, bloodType, allergies, emergencyContact } = req.body;
    if (!fullName || !dateOfBirth || !gender || !phone) {
      res.status(400).json({ error: "Missing required fields: fullName, dateOfBirth, gender, phone" });
      return;
    }

    // Validate DOB is not in the future
    if (new Date(dateOfBirth) > new Date()) {
      res.status(400).json({ error: "Date of birth cannot be in the future" });
      return;
    }

    // Validate gender enum
    if (!["male", "female"].includes(gender)) {
      res.status(400).json({ error: "Gender must be 'male' or 'female'" });
      return;
    }

    const mrn = await generateMRN();
    const [patient] = await db.insert(patientsTable).values({
      mrn, fullName, fullNameAr, dateOfBirth, gender, phone, address, bloodType, allergies, emergencyContact,
    }).returning();
    await logAudit(req, "CREATE", "patient", patient.id);
    res.status(201).json(patient);
  }
);

// ── Get single patient ───────────────────────────────────────────────────
router.get("/patients/:patientId",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"),
  async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) { res.status(400).json({ error: "Invalid patient ID" }); return; }

    if (!await assertPatientInScope(req, patientId, "patient")) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const [patient] = await db.select().from(patientsTable).where(and(eq(patientsTable.id, patientId), isNull(patientsTable.deletedAt)));
    if (!patient) { res.status(404).json({ error: "Not found" }); return; }

    void logRead(req, "patient", patientId);
    res.json(serializeForRole(patient, req.user!.role));
  }
);

// ── Update personal data (receptionist/nurse/admin) ──────────────────────
router.patch("/patients/:patientId",
  requireRole("super_admin", "admin", "nurse", "front_desk"),
  async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) { res.status(400).json({ error: "Invalid patient ID" }); return; }

    const role = req.user!.role;

    // Determine which fields this role can update
    let updateData: Record<string, any> = {};

    if (role === "front_desk") {
      // Receptionist: personal data ONLY (including DOB per spec)
      const { fullName, fullNameAr, phone, address, emergencyContact, dateOfBirth } = req.body;
      updateData = { fullName, fullNameAr, phone, address, emergencyContact, dateOfBirth };
    } else if (role === "nurse") {
      // Nurse: personal + basic clinical fields
      const { fullName, fullNameAr, phone, address, emergencyContact, bloodType, allergies, dateOfBirth } = req.body;
      updateData = { fullName, fullNameAr, phone, address, emergencyContact, bloodType, allergies, dateOfBirth };
    } else {
      // Admin/Super Admin: full access including insurance fields (S-05)
      const {
        fullName, fullNameAr, phone, address, bloodType, allergies, emergencyContact, isActive, dateOfBirth,
        insuranceProvider, insurancePolicyNum, insuranceMemberId, insuranceExpiry, insuranceGroupNum,
      } = req.body;

      // Validate insuranceExpiry date if provided
      if (insuranceExpiry && isNaN(new Date(insuranceExpiry).getTime())) {
        res.status(400).json({ error: "Invalid insurance expiry date" });
        return;
      }

      updateData = {
        fullName, fullNameAr, phone, address, bloodType, allergies, emergencyContact, isActive, dateOfBirth,
        insuranceProvider, insurancePolicyNum, insuranceMemberId,
        insuranceExpiry: insuranceExpiry ? new Date(insuranceExpiry) : undefined,
        insuranceGroupNum,
      };
    }

    // Remove undefined fields to avoid overwriting with null
    Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k]);

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    updateData.updatedAt = new Date();

    const [patient] = await db.update(patientsTable)
      .set(updateData)
      .where(eq(patientsTable.id, patientId))
      .returning();

    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }
    await logAudit(req, "UPDATE", "patient", patient.id, { fields: Object.keys(updateData) });
    res.json(patient);
  }
);

// ── Soft delete patient (admin only) ──────────────────────────────────────
router.delete("/patients/:patientId",
  requireRole("super_admin", "admin"),
  async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) { res.status(400).json({ error: "Invalid patient ID" }); return; }
    await db.update(patientsTable).set({ deletedAt: new Date() }).where(eq(patientsTable.id, patientId));
    await logAudit(req, "DELETE", "patient", patientId);
    res.json({ success: true });
  }
);

// ── Patient summary (doctors/admin only for medical data) ─────────────────
router.get("/patients/:patientId/summary",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  async (req: AuthRequest, res) => {
    const patientId = safeParseInt(req.params.patientId);
    if (!patientId) { res.status(400).json({ error: "Invalid patient ID" }); return; }

    if (!await assertPatientInScope(req, patientId, "patient")) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const [patient] = await db.select().from(patientsTable).where(and(eq(patientsTable.id, patientId), isNull(patientsTable.deletedAt)));
    if (!patient) { res.status(404).json({ error: "Not found" }); return; }

    void logRead(req, "patient_summary", patientId);

    const recentAppointments = await db.select({
      id: appointmentsTable.id, reason: appointmentsTable.reason, status: appointmentsTable.status,
      scheduledAt: appointmentsTable.scheduledAt,
      doctor: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(appointmentsTable)
      .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
      .where(eq(appointmentsTable.patientId, patientId))
      .orderBy(desc(appointmentsTable.scheduledAt)).limit(5);

    const recentRecords = await db.select().from(medicalRecordsTable)
      .where(eq(medicalRecordsTable.patientId, patientId))
      .orderBy(desc(medicalRecordsTable.createdAt)).limit(5);

    const recentXrays = await db.select().from(xrayRecordsTable)
      .where(eq(xrayRecordsTable.patientId, patientId))
      .orderBy(desc(xrayRecordsTable.createdAt)).limit(5);

    const recentLabTests = await db.select().from(labTestsTable)
      .where(eq(labTestsTable.patientId, patientId))
      .orderBy(desc(labTestsTable.createdAt)).limit(5);

    const pendingInvoices = await db.select().from(invoicesTable)
      .where(eq(invoicesTable.patientId, patientId));
    const outstandingBalance = pendingInvoices
      .filter(inv => inv.status === "pending")
      .reduce((s, inv) => s + parseFloat(String(inv.total)), 0);

    res.json({ patient, recentAppointments, recentRecords, recentXrays, recentLabTests, outstandingBalance });
  }
);

export default router;
