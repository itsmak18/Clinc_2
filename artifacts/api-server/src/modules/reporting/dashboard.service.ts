// All queries run inside runInTenantContext (RLS-enforced) with belt-and-braces
// eq(clinicId) filters. No raw dbUnsafe call sites in this service.
import { runInTenantContext } from "@workspace/db";
import {
  appointmentsTable, patientsTable, usersTable, labTestsTable,
  xrayRecordsTable, invoicesTable, operationsTable, inventoryTable, auditLogsTable,
  prescriptionsTable,
} from "@workspace/db";
import { eq, isNull, gte, lte, and, desc, notInArray, sql, like } from "drizzle-orm";
import type { AuthRequest } from "../../middlewares/auth";
import { runtime } from "../../lib/runtime";
import { parseMoneyToCents, sumCents, centsToNumber } from "../../lib/money";

// TODO: move cache TTLs to env vars if patient portal is added (higher concurrency).
const TTL_DASHBOARD = 30;
const TTL_RECENT_ACTIVITY = 15;

export async function getDashboardSummary(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  return runtime.cache.getOrSet(
    `cache:${clinicId}:dashboard:summary`,
    TTL_DASHBOARD,
    () => computeDashboardSummary(req),
  );
}

async function computeDashboardSummary(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const yestStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestEnd    = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);

  const [
    todayAppts, allPatients, allUsers, pendingLabs, pendingXrays,
    todayInvoices, scheduledOps, inventory, yesterdayInvoices,
  ] = await runInTenantContext(req.user!, async (tx) => {
    return Promise.all([
      tx.select().from(appointmentsTable).where(and(eq(appointmentsTable.clinicId, clinicId), gte(appointmentsTable.scheduledAt, todayStart), lte(appointmentsTable.scheduledAt, todayEnd))),
      tx.select({ id: patientsTable.id }).from(patientsTable).where(and(eq(patientsTable.clinicId, clinicId), isNull(patientsTable.deletedAt))),
      tx.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(and(eq(usersTable.clinicId, clinicId), isNull(usersTable.deletedAt), eq(usersTable.isActive, true))),
      tx.select({ id: labTestsTable.id }).from(labTestsTable).where(and(eq(labTestsTable.clinicId, clinicId), eq(labTestsTable.status, "requested"))),
      tx.select({ id: xrayRecordsTable.id }).from(xrayRecordsTable).where(and(eq(xrayRecordsTable.clinicId, clinicId), eq(xrayRecordsTable.status, "requested"))),
      tx.select().from(invoicesTable).where(and(eq(invoicesTable.clinicId, clinicId), isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, todayStart), lte(invoicesTable.createdAt, todayEnd))),
      tx.select({ id: operationsTable.id }).from(operationsTable).where(and(eq(operationsTable.clinicId, clinicId), eq(operationsTable.status, "scheduled"))),
      tx.select().from(inventoryTable).where(and(eq(inventoryTable.clinicId, clinicId), isNull(inventoryTable.deletedAt), eq(inventoryTable.isActive, true))),
      tx.select({ total: invoicesTable.total, status: invoicesTable.status }).from(invoicesTable).where(and(eq(invoicesTable.clinicId, clinicId), isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, yestStart), lte(invoicesTable.createdAt, yestEnd))),
    ]);
  });

  const todayRevenue     = centsToNumber(sumCents(todayInvoices.filter(i => i.status === "paid").map(i => parseMoneyToCents(String(i.total)))));
  const yesterdayRevenue = centsToNumber(sumCents(yesterdayInvoices.filter(i => i.status === "paid").map(i => parseMoneyToCents(String(i.total)))));
  const lowStockItems    = inventory.filter(i => i.quantity <= i.minimumStock).length;

  return {
    todayAppointments:   todayAppts.length,
    checkedInPatients:   todayAppts.filter(a => a.status === "checked_in").length,
    pendingLabTests:     pendingLabs.length,
    pendingXrays:        pendingXrays.length,
    todayRevenue,
    yesterdayRevenue,
    pendingInvoices:     todayInvoices.filter(i => i.status === "pending").length,
    scheduledOperations: scheduledOps.length,
    lowStockItems,
    totalPatients:       allPatients.length,
    totalDoctors:        allUsers.filter(u => u.role === "doctor").length,
  };
}

