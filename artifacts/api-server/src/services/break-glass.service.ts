import { db } from "@workspace/db";
import { breakGlassSessionsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, and, isNull, isNotNull, gt, or, desc } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { emitToUser } from "../lib/sse";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes (full TTL post-approval)
const GRACE_MS = 5 * 60 * 1000;        // 5 minutes (unapproved auto-expire)
const MIN_JUSTIFICATION_LENGTH = 30;

// Approved emergency-access categories. Free-form justification still required.
// Any unknown category is rejected — forces the caller to pick a reviewable reason.
const APPROVED_REASON_CATEGORIES = new Set([
  "life_threatening_emergency",
  "patient_unconscious",
  "code_blue_response",
  "covering_attending_unavailable",
  "regulatory_audit_request",
]);

// Phase 3.4 (2026-05-31): a session is active when either approved (extends to
// expiresAt) or still inside its 5-minute grace window. graceFloor returns the
// activatedAt cutoff before which an unapproved session is no longer valid.
function graceFloor(now: Date = new Date()): Date {
  return new Date(now.getTime() - GRACE_MS);
}

// Returns the active break-glass session for (userId, patientId), or null.
// Honors the approval gate: an unapproved session is only active during grace.
export async function getActiveSession(userId: number, patientId: number, clinicId: number) {
  const now = new Date();
  const [session] = await db
    .select()
    .from(breakGlassSessionsTable)
    .where(
      and(
        eq(breakGlassSessionsTable.clinicId, clinicId),
        eq(breakGlassSessionsTable.userId, userId),
        eq(breakGlassSessionsTable.patientId, patientId),
        isNull(breakGlassSessionsTable.revokedAt),
        or(
          and(
            isNotNull(breakGlassSessionsTable.approvedAt),
            gt(breakGlassSessionsTable.expiresAt, now),
          ),
          and(
            isNull(breakGlassSessionsTable.approvedAt),
            gt(breakGlassSessionsTable.activatedAt, graceFloor(now)),
          ),
        ),
      ),
    )
    .limit(1);
  return session ?? null;
}

// Activate a break-glass session. The session is unapproved at activation —
// access is granted for a 5-minute grace window; a compliance_officer must
// approve via POST /break-glass/sessions/:id/approve to extend to full 15 min.
// Alerts all same-clinic compliance_officers via SSE.
export async function activateBreakGlass(
  req: AuthRequest,
  patientId: number,
  body: Record<string, unknown>,
) {
  const clinicId = req.user!.clinicId;
  const justification = typeof body.justification === "string" ? body.justification.trim() : "";
  if (justification.length < MIN_JUSTIFICATION_LENGTH) {
    throw new ValidationError(`justification must be at least ${MIN_JUSTIFICATION_LENGTH} characters`);
  }
  const reasonCategory = typeof body.reasonCategory === "string" ? body.reasonCategory.trim() : "";
  if (!APPROVED_REASON_CATEGORIES.has(reasonCategory)) {
    throw new ValidationError(
      `reasonCategory must be one of: ${Array.from(APPROVED_REASON_CATEGORIES).join(", ")}`,
    );
  }

  const [patient] = await db
    .select({ id: patientsTable.id, fullName: patientsTable.fullName })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.clinicId, clinicId)));
  if (!patient) throw new NotFoundError("patient", patientId);

  const userId = req.user!.userId;

  // Block duplicate active sessions
  const existing = await getActiveSession(userId, patientId, clinicId);
  if (existing) throw new ConflictError("An active break-glass session already exists for this patient");

  const activatedAt = new Date();
  const expiresAt = new Date(activatedAt.getTime() + SESSION_TTL_MS);

  const [session] = await db.insert(breakGlassSessionsTable).values({
    clinicId,
    userId,
    patientId,
    justification,
    activatedAt,
    expiresAt,
  }).returning();

  // Alert all same-clinic compliance officers — IDs only in the SSE payload, no PHI.
  // The payload now also carries `requiresApproval: true` so the compliance UI can
  // surface a one-click approve/deny action instead of a passive notification.
  const complianceOfficers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.clinicId, clinicId), eq(usersTable.role, "compliance_officer")));

  const graceExpiresAt = new Date(activatedAt.getTime() + GRACE_MS);
  const alertPayload = {
    sessionId: session.id,
    activatedByUserId: userId,
    patientId,
    reasonCategory,
    activatedAt: activatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceExpiresAt: graceExpiresAt.toISOString(),
    requiresApproval: true,
  };

  for (const officer of complianceOfficers) {
    emitToUser(officer.id, "break_glass_activated", alertPayload);
  }

  await db.update(breakGlassSessionsTable)
    .set({ alertSentAt: new Date() })
    .where(and(eq(breakGlassSessionsTable.id, session.id), eq(breakGlassSessionsTable.clinicId, clinicId)));

  await logAudit(req, "BREAK_GLASS_ACTIVATED", "break_glass_session", session.id, {
    patientId, justification, reasonCategory, expiresAt: expiresAt.toISOString(),
    graceExpiresAt: graceExpiresAt.toISOString(),
    alertedOfficers: complianceOfficers.length,
  });

  return { ...session, graceExpiresAt };
}

