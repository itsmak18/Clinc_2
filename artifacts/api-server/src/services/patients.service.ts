import { db } from "@workspace/db";
import {
  patientsTable, appointmentsTable, medicalRecordsTable, xrayRecordsTable,
  labTestsTable, invoicesTable, usersTable,
} from "@workspace/db";
import { eq, isNull, ilike, or, and, sql, desc, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { isDoctorScoped, getDoctorPatientScope, assertPatientInScope } from "../lib/scope";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

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
  params: { search?: string; limit?: string; offset?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 200);
  const off = parseInt(params.offset ?? "0") || 0;

  const conditions: any[] = [isNull(patientsTable.deletedAt)];

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) return { patients: [], total: 0 };
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

  const whereClause = and(...conditions);
  const patients = await db.select().from(patientsTable).where(whereClause).limit(lim).offset(off);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(patientsTable).where(whereClause);

  void logAudit(req, "READ_LIST", "patient", undefined, { count: patients.length });
  return { patients: patients.map(p => serializeForRole(p, req.user!.role)), total: Number(count) };
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
  const [patient] = await db.insert(patientsTable).values({ mrn, ...data, gender: data.gender as "male" | "female" }).returning();
  await logAudit(req, "CREATE", "patient", patient.id);
  return patient;
}

export async function getPatient(req: AuthRequest, patientId: number) {
  if (!await assertPatientInScope(req, patientId, "patient")) {
    throw new ForbiddenError();
  }
  const [patient] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), isNull(patientsTable.deletedAt)));
  if (!patient) throw new NotFoundError("patient", patientId);

  void logRead(req, "patient", patientId);
  return serializeForRole(patient, req.user!.role);
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

  updateData.updatedAt = new Date();
  const [patient] = await db.update(patientsTable).set(updateData).where(eq(patientsTable.id, patientId)).returning();
  if (!patient) throw new NotFoundError("patient", patientId);

  await logAudit(req, "UPDATE", "patient", patient.id, { fields: Object.keys(updateData) });
  return patient;
}

export async function deletePatient(req: AuthRequest, patientId: number) {
  await db.update(patientsTable).set({ deletedAt: new Date() }).where(eq(patientsTable.id, patientId));
  await logAudit(req, "DELETE", "patient", patientId);
}

export async function getPatientSummary(req: AuthRequest, patientId: number) {
  if (!await assertPatientInScope(req, patientId, "patient")) {
    throw new ForbiddenError();
  }
  const [patient] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), isNull(patientsTable.deletedAt)));
  if (!patient) throw new NotFoundError("patient", patientId);

  void logRead(req, "patient_summary", patientId);

  const [recentAppointments, recentRecords, recentXrays, recentLabTests, pendingInvoices] = await Promise.all([
    db.select({
      id: appointmentsTable.id, reason: appointmentsTable.reason, status: appointmentsTable.status,
      scheduledAt: appointmentsTable.scheduledAt,
      doctor: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(appointmentsTable)
      .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
      .where(eq(appointmentsTable.patientId, patientId))
      .orderBy(desc(appointmentsTable.scheduledAt)).limit(5),
    db.select().from(medicalRecordsTable)
      .where(eq(medicalRecordsTable.patientId, patientId))
      .orderBy(desc(medicalRecordsTable.createdAt)).limit(5),
    db.select().from(xrayRecordsTable)
      .where(eq(xrayRecordsTable.patientId, patientId))
      .orderBy(desc(xrayRecordsTable.createdAt)).limit(5),
    db.select().from(labTestsTable)
      .where(eq(labTestsTable.patientId, patientId))
      .orderBy(desc(labTestsTable.createdAt)).limit(5),
    db.select().from(invoicesTable)
      .where(eq(invoicesTable.patientId, patientId)),
  ]);

  const outstandingBalance = pendingInvoices
    .filter(inv => inv.status === "pending")
    .reduce((s, inv) => s + parseFloat(String(inv.total)), 0);

  return { patient, recentAppointments, recentRecords, recentXrays, recentLabTests, outstandingBalance };
}
