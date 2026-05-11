import { db } from "@workspace/db";
import { appointmentsTable, medicalRecordsTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import type { AuthRequest } from "../middlewares/auth";
import { logAudit, logDenied } from "./audit";

// Doctors are the only role with patient-level scoping. All other clinical
// roles (admin, nurse, front_desk, lab_staff, xray_staff) keep full access.
const SCOPED_ROLE = "doctor";

export function isDoctorScoped(role: string | undefined): boolean {
  return role === SCOPED_ROLE;
}

/**
 * Returns the patient IDs a doctor is authorized to see — i.e. patients with
 * at least one appointment where doctor_id = the given doctor's user ID.
 *
 * Always returns a fresh array (not cached) so newly-assigned patients become
 * visible immediately after their first appointment is created.
 */
export async function getDoctorPatientScope(doctorId: number): Promise<number[]> {
  const rows = await db.selectDistinct({ patientId: appointmentsTable.patientId })
    .from(appointmentsTable)
    .where(eq(appointmentsTable.doctorId, doctorId));
  return rows.map(r => r.patientId);
}

/**
 * For routes that fetch a single patient. If the requester is a doctor and the
 * patient is outside their scope, writes an audit entry and returns false.
 * Returns true if access is allowed (non-doctor roles always pass).
 */
export async function assertPatientInScope(
  req: AuthRequest,
  patientId: number,
  entityType: string = "patient",
): Promise<boolean> {
  if (!isDoctorScoped(req.user?.role)) return true;

  const allowed = await getDoctorPatientScope(req.user!.userId);
  if (allowed.includes(patientId)) return true;

  await logAudit(req, "ACCESS_DENIED_OUT_OF_SCOPE", entityType, patientId, {
    doctorId: req.user!.userId,
    reason: "patient not assigned to doctor",
  });
  return false;
}

/**
 * For routes that fetch a single medical record. Applies SCOPED rules (Section 1):
 *   Rule 1: isGlobal = true → allow regardless of doctor_id
 *   Rule 2: record.doctorId = current user.id → allow
 *   Rule 3: deny with DENIED audit entry
 * Non-doctor roles always pass (caller must enforce requireRole separately).
 */
export async function assertMedicalRecordInScope(
  req: AuthRequest,
  recordId: number,
): Promise<boolean> {
  if (!isDoctorScoped(req.user?.role)) return true;

  const [record] = await db
    .select({ doctorId: medicalRecordsTable.doctorId, isGlobal: medicalRecordsTable.isGlobal })
    .from(medicalRecordsTable)
    .where(eq(medicalRecordsTable.id, recordId));

  if (!record) return true; // let the caller handle 404

  if (record.isGlobal) return true;
  if (record.doctorId === req.user!.userId) return true;

  await logDenied(req, "medical_record", recordId, "record_not_owned_or_global");
  return false;
}
