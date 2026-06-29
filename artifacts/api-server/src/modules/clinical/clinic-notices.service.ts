// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { clinicNoticesTable } from "@workspace/db";
import { eq, isNull, desc, lt, and } from "drizzle-orm";
import { z } from "zod/v4";
import { logAudit } from "../../lib/audit";
import { NotFoundError, ValidationError } from "../../services/errors";
import type { AuthRequest } from "../../middlewares/auth";

const createNoticeSchema = z.object({
  title: z.string().min(5).max(200),
  content: z.string().min(10).max(5000),
  reason: z.string().min(20).max(1000),
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

  // cursor is a UUID string â€” lexicographic order equals chronological for UUIDv7
  if (params.cursor) {
    conditions.push(lt(clinicNoticesTable.id, params.cursor) as any);
  }

  return runInTenantContext(req.user!, async (tx) => {
    const results = await tx
      .select()
      .from(clinicNoticesTable)
      .where(and(...(conditions as any[])))
      .orderBy(desc(clinicNoticesTable.id))
      .limit(lim);

    const nextCursor = results.length === lim ? results[results.length - 1].id : null;
    await logAudit(req, "READ_LIST", "clinic_notice", undefined, { count: results.length });
    return { data: results, nextCursor };
  });
}

export async function createClinicNotice(req: AuthRequest, body: unknown) {
  const parsed = createNoticeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("title (5â€“200 chars), content (10â€“5000 chars), reason (20â€“1000 chars) required");
  }

  return runInTenantContext(req.user!, async (tx) => {
    const [notice] = await tx
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
  });
}

export async function deleteClinicNotice(req: AuthRequest, noticeId: string) {
  const conditions = [
    eq(clinicNoticesTable.id, noticeId),
    isNull(clinicNoticesTable.deletedAt),
    eq(clinicNoticesTable.clinicId, req.user!.clinicId),
  ];

  return runInTenantContext(req.user!, async (tx) => {
    const [existing] = await tx
      .select({ id: clinicNoticesTable.id })
      .from(clinicNoticesTable)
      .where(and(...conditions));
    if (!existing) throw new NotFoundError("clinic notice", noticeId);

    await tx
      .update(clinicNoticesTable)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions));

    await logAudit(req, "DELETE", "clinic_notice", noticeId);
  });
}
