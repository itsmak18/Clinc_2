import { runInTenantContext } from "@workspace/db";
import {
  appointmentsTable,
  invoicesTable,
  labTestsTable,
  xrayRecordsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, gte, lte, isNull, inArray, sql, ne } from "drizzle-orm";
import { logRead } from "../../lib/audit";
import { ForbiddenError, ValidationError } from "../../services/errors";
import type { AuthRequest } from "../../middlewares/auth";

export interface DoctorKPIs {
  totalAppointments: number;
  completedAppointments: number;
  noShowCount: number;
  noShowRate: number;
  cancelledCount: number;
  cancellationRate: number;
  avgConsultMinutes: number;
  avgWaitMinutes: number;
  revenueGenerated: number;
  labOrders: number;
  xrayOrders: number;
  orderRate: number;
}

export interface DoctorTrendPoint {
  month: string;
  totalAppointments: number;
  completedAppointments: number;
  noShowCount: number;
  revenueGenerated: number;
}

const ZERO_KPIS: DoctorKPIs = {
  totalAppointments: 0,
  completedAppointments: 0,
  noShowCount: 0,
  noShowRate: 0,
  cancelledCount: 0,
  cancellationRate: 0,
  avgConsultMinutes: 0,
  avgWaitMinutes: 0,
  revenueGenerated: 0,
  labOrders: 0,
  xrayOrders: 0,
  orderRate: 0,
};

function parseDateRange(from?: string, to?: string): { start: Date; end: Date } {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ValidationError("Invalid dateFrom/dateTo");
  }
  end.setHours(23, 59, 59, 999);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

