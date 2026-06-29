// All queries run inside runInTenantContext (RLS-enforced) with belt-and-braces
// eq(clinicId) filters. No raw dbUnsafe call sites in this service.
//
// Aggregation is performed in SQL (COUNT/SUM/AVG ... GROUP BY) rather than by
// pulling rows to Node and reducing in JS. This keeps memory bounded on wide date
// ranges, makes money math exact (numeric SUM, no float drift), and lets day
// buckets honour the clinic's local timezone.
import { runInTenantContext } from "@workspace/db";
import {
  appointmentsTable,
  invoicesTable,
  invoiceItemsTable,
  usersTable,
  labTestsTable,
  xrayRecordsTable,
  ultrasoundRecordsTable,
  operationsTable,
  clinicsTable,
} from "@workspace/db";
import { eq, and, isNull, sql, type SQL } from "drizzle-orm";
import { logAudit } from "../../lib/audit";
import { isDoctorScoped } from "../../lib/scope";
import type { AuthRequest } from "../../middlewares/auth";

const DEFAULT_RANGE_DAYS = 30;

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Resolve the date window to inclusive YYYY-MM-DD strings (clinic-local days). */
function normalizeRange(dateFrom?: string, dateTo?: string) {
  const toStr = dateTo || ymd(new Date());
  const fromStr = dateFrom || ymd(new Date(Date.now() - DEFAULT_RANGE_DAYS * 86400000));
  return { fromStr, toStr };
}

/**
 * The immediately-preceding window of equal length, for period-over-period.
 * For a 30-day window ending today, this is the 30 days before `fromStr`.
 */
function previousRange(fromStr: string, toStr: string) {
  const from = new Date(`${fromStr}T00:00:00Z`).getTime();
  const to = new Date(`${toStr}T00:00:00Z`).getTime();
  const spanDays = Math.round((to - from) / 86400000) + 1; // inclusive
  const prevToStr = ymd(new Date(from - 86400000));
  const prevFromStr = ymd(new Date(from - spanDays * 86400000));
  return { prevFromStr, prevToStr };
}

/** All calendar days in [fromStr, toStr] inclusive, for gap-filling time series. */
function enumerateDays(fromStr: string, toStr: string): string[] {
  const out: string[] = [];
  const end = new Date(`${toStr}T00:00:00Z`).getTime();
  for (let t = new Date(`${fromStr}T00:00:00Z`).getTime(); t <= end; t += 86400000) {
    out.push(ymd(new Date(t)));
  }
  return out;
}

async function getClinicTimezone(tx: any, clinicId: number): Promise<string> {
  const rows = await tx
    .select({ tz: clinicsTable.timezone })
    .from(clinicsTable)
    .where(eq(clinicsTable.id, clinicId));
  return rows[0]?.tz ?? "UTC";
}

/**
 * Bucket a `timestamp without time zone` column (stored as a UTC wall clock) to
 * the clinic-local calendar date: interpret as UTC, convert to clinic tz, cast
 * to date.
 */
function localDate(col: SQL.Aliased | any, tz: string): SQL {
  return sql`(${col} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date`;
}

const ratio = (num: number, den: number) => (den > 0 ? num / den : 0);