export async function getDepartmentLoad(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  return runtime.cache.getOrSet(
    `cache:${clinicId}:dashboard:dept_load`,
    TTL_DASHBOARD,
    () => computeDepartmentLoad(req),
  );
}

async function computeDepartmentLoad(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const now      = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const rows = await runInTenantContext(req.user!, async (tx) => {
    return tx.select({
      doctorId:   appointmentsTable.doctorId,
      doctorName: usersTable.fullName,
      count:      appointmentsTable.id,
    }).from(appointmentsTable)
      .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
      .where(and(
        eq(appointmentsTable.clinicId, clinicId),
        gte(appointmentsTable.scheduledAt, todayStart),
        lte(appointmentsTable.scheduledAt, todayEnd),
        notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
      ));
  });

  const grouped: Record<number, { doctorId: number; doctorName: string; count: number }> = {};
  for (const row of rows) {
    const id = row.doctorId;
    if (!grouped[id]) {
      grouped[id] = { doctorId: id, doctorName: row.doctorName ?? `Doctor #${id}`, count: 0 };
    }
    grouped[id].count++;
  }

  return Object.values(grouped).sort((a, b) => b.count - a.count);
}

export async function getRecentActivity(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  return runtime.cache.getOrSet(
    `cache:${clinicId}:dashboard:recent_activity`,
    TTL_RECENT_ACTIVITY,
    () => computeRecentActivity(req),
  );
}

