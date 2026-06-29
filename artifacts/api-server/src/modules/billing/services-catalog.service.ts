// dbUnsafe: uses runInTenantContext for RLS-enforced queries (tx). Remaining raw
// db calls carry explicit eq(clinicId) filters (belt-and-braces).
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { servicesCatalogTable } from "@workspace/db";
import { eq, isNull, and, lt, desc } from "drizzle-orm";
import { logAudit, auditSnapshot } from "../../lib/audit";
import { NotFoundError, ValidationError } from "../../services/errors";
import type { AuthRequest } from "../../middlewares/auth";

export async function listServices(req: AuthRequest, params: { category?: string; includeInactive?: boolean; cursor?: string; limit?: string }) {
  return runInTenantContext(req.user!, async (tx) => {
    const lim = Math.min(parseInt(params.limit ?? "100") || 100, 100);
    const conditions: any[] = [isNull(servicesCatalogTable.deletedAt), eq(servicesCatalogTable.clinicId, req.user!.clinicId)];
    // Filters moved from JS post-fetch to SQL WHERE so they apply before the limit
    if (params.category) conditions.push(eq(servicesCatalogTable.category, params.category));
    if (!params.includeInactive) conditions.push(eq(servicesCatalogTable.active, true));
    if (params.cursor) {
      const cursorId = parseInt(params.cursor);
      if (!isNaN(cursorId)) conditions.push(lt(servicesCatalogTable.id, cursorId));
    }
    const rows = await tx.select().from(servicesCatalogTable).where(and(...conditions)).orderBy(desc(servicesCatalogTable.id)).limit(lim);
    return { data: rows, nextCursor: rows.length === lim ? rows[rows.length - 1].id : null };
  });
}

export async function createService(
  req: AuthRequest,
  data: { name: string; nameAr?: string; defaultPrice: number; category?: string; code?: string; description?: string },
) {
  if (!data.name || data.defaultPrice === undefined || data.defaultPrice === null) {
    throw new ValidationError("Name and price are required");
  }
  if (Number(data.defaultPrice) < 0) throw new ValidationError("Price cannot be negative");

  return runInTenantContext(req.user!, async (tx) => {
    const [row] = await tx.insert(servicesCatalogTable).values({
      clinicId: req.user!.clinicId,
      name: data.name,
      nameAr: data.nameAr,
      defaultPrice: String(data.defaultPrice),
      category: data.category,
      code: data.code,
      description: data.description,
    }).returning();
    await logAudit(req, "CREATE", "service_catalog", row.id);
    return row;
  });
}

export async function updateService(req: AuthRequest, id: number, data: Record<string, any>) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(servicesCatalogTable.id, id), eq(servicesCatalogTable.clinicId, req.user!.clinicId), isNull(servicesCatalogTable.deletedAt)];
    const [before] = await tx.select().from(servicesCatalogTable).where(and(...conditions));
    if (!before) throw new NotFoundError("service", id);
    const patch: Record<string, any> = { ...data, updatedAt: new Date() };
    if (patch.defaultPrice !== undefined) patch.defaultPrice = String(patch.defaultPrice);
    const [row] = await tx.update(servicesCatalogTable).set(patch).where(and(...conditions)).returning();
    const fields = Object.keys(data).filter(k => k !== "updatedAt");
    await logAudit(req, "UPDATE", "service_catalog", row.id, { fields }, auditSnapshot(before), auditSnapshot(row));
    return row;
  });
}

