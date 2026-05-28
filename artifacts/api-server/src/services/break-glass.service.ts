import { db } from "@workspace/db";
import { breakGlassSessionsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, and, isNull, gt, desc } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { emitToUser } from "../lib/sse";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_JUSTIFICATION_LENGTH = 20;

// Returns the active break-glass session for (userId, patientId), or null.
export async function getActiveSession(userId: number, patientId: number) {
  const now = new Date();
  const [session] = await db
    .select()
    .from(breakGlassSessionsTable)
    .where(
      and(
        eq(breakGlassSessionsTable.userId, userId),
        eq(breakGlassSessionsTable.patientId, patientId),
        isNull(breakGlassSessionsTable.revokedAt),
        gt(breakGlassSessionsTable.expiresAt, now),
      ),
    )
    .limit(1);
  return session ?? null;
}

// Activate a break-glass session. Alerts all compliance_officers via SSE.
export async function activateBreakGlass(
  req: AuthRequest,
  patientId: number,
  body: Record<string, unknown>,
) {
  const justification = typeof body.justification === "string" ? body.justification.trim() : "";
  if (justification.length < MIN_JUSTIFICATION_LENGTH) {
    throw new ValidationError(`justification must be at least ${MIN_JUSTIFICATION_LENGTH} characters`);
  }

  const patientConditions: any[] = [eq(patientsTable.id, patientId)];

  const [patient] = await db
    .select({ id: patientsTable.id, fullName: patientsTable.fullName })
    .from(patientsTable)
    .where(and(...patientConditions));
  if (!patient) throw new NotFoundError("patient", patientId);

  const userId = req.user!.userId;

  // Block duplicate active sessions
  const existing = await getActiveSession(userId, patientId);
  if (existing) throw new ConflictError("An active break-glass session already exists for this patient");

  const activatedAt = new Date();
  const expiresAt = new Date(activatedAt.getTime() + SESSION_TTL_MS);

  const [session] = await db.insert(breakGlassSessionsTable).values({
    userId,
    patientId,
    justification,
    activatedAt,
    expiresAt,
  }).returning();

  // Alert all compliance officers — IDs only in the SSE payload, no PHI
  const complianceOfficers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "compliance_officer"));

  const alertPayload = {
    sessionId: session.id,
    activatedByUserId: userId,
    patientId,
    activatedAt: activatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  for (const officer of complianceOfficers) {
    emitToUser(officer.id, "break_glass_activated", alertPayload);
  }

  await db.update(breakGlassSessionsTable)
    .set({ alertSentAt: new Date() })
    .where(eq(breakGlassSessionsTable.id, session.id));

  await logAudit(req, "BREAK_GLASS_ACTIVATED", "break_glass_session", session.id, {
    patientId, justification, expiresAt: expiresAt.toISOString(),
    alertedOfficers: complianceOfficers.length,
  });

  return session;
}

// Log every PHI access that occurs under an active break-glass session.
export async function logBreakGlassAccess(
  req: AuthRequest,
  sessionId: number,
  entityType: string,
  entityId: number,
) {
  void logAudit(req, "BREAK_GLASS_ACCESS", entityType, entityId, { breakGlassSessionId: sessionId });
}

export async function revokeBreakGlass(req: AuthRequest, sessionId: number) {
  const [session] = await db
    .select()
    .from(breakGlassSessionsTable)
    .where(eq(breakGlassSessionsTable.id, sessionId));
  if (!session) throw new NotFoundError("break-glass session", sessionId);
  if (session.revokedAt) throw new ConflictError("Session is already revoked");

  const role = req.user!.role;
  const isCompliance = ["super_admin", "admin", "compliance_officer"].includes(role);
  const isOwner = session.userId === req.user!.userId;
  if (!isCompliance && !isOwner) {
    throw new ForbiddenError("Only the activating user, compliance officers, or admins can revoke a break-glass session");
  }

  const [revoked] = await db.update(breakGlassSessionsTable)
    .set({ revokedAt: new Date(), revokedByUserId: req.user!.userId })
    .where(eq(breakGlassSessionsTable.id, sessionId))
    .returning();

  await logAudit(req, "BREAK_GLASS_REVOKED", "break_glass_session", sessionId, {
    patientId: session.patientId,
  });
  return revoked;
}

export async function listBreakGlassSessions(
  req: AuthRequest,
  params: { patientId?: string; active?: string },
) {
  const conditions: any[] = [];

  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(breakGlassSessionsTable.patientId, pid));
  }

  if (params.active === "true") {
    conditions.push(isNull(breakGlassSessionsTable.revokedAt));
    conditions.push(gt(breakGlassSessionsTable.expiresAt, new Date()));
  }

  const query = db
    .select()
    .from(breakGlassSessionsTable)
    .orderBy(desc(breakGlassSessionsTable.activatedAt));

  const rows = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;

  void logAudit(req, "READ_LIST", "break_glass_session", undefined, { count: rows.length });
  return rows;
}