async function computeRecentActivity(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const rows = await runInTenantContext(req.user!, async (tx) => {
    return tx.select({
      id:         auditLogsTable.id,
      action:     auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId:   auditLogsTable.entityId,
      createdAt:  auditLogsTable.createdAt,
      user:       { fullName: usersTable.fullName },
    }).from(auditLogsTable)
      .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
      .where(eq(auditLogsTable.clinicId, clinicId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(20);
  });

  return rows.map(r => ({
    ...r,
    description: `${r.user?.fullName || "System"} ${r.action.toLowerCase()}d ${r.entityType.replace(/_/g, " ")}${r.entityId ? ` #${r.entityId}` : ""}`,
  }));
}

function imagingShape(
  first: number, second: number, third: number,
  today: number, week: number,
  recent: { id: number; patientId: number; status: string; createdAt: Date }[],
) {
  return { firstCount: first, secondCount: second, thirdCount: third, todayCount: today, weekCount: week, recentItems: recent };
}

export async function getImagingDashboard(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  const [all, today, week, recent] = await runInTenantContext(req.user!, async (tx) => {
    return Promise.all([
      tx.select({ status: xrayRecordsTable.status }).from(xrayRecordsTable).where(eq(xrayRecordsTable.clinicId, clinicId)),
      tx.select({ id: xrayRecordsTable.id }).from(xrayRecordsTable).where(and(eq(xrayRecordsTable.clinicId, clinicId), gte(xrayRecordsTable.createdAt, todayStart))),
      tx.select({ id: xrayRecordsTable.id }).from(xrayRecordsTable).where(and(eq(xrayRecordsTable.clinicId, clinicId), gte(xrayRecordsTable.createdAt, weekStart))),
      tx.select({ id: xrayRecordsTable.id, patientId: xrayRecordsTable.patientId, status: xrayRecordsTable.status, createdAt: xrayRecordsTable.createdAt })
        .from(xrayRecordsTable).where(eq(xrayRecordsTable.clinicId, clinicId)).orderBy(desc(xrayRecordsTable.createdAt)).limit(10),
    ]);
  });

  return imagingShape(
    all.filter(r => r.status === "requested").length,
    all.filter(r => r.status === "in_progress").length,
    all.filter(r => r.status === "completed").length,
    today.length, week.length, recent,
  );
}

export async function getLabDashboard(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  const [all, today, week, recent] = await runInTenantContext(req.user!, async (tx) => {
    return Promise.all([
      tx.select({ status: labTestsTable.status }).from(labTestsTable).where(eq(labTestsTable.clinicId, clinicId)),
      tx.select({ id: labTestsTable.id }).from(labTestsTable).where(and(eq(labTestsTable.clinicId, clinicId), gte(labTestsTable.createdAt, todayStart))),
      tx.select({ id: labTestsTable.id }).from(labTestsTable).where(and(eq(labTestsTable.clinicId, clinicId), gte(labTestsTable.createdAt, weekStart))),
      tx.select({ id: labTestsTable.id, patientId: labTestsTable.patientId, status: labTestsTable.status, createdAt: labTestsTable.createdAt })
        .from(labTestsTable).where(eq(labTestsTable.clinicId, clinicId)).orderBy(desc(labTestsTable.createdAt)).limit(10),
    ]);
  });

  return imagingShape(
    all.filter(r => r.status === "requested").length,
    all.filter(r => r.status === "in_progress").length,
    all.filter(r => r.status === "completed").length,
    today.length, week.length, recent,
  );
}

export async function getFrontDeskDashboard(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const [todayAppts, pendingInvoices] = await runInTenantContext(req.user!, async (tx) => {
    return Promise.all([
      tx.select({
        id:            appointmentsTable.id,
        status:        appointmentsTable.status,
        bookingSource: appointmentsTable.bookingSource,
        scheduledAt:   appointmentsTable.scheduledAt,
      })
        .from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.clinicId, clinicId),
          gte(appointmentsTable.scheduledAt, todayStart),
          lte(appointmentsTable.scheduledAt, todayEnd),
        )),

      tx.select({ id: invoicesTable.id, total: invoicesTable.total })
        .from(invoicesTable)
        .where(and(eq(invoicesTable.clinicId, clinicId), isNull(invoicesTable.deletedAt), eq(invoicesTable.status, "pending"))),
    ]);
  });

  const statusCounts = {
    scheduled:           todayAppts.filter(a => a.status === "scheduled").length,
    checked_in:          todayAppts.filter(a => a.status === "checked_in").length,
    completed:           todayAppts.filter(a => a.status === "completed").length,
    cancelled:           todayAppts.filter(a => a.status === "cancelled").length,
    no_show:             todayAppts.filter(a => a.status === "no_show").length,
    in_progress:         todayAppts.filter(a =>
      ["in_triage", "ready_for_doctor", "in_consultation", "awaiting_diagnostics", "pending_payment"].includes(a.status)
    ).length,
  };

  const sourceCounts = {
    walk_in: todayAppts.filter(a => a.bookingSource === "walk_in").length,
    phone:   todayAppts.filter(a => a.bookingSource === "phone").length,
    online:  todayAppts.filter(a => a.bookingSource === "online").length,
  };

  const pendingInvoiceSum = centsToNumber(sumCents(pendingInvoices.map(i => parseMoneyToCents(String(i.total)))));

  return {
    totalToday:        todayAppts.length,
    statusCounts,
    sourceCounts,
    noShowCount:       statusCounts.no_show,
    pendingInvoiceCount: pendingInvoices.length,
    pendingInvoiceSum:   Math.round(pendingInvoiceSum * 100) / 100,
  };
}