// A starter catalog of common clinic services (price 0 — the admin fills prices in).
// Names are matched case-insensitively on seed so re-running never duplicates.
const DEFAULT_SERVICES: { name: string; nameAr: string; category: string; code?: string }[] = [
  // Consultations
  { name: "General Consultation",     nameAr: "كشف عام",                  category: "consultation", code: "CONSULTATION" },
  { name: "Follow-up Visit",          nameAr: "زيارة متابعة",             category: "consultation" },
  { name: "Specialist Consultation",  nameAr: "استشارة أخصائي",           category: "consultation" },
  // Laboratory
  { name: "Complete Blood Count (CBC)", nameAr: "تعداد الدم الكامل",      category: "lab" },
  { name: "Fasting Blood Glucose",    nameAr: "سكر صائم",                 category: "lab" },
  { name: "Lipid Profile",            nameAr: "دهون الدم",                category: "lab" },
  { name: "Liver Function Test (LFT)",nameAr: "وظائف الكبد",              category: "lab" },
  { name: "Kidney Function Test (KFT)",nameAr: "وظائف الكلى",             category: "lab" },
  { name: "Urinalysis",               nameAr: "تحليل بول",                category: "lab" },
  { name: "HbA1c",                    nameAr: "السكر التراكمي",           category: "lab" },
  { name: "Thyroid (TSH)",            nameAr: "هرمون الغدة الدرقية",       category: "lab" },
  { name: "Vitamin D",                nameAr: "فيتامين د",                category: "lab" },
  { name: "C-Reactive Protein (CRP)", nameAr: "بروتين سي التفاعلي",        category: "lab" },
  { name: "Pregnancy Test (Beta-hCG)",nameAr: "اختبار حمل",               category: "lab" },
  { name: "Lab Test (default)",       nameAr: "تحليل مخبري (افتراضي)",     category: "lab", code: "LAB_DEFAULT" },
  // X-Ray
  { name: "Chest X-Ray",              nameAr: "أشعة صدر",                 category: "xray" },
  { name: "Spine X-Ray",              nameAr: "أشعة عمود فقري",            category: "xray" },
  { name: "Extremity X-Ray",          nameAr: "أشعة أطراف",               category: "xray" },
  { name: "Abdomen X-Ray",            nameAr: "أشعة بطن",                 category: "xray" },
  { name: "X-Ray (default)",          nameAr: "أشعة سينية (افتراضي)",      category: "xray", code: "XRAY_DEFAULT" },
  // Ultrasound
  { name: "Abdominal Ultrasound",     nameAr: "موجات صوتية للبطن",        category: "ultrasound" },
  { name: "Pelvic Ultrasound",        nameAr: "موجات صوتية للحوض",        category: "ultrasound" },
  { name: "Obstetric Ultrasound",     nameAr: "موجات صوتية للحمل",        category: "ultrasound" },
  { name: "Thyroid Ultrasound",       nameAr: "موجات صوتية للغدة الدرقية", category: "ultrasound" },
  { name: "Renal Ultrasound",         nameAr: "موجات صوتية للكلى",        category: "ultrasound" },
  { name: "Ultrasound (default)",     nameAr: "موجات صوتية (افتراضي)",     category: "ultrasound", code: "US_DEFAULT" },
  // Operations / procedures
  { name: "Minor Surgical Procedure", nameAr: "إجراء جراحي بسيط",         category: "operation" },
  { name: "Operation (default)",      nameAr: "عملية (افتراضي)",          category: "operation", code: "OPERATION_DEFAULT" },
  // Other
  { name: "Wound Dressing",           nameAr: "تغيير ضمادة",              category: "other" },
  { name: "Injection",                nameAr: "حقنة",                     category: "other" },
  { name: "Nebulization",             nameAr: "جلسة استنشاق",             category: "other" },
];

export async function seedDefaultServices(req: AuthRequest) {
  return runInTenantContext(req.user!, async (tx) => {
    const existing = await tx.select({ name: servicesCatalogTable.name }).from(servicesCatalogTable)
      .where(and(eq(servicesCatalogTable.clinicId, req.user!.clinicId), isNull(servicesCatalogTable.deletedAt)));
    const have = new Set(existing.map(e => e.name.trim().toLowerCase()));
    const toInsert = DEFAULT_SERVICES.filter(d => !have.has(d.name.toLowerCase()));
    if (toInsert.length) {
      await tx.insert(servicesCatalogTable).values(toInsert.map(d => ({
        clinicId: req.user!.clinicId,
        name: d.name, nameAr: d.nameAr, category: d.category, code: d.code,
        defaultPrice: "0",
      })));
    }
    await logAudit(req, "SEED_DEFAULTS", "service_catalog", undefined, { inserted: toInsert.length });
    return { inserted: toInsert.length };
  });
}

export async function deleteService(req: AuthRequest, id: number) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(servicesCatalogTable.id, id), eq(servicesCatalogTable.clinicId, req.user!.clinicId), isNull(servicesCatalogTable.deletedAt)];
    const [before] = await tx.select().from(servicesCatalogTable).where(and(...conditions));
    if (!before) throw new NotFoundError("service", id);
    const [after] = await tx.update(servicesCatalogTable).set({ deletedAt: new Date() }).where(and(...conditions)).returning();
    await logAudit(req, "DELETE", "service_catalog", id, null, auditSnapshot(before), auditSnapshot(after));
  });
}
