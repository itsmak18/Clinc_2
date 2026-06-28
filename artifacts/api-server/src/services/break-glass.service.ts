import { runInTenantContext, dbUnsafe as db } from "@workspace/db";
import { breakGlassSessionsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, and, isNull, isNotNull, gt, lt, or, desc, count, gte } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { auditBreakGlass } from "../lib/break-glass-audit";
import { emitToUser } from "../lib/sse";
import { breakGlassActivationsTotal } from "../lib/metrics";
import { logger } from "../lib/logger";
import { config } from "../lib/config";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

// Activations per user in 24h above this threshold trigger a compliance alert.
const BG_VELOCITY_THRESHOLD = config.bgVelocityThreshold;

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes (full TTL post-approval)
const GRACE_MS = 5 * 60 * 1000;        // 5 minutes (unapproved auto-expire)
const MIN_JUSTIFICATION_LENGTH = 30;

// Approved emergency-access categories. Free-form justification still required.
// Any unknown category is rejected â€” forces the caller to pick a reviewable reason.
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
// Wrapped in runInTenantContext so RLS enforces the clinic boundary.
export async function getActiveSession(userId: number, patientId: number, clinicId: number) {
  const now = new Date();
  const rows = await runInTenantContext(
    { userId, clinicId, role: "break_glass_read" },
    async (tx) =>
      tx
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
        .limit(1),
  );
  return rows[0] ?? null;
}

// Returns the distinct patient IDs the given user currently holds an ACTIVE
// break-glass session for (clinic-scoped). Drives both the app-layer widening
// of doctor list-scope and the DB-layer `app.break_glass_patient_ids` GUC that
// lets the doctor_scope RLS policy permit those patients' clinical rows.
// Empty array when the doctor has no live sessions (the common case).
export async function getActiveBreakGlassPatientIds(userId: number, clinicId: number): Promise<number[]> {
  const now = new Date();
  const rows = await runInTenantContext(
    { userId, clinicId, role: "break_glass_read" },
    async (tx) =>
      tx
        .select({ patientId: breakGlassSessionsTable.patientId })
        .from(breakGlassSessionsTable)
        .where(
          and(
            eq(breakGlassSessionsTable.clinicId, clinicId),
            eq(breakGlassSessionsTable.userId, userId),
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
        ),
  );
  return [...new Set(rows.map((r) => r.patientId))];
}

// Activate a break-glass session. The session is unapproved at activation â€”
// access is granted for a 5-minute grace window; a compliance_officer must
// approve via POST /break-glass/sessions/:id/approve to extend to full 15 min.
// Alerts all same-clinic compliance_officers via SSE.
export async function activateBreakGlass(
  req: AuthRequest,
  patientId: number,
  body: Record<string, unknown>,
) {
  const clinicId = req.user!.clinicId;
  const userId = req.user!.userId;

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

  // All clinic-bearing DB operations run inside a single tenant context so
  // RLS enforces and the belt-and-braces eq(clinicId) filters stay in place.
  const { session, complianceOfficers, graceExpiresAt } = await runInTenantContext(
    req.user!,
    async (tx) => {
      const [patient] = await tx
        .select({ id: patientsTable.id, fullName: patientsTable.fullName })
        .from(patientsTable)
        .where(and(eq(patientsTable.id, patientId), eq(patientsTable.clinicId, clinicId)));
      if (!patient) throw new NotFoundError("patient", patientId);

      // Block duplicate active sessions (inline to avoid nested runInTenantContext).
      const now = new Date();
      const existingRows = await tx
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
      if (existingRows.length > 0) {
        throw new ConflictError("An active break-glass session already exists for this patient");
      }

      const activatedAt = new Date();
      const expiresAt = new Date(activatedAt.getTime() + SESSION_TTL_MS);

      const [newSession] = await tx.insert(breakGlassSessionsTable).values({
        clinicId,
        userId,
        patientId,
        justification,
        activatedAt,
        expiresAt,
      }).returning();

      const officers = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.clinicId, clinicId), eq(usersTable.role, "compliance_officer")));

      const graceExp = new Date(activatedAt.getTime() + GRACE_MS);

      await tx.update(breakGlassSessionsTable)
        .set({ alertSentAt: new Date() })
        .where(and(
          eq(breakGlassSessionsTable.id, newSession.id),
          eq(breakGlassSessionsTable.clinicId, clinicId),
        ));

      return { session: newSession, complianceOfficers: officers, graceExpiresAt: graceExp };
    },
  );

  // SSE emission and audit writes happen outside the transaction.
  const alertPayload = {
    sessionId: session.id,
    activatedByUserId: userId,
    patientId,
    reasonCategory,
    activatedAt: session.activatedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    graceExpiresAt: graceExpiresAt.toISOString(),
    requiresApproval: true,
  };

  for (const officer of complianceOfficers) {
    emitToUser(officer.id, "break_glass_activated", alertPayload);
  }

  await auditBreakGlass(req, "BREAK_GLASS_ACTIVATED", "break_glass_session", session.id, {
    patientId, justification, reasonCategory, expiresAt: session.expiresAt.toISOString(),
    graceExpiresAt: graceExpiresAt.toISOString(),
    alertedOfficers: complianceOfficers.length,
  });

  breakGlassActivationsTotal.labels(String(userId), String(clinicId)).inc();

  // Velocity check: count this user's activations in the last 24 hours.
  // High rate = possible insider abuse. Alert compliance officers without blocking access.
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ activationCount }] = await db
      .select({ activationCount: count() })
      .from(breakGlassSessionsTable)
      .where(and(
        eq(breakGlassSessionsTable.clinicId, clinicId),
        eq(breakGlassSessionsTable.userId, userId),
        gte(breakGlassSessionsTable.activatedAt, since24h),
      ));
    if (Number(activationCount) > BG_VELOCITY_THRESHOLD) {
      const velocityPayload = {
        userId,
        clinicId,
        activationsLast24h: Number(activationCount),
        threshold: BG_VELOCITY_THRESHOLD,
        latestSessionId: session.id,
      };
      logger.warn(velocityPayload, "break_glass_velocity_alert");
      for (const officer of complianceOfficers) {
        emitToUser(officer.id, "break_glass_velocity_alert", velocityPayload);
      }
    }
  } catch (err) {
    logger.error({ err }, "break_glass_velocity_check_failed");
  }

  return { ...session, graceExpiresAt };
}