export async function getNurseDashboard(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const todayAppts = await runInTenantContext(req.user!, async (tx) => {
    return tx.select({
      id:           appointmentsTable.id,
      patientId:    appointmentsTable.patientId,
      status:       appointmentsTable.status,
      triagePriority: appointmentsTable.triagePriority,
      checkedInAt:  appointmentsTable.checkedInAt,
    })
      .from(appointmentsTable)
      .where(and(
        eq(appointmentsTable.clinicId, clinicId),
        gte(appointmentsTable.scheduledAt, todayStart),
        lte(appointmentsTable.scheduledAt, todayEnd),
        notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
      ));
  });

  const activeStatuses = ["checked_in", "in_triage", "ready_for_doctor", "in_consultation"] as const;

  const triageCounts = {
    checked_in:       todayAppts.filter(a => a.status === "checked_in").length,
    in_triage:        todayAppts.filter(a => a.status === "in_triage").length,
    ready_for_doctor: todayAppts.filter(a => a.status === "ready_for_doctor").length,
    in_consultation:  todayAppts.filter(a => a.status === "in_consultation").length,
  };

  const active = todayAppts.filter(a => (activeStatuses as readonly string[]).includes(a.status));

  const priorityCounts = {
    critical: active.filter(a => a.triagePriority === "critical").length,
    urgent:   active.filter(a => a.triagePriority === "urgent").length,
    normal:   active.filter(a => a.triagePriority === "normal").length,
  };

  const priorityRank: Record<string, number> = { critical: 0, urgent: 1, normal: 2 };
  const vitalsPending = todayAppts
    .filter(a => a.status === "checked_in")
    .sort((a, b) => (priorityRank[a.triagePriority] ?? 2) - (priorityRank[b.triagePriority] ?? 2))
    .slice(0, 15)
    .map(a => ({
      id:           a.id,
      patientId:    a.patientId,
      priority:     a.triagePriority,
      checkedInAt:  a.checkedInAt,
    }));

  return {
    triageCounts,
    priorityCounts,
    vitalsPending,
    todayTotal:      todayAppts.length,
    todayCheckedIn:  todayAppts.filter(a => a.status !== "scheduled").length,
  };
}

export async function getPharmacistDashboard(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  const [todayRx, weekRx, recentRx, lowStock] = await runInTenantContext(req.user!, async (tx) => {
    return Promise.all([
      tx.select({ id: prescriptionsTable.id })
        .from(prescriptionsTable)
        .where(and(eq(prescriptionsTable.clinicId, clinicId), isNull(prescriptionsTable.deletedAt), gte(prescriptionsTable.createdAt, todayStart))),

      tx.select({ id: prescriptionsTable.id })
        .from(prescriptionsTable)
        .where(and(eq(prescriptionsTable.clinicId, clinicId), isNull(prescriptionsTable.deletedAt), gte(prescriptionsTable.createdAt, weekStart))),

      tx.select({
        id:              prescriptionsTable.id,
        patientId:       prescriptionsTable.patientId,
        doctorName:      usersTable.fullName,
        medicationCount: sql<number>`jsonb_array_length(${prescriptionsTable.medications})`,
        createdAt:       prescriptionsTable.createdAt,
      })
        .from(prescriptionsTable)
        .leftJoin(usersTable, eq(prescriptionsTable.doctorId, usersTable.id))
        .where(and(eq(prescriptionsTable.clinicId, clinicId), isNull(prescriptionsTable.deletedAt)))
        .orderBy(desc(prescriptionsTable.createdAt))
        .limit(10),

      tx.select({
        id:           inventoryTable.id,
        name:         inventoryTable.name,
        category:     inventoryTable.category,
        quantity:     inventoryTable.quantity,
        minimumStock: inventoryTable.minimumStock,
        unit:         inventoryTable.unit,
      })
        .from(inventoryTable)
        .where(and(
          eq(inventoryTable.clinicId, clinicId),
          isNull(inventoryTable.deletedAt),
          eq(inventoryTable.isActive, true),
          sql`${inventoryTable.quantity} <= ${inventoryTable.minimumStock}`,
        ))
        .orderBy(inventoryTable.quantity),
    ]);
  });

  return {
    todayCount: todayRx.length,
    weekCount:  weekRx.length,
    recentPrescriptions: recentRx.map(r => ({
      id:              r.id,
      patientId:       r.patientId,
      doctorName:      r.doctorName ?? "Unknown",
      medicationCount: r.medicationCount ?? 0,
      createdAt:       r.createdAt,
    })),
    lowStockItems: lowStock,
  };
}