export async function appointmentsSummary(
  req: AuthRequest,
  params: { dateFrom?: string; dateTo?: string },
) {
  const { fromStr, toStr } = normalizeRange(params.dateFrom, params.dateTo);
  const { prevFromStr, prevToStr } = previousRange(fromStr, toStr);
  const clinicId = req.user!.clinicId;
  const doctorScoped = isDoctorScoped(req.user?.role);

  const result = await runInTenantContext(req.user!, async (tx) => {
    const tz = await getClinicTimezone(tx, clinicId);
    const day = localDate(appointmentsTable.scheduledAt, tz);

    const rangeWhere = (f: string, t: string) =>
      and(
        eq(appointmentsTable.clinicId, clinicId),
        sql`${day} >= ${f}::date`,
        sql`${day} <= ${t}::date`,
        // Doctors only see their own appointments (least privilege).
        doctorScoped ? eq(appointmentsTable.doctorId, req.user!.userId) : undefined,
      );

    // Totals for an arbitrary window â€” reused for current + previous period.
    const totalsFor = async (f: string, t: string) => {
      const [row] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`(count(*) filter (where ${appointmentsTable.status} = 'completed'))::int`,
          cancelled: sql<number>`(count(*) filter (where ${appointmentsTable.status} = 'cancelled'))::int`,
          noShow: sql<number>`(count(*) filter (where ${appointmentsTable.status} = 'no_show'))::int`,
          // True waiting-room time: check-in â†’ consultation start. Clamp at 0 so a
          // clock skew never pulls the average negative. Only counts appts that
          // actually reached consultation.
          avgWait: sql<number>`coalesce(avg(greatest(extract(epoch from (${appointmentsTable.consultationStartedAt} - ${appointmentsTable.checkedInAt})) / 60, 0)) filter (where ${appointmentsTable.consultationStartedAt} is not null and ${appointmentsTable.checkedInAt} is not null), 0)::float8`,
        })
        .from(appointmentsTable)
        .where(rangeWhere(f, t));
      return row;
    };

    const totals = await totalsFor(fromStr, toStr);
    const prev = await totalsFor(prevFromStr, prevToStr);

    const byDoctor = await tx
      .select({
        doctorId: appointmentsTable.doctorId,
        doctorName: sql<string>`coalesce(${usersTable.fullName}, '#' || ${appointmentsTable.doctorId})`,
        count: sql<number>`count(*)::int`,
      })
      .from(appointmentsTable)
      .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
      .where(rangeWhere(fromStr, toStr))
      .groupBy(appointmentsTable.doctorId, usersTable.fullName)
      .orderBy(sql`count(*) desc`);

    const byStatus = await tx
      .select({ status: appointmentsTable.status, count: sql<number>`count(*)::int` })
      .from(appointmentsTable)
      .where(rangeWhere(fromStr, toStr))
      .groupBy(appointmentsTable.status)
      .orderBy(sql`count(*) desc`);

    const byDayRows = await tx
      .select({ date: sql<string>`to_char(${day}, 'YYYY-MM-DD')`, count: sql<number>`count(*)::int` })
      .from(appointmentsTable)
      .where(rangeWhere(fromStr, toStr))
      // Ordinal GROUP/ORDER on the selected bucketed date: repeating the parameterized
      // `day` expr would re-bind the tz as a new placeholder â†’ Postgres "must appear in
      // the GROUP BY clause" (different param = different expression). See reports byDay fix.
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return { totals, prev, byDoctor, byStatus, byDayRows };
  });

  const total = result.totals.total;
  const byDayMap = new Map(result.byDayRows.map((r) => [r.date, r]));
  const byDay = enumerateDays(fromStr, toStr).map((date) => byDayMap.get(date) ?? { date, count: 0 });

  await logAudit(req, "READ", "REPORT", undefined, { report: "appointments", dateFrom: fromStr, dateTo: toStr });
  return {
    totalAppointments: total,
    completed: result.totals.completed,
    cancelled: result.totals.cancelled,
    noShow: result.totals.noShow,
    cancellationRate: ratio(result.totals.cancelled, total),
    noShowRate: ratio(result.totals.noShow, total),
    averageWaitTimeMinutes: result.totals.avgWait,
    byDoctor: result.byDoctor,
    byStatus: result.byStatus,
    byDay,
    previous: {
      totalAppointments: result.prev.total,
      completed: result.prev.completed,
      cancellationRate: ratio(result.prev.cancelled, result.prev.total),
      noShowRate: ratio(result.prev.noShow, result.prev.total),
    },
  };
}