// Phase 3.4: compliance_officer (or admin/super_admin) approves a pending session.
// Extends validity from the 5-minute grace window to the full 15-minute TTL.
// Self-approval is forbidden â€” the activator cannot approve their own session
// even if they happen to also hold the compliance_officer role.
export async function approveBreakGlass(req: AuthRequest, sessionId: number) {
  const clinicId = req.user!.clinicId;
  const role = req.user!.role;
  const approverId = req.user!.userId;

  if (!["super_admin", "admin", "compliance_officer"].includes(role)) {
    throw new ForbiddenError("Only compliance_officer, admin, or super_admin can approve a break-glass session");
  }

  const { approved, patientId, activatedByUserId } = await runInTenantContext(
    req.user!,
    async (tx) => {
      const [session] = await tx
        .select()
        .from(breakGlassSessionsTable)
        .where(and(
          eq(breakGlassSessionsTable.id, sessionId),
          eq(breakGlassSessionsTable.clinicId, clinicId),
        ));
      if (!session) throw new NotFoundError("break-glass session", sessionId);
      if (session.revokedAt) throw new ConflictError("Session is revoked");
      if (session.approvedAt) throw new ConflictError("Session is already approved");
      if (session.userId === approverId) {
        throw new ForbiddenError("You cannot approve your own break-glass session");
      }
      if (session.activatedAt < graceFloor()) {
        throw new ConflictError("Grace window expired â€” the activator must request a new session");
      }

      const [approvedSession] = await tx.update(breakGlassSessionsTable)
        .set({ approvedAt: new Date(), approvedByUserId: approverId })
        .where(and(
          eq(breakGlassSessionsTable.id, sessionId),
          eq(breakGlassSessionsTable.clinicId, clinicId),
        ))
        .returning();

      return {
        approved: approvedSession,
        patientId: session.patientId,
        activatedByUserId: session.userId,
      };
    },
  );

  await auditBreakGlass(req, "BREAK_GLASS_APPROVED", "break_glass_session", sessionId, {
    patientId,
    activatedByUserId,
  });
  return approved;
}