export async function getBillingDashboard(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [paidInvoices, pendingInvoices, recentPayments, recentCancellations, dailyRevenue] = await runInTenantContext(req.user!, async (tx) => {
    return Promise.all([
      tx.select({ total: invoicesTable.total, paidAt: invoicesTable.paidAt })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.clinicId, clinicId),
          isNull(invoicesTable.deletedAt),
          eq(invoicesTable.status, "paid"),
          gte(invoicesTable.paidAt, monthStart),
        )),

      tx.select({ total: invoicesTable.total })
        .from(invoicesTable)
        .where(and(eq(invoicesTable.clinicId, clinicId), isNull(invoicesTable.deletedAt), eq(invoicesTable.status, "pending"))),

      tx.select({
        id:            invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        total:         invoicesTable.total,
        paidAt:        invoicesTable.paidAt,
      })
        .from(invoicesTable)
        .where(and(eq(invoicesTable.clinicId, clinicId), isNull(invoicesTable.deletedAt), eq(invoicesTable.status, "paid")))
        .orderBy(desc(invoicesTable.paidAt))
        .limit(10),

      tx.select({
        id:            invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        total:         invoicesTable.total,
        updatedAt:     invoicesTable.updatedAt,
      })
        .from(invoicesTable)
        .where(and(eq(invoicesTable.clinicId, clinicId), isNull(invoicesTable.deletedAt), eq(invoicesTable.status, "cancelled")))
        .orderBy(desc(invoicesTable.updatedAt))
        .limit(5),

      tx.select({
        day:    sql<string>`to_char(${invoicesTable.paidAt}, 'YYYY-MM-DD')`,
        amount: sql<number>`cast(coalesce(sum(${invoicesTable.total}), 0) as float)`,
      })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.clinicId, clinicId),
          isNull(invoicesTable.deletedAt),
          eq(invoicesTable.status, "paid"),
          gte(invoicesTable.paidAt, weekStart),
        ))
        .groupBy(sql`to_char(${invoicesTable.paidAt}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${invoicesTable.paidAt}, 'YYYY-MM-DD')`),
    ]);
  });

  // Aggregate in integer cents — exact, so the Math.round(x*100)/100 float
  // clean-up the old reduce() needed is gone.
  const todayRevenue  = centsToNumber(sumCents(paidInvoices
    .filter(i => i.paidAt && i.paidAt >= todayStart && i.paidAt <= todayEnd)
    .map(i => parseMoneyToCents(String(i.total)))));
  const weekRevenue   = centsToNumber(sumCents(paidInvoices
    .filter(i => i.paidAt && i.paidAt >= weekStart)
    .map(i => parseMoneyToCents(String(i.total)))));
  const monthRevenue  = centsToNumber(sumCents(paidInvoices.map(i => parseMoneyToCents(String(i.total)))));
  const pendingCount  = pendingInvoices.length;
  const pendingSum    = centsToNumber(sumCents(pendingInvoices.map(i => parseMoneyToCents(String(i.total)))));

  return {
    todayRevenue,
    weekRevenue,
    monthRevenue,
    pendingCount,
    pendingSum,
    recentPayments:      recentPayments.map(p => ({
      id:            p.id,
      invoiceNumber: p.invoiceNumber,
      total:         centsToNumber(parseMoneyToCents(String(p.total))),
      paidAt:        p.paidAt,
    })),
    recentCancellations: recentCancellations.map(c => ({
      id:            c.id,
      invoiceNumber: c.invoiceNumber,
      total:         centsToNumber(parseMoneyToCents(String(c.total))),
      updatedAt:     c.updatedAt,
    })),
    dailyRevenue: dailyRevenue.map(d => ({ day: d.day, amount: centsToNumber(parseMoneyToCents(String(d.amount))) })),
  };
}

