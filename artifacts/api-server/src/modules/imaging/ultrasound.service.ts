// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { ultrasoundRecordsTable, patientsTable, usersTable, notificationsTable, invoiceItemsTable } from "@workspace/db";
import { eq, isNull, desc, lt, and, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../../lib/audit";
import { emitToUser } from "../../lib/sse";
import { isDoctorScoped, getDoctorPatientScope, getDoctorListScope } from "../../lib/scope";
import { getActiveBreakGlassPatientIds } from "../compliance";
import { auditBreakGlass } from "../../lib/break-glass-audit";
import { NotFoundError, ForbiddenError, ValidationError, ClearanceRequiredError } from "../../services/errors";
import { autoAdvanceVisit } from "../clinical";
import { isClearanceGateEnabled, appendOrderCharge, removeOrderCharge, clearanceBlocksProgress, parseClearanceStatusFilter, orderChargeFromLine } from "../billing";
import type { AuthRequest } from "../../middlewares/auth";

export async function listUltrasounds(
  req: AuthRequest,
  params: { status?: string; clearanceStatus?: string; patientId?: string; limit?: string; cursor?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);
  const conditions: any[] = [isNull(ultrasoundRecordsTable.deletedAt), eq(ultrasoundRecordsTable.clinicId, req.user!.clinicId)];
  if (params.clearanceStatus) conditions.push(inArray(ultrasoundRecordsTable.clearanceStatus, parseClearanceStatusFilter(params.clearanceStatus)));

  let breakGlassPatientIds: number[] = [];
  if (isDoctorScoped(req.user?.role)) {
    const scope = await getDoctorListScope(req, "ultrasound");
    breakGlassPatientIds = scope.breakGlassPatientIds;
    if (scope.allowed.length === 0) {
      await logAudit(req, "READ_LIST", "ultrasound", undefined, { count: 0 });
      return { data: [], nextCursor: null };
    }
    conditions.push(inArray(ultrasoundRecordsTable.patientId, scope.allowed));
  }

  if (params.status) conditions.push(eq(ultrasoundRecordsTable.status, params.status as any));
  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(ultrasoundRecordsTable.patientId, pid));
  }
  if (params.cursor) {
    const cursorId = parseInt(params.cursor);
    if (!isNaN(cursorId)) conditions.push(lt(ultrasoundRecordsTable.id, cursorId));
  }

  const rows = await runInTenantContext(req.user!, async (tx) =>
    tx.select({
      id: ultrasoundRecordsTable.id,
      patientId: ultrasoundRecordsTable.patientId,
      requestedById: ultrasoundRecordsTable.requestedById,
      performedById: ultrasoundRecordsTable.performedById,
      examType: ultrasoundRecordsTable.examType,
      bodyPart: ultrasoundRecordsTable.bodyPart,
      bodyPartAr: ultrasoundRecordsTable.bodyPartAr,
      imageUrl: ultrasoundRecordsTable.imageUrl,
      images: ultrasoundRecordsTable.images,
      orderGroupId: ultrasoundRecordsTable.orderGroupId,
      report: ultrasoundRecordsTable.report,
      reportAr: ultrasoundRecordsTable.reportAr,
      status: ultrasoundRecordsTable.status,
      clearanceStatus: ultrasoundRecordsTable.clearanceStatus,
      invoiceItemId: ultrasoundRecordsTable.invoiceItemId,
      invoiceId: invoiceItemsTable.invoiceId,
      // Own-line price only (visibility plan D1) — folded into `charge` below.
      chargeQuantity: invoiceItemsTable.quantity,
      chargeUnitPrice: invoiceItemsTable.unitPrice,
      notes: ultrasoundRecordsTable.notes,
      notesAr: ultrasoundRecordsTable.notesAr,
      createdAt: ultrasoundRecordsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName, mrn: patientsTable.mrn, dateOfBirth: patientsTable.dateOfBirth, gender: patientsTable.gender },
      requestedBy: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(ultrasoundRecordsTable)
      .leftJoin(patientsTable, eq(ultrasoundRecordsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(ultrasoundRecordsTable.requestedById, usersTable.id))
      .leftJoin(invoiceItemsTable, eq(ultrasoundRecordsTable.invoiceItemId, invoiceItemsTable.id))
      .where(and(...conditions))
      .orderBy(desc(ultrasoundRecordsTable.id))
      .limit(lim),
    { breakGlassPatientIds },
  );

  const data = rows.map(({ chargeQuantity, chargeUnitPrice, ...row }) => ({
    ...row,
    charge: orderChargeFromLine(chargeQuantity, chargeUnitPrice),
  }));
  const nextCursor = data.length === lim ? data[data.length - 1].id : null;
  await logAudit(req, "READ_LIST", "ultrasound", undefined, { count: data.length });
  return { data, nextCursor };
}

export async function createUltrasound(
  req: AuthRequest,
  data: { patientId: number | string; requestedById: number | string; examType: string; bodyPart: string; bodyPartAr?: string; notes?: string; notesAr?: string; orderGroupId?: string },
) {
  if (!data.patientId || !data.requestedById || !data.examType || !data.bodyPart) {
    throw new ValidationError("Missing required fields");
  }
  const values = {
    clinicId: req.user!.clinicId,
    patientId: Number(data.patientId), requestedById: Number(data.requestedById),
    examType: data.examType as any, bodyPart: data.bodyPart, bodyPartAr: data.bodyPartAr, notes: data.notes, notesAr: data.notesAr,
    orderGroupId: data.orderGroupId || null,
  };

  let record;
  let charge: { invoiceId: number; invoiceItemId: number } | null = null;
  if (isClearanceGateEnabled()) {
    // Clearance gate (ADR-011): order + basket charge line in one tx.
    ({ record, charge } = await runInTenantContext(req.user!, async (tx) => {
      const [row] = await tx.insert(ultrasoundRecordsTable)
        .values({ ...values, clearanceStatus: "pending" as const })
        .returning();
      const c = await appendOrderCharge(tx, req.user!, {
        patientId: row.patientId,
        modality: "ultrasound",
        description: `Ultrasound: ${row.examType} — ${row.bodyPart}`,
      });
      const [linked] = await tx.update(ultrasoundRecordsTable)
        .set({ invoiceItemId: c.invoiceItemId })
        .where(and(eq(ultrasoundRecordsTable.id, row.id), eq(ultrasoundRecordsTable.clinicId, req.user!.clinicId)))
        .returning();
      return { record: linked, charge: c };
    }));
  } else {
    [record] = await db.insert(ultrasoundRecordsTable).values(values).returning();
  }

  await logAudit(req, "CREATE", "ultrasound", record.id);
  if (charge) {
    await logAudit(req, "CHARGE_AUTO_CREATED", "ultrasound", record.id, charge);
  }
  // Ultrasound rows carry no appointmentId - resolve the patient's active visit
  // and advance it to awaiting_diagnostics (best-effort, skip-on-ambiguity).
  await autoAdvanceVisit(req, { patientId: Number(data.patientId), actions: ["diagnostics"] });
  return record;
}

export async function getUltrasound(req: AuthRequest, id: number) {
  const isDoc = isDoctorScoped(req.user?.role);
  const breakGlassPatientIds = isDoc
    ? await getActiveBreakGlassPatientIds(req.user!.userId, req.user!.clinicId)
    : [];

  const found = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(ultrasoundRecordsTable.id, id), eq(ultrasoundRecordsTable.clinicId, req.user!.clinicId)];
    const [row] = await tx.select({
      record: ultrasoundRecordsTable,
      // Own-line price only (visibility plan D1) — never invoice totals.
      chargeQuantity: invoiceItemsTable.quantity,
      chargeUnitPrice: invoiceItemsTable.unitPrice,
    }).from(ultrasoundRecordsTable)
      .leftJoin(invoiceItemsTable, eq(ultrasoundRecordsTable.invoiceItemId, invoiceItemsTable.id))
      .where(and(...conditions));
    return row;
  }, { breakGlassPatientIds });
  if (!found) throw new NotFoundError("ultrasound record", id);
  const record = { ...found.record, charge: orderChargeFromLine(found.chargeQuantity, found.chargeUnitPrice) };

  if (isDoc) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    const viaBreakGlass = breakGlassPatientIds.includes(record.patientId);
    if (!allowed.includes(record.patientId) && !viaBreakGlass) throw new ForbiddenError();
    if (viaBreakGlass) {
      await auditBreakGlass(req, "BREAK_GLASS_ACCESS", "ultrasound", id, { patientId: record.patientId, via: "get" });
    }
  }

  await logRead(req, "ultrasound", id);
  return record;
}

