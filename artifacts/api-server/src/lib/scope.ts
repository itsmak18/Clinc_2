import { db } from "@workspace/db";
import { doctorPatientsTable, medicalRecordsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { AuthRequest } from "../middlewares/auth";
import { logAudit, logDenied } from "./audit";
import { runtime } from "./runtime";
import { logger } from "./logger";
import { ForbiddenError } from "../services/errors";
import { getActiveSession, logBreakGlassAccess, getActiveBreakGlassPatientIds } from "../services/break-glass.service";

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
 * Doctor list-scope for the five doctor-bound clinical tables.
 *
 * Returns the patient IDs a doctor may enumerate (their assigned patients PLUS
 * any patient they hold an active break-glass session for) AND the break-glass
 * IDs alone. Callers MUST:
 *   1. filter the query with `inArray(table.patientId, allowed)`, and
 *   2. pass `{ breakGlassPatientIds }` to `runInTenantContext` so the
 *      `doctor_scope` RLS policy (0017 + 0024) also permits those rows at the
 *      DB layer — without it the DB returns zero break-glass rows (F-P2-1).
 *
 * Surfacing break-glass patients in a list is itself a PHI access, so it is
 * audited here once.
 */
export async function getDoctorListScope(
  req: AuthRequest,
  entityType: string,
): Promise<{ allowed: number[]; breakGlassPatientIds: number[] }> {
  const assigned = await getDoctorPatientScope(req.user!.userId);
  const breakGlassPatientIds = await getActiveBreakGlassPatientIds(req.user!.userId, req.user!.clinicId);
  if (breakGlassPatientIds.length > 0) {
    await logAudit(req, "BREAK_GLASS_ACCESS", entityType, undefined, {
      patientIds: breakGlassPatientIds,
      via: "list",
    } as object);
  }
  const allowed = [...new Set([...assigned, ...breakGlassPatientIds])];
  return { allowed, breakGlassPatientIds };
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

  // Check for an active break-glass session — emergency override allows access.
  const session = await getActiveSession(req.user!.userId, patientId, req.user!.clinicId);
  if (session) {
    await logBreakGlassAccess(req, session.id, entityType, patientId);
    return;
  }

  await logAudit(req, "ACCESS_DENIED_OUT_OF_SCOPE", entityType, patientId, {
    doctorId: req.user!.userId,
    reason: "patient not assigned to doctor",
  } as object);
  throw new ForbiddenError("patient_out_of_scope");
}

/**
 * For routes that fetch a single medical record. Rules:
 *   1. record.doctorId = current user.id → allow
 *   2. active break-glass session for the record's patient → allow (audited)
 *   3. deny + DENIED audit entry + ForbiddenError
 * Non-doctor roles always pass.
 *
 * Returns `{ breakGlassPatientIds }` when access is allowed — non-empty only
 * when access was granted via break-glass, in which case the caller MUST pass
 * it to `runInTenantContext` so the doctor_scope RLS (0017 + 0024) permits the
 * row at the DB layer. Throws ForbiddenError on deny. If the record doesn't
 * exist, returns empty and lets the caller handle 404.
 */
export async function assertMedicalRecordInScope(
  req: AuthRequest,
  recordId: number,
): Promise<{ breakGlassPatientIds: number[] }> {
  if (!isDoctorScoped(req.user?.role)) return { breakGlassPatientIds: [] };

  const [record] = await db
    .select({ doctorId: medicalRecordsTable.doctorId, patientId: medicalRecordsTable.patientId })
    .from(medicalRecordsTable)
    .where(eq(medicalRecordsTable.id, recordId));

  if (!record) return { breakGlassPatientIds: [] }; // let the caller handle 404
  if (record.doctorId === req.user!.userId) return { breakGlassPatientIds: [] };

  // Break-glass emergency override — an active session for this record's patient
  // grants read access to the doctor even though the record is not theirs.
  const session = await getActiveSession(req.user!.userId, record.patientId, req.user!.clinicId);
  if (session) {
    await logBreakGlassAccess(req, session.id, "medical_record", recordId);
    return { breakGlassPatientIds: [record.patientId] };
  }

  await logDenied(req, "medical_record", recordId as number, "record_not_owned");
  throw new ForbiddenError("record_not_owned");
}
