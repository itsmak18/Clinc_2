import { db } from "@workspace/db";
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
export async function hasActiveConsent(patientId: number, consentType: ConsentType): Promise<boolean> {
  const [row] = await db
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
  const conditions: any[] = [eq(patientsTable.id, patientId)];
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(...conditions));
  if (!patient) throw new NotFoundError("patient", patientId);

  void logAudit(req, "READ_LIST", "patient_consent", patientId);
  return db
    .select()
    .from(patientConsentsTable)
    .where(eq(patientConsentsTable.patientId, patientId))
    .orderBy(desc(patientConsentsTable.createdAt));
}

export async function grantConsent(
  req: AuthRequest,
  patientId: number,
  body: Record<string, unknown>,
): Promise<PatientConsent> {
  assertValidType(body.consentType);
  if (!body.documentVersion || typeof body.documentVersion !== "string") {
    throw new ValidationError("documentVersion is required");
  }

  const conditions: any[] = [eq(patientsTable.id, patientId)];
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(...conditions));
  if (!patient) throw new NotFoundError("patient", patientId);

  // Revoke any existing active consent of the same type before granting new one
  await db.update(patientConsentsTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(patientConsentsTable.patientId, patientId),
        eq(patientConsentsTable.consentType, body.consentType),
        isNull(patientConsentsTable.revokedAt),
      ),
    );

  const [consent] = await db.insert(patientConsentsTable).values({
    patientId,
    consentType: body.consentType,
    grantedByUserId: req.user!.userId,
    ipAddress: req.ip || req.socket?.remoteAddress || "unknown",
    documentVersion: body.documentVersion,
    notes: typeof body.notes === "string" ? body.notes : null,
  }).returning();

  await logAudit(req, "CONSENT_GRANTED", "patient_consent", consent.id, {
    patientId, consentType: body.consentType, documentVersion: body.documentVersion,
  });
  return consent;
}

export async function revokeConsent(
  req: AuthRequest,
  patientId: number,
  consentId: number,
): Promise<PatientConsent> {
  const [consent] = await db
    .select()
    .from(patientConsentsTable)
    .where(
      and(
        eq(patientConsentsTable.id, consentId),
        eq(patientConsentsTable.patientId, patientId),
      ),
    );
  if (!consent) throw new NotFoundError("consent", consentId);
  if (consent.revokedAt) throw new ConflictError("Consent is already revoked");

  const [updated] = await db.update(patientConsentsTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(patientConsentsTable.id, consentId))
    .returning();

  await logAudit(req, "CONSENT_REVOKED", "patient_consent", consentId, {
    patientId, consentType: consent.consentType,
  });
  return updated;
}

export { hasActiveConsent as default, type ConsentType };