async function computeKPIsForDoctorIds(
  tx: any,
  clinicId: number,
  doctorIds: number[],
  start: Date,
  end: Date,
): Promise<Map<number, DoctorKPIs>> {
  const out = new Map<number, DoctorKPIs>();
  if (doctorIds.length === 0) return out;

  // 1. Appointments â€” fetch in one go, aggregate per doctor in memory.
  const appts = await tx
    .select({
      doctorId: appointmentsTable.doctorId,
      patientId: appointmentsTable.patientId,
      status: appointmentsTable.status,
      scheduledAt: appointmentsTable.scheduledAt,
      checkedInAt: appointmentsTable.checkedInAt,
      consultationStartedAt: appointmentsTable.consultationStartedAt,
      updatedAt: appointmentsTable.updatedAt,
    })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.clinicId, clinicId),
        inArray(appointmentsTable.doctorId, doctorIds),
        gte(appointmentsTable.scheduledAt, start),
        lte(appointmentsTable.scheduledAt, end),
      ),
    );

  // 2. Lab + X-ray order counts per doctor.
  const labRows = await tx
    .select({
      doctorId: labTestsTable.requestedById,
      count: sql<number>`COUNT(*)::int`.as("count"),
    })
    .from(labTestsTable)
    .where(
      and(
        eq(labTestsTable.clinicId, clinicId),
        inArray(labTestsTable.requestedById, doctorIds),
        isNull(labTestsTable.deletedAt),
        gte(labTestsTable.createdAt, start),
        lte(labTestsTable.createdAt, end),
      ),
    )
    .groupBy(labTestsTable.requestedById);

  const xrayRows = await tx
    .select({
      doctorId: xrayRecordsTable.requestedById,
      count: sql<number>`COUNT(*)::int`.as("count"),
    })
    .from(xrayRecordsTable)
    .where(
      and(
        eq(xrayRecordsTable.clinicId, clinicId),
        inArray(xrayRecordsTable.requestedById, doctorIds),
        isNull(xrayRecordsTable.deletedAt),
        gte(xrayRecordsTable.createdAt, start),
        lte(xrayRecordsTable.createdAt, end),
      ),
    )
    .groupBy(xrayRecordsTable.requestedById);

  const labByDoctor = new Map<number, number>(labRows.map((r: any) => [r.doctorId, r.count]));
  const xrayByDoctor = new Map<number, number>(xrayRows.map((r: any) => [r.doctorId, r.count]));

  // 3. Revenue: loose attribution â€” sum paid invoices for patients seen by this
  //    doctor in the period. Approximation because invoices.appointmentId does
  //    not exist; revisit when billing-appointment linkage lands.
  const apptsByDoctor = new Map<number, Set<number>>();
  for (const a of appts) {
    if (!apptsByDoctor.has(a.doctorId)) apptsByDoctor.set(a.doctorId, new Set());
    apptsByDoctor.get(a.doctorId)!.add(a.patientId);
  }

  // Revenue per patient in ONE grouped query, then fan out to each doctor by their
  // patient set. Was an N+1 (one SUM query per doctor); the result is identical because
  // a doctor's revenue = Î£ over their patients of that patient's paid-invoice total.
  const allPatientIds = [...new Set<number>(appts.map((a: any) => a.patientId))];
  const revenueByPatient = new Map<number, number>();
  if (allPatientIds.length > 0) {
    const invRows = await tx
      .select({
        patientId: invoicesTable.patientId,
        total: sql<string>`COALESCE(SUM(${invoicesTable.total}), 0)`.as("total"),
      })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.clinicId, clinicId),
          eq(invoicesTable.status, "paid"),
          isNull(invoicesTable.deletedAt),
          inArray(invoicesTable.patientId, allPatientIds),
          gte(invoicesTable.paidAt, start),
          lte(invoicesTable.paidAt, end),
        ),
      )
      .groupBy(invoicesTable.patientId);
    for (const r of invRows as Array<{ patientId: number; total: string }>) {
      revenueByPatient.set(r.patientId, Number(r.total));
    }
  }

  const revenueByDoctor = new Map<number, number>();
  for (const [doctorId, patientSet] of apptsByDoctor) {
    let sum = 0;
    for (const p of patientSet) sum += revenueByPatient.get(p) ?? 0;
    revenueByDoctor.set(doctorId, sum);
  }

  for (const doctorId of doctorIds) {
    const docAppts = appts.filter((a: any) => a.doctorId === doctorId);
    const total = docAppts.length;
    const completed = docAppts.filter((a: any) => a.status === "completed").length;
    const noShows = docAppts.filter((a: any) => a.status === "no_show").length;
    const cancelled = docAppts.filter((a: any) => a.status === "cancelled").length;

    // Consult time: status='completed' â†’ updatedAt as proxy for completion (no
    // completedAt column exists). Skip rows missing consultationStartedAt.
    const consultTimes = docAppts
      .filter((a: any) => a.status === "completed" && a.consultationStartedAt && a.updatedAt)
      .map((a: any) =>
        (new Date(a.updatedAt).getTime() - new Date(a.consultationStartedAt).getTime()) / 60000,
      )
      .filter((m: number) => m > 0 && m < 24 * 60); // sanity cap
    const avgConsultMinutes = consultTimes.length
      ? consultTimes.reduce((s: number, t: number) => s + t, 0) / consultTimes.length
      : 0;

    const waitTimes = docAppts
      .filter((a: any) => a.consultationStartedAt && a.checkedInAt)
      .map((a: any) =>
        (new Date(a.consultationStartedAt).getTime() - new Date(a.checkedInAt).getTime()) / 60000,
      )
      .filter((m: number) => m >= 0 && m < 24 * 60);
    const avgWaitMinutes = waitTimes.length
      ? waitTimes.reduce((s: number, t: number) => s + t, 0) / waitTimes.length
      : 0;

    const labCount = labByDoctor.get(doctorId) ?? 0;
    const xrayCount = xrayByDoctor.get(doctorId) ?? 0;
    const orderRate = completed > 0 ? (labCount + xrayCount) / completed : 0;

    out.set(doctorId, {
      totalAppointments: total,
      completedAppointments: completed,
      noShowCount: noShows,
      noShowRate: total > 0 ? round(noShows / total, 4) : 0,
      cancelledCount: cancelled,
      cancellationRate: total > 0 ? round(cancelled / total, 4) : 0,
      avgConsultMinutes: round(avgConsultMinutes, 1),
      avgWaitMinutes: round(avgWaitMinutes, 1),
      revenueGenerated: round(revenueByDoctor.get(doctorId) ?? 0, 2),
      labOrders: labCount,
      xrayOrders: xrayCount,
      orderRate: round(orderRate, 2),
    });
  }

  // Backfill zeros for any doctor with no rows at all.
  for (const id of doctorIds) {
    if (!out.has(id)) out.set(id, { ...ZERO_KPIS });
  }
  return out;
}

