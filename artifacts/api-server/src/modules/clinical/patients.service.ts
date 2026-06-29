// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import {
  patientsTable, appointmentsTable, medicalRecordsTable, xrayRecordsTable,
  labTestsTable, invoicesTable, usersTable,
} from "@workspace/db";
import { eq, isNull, ilike, or, and, sql, desc, lt, inArray } from "drizzle-orm";
import { logAudit, logRead, auditSnapshot } from "../../lib/audit";
import { isDoctorScoped, getDoctorPatientScope, assertPatientInScope } from "../../lib/scope";
import { escapeLike } from "../../lib/validators";
import { encrypt, decrypt, encryptNullable, decryptNullable } from "../../lib/field-encryption";
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from "../../services/errors";
import type { AuthRequest } from "../../middlewares/auth";

function decryptPatient<T extends { allergies?: string | null; emergencyContact?: string | null }>(p: T): T {
  return {
    ...p,
    allergies: decryptNullable(p.allergies),
    emergencyContact: decryptNullable(p.emergencyContact),
  };
}

async function generateMRN(): Promise<string> {
  // db.execute (drizzle node-postgres) returns a pg QueryResult ({ rows, ... }),
  // which is NOT array-iterable — read .rows, don't array-destructure the result.
  const { rows } = await db.execute(sql`SELECT nextval('mrn_seq') as nextval`) as any;
  const nextval = rows[0].nextval;
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `MRN-${ym}-${String(nextval).padStart(5, "0")}`;
}

// Fields a role must NOT receive on a patient object (HIPAA minimum-necessary):
//   front_desk → clinical (allergies/bloodType): they handle logistics, not care.
//   nurse/doctor → contact PII (address/phone/emergencyContact): clinical staff
//     work from identity + clinical data; contact is front-desk's domain.
const REDACTED_PATIENT_FIELDS: Record<string, ReadonlyArray<string>> = {
  front_desk: ["allergies", "bloodType"],
  nurse:      ["address", "phone", "emergencyContact"],
  doctor:     ["address", "phone", "emergencyContact"],
};

// Only oversight roles see the full national ID card number on reads. Everyone
// else (front desk included) gets the last 4 digits only — enough to confirm a
// match without exposing the full sensitive ID in list/detail/summary views.
// The full value is still entered at registration and searchable server-side.
const FULL_ID_CARD_ROLES = new Set(["super_admin", "admin"]);

function maskIdCard(value: unknown): string {
  const s = String(value ?? "");
  return s.length > 4 ? `••••${s.slice(-4)}` : s;
}

export function serializeForRole<T extends Record<string, any>>(patient: T, role: string): T {
  const clone: Record<string, any> = { ...patient };
  const redact = REDACTED_PATIENT_FIELDS[role];
  if (redact?.length) for (const f of redact) delete clone[f];
  if (!FULL_ID_CARD_ROLES.has(role) && clone.idCardNumber != null) {
    clone.idCardNumber = maskIdCard(clone.idCardNumber);
  }
  return clone as T;
}

/**
 * Which patient-summary sections a role may receive. The summary is a
 * cross-module aggregator, so it MUST obey each role's module access (HIPAA
 * minimum-necessary) — otherwise it leaks data the role can't reach via the
 * module pages. Aligns with the route-access matrix:
 *   - nurse:      none — identity/allergies/appointments only (vitals are their own
 *                 table now, so the old "MR read for vitals" rationale is gone)
 *   - doctor:     full clinical (records/labs/xray, already doctor-scoped) — NOT billing
 *   - front_desk: billing balance only — clinical redacted (also see serializeForRole)
 *   - xray/lab:   their own modality only
 */