// Log every PHI access that occurs under an active break-glass session.
// Awaited by callers in scope.ts â€” must resolve (durably) before PHI returns.
export async function logBreakGlassAccess(
  req: AuthRequest,
  sessionId: number,
  entityType: string,
  entityId: number,
) {
  await auditBreakGlass(req, "BREAK_GLASS_ACCESS", entityType, entityId, { breakGlassSessionId: sessionId });
}

export async function revokeBreakGlass(req: AuthRequest, sessionId: number) {
  const clinicId = req.user!.clinicId;
  const role = req.user!.role;
  const revokerId = req.user!.userId;

  const { revoked, patientId, wasApproved, isCompliance, isOwner } = await runInTenantContext(
    req.user!,
    async (tx) => {
      const [session] = await tx
        .select()
        .from(breakGlassSessionsTable)
        .where(and(
          eq(breakGlassSessionsTable.id, sessionId),
          eq(breakGlassSessionsTable.clinicId, clinicId),
        ));
      if (!session) throw new NotFoundError("break-glass session", sessionId);
      if (session.revokedAt) throw new ConflictError("Session is already revoked");

      const compliance = ["super_admin", "admin", "compliance_officer"].includes(role);
      const owner = session.userId === revokerId;
      if (!compliance && !owner) {
        throw new ForbiddenError(
          "Only the activating user, compliance officers, or admins can revoke a break-glass session",
        );
      }

      const [revokedSession] = await tx.update(breakGlassSessionsTable)
        .set({ revokedAt: new Date(), revokedByUserId: revokerId })
        .where(and(
          eq(breakGlassSessionsTable.id, sessionId),
          eq(breakGlassSessionsTable.clinicId, clinicId),
        ))
        .returning();

      return {
        revoked: revokedSession,
        patientId: session.patientId,
        wasApproved: !!session.approvedAt,
        isCompliance: compliance,
        isOwner: owner,
      };
    },
  );

  // Phase 3.4: a compliance revoke of an unapproved session is the explicit
  // "deny" action. Audit it distinctly so reviewers can tell rejection apart
  // from end-of-session housekeeping.
  const action = !wasApproved && isCompliance && !isOwner
    ? "BREAK_GLASS_DENIED"
    : "BREAK_GLASS_REVOKED";
  await auditBreakGlass(req, action, "break_glass_session", sessionId, { patientId });
  return revoked;
}

export async function listBreakGlassSessions(
  req: AuthRequest,
  params: { patientId?: string; active?: string; cursor?: string; limit?: string },
) {
  const clinicId = req.user!.clinicId;
  const lim = Math.min(parseInt(params.limit ?? "100") || 100, 100);

  const rows = await runInTenantContext(
    req.user!,
    async (tx) => {
      const conditions: any[] = [eq(breakGlassSessionsTable.clinicId, clinicId)];

      if (params.patientId) {
        const pid = parseInt(params.patientId);
        if (!isNaN(pid)) conditions.push(eq(breakGlassSessionsTable.patientId, pid));
      }

      if (params.active === "true") {
        const now = new Date();
        conditions.push(isNull(breakGlassSessionsTable.revokedAt));
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

      if (params.cursor) {
        const cursorId = parseInt(params.cursor);
        if (!isNaN(cursorId)) conditions.push(lt(breakGlassSessionsTable.id, cursorId));
      }

      return tx
        .select()
        .from(breakGlassSessionsTable)
        .where(and(...conditions))
        .orderBy(desc(breakGlassSessionsTable.id))
        .limit(lim);
    },
  );

  await logAudit(req, "READ_LIST", "break_glass_session", undefined, { count: rows.length });
  return { data: rows, nextCursor: rows.length === lim ? rows[rows.length - 1].id : null };
}
