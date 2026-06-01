// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import {
  patientConsentsTable, patientsTable,
  type PatientConsent,
} from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { NotFoundError, ValidationError, ConflictError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

const VALID_TYPES = ["treatment", "data_sharing", "research", "marketing"] as const;
type ConsentType = typeof VALID_TYPES[number];

function assertValidType(type: unknown): asserts type is ConsentType {
  if (!VALID_TYPES.includes(type as ConsentType)) {
    throw new ValidationError(`Invalid consent_type. Must be one of: ${VALID_TYPES.join(", ")}`);
  }
}

// Returns true if the patient has an active (non-revoked) consent of the given type.
export async function hasActiveConsent(patientId: number, consentType: ConsentType, tx?: any): Promise<boolean> {
  const client = tx || db;
  const [row] = await client
    .select({ id: patientConsentsTable.id })
    .from(patientConsentsTable)
    .where(
      and(
        eq(patientConsentsTable.patientId, patientId),
        eq(patientConsentsTable.consentType, consentType),
        isNull(patientConsentsTable.revokedAt),
      ),
    )
    .limit(1);
  return !!row;
}

export async function listConsents(req: AuthRequest, patientId: number): Promise<PatientConsent[]> {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(patientsTable.id, patientId), eq(patientsTable.clinicId, req.user!.clinicId)];
    const [patient] = await tx
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(and(...conditions));
    if (!patient) throw new NotFoundError("patient", patientId);

    void logAudit(req, "READ_LIST", "patient_consent", patientId);
    return tx
      .select()
      .from(patientConsentsTable)
      .where(and(eq(patientConsentsTable.patientId, patientId), eq(patientConsentsTable.clinicId, req.user!.clinicId)))
      .orderBy(desc(patientConsentsTable.createdAt));
  });
}

export async function grantConsent(
  req: AuthRequest,
  patientId: number,
  body: Record<string, unknown>,
): Promise<PatientConsent> {
  const consentType = body.consentType as ConsentType;
  assertValidType(consentType);
  const documentVersion = body.documentVersion;
  if (!documentVersion || typeof documentVersion !== "string") {
    throw new ValidationError("documentVersion is required");
  }
  const notes = typeof body.notes === "string" ? body.notes : null;

  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(patientsTable.id, patientId), eq(patientsTable.clinicId, req.user!.clinicId)];
    const [patient] = await tx
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(and(...conditions));
    if (!patient) throw new NotFoundError("patient", patientId);

    // Revoke any existing active consent of the same type before granting new one
    await tx.update(patientConsentsTable)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(patientConsentsTable.patientId, patientId),
          eq(patientConsentsTable.clinicId, req.user!.clinicId),
          eq(patientConsentsTable.consentType, consentType),
          isNull(patientConsentsTable.revokedAt),
        ),
      );

    const [consent] = await tx.insert(patientConsentsTable).values({
      clinicId: req.user!.clinicId,
      patientId,
      consentType,
      grantedByUserId: req.user!.userId,
      ipAddress: req.ip || req.socket?.remoteAddress || "unknown",
      documentVersion,
      notes,
    }).returning();

    await logAudit(req, "CONSENT_GRANTED", "patient_consent", consent.id, {
      patientId, consentType, documentVersion,
    });
    return consent;
  });
}

export async function revokeConsent(
  req: AuthRequest,
  patientId: number,
  consentId: number,
): Promise<PatientConsent> {
  return runInTenantContext(req.user!, async (tx) => {
    const [consent] = await tx
      .select()
      .from(patientConsentsTable)
      .where(
        and(
          eq(patientConsentsTable.id, consentId),
          eq(patientConsentsTable.patientId, patientId),
          eq(patientConsentsTable.clinicId, req.user!.clinicId),
        ),
      );
    if (!consent) throw new NotFoundError("consent", consentId);
    if (consent.revokedAt) throw new ConflictError("Consent is already revoked");

    const [updated] = await tx.update(patientConsentsTable)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(patientConsentsTable.id, consentId), eq(patientConsentsTable.clinicId, req.user!.clinicId)))
      .returning();

    await logAudit(req, "CONSENT_REVOKED", "patient_consent", consentId, {
      patientId, consentType: consent.consentType,
    });
    return updated;
  });
}

export { hasActiveConsent as default, type ConsentType };