export async function getComplianceDashboard(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  const now       = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  const [todayRows, weekRows, topEntities, topUsers, recentDenied, dailyTrend] = await runInTenantContext(req.user!, async (tx) => {
    return Promise.all([
      // Today: total + denied counts
      tx.select({ action: auditLogsTable.action })
        .from(auditLogsTable)
        .where(and(eq(auditLogsTable.clinicId, clinicId), gte(auditLogsTable.createdAt, todayStart))),

      // Week: total count
      tx.select({ id: auditLogsTable.id })
        .from(auditLogsTable)
        .where(and(eq(auditLogsTable.clinicId, clinicId), gte(auditLogsTable.createdAt, weekStart))),

      // Top 5 accessed entity types (7-day window)
      tx.select({
        entityType: auditLogsTable.entityType,
        count: sql<number>`cast(count(*) as int)`,
      })
        .from(auditLogsTable)
        .where(and(eq(auditLogsTable.clinicId, clinicId), gte(auditLogsTable.createdAt, weekStart)))
        .groupBy(auditLogsTable.entityType)
        .orderBy(desc(sql`count(*)`))
        .limit(5),

      // Top 5 active users (7-day window, exclude system/null)
      tx.select({
        userId: auditLogsTable.userId,
        fullName: usersTable.fullName,
        role: usersTable.role,
        count: sql<number>`cast(count(*) as int)`,
      })
        .from(auditLogsTable)
        .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
        .where(and(eq(auditLogsTable.clinicId, clinicId), gte(auditLogsTable.createdAt, weekStart)))
        .groupBy(auditLogsTable.userId, usersTable.fullName, usersTable.role)
        .orderBy(desc(sql`count(*)`))
        .limit(5),

      // Recent 20 denied events
      tx.select({
        id:         auditLogsTable.id,
        action:     auditLogsTable.action,
        entityType: auditLogsTable.entityType,
        entityId:   auditLogsTable.entityId,
        createdAt:  auditLogsTable.createdAt,
        fullName:   usersTable.fullName,
        role:       usersTable.role,
      })
        .from(auditLogsTable)
        .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
        .where(and(eq(auditLogsTable.clinicId, clinicId), like(auditLogsTable.action, "%DENIED%")))
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(20),

      // Daily event counts for last 7 days
      tx.select({
        day: sql<string>`to_char(${auditLogsTable.createdAt}, 'YYYY-MM-DD')`,
        count: sql<number>`cast(count(*) as int)`,
      })
        .from(auditLogsTable)
        .where(and(eq(auditLogsTable.clinicId, clinicId), gte(auditLogsTable.createdAt, weekStart)))
        .groupBy(sql`to_char(${auditLogsTable.createdAt}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${auditLogsTable.createdAt}, 'YYYY-MM-DD')`),
    ]);
  });

  const todayEvents  = todayRows.length;
  const todayDenied  = todayRows.filter(r => r.action.includes("DENIED")).length;
  const weekEvents   = weekRows.length;
  const deniedRate   = weekEvents > 0 ? Math.round((todayRows.filter(r => r.action.includes("DENIED")).length / (todayEvents || 1)) * 100) : 0;

  return {
    todayEvents,
    todayDenied,
    weekEvents,
    deniedRate,
    topEntities: topEntities.map(e => ({ entityType: e.entityType, count: e.count })),
    topUsers: topUsers.map(u => ({ userId: u.userId, fullName: u.fullName ?? "Unknown", role: u.role ?? "unknown", count: u.count })),
    recentDenied: recentDenied.map(r => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      createdAt: r.createdAt,
      userName: r.fullName ?? "Unknown",
      userRole: r.role ?? "unknown",
    })),
    dailyTrend: dailyTrend.map(d => ({ day: d.day, count: d.count })),
  };
}
