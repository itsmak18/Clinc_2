// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import {
  patientsTable, appointmentsTable, medicalRecordsTable, xrayRecordsTable,
  labTestsTable, invoicesTable, usersTable,
} from "@workspace/db";
import { eq, isNull, ilike, or, and, sql, desc, lt, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { isDoctorScoped, getDoctorPatientScope, assertPatientInScope } from "../lib/scope";
import { encrypt, decrypt, encryptNullable, decryptNullable } from "../lib/field-encryption";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

function decryptPatient<T extends { allergies?: string | null; emergencyContact?: string | null }>(p: T): T {
  return {
    ...p,
    allergies: decryptNullable(p.allergies),
    emergencyContact: decryptNullable(p.emergencyContact),
  };
}

async function generateMRN(): Promise<string> {
  const [{ nextval }] = await db.execute(sql`SELECT nextval('mrn_seq') as nextval`) as any;
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `MRN-${ym}-${String(nextval).padStart(5, "0")}`;
}

export function serializeForRole<T extends Record<string, any>>(
  patient: T,
  role: string,
): Omit<T, "allergies" | "bloodType"> | T {
  if (role === "front_desk") {
    const { allergies, bloodType, ...personalData } = patient;
    return personalData as Omit<T, "allergies" | "bloodType">;
  }
  return patient;
}

export async function listPatients(
  req: AuthRequest,
  params: { search?: string; limit?: string; cursor?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);

  const conditions: any[] = [isNull(patientsTable.deletedAt), eq(patientsTable.clinicId, req.user!.clinicId)];

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) return { patients: [], total: 0, nextCursor: null };
    conditions.push(inArray(patientsTable.id, allowed));
  }

  if (params.search) {
    const q = `%${params.search}%`;
    conditions.push(or(
      ilike(patientsTable.fullName, q),
      ilike(patientsTable.fullNameAr, q),
      ilike(patientsTable.mrn, q),
      ilike(patientsTable.phone, q),
    ));
  }
  if (params.cursor) {
    const cursorId = parseInt(params.cursor);
    if (!isNaN(cursorId)) conditions.push(lt(patientsTable.id, cursorId));
  }

  const whereClause = and(...conditions);
  // Phase 2.2 rollout: both queries go through runInTenantContext so the DB
  // enforces clinic isolation. Also fixes a pre-existing leak in the count
  // query, which was missing the clinic filter (covered by the app-layer
  // filter only â€” RLS now plugs it as a second line of defense).
  const { patients, count } = await runInTenantContext(req.user!, async (tx) => {
    const rows = await tx.select().from(patientsTable).where(whereClause).orderBy(desc(patientsTable.id)).limit(lim);
    const [c] = await tx.select({ count: sql<number>`count(*)` }).from(patientsTable)
      .where(and(isNull(patientsTable.deletedAt), eq(patientsTable.clinicId, req.user!.clinicId)));
    return { patients: rows, count: c.count };
  });

  const nextCursor = patients.length === lim ? patients[patients.length - 1].id : null;
  void logAudit(req, "READ_LIST", "patient", undefined, { count: patients.length });
  return { patients: patients.map(p => serializeForRole(decryptPatient(p), req.user!.role)), total: Number(count), nextCursor };
}

export async function createPatient(
  req: AuthRequest,
  data: {
    fullName: string;
    fullNameAr?: string;
    dateOfBirth: string;
    gender: string;
    phone: string;
    address?: string;
    bloodType?: string;
    allergies?: string;
    emergencyContact?: string;
  },
) {
  if (!data.fullName || !data.dateOfBirth || !data.gender || !data.phone) {
    throw new ValidationError("Missing required fields: fullName, dateOfBirth, gender, phone");
  }
  if (new Date(data.dateOfBirth) > new Date()) {
    throw new ValidationError("Date of birth cannot be in the future");
  }
  if (!["male", "female"].includes(data.gender)) {
    throw new ValidationError("Gender must be 'male' or 'female'");
  }

  const mrn = await generateMRN();
  const [patient] = await db.insert(patientsTable).values({
    mrn, ...data,
    clinicId: req.user!.clinicId,
    gender: data.gender as "male" | "female",
    allergies: encryptNullable(data.allergies ?? null),
    emergencyContact: encryptNullable(data.emergencyContact ?? null),
  }).returning();
  await logAudit(req, "CREATE", "patient", patient.id);
  return decryptPatient(patient);
}

export async function getPatient(req: AuthRequest, patientId: number) {
  await assertPatientInScope(req, patientId, "patient");
  // Phase 2.2 demo conversion: read goes through runInTenantContext so the DB
  // enforces clinic isolation via the RLS tenant_isolation policy (0015). The
  // existing `eq(patientsTable.clinicId, req.user!.clinicId)` filter is kept
  // belt-and-braces until the full rollout completes; the integration tests
  // (rls-tenant-context + cross-tenant) cover both layers.
  const patient = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(patientsTable.id, patientId), isNull(patientsTable.deletedAt), eq(patientsTable.clinicId, req.user!.clinicId)];
    const [row] = await tx.select().from(patientsTable).where(and(...conditions));
    return row;
  });
  if (!patient) throw new NotFoundError("patient", patientId);

  void logRead(req, "patient", patientId);
  return serializeForRole(decryptPatient(patient), req.user!.role);
}