export async function revenueSummary(
  req: AuthRequest,
  params: { dateFrom?: string; dateTo?: string },
) {
  const { fromStr, toStr } = normalizeRange(params.dateFrom, params.dateTo);
  const { prevFromStr, prevToStr } = previousRange(fromStr, toStr);
  const clinicId = req.user!.clinicId;

  const result = await runInTenantContext(req.user!, async (tx) => {
    const tz = await getClinicTimezone(tx, clinicId);
    const day = localDate(invoicesTable.createdAt, tz);

    const rangeWhere = (f: string, t: string) =>
      and(
        isNull(invoicesTable.deletedAt),
        eq(invoicesTable.clinicId, clinicId),
        sql`${day} >= ${f}::date`,
        sql`${day} <= ${t}::date`,
      );

    const totalsFor = async (f: string, t: string) => {
      const [row] = await tx
        .select({
          // numeric SUM â†’ exact money; ::float8 only for transport.
          totalRevenue: sql<number>`coalesce(sum(${invoicesTable.total}) filter (where ${invoicesTable.status} = 'paid'), 0)::float8`,
          pendingAmount: sql<number>`coalesce(sum(${invoicesTable.total}) filter (where ${invoicesTable.status} = 'pending'), 0)::float8`,
          totalInvoices: sql<number>`count(*)::int`,
          paidInvoices: sql<number>`(count(*) filter (where ${invoicesTable.status} = 'paid'))::int`,
          pendingInvoices: sql<number>`(count(*) filter (where ${invoicesTable.status} = 'pending'))::int`,
          cancelledInvoices: sql<number>`(count(*) filter (where ${invoicesTable.status} = 'cancelled'))::int`,
        })
        .from(invoicesTable)
        .where(rangeWhere(f, t));
      return row;
    };

    const totals = await totalsFor(fromStr, toStr);
    const prev = await totalsFor(prevFromStr, prevToStr);

    const byDayRows = await tx
      .select({
        date: sql<string>`to_char(${day}, 'YYYY-MM-DD')`,
        revenue: sql<number>`coalesce(sum(${invoicesTable.total}) filter (where ${invoicesTable.status} = 'paid'), 0)::float8`,
        invoices: sql<number>`count(*)::int`,
      })
      .from(invoicesTable)
      .where(rangeWhere(fromStr, toStr))
      // Ordinal GROUP/ORDER on the selected bucketed date: repeating the parameterized
      // `day` expr would re-bind the tz as a new placeholder â†’ Postgres "must appear in
      // the GROUP BY clause" (different param = different expression). See reports byDay fix.
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // Top services by collected revenue: invoice line-items on PAID invoices in window.
    const topServices = await tx
      .select({
        name: invoiceItemsTable.description,
        revenue: sql<number>`coalesce(sum(${invoiceItemsTable.quantity} * ${invoiceItemsTable.unitPrice}), 0)::float8`,
        count: sql<number>`coalesce(sum(${invoiceItemsTable.quantity}), 0)::int`,
      })
      .from(invoiceItemsTable)
      .innerJoin(invoicesTable, eq(invoiceItemsTable.invoiceId, invoicesTable.id))
      .where(
        and(
          isNull(invoicesTable.deletedAt),
          eq(invoicesTable.clinicId, clinicId),
          eq(invoicesTable.status, "paid"),
          sql`${day} >= ${fromStr}::date`,
          sql`${day} <= ${toStr}::date`,
        ),
      )
      .groupBy(invoiceItemsTable.description)
      .orderBy(sql`coalesce(sum(${invoiceItemsTable.quantity} * ${invoiceItemsTable.unitPrice}), 0) desc`)
      .limit(10);

    return { totals, prev, byDayRows, topServices };
  });

  const { totals, prev } = result;
  const averageInvoiceValue = ratio(totals.totalRevenue, totals.paidInvoices);
  const collectionRate = ratio(totals.paidInvoices, totals.paidInvoices + totals.pendingInvoices);

  // Gap-fill: every calendar day in range, zero where no invoices.
  const byDayMap = new Map(result.byDayRows.map((r) => [r.date, r]));
  const byDay = enumerateDays(fromStr, toStr).map(
    (date) => byDayMap.get(date) ?? { date, revenue: 0, invoices: 0 },
  );

  await logAudit(req, "READ", "REPORT", undefined, { report: "revenue", dateFrom: fromStr, dateTo: toStr });
  return {
    totalRevenue: totals.totalRevenue,
    totalInvoices: totals.totalInvoices,
    paidInvoices: totals.paidInvoices,
    pendingInvoices: totals.pendingInvoices,
    cancelledInvoices: totals.cancelledInvoices,
    pendingAmount: totals.pendingAmount,
    collectionRate,
    averageInvoiceValue,
    byDay,
    topServices: result.topServices,
    previous: {
      totalRevenue: prev.totalRevenue,
      paidInvoices: prev.paidInvoices,
      collectionRate: ratio(prev.paidInvoices, prev.paidInvoices + prev.pendingInvoices),
    },
  };
}

