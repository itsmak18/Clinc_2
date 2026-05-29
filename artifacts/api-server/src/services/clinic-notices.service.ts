import { db } from "@workspace/db";
import { clinicNoticesTable } from "@workspace/db";
import { eq, isNull, desc, lt, and } from "drizzle-orm";
import { z } from "zod/v4";
import { logAudit } from "../lib/audit";
import { NotFoundError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

const createNoticeSchema = z.object({
  title: z.string().min(5).max(200),
  content: z.string().min(10),
  reason: z.string().min(20),
});

export async function listClinicNotices(
  req: AuthRequest,
  params: { limit?: string; cursor?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);
  const conditions: ReturnType<typeof eq>[] = [
    isNull(clinicNoticesTable.deletedAt),
    eq(clinicNoticesTable.clinicId, req.user!.clinicId),
  ];

  if (params.cursor) {
    const cursorId = parseInt(params.cursor);
    if (!isNaN(cursorId)) conditions.push(lt(clinicNoticesTable.id, cursorId) as any);
  }

  const results = await db
    .select()
    .from(clinicNoticesTable)
    .where(and(...(conditions as any[])))
    .orderBy(desc(clinicNoticesTable.id))
    .limit(lim);

  const nextCursor = results.length === lim ? results[results.length - 1].id : null;
  void logAudit(req, "READ_LIST", "clinic_notice", undefined, { count: results.length });
  return { data: results, nextCursor };
}

export async function createClinicNotice(req: AuthRequest, body: unknown) {
  const parsed = createNoticeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("title (5–200 chars), content (10+ chars), reason (20+ chars) required");
  }

  const [notice] = await db
    .insert(clinicNoticesTable)
    .values({
      clinicId: req.user!.clinicId,
      title: parsed.data.title,
      content: parsed.data.content,
      createdBy: req.user!.userId,
      reason: parsed.data.reason,
    })
    .returning();

  await logAudit(req, "CREATE", "clinic_notice", notice.id);
  return notice;
}

export async function deleteClinicNotice(req: AuthRequest, noticeId: number) {
  const conditions = [
    eq(clinicNoticesTable.id, noticeId),
    isNull(clinicNoticesTable.deletedAt),
    eq(clinicNoticesTable.clinicId, req.user!.clinicId),
  ];

  const [existing] = await db
    .select({ id: clinicNoticesTable.id })
    .from(clinicNoticesTable)
    .where(and(...conditions));
  if (!existing) throw new NotFoundError("clinic notice", noticeId);

  await db
    .update(clinicNoticesTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(...conditions));

  await logAudit(req, "DELETE", "clinic_notice", noticeId);
}