export async function updateUltrasound(
  req: AuthRequest,
  id: number,
  data: { imageUrl?: string; imageFileName?: string; images?: { url: string; fileName?: string; caption?: string }[]; report?: string; reportAr?: string; status?: string; performedById?: number; notes?: string; notesAr?: string; bodyPartAr?: string },
) {
  const conditions: any[] = [eq(ultrasoundRecordsTable.id, id), eq(ultrasoundRecordsTable.clinicId, req.user!.clinicId)];

  let record;
  if (isClearanceGateEnabled()) {
    // Clearance guard (ADR-011): no workflow progress while awaiting payment;
    // cancel is always allowed and withdraws the basket charge.
    record = await runInTenantContext(req.user!, async (tx) => {
      const [before] = await tx.select().from(ultrasoundRecordsTable).where(and(...conditions));
      if (!before) throw new NotFoundError("ultrasound record", id);
      if (clearanceBlocksProgress(data.status, before.clearanceStatus)) {
        throw new ClearanceRequiredError();
      }
      const txPatch: Record<string, unknown> = { ...data, status: data.status as any, updatedAt: new Date() };
      if (data.status === "cancelled" && before.clearanceStatus === "pending") {
        txPatch.clearanceStatus = "expired";
        if (before.invoiceItemId != null) {
          await removeOrderCharge(tx, req.user!.clinicId, before.invoiceItemId, "ultrasound");
        }
      }
      const [row] = await tx.update(ultrasoundRecordsTable).set(txPatch).where(and(...conditions)).returning();
      return row;
    });
  } else {
    [record] = await db.update(ultrasoundRecordsTable)
      .set({ ...data, status: data.status as any, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!record) throw new NotFoundError("ultrasound record", id);
  }

  if (data.status === "completed") {
    const notifData = {
      clinicId: req.user!.clinicId,
      userId: record.requestedById,
      title: "Ultrasound Report Ready",
      // F-4: keep clinical descriptors (exam type / body part) off the SSE/Redis
      // wire - the title carries the category; the client fetches via the API.
      message: "Report is ready for review",
      type: "ultrasound_ready" as const,
    };
    const [notif] = await db.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
    if (notif) emitToUser(record.requestedById, "notification", notif);
  }

  await logAudit(req, "UPDATE", "ultrasound", record.id);
  return record;
}