function averageKPIs(rows: DoctorKPIs[]): DoctorKPIs {
  if (rows.length === 0) return { ...ZERO_KPIS };
  const sum = (k: keyof DoctorKPIs) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const n = rows.length;
  return {
    totalAppointments: Math.round(sum("totalAppointments") / n),
    completedAppointments: Math.round(sum("completedAppointments") / n),
    noShowCount: Math.round(sum("noShowCount") / n),
    noShowRate: round(sum("noShowRate") / n, 4),
    cancelledCount: Math.round(sum("cancelledCount") / n),
    cancellationRate: round(sum("cancellationRate") / n, 4),
    avgConsultMinutes: round(sum("avgConsultMinutes") / n, 1),
    avgWaitMinutes: round(sum("avgWaitMinutes") / n, 1),
    revenueGenerated: round(sum("revenueGenerated") / n, 2),
    labOrders: Math.round(sum("labOrders") / n),
    xrayOrders: Math.round(sum("xrayOrders") / n),
    orderRate: round(sum("orderRate") / n, 2),
  };
}

async function listClinicDoctors(tx: any, clinicId: number): Promise<Array<{ id: number; fullName: string }>> {
  return tx
    .select({ id: usersTable.id, fullName: usersTable.fullName })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.clinicId, clinicId),
        eq(usersTable.role, "doctor"),
        ne(usersTable.id, -1),
      ),
    );
}

async function computeMonthlyTrend(
  tx: any,
  clinicId: number,
  doctorId: number,
  months: number,
): Promise<DoctorTrendPoint[]> {
  const now = new Date();
  const out: DoctorTrendPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    const monthLabel = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;

    const kpis = (await computeKPIsForDoctorIds(tx, clinicId, [doctorId], start, end)).get(doctorId)!;
    out.push({
      month: monthLabel,
      totalAppointments: kpis.totalAppointments,
      completedAppointments: kpis.completedAppointments,
      noShowCount: kpis.noShowCount,
      revenueGenerated: kpis.revenueGenerated,
    });
  }
  return out;
}

export async function getDoctorAnalytics(
  req: AuthRequest,
  doctorId: number,
  params: { dateFrom?: string; dateTo?: string },
): Promise<{ doctor: DoctorKPIs; clinicAverage: DoctorKPIs; trend: DoctorTrendPoint[] }> {
  const clinicId = req.user!.clinicId;
  const role = req.user!.role;

  if (role === "doctor" && req.user!.userId !== doctorId) {
    throw new ForbiddenError("Doctors can only view their own analytics");
  }
  if (!["super_admin", "admin", "doctor"].includes(role)) {
    throw new ForbiddenError();
  }

  const { start, end } = parseDateRange(params.dateFrom, params.dateTo);

  const result = await runInTenantContext(req.user!, async (tx) => {
    const doctors = await listClinicDoctors(tx, clinicId);
    const allIds = doctors.map((d) => d.id);
    const kpiMap = await computeKPIsForDoctorIds(tx, clinicId, allIds, start, end);
    const trend = await computeMonthlyTrend(tx, clinicId, doctorId, 6);
    return {
      doctor: kpiMap.get(doctorId) ?? { ...ZERO_KPIS },
      clinicAverage: averageKPIs(Array.from(kpiMap.values())),
      trend,
    };
  });

  await logRead(req, "ANALYTICS", doctorId);
  return result;
}

export async function listDoctorAnalytics(
  req: AuthRequest,
  params: { dateFrom?: string; dateTo?: string },
): Promise<{
  doctors: Array<{ doctorId: number; doctorName: string; kpis: DoctorKPIs }>;
  clinicAverage: DoctorKPIs;
}> {
  const role = req.user!.role;
  if (!["super_admin", "admin"].includes(role)) {
    throw new ForbiddenError("Admin role required for cross-doctor analytics");
  }

  const clinicId = req.user!.clinicId;
  const { start, end } = parseDateRange(params.dateFrom, params.dateTo);

  const result = await runInTenantContext(req.user!, async (tx) => {
    const doctors = await listClinicDoctors(tx, clinicId);
    const ids = doctors.map((d) => d.id);
    const kpiMap = await computeKPIsForDoctorIds(tx, clinicId, ids, start, end);
    const rows = doctors.map((d) => ({
      doctorId: d.id,
      doctorName: d.fullName,
      kpis: kpiMap.get(d.id) ?? { ...ZERO_KPIS },
    }));
    return {
      doctors: rows.sort((a, b) => b.kpis.completedAppointments - a.kpis.completedAppointments),
      clinicAverage: averageKPIs(rows.map((r) => r.kpis)),
    };
  });

  await logRead(req, "ANALYTICS", "all-doctors");
  return result;
}