// Phase 3.4: compliance_officer (or admin/super_admin) approves a pending session.
// Extends validity from the 5-minute grace window to the full 15-minute TTL.
// Self-approval is forbidden — the activator cannot approve their own session
// even if they happen to also hold the compliance_officer role.
export async function approveBreakGlass(req: AuthRequest, sessionId: number) {
  const clinicId = req.user!.clinicId;
  const role = req.user!.role;
  const approverId = req.user!.userId;

  if (!["super_admin", "admin", "compliance_officer"].includes(role)) {
    throw new ForbiddenError("Only compliance_officer, admin, or super_admin can approve a break-glass session");
  }

  const [session] = await db
    .select()
    .from(breakGlassSessionsTable)
    .where(and(eq(breakGlassSessionsTable.id, sessionId), eq(breakGlassSessionsTable.clinicId, clinicId)));
  if (!session) throw new NotFoundError("break-glass session", sessionId);
  if (session.revokedAt) throw new ConflictError("Session is revoked");
  if (session.approvedAt) throw new ConflictError("Session is already approved");
  if (session.userId === approverId) {
    throw new ForbiddenError("You cannot approve your own break-glass session");
  }
  // Must approve within grace window — past grace the session is effectively
  // dead, and re-extending would be the same as bypassing the gate.
  if (session.activatedAt < graceFloor()) {
    throw new ConflictError("Grace window expired — the activator must request a new session");
  }

  const [approved] = await db.update(breakGlassSessionsTable)
    .set({ approvedAt: new Date(), approvedByUserId: approverId })
    .where(and(eq(breakGlassSessionsTable.id, sessionId), eq(breakGlassSessionsTable.clinicId, clinicId)))
    .returning();

  await logAudit(req, "BREAK_GLASS_APPROVED", "break_glass_session", sessionId, {
    patientId: session.patientId,
    activatedByUserId: session.userId,
  });
  return approved;
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
  const clinicId = req.user!.clinicId;
  const [session] = await db
    .select()
    .from(breakGlassSessionsTable)
    .where(and(eq(breakGlassSessionsTable.id, sessionId), eq(breakGlassSessionsTable.clinicId, clinicId)));
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
    .where(and(eq(breakGlassSessionsTable.id, sessionId), eq(breakGlassSessionsTable.clinicId, clinicId)))
    .returning();

  // Phase 3.4: a compliance revoke of an unapproved session is the explicit
  // "deny" action. Audit it distinctly so reviewers can tell rejection apart
  // from end-of-session housekeeping.
  const action = !session.approvedAt && isCompliance && !isOwner
    ? "BREAK_GLASS_DENIED"
    : "BREAK_GLASS_REVOKED";
  await logAudit(req, action, "break_glass_session", sessionId, {
    patientId: session.patientId,
  });
  return revoked;
}

export async function listBreakGlassSessions(
  req: AuthRequest,
  params: { patientId?: string; active?: string },
) {
  const conditions: any[] = [eq(breakGlassSessionsTable.clinicId, req.user!.clinicId)];

  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(breakGlassSessionsTable.patientId, pid));
  }

  if (params.active === "true") {
    const now = new Date();
    conditions.push(isNull(breakGlassSessionsTable.revokedAt));
    // Mirrors getActiveSession's dual-validity check.
    conditions.push(or(
      and(
        isNotNull(breakGlassSessionsTable.approvedAt),
        gt(breakGlassSessionsTable.expiresAt, now),
      ),
      and(
        isNull(breakGlassSessionsTable.approvedAt),
        gt(breakGlassSessionsTable.activatedAt, graceFloor(now)),
      ),
    ));
  }

  const rows = await db
    .select()
    .from(breakGlassSessionsTable)
    .where(and(...conditions))
    .orderBy(desc(breakGlassSessionsTable.activatedAt));

  void logAudit(req, "READ_LIST", "break_glass_session", undefined, { count: rows.length });
  return rows;
}