type SummarySection = "records" | "xrays" | "labs" | "balance";
const SUMMARY_SECTIONS: Record<string, ReadonlyArray<SummarySection>> = {
  super_admin: ["records", "xrays", "labs", "balance"],
  admin:       ["records", "xrays", "labs", "balance"],
  doctor:      ["records", "xrays", "labs"],
  nurse:       [],
  front_desk:  ["balance"],
  xray_staff:  ["xrays"],
  lab_staff:   ["labs"],
};
function canSeeSummarySection(role: string, section: SummarySection): boolean {
  return (SUMMARY_SECTIONS[role] ?? []).includes(section);
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
    const q = `%${escapeLike(params.search.slice(0, 100))}%`;
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
  await logAudit(req, "READ_LIST", "patient", undefined, { count: patients.length });
  return { patients: patients.map(p => serializeForRole(decryptPatient(p), req.user!.role)), total: Number(count), nextCursor };
}

export async function createPatient(
  req: AuthRequest,
  data: {
    idCardNumber: string;
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
  if (!data.idCardNumber || !data.fullName || !data.dateOfBirth || !data.gender || !data.phone) {
    throw new ValidationError("Missing required fields: idCardNumber, fullName, dateOfBirth, gender, phone");
  }
  if (new Date(data.dateOfBirth) > new Date()) {
    throw new ValidationError("Date of birth cannot be in the future");
  }
  if (!["male", "female"].includes(data.gender)) {
    throw new ValidationError("Gender must be 'male' or 'female'");
  }

  const idCardNumber = data.idCardNumber.trim();
  if (!/^\d{11,}$/.test(idCardNumber)) {
    throw new ValidationError("ID card number must be digits only and at least 11 digits");
  }
  // Pre-check the per-clinic unique ID card constraint so a duplicate returns a
  // clear ConflictError instead of a raw 23505. The DB unique index
  // (patient_clinic_idcard_uq) remains the authoritative backstop.
  const [dup] = await db.select({ id: patientsTable.id }).from(patientsTable)
    .where(and(eq(patientsTable.clinicId, req.user!.clinicId), eq(patientsTable.idCardNumber, idCardNumber)));
  if (dup) {
    throw new ConflictError("A patient with this ID card number already exists");
  }

  const mrn = await generateMRN();
  const [patient] = await db.insert(patientsTable).values({
    mrn, ...data,
    idCardNumber,
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

  await logRead(req, "patient", patientId);
  return serializeForRole(decryptPatient(patient), req.user!.role);
}

export async function updatePatient(
  req: AuthRequest,
  patientId: number,
  body: Record<string, any>,
) {
  const role = req.user!.role;
  let updateData: Record<string, any> = {};

  // Doctors are scoped to their assigned patients (or an active break-glass
  // session); this throws ForbiddenError when out of scope. No-op for the
  // non-scoped roles (admin / front_desk).
  if (isDoctorScoped(role)) await assertPatientInScope(req, patientId, "patient");

  if (role === "front_desk") {
    const { fullName, fullNameAr, phone, address, emergencyContact, dateOfBirth } = body;
    updateData = { fullName, fullNameAr, phone, address, emergencyContact, dateOfBirth };
  } else if (role === "nurse") {
    const { fullName, fullNameAr, phone, address, emergencyContact, bloodType, allergies, dateOfBirth } = body;
    updateData = { fullName, fullNameAr, phone, address, emergencyContact, bloodType, allergies, dateOfBirth };
  } else if (role === "doctor") {
    // Doctors maintain ONLY the clinical allergies field — never demographics or
    // contact PII (which they can't even see). Whitelisting to `allergies` keeps
    // the shared PATCH route safe even if extra fields are sent in the body.
    updateData = { allergies: body.allergies };
  } else {
    const {
      idCardNumber, fullName, fullNameAr, phone, address, bloodType, allergies, emergencyContact, isActive, dateOfBirth,
      insuranceProvider, insurancePolicyNum, insuranceMemberId, insuranceExpiry, insuranceGroupNum,
    } = body;
    if (insuranceExpiry && isNaN(new Date(insuranceExpiry).getTime())) {
      throw new ValidationError("Invalid insurance expiry date");
    }
    updateData = {
      idCardNumber: typeof idCardNumber === "string" ? idCardNumber.trim() : undefined,
      fullName, fullNameAr, phone, address, bloodType, allergies, emergencyContact, isActive, dateOfBirth,
      insuranceProvider, insurancePolicyNum, insuranceMemberId,
      insuranceExpiry: insuranceExpiry ? new Date(insuranceExpiry) : undefined,
      insuranceGroupNum,
    };
  }

  Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k]);
  if (Object.keys(updateData).length === 0) throw new ValidationError("No valid fields to update");

  // ID card number is unique per clinic — if it's being changed, reject a
  // collision with another patient up front (DB unique index is the backstop).
  if ("idCardNumber" in updateData) {
    if (!updateData.idCardNumber) throw new ValidationError("ID card number cannot be empty");
    if (!/^\d{11,}$/.test(updateData.idCardNumber)) {
      throw new ValidationError("ID card number must be digits only and at least 11 digits");
    }
    const [dup] = await db.select({ id: patientsTable.id }).from(patientsTable)
      .where(and(
        eq(patientsTable.clinicId, req.user!.clinicId),
        eq(patientsTable.idCardNumber, updateData.idCardNumber),
      ));
    if (dup && dup.id !== patientId) {
      throw new ConflictError("A patient with this ID card number already exists");
    }
  }

  // Encrypt PHI fields before storing
  if ("allergies" in updateData) updateData.allergies = encryptNullable(updateData.allergies);
  if ("emergencyContact" in updateData) updateData.emergencyContact = encryptNullable(updateData.emergencyContact);

  updateData.updatedAt = new Date();

  const whereConditions: any[] = [eq(patientsTable.id, patientId), eq(patientsTable.clinicId, req.user!.clinicId)];

  const [before] = await db.select().from(patientsTable).where(and(...whereConditions));
  const [patient] = await db.update(patientsTable).set(updateData).where(and(...whereConditions)).returning();
  if (!patient) throw new NotFoundError("patient", patientId);

  // Change history: real before→after for non-encrypted fields; encrypted PHI
  // fields are redacted by auditSnapshot. `fields` lists the patched columns
  // (the reliable changed-set; ciphertext comparison would false-positive).
  const fields = Object.keys(updateData).filter(k => k !== "updatedAt");
  await logAudit(req, "UPDATE", "patient", patient.id, { fields }, auditSnapshot(before), auditSnapshot(patient));
  return decryptPatient(patient);
}

export async function deletePatient(req: AuthRequest, patientId: number) {
  const whereConditions: any[] = [eq(patientsTable.id, patientId), eq(patientsTable.clinicId, req.user!.clinicId)];
  const [before] = await db.select().from(patientsTable).where(and(...whereConditions));
  const [after] = await db.update(patientsTable).set({ deletedAt: new Date() }).where(and(...whereConditions)).returning();
  await logAudit(req, "DELETE", "patient", patientId, null, auditSnapshot(before), auditSnapshot(after));
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
  await logRead(req, "patient_summary", patientId);
  const role = req.user!.role;
  const decrypted = decryptPatient(result.patient);
  // Minimum-necessary projection: only return the sections this role has module
  // access to (and run the patient itself through serializeForRole, which the
  // summary previously skipped — leaking allergies/bloodType to front_desk).
  const outstandingBalance = canSeeSummarySection(role, "balance")
    ? result.pendingInvoices
        .filter(inv => inv.status === "pending")
        .reduce((s, inv) => s + parseFloat(String(inv.total)), 0)
    : 0;

  return {
    patient: serializeForRole(decrypted, role),
    recentAppointments: result.recentAppointments,
    recentRecords:  canSeeSummarySection(role, "records") ? result.recentRecords  : [],
    recentXrays:    canSeeSummarySection(role, "xrays")   ? result.recentXrays    : [],
    recentLabTests: canSeeSummarySection(role, "labs")    ? result.recentLabTests : [],
    outstandingBalance,
  };
}