export async function diagnosticsSummary(
  req: AuthRequest,
  params: { dateFrom?: string; dateTo?: string },
) {
  const { fromStr, toStr } = normalizeRange(params.dateFrom, params.dateTo);
  const clinicId = req.user!.clinicId;

  const result = await runInTenantContext(req.user!, async (tx) => {
    const tz = await getClinicTimezone(tx, clinicId);

    // Doctor patient-scoping is enforced at the DB layer: lab_tests / xray_records
    // carry the doctor_scope RLS policy (migration 0017), which self-derives from
    // app.user_id / app.role set by runInTenantContext. A doctor's aggregates are
    // therefore automatically limited to their assigned patients â€” no manual
    // patient filter needed here. Break-glass patients are intentionally excluded
    // from bulk reports (no breakGlassPatientIds passed): a report is not an
    // emergency individual-record access.
    const labDay = localDate(labTestsTable.createdAt, tz);
    const labWhere = and(
      isNull(labTestsTable.deletedAt),
      eq(labTestsTable.clinicId, clinicId),
      sql`${labDay} >= ${fromStr}::date`,
      sql`${labDay} <= ${toStr}::date`,
    );
    const xrayDay = localDate(xrayRecordsTable.createdAt, tz);
    const xrayWhere = and(
      isNull(xrayRecordsTable.deletedAt),
      eq(xrayRecordsTable.clinicId, clinicId),
      sql`${xrayDay} >= ${fromStr}::date`,
      sql`${xrayDay} <= ${toStr}::date`,
    );

    const labByStatus = await tx
      .select({ status: labTestsTable.status, count: sql<number>`count(*)::int` })
      .from(labTestsTable)
      .where(labWhere)
      .groupBy(labTestsTable.status);

    const topLabTypes = await tx
      .select({ name: sql<string>`coalesce(${labTestsTable.testName}, 'Unknown')`, count: sql<number>`count(*)::int` })
      .from(labTestsTable)
      .where(labWhere)
      .groupBy(labTestsTable.testName)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    const xrayByStatus = await tx
      .select({ status: xrayRecordsTable.status, count: sql<number>`count(*)::int` })
      .from(xrayRecordsTable)
      .where(xrayWhere)
      .groupBy(xrayRecordsTable.status);

    const topXrayBodyParts = await tx
      .select({ part: sql<string>`coalesce(${xrayRecordsTable.bodyPart}, 'Unknown')`, count: sql<number>`count(*)::int` })
      .from(xrayRecordsTable)
      .where(xrayWhere)
      .groupBy(xrayRecordsTable.bodyPart)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    // Ultrasound â€” same doctor_scope RLS as lab/xray; mirrors the xray blocks.
    const ultrasoundDay = localDate(ultrasoundRecordsTable.createdAt, tz);
    const ultrasoundWhere = and(
      isNull(ultrasoundRecordsTable.deletedAt),
      eq(ultrasoundRecordsTable.clinicId, clinicId),
      sql`${ultrasoundDay} >= ${fromStr}::date`,
      sql`${ultrasoundDay} <= ${toStr}::date`,
    );

    const ultrasoundByStatus = await tx
      .select({ status: ultrasoundRecordsTable.status, count: sql<number>`count(*)::int` })
      .from(ultrasoundRecordsTable)
      .where(ultrasoundWhere)
      .groupBy(ultrasoundRecordsTable.status);

    const topUltrasoundExamTypes = await tx
      .select({ name: sql<string>`coalesce(${ultrasoundRecordsTable.examType}, 'Unknown')`, count: sql<number>`count(*)::int` })
      .from(ultrasoundRecordsTable)
      .where(ultrasoundWhere)
      .groupBy(ultrasoundRecordsTable.examType)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    return { labByStatus, topLabTypes, xrayByStatus, topXrayBodyParts, ultrasoundByStatus, topUltrasoundExamTypes };
  });

  const sumCounts = (rows: { count: number }[]) => rows.reduce((s, r) => s + r.count, 0);
  const totalLabTests = sumCounts(result.labByStatus);
  const labCompleted = result.labByStatus.find((r) => r.status === "completed")?.count ?? 0;
  const totalXrays = sumCounts(result.xrayByStatus);
  const xraysReviewed = result.xrayByStatus.find((r) => r.status === "completed")?.count ?? 0;
  const totalUltrasounds = sumCounts(result.ultrasoundByStatus);
  const ultrasoundsReviewed = result.ultrasoundByStatus.find((r) => r.status === "completed")?.count ?? 0;

  await logAudit(req, "READ", "REPORT", undefined, { report: "diagnostics", dateFrom: fromStr, dateTo: toStr });
  return {
    totalLabTests,
    labCompleted,
    totalXrays,
    xraysReviewed,
    totalUltrasounds,
    ultrasoundsReviewed,
    labByStatus: result.labByStatus,
    xrayByStatus: result.xrayByStatus,
    ultrasoundByStatus: result.ultrasoundByStatus,
    topLabTypes: result.topLabTypes,
    topXrayBodyParts: result.topXrayBodyParts,
    topUltrasoundExamTypes: result.topUltrasoundExamTypes,
  };
}