export async function updatePatient(
  req: AuthRequest,
  patientId: number,
  body: Record<string, any>,
) {
  const role = req.user!.role;
  let updateData: Record<string, any> = {};

  if (role === "front_desk") {
    const { fullName, fullNameAr, phone, address, emergencyContact, dateOfBirth } = body;
    updateData = { fullName, fullNameAr, phone, address, emergencyContact, dateOfBirth };
  } else if (role === "nurse") {
    const { fullName, fullNameAr, phone, address, emergencyContact, bloodType, allergies, dateOfBirth } = body;
    updateData = { fullName, fullNameAr, phone, address, emergencyContact, bloodType, allergies, dateOfBirth };
  } else {
    const {
      fullName, fullNameAr, phone, address, bloodType, allergies, emergencyContact, isActive, dateOfBirth,
      insuranceProvider, insurancePolicyNum, insuranceMemberId, insuranceExpiry, insuranceGroupNum,
    } = body;
    if (insuranceExpiry && isNaN(new Date(insuranceExpiry).getTime())) {
      throw new ValidationError("Invalid insurance expiry date");
    }
    updateData = {
      fullName, fullNameAr, phone, address, bloodType, allergies, emergencyContact, isActive, dateOfBirth,
      insuranceProvider, insurancePolicyNum, insuranceMemberId,
      insuranceExpiry: insuranceExpiry ? new Date(insuranceExpiry) : undefined,
      insuranceGroupNum,
    };
  }

  Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k]);
  if (Object.keys(updateData).length === 0) throw new ValidationError("No valid fields to update");

  // Encrypt PHI fields before storing
  if ("allergies" in updateData) updateData.allergies = encryptNullable(updateData.allergies);
  if ("emergencyContact" in updateData) updateData.emergencyContact = encryptNullable(updateData.emergencyContact);

  updateData.updatedAt = new Date();

  const whereConditions: any[] = [eq(patientsTable.id, patientId), eq(patientsTable.clinicId, req.user!.clinicId)];

  const [patient] = await db.update(patientsTable).set(updateData).where(and(...whereConditions)).returning();
  if (!patient) throw new NotFoundError("patient", patientId);

  await logAudit(req, "UPDATE", "patient", patient.id, { fields: Object.keys(updateData) });
  return decryptPatient(patient);
}

export async function deletePatient(req: AuthRequest, patientId: number) {
  const whereConditions: any[] = [eq(patientsTable.id, patientId), eq(patientsTable.clinicId, req.user!.clinicId)];
  await db.update(patientsTable).set({ deletedAt: new Date() }).where(and(...whereConditions));
  await logAudit(req, "DELETE", "patient", patientId);
}

export async function getPatientSummary(req: AuthRequest, patientId: number) {
  await assertPatientInScope(req, patientId, "patient");

  // Phase 2.2 rollout: every query in the summary fan-out goes through the
  // tenant context â€” RLS enforces clinic isolation on each of the six tables
  // (patients, appointments, medical_records, xray_records, lab_tests,
  // invoices). The summary previously trusted FK chains to keep secondary
  // tables clinic-correct; RLS makes that explicit.
  const result = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(patientsTable.id, patientId), isNull(patientsTable.deletedAt), eq(patientsTable.clinicId, req.user!.clinicId)];
    const [patient] = await tx.select().from(patientsTable).where(and(...conditions));
    if (!patient) return null;

    const [recentAppointments, recentRecords, recentXrays, recentLabTests, pendingInvoices] = await Promise.all([
      tx.select({
        id: appointmentsTable.id, reason: appointmentsTable.reason, status: appointmentsTable.status,
        scheduledAt: appointmentsTable.scheduledAt,
        doctor: { id: usersTable.id, fullName: usersTable.fullName },
      }).from(appointmentsTable)
        .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
        .where(eq(appointmentsTable.patientId, patientId))
        .orderBy(desc(appointmentsTable.scheduledAt)).limit(5),
      tx.select().from(medicalRecordsTable)
        .where(eq(medicalRecordsTable.patientId, patientId))
        .orderBy(desc(medicalRecordsTable.createdAt)).limit(5),
      tx.select().from(xrayRecordsTable)
        .where(eq(xrayRecordsTable.patientId, patientId))
        .orderBy(desc(xrayRecordsTable.createdAt)).limit(5),
      tx.select().from(labTestsTable)
        .where(eq(labTestsTable.patientId, patientId))
        .orderBy(desc(labTestsTable.createdAt)).limit(5),
      tx.select().from(invoicesTable)
        .where(eq(invoicesTable.patientId, patientId)),
    ]);

    return { patient, recentAppointments, recentRecords, recentXrays, recentLabTests, pendingInvoices };
  });

  if (!result) throw new NotFoundError("patient", patientId);
  void logRead(req, "patient_summary", patientId);
  const decrypted = decryptPatient(result.patient);
  const outstandingBalance = result.pendingInvoices
    .filter(inv => inv.status === "pending")
    .reduce((s, inv) => s + parseFloat(String(inv.total)), 0);

  return {
    patient: decrypted,
    recentAppointments: result.recentAppointments,
    recentRecords: result.recentRecords,
    recentXrays: result.recentXrays,
    recentLabTests: result.recentLabTests,
    outstandingBalance,
  };
}
