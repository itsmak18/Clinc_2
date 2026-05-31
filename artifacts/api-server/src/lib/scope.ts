import { db } from "@workspace/db";
import { doctorPatientsTable, medicalRecordsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { AuthRequest } from "../middlewares/auth";
import { logAudit, logDenied } from "./audit";
import { runtime } from "./runtime";
import { logger } from "./logger";
import { ForbiddenError } from "../services/errors";

const SCOPED_ROLE = "doctor";
const SCOPE_CACHE_TTL_SEC = 60;

export function isDoctorScoped(role: string | undefined): boolean {
  return role === SCOPED_ROLE;
}

/**
 * Returns the patient IDs a doctor is authorized to see — i.e. patients who
 * appear in the doctor_patients materialized scope table for this doctor.
 *
 * The table is maintained by recordDoctorPatientLink() on every appointment
 * create/update. O(1) indexed lookup instead of O(N) SELECT DISTINCT on the
 * full appointments table.
 *
 * Cached in Redis for 60 s (key: doctor_scope:<doctorId>).
 * Call invalidateDoctorScope() from appointment create/update/cancel.
 */
export async function getDoctorPatientScope(doctorId: number): Promise<number[]> {
  const cacheKey = `doctor_scope:${doctorId}`;

  // Try Redis cache (only present when SESSION_STORE=redis and runtime exposes scopeCache)
  try {
    const cached = await (runtime as any).scopeCache?.get(cacheKey) as string | null | undefined;
    if (cached) return JSON.parse(cached) as number[];
  } catch {
    // Cache miss or unavailable — fall through to DB
  }

  const rows = await db.select({ patientId: doctorPatientsTable.patientId })
    .from(doctorPatientsTable)
    .where(eq(doctorPatientsTable.doctorId, doctorId));

  const ids = rows.map(r => r.patientId);

  try {
    await (runtime as any).scopeCache?.set(cacheKey, JSON.stringify(ids), "EX", SCOPE_CACHE_TTL_SEC);
  } catch {
    // Cache write failed — non-fatal
  }

  return ids;
}

/**
 * Upsert a doctor ↔ patient link into the materialized scope table.
 * Called from createAppointment() and updateAppointment() whenever a
 * (doctor, patient) pair is established or modified.
 *
 * Idempotent: ON CONFLICT updates last_seen_at to the newer value.
 */
export async function recordDoctorPatientLink(
  clinicId: number,
  doctorId: number,
  patientId: number,
  lastSeenAt: Date = new Date(),
): Promise<void> {
  await db.insert(doctorPatientsTable)
    .values({ clinicId, doctorId, patientId, lastSeenAt })
    .onConflictDoUpdate({
      target: [doctorPatientsTable.doctorId, doctorPatientsTable.patientId],
      set: { lastSeenAt: sql`excluded.last_seen_at` },
    });
}

/**
 * Invalidate the doctor scope cache after any appointment mutation.
 * Called from createAppointment / updateAppointment / cancelAppointment.
 */
export async function invalidateDoctorScope(doctorId: number): Promise<void> {
  const cacheKey = `doctor_scope:${doctorId}`;
  try {
    await (runtime as any).scopeCache?.del(cacheKey);
  } catch (err) {
    logger.warn({ err, doctorId, cacheKey }, "doctor_scope_cache_invalidation_failed");
  }
}

/**
 * For routes that fetch a single patient. If the requester is a doctor and the
 * patient is outside their scope, writes an audit entry and throws ForbiddenError.
 * Resolves silently (void) when access is allowed (non-doctor roles always pass).
 *
 * Throws (not bool) — the previous bool-returning shape was a foot-gun: forgetting
 * to check the return value silently granted access. Throwing routes the denial
 * through the canonical error envelope via asyncHandler.
 */
export async function assertPatientInScope(
  req: AuthRequest,
  patientId: number,
  entityType: string = "patient",
): Promise<void> {
  if (!isDoctorScoped(req.user?.role)) return;

  const allowed = await getDoctorPatientScope(req.user!.userId);
  if (allowed.includes(patientId)) return;

  await logAudit(req, "ACCESS_DENIED_OUT_OF_SCOPE", entityType, patientId, {
    doctorId: req.user!.userId,
    reason: "patient not assigned to doctor",
  } as object);
  throw new ForbiddenError("patient_out_of_scope");
}

/**
 * For routes that fetch a single medical record. Rules:
 *   1. record.doctorId = current user.id → allow
 *   2. deny + DENIED audit entry + ForbiddenError
 * Non-doctor roles always pass.
 *
 * Returns silently (void) when access is allowed; throws ForbiddenError on deny.
 * If the record doesn't exist, returns silently and lets the caller handle 404.
 */
export async function assertMedicalRecordInScope(
  req: AuthRequest,
  recordId: number,
): Promise<void> {
  if (!isDoctorScoped(req.user?.role)) return;

  const [record] = await db
    .select({ doctorId: medicalRecordsTable.doctorId })
    .from(medicalRecordsTable)
    .where(eq(medicalRecordsTable.id, recordId));

  if (!record) return; // let the caller handle 404
  if (record.doctorId === req.user!.userId) return;

  await logDenied(req, "medical_record", recordId as number, "record_not_owned");
  throw new ForbiddenError("record_not_owned");
}