export async function operationsSummary(
  req: AuthRequest,
  params: { dateFrom?: string; dateTo?: string },
) {
  const { fromStr, toStr } = normalizeRange(params.dateFrom, params.dateTo);
  const clinicId = req.user!.clinicId;

  const result = await runInTenantContext(req.user!, async (tx) => {
    const tz = await getClinicTimezone(tx, clinicId);
    const day = localDate(operationsTable.scheduledAt, tz);
    const baseWhere = and(
      isNull(operationsTable.deletedAt),
      eq(operationsTable.clinicId, clinicId),
      sql`${day} >= ${fromStr}::date`,
      sql`${day} <= ${toStr}::date`,
    );
    // "Performed" / "entered the OR" = the operation actually took place.
    const occurred = sql`${operationsTable.status} in ('in_progress', 'completed')`;

    const byStatus = await tx
      .select({ status: operationsTable.status, count: sql<number>`count(*)::int` })
      .from(operationsTable)
      .where(baseWhere)
      .groupBy(operationsTable.status)
      .orderBy(sql`count(*) desc`);

    // How many operations each surgeon performed (+ total assigned for context).
    const bySurgeon = await tx
      .select({
        surgeonId: operationsTable.surgeonId,
        surgeonName: sql<string>`coalesce(${usersTable.fullName}, '#' || ${operationsTable.surgeonId})`,
        performed: sql<number>`(count(*) filter (where ${occurred}))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(operationsTable)
      .leftJoin(usersTable, eq(operationsTable.surgeonId, usersTable.id))
      .where(baseWhere)
      .groupBy(operationsTable.surgeonId, usersTable.fullName)
      .orderBy(sql`count(*) filter (where ${occurred}) desc`);

    const byProcedure = await tx
      .select({ name: sql<string>`coalesce(${operationsTable.procedureName}, 'Unknown')`, count: sql<number>`count(*)::int` })
      .from(operationsTable)
      .where(and(baseWhere, occurred))
      .groupBy(operationsTable.procedureName)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    const byDayRows = await tx
      .select({ date: sql<string>`to_char(${day}, 'YYYY-MM-DD')`, count: sql<number>`count(*)::int` })
      .from(operationsTable)
      .where(and(baseWhere, occurred))
      // Ordinal GROUP/ORDER on the selected bucketed date: repeating the parameterized
      // `day` expr would re-bind the tz as a new placeholder â†’ Postgres "must appear in
      // the GROUP BY clause" (different param = different expression). See reports byDay fix.
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // OR-team participation: how many performed operations each assisting staff
    // member (nurse, anesthetist, assistant â€¦) was part of. Unnest the
    // staff_assigned jsonb array and group by the referenced user.
    // Extract the assigned user id per operation row FIRST (subquery), then
    // aggregate. Doing the unnest + aggregate in one level fails because the
    // name fallback references the ungrouped lateral `elem`.
    const staffRes: any = await tx.execute(sql`
      SELECT s.user_id,
             coalesce(u.full_name, '#' || s.user_id) AS name,
             u.role AS role,
             count(*)::int AS count
      FROM (
        SELECT (elem->>'userId')::int AS user_id
        FROM operations o
        CROSS JOIN LATERAL jsonb_array_elements(o.staff_assigned) AS elem
        WHERE o.deleted_at IS NULL
          AND o.clinic_id = ${clinicId}
          AND jsonb_typeof(o.staff_assigned) = 'array'
          AND (o.scheduled_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date >= ${fromStr}::date
          AND (o.scheduled_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date <= ${toStr}::date
          AND o.status IN ('in_progress', 'completed')
      ) s
      LEFT JOIN users u ON u.id = s.user_id
      GROUP BY s.user_id, u.full_name, u.role
      ORDER BY count(*) DESC
      LIMIT 50
    `);
    const byStaff = (staffRes.rows ?? staffRes).map((r: any) => ({
      userId: r.user_id,
      name: r.name,
      role: r.role ?? null,
      count: Number(r.count),
    }));

    return { byStatus, bySurgeon, byProcedure, byDayRows, byStaff };
  });

  const findStatus = (s: string) => result.byStatus.find((r) => r.status === s)?.count ?? 0;
  const totalOperations = result.byStatus.reduce((acc, r) => acc + r.count, 0);
  const byDayMap = new Map(result.byDayRows.map((r) => [r.date, r]));
  const byDay = enumerateDays(fromStr, toStr).map((date) => byDayMap.get(date) ?? { date, count: 0 });

  await logAudit(req, "READ", "REPORT", undefined, { report: "operations", dateFrom: fromStr, dateTo: toStr });
  return {
    totalOperations,
    completed: findStatus("completed"),
    inProgress: findStatus("in_progress"),
    cancelled: findStatus("cancelled"),
    byStatus: result.byStatus,
    bySurgeon: result.bySurgeon,
    byStaff: result.byStaff,
    byProcedure: result.byProcedure,
    byDay,
  };
}
