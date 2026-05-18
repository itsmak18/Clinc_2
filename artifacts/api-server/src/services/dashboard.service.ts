import { db } from "@workspace/db";
import {
  appointmentsTable, patientsTable, usersTable, labTestsTable,
  xrayRecordsTable, invoicesTable, operationsTable, inventoryTable, auditLogsTable,
  prescriptionsTable,
} from "@workspace/db";
import { eq, isNull, gte, lte, and, desc, notInArray, sql, like } from "drizzle-orm";

export async function getDashboardSummary() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const yestStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestEnd    = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);

  const [
    todayAppts, allPatients, allUsers, pendingLabs, pendingXrays,
    todayInvoices, scheduledOps, inventory, yesterdayInvoices,
  ] = await Promise.all([
    db.select().from(appointmentsTable).where(and(gte(appointmentsTable.scheduledAt, todayStart), lte(appointmentsTable.scheduledAt, todayEnd))),
    db.select({ id: patientsTable.id }).from(patientsTable).where(isNull(patientsTable.deletedAt)),
    db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(and(isNull(usersTable.deletedAt), eq(usersTable.isActive, true))),
    db.select({ id: labTestsTable.id }).from(labTestsTable).where(eq(labTestsTable.status, "requested")),
    db.select({ id: xrayRecordsTable.id }).from(xrayRecordsTable).where(eq(xrayRecordsTable.status, "pending")),
    db.select().from(invoicesTable).where(and(isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, todayStart), lte(invoicesTable.createdAt, todayEnd))),
    db.select({ id: operationsTable.id }).from(operationsTable).where(eq(operationsTable.status, "scheduled")),
    db.select().from(inventoryTable).where(and(isNull(inventoryTable.deletedAt), eq(inventoryTable.isActive, true))),
    db.select({ total: invoicesTable.total, status: invoicesTable.status }).from(invoicesTable).where(and(isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, yestStart), lte(invoicesTable.createdAt, yestEnd))),
  ]);

  const todayRevenue     = todayInvoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(String(i.total)), 0);
  const yesterdayRevenue = yesterdayInvoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(String(i.total)), 0);
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

export async function getDepartmentLoad() {
  const now      = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const rows = await db.select({
    doctorId:   appointmentsTable.doctorId,
    doctorName: usersTable.fullName,
    count:      appointmentsTable.id,
  }).from(appointmentsTable)
    .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
    .where(and(
      gte(appointmentsTable.scheduledAt, todayStart),
      lte(appointmentsTable.scheduledAt, todayEnd),
      notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
    ));

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

export async function getRecentActivity() {
  const rows = await db.select({
    id:         auditLogsTable.id,
    action:     auditLogsTable.action,
    entityType: auditLogsTable.entityType,
    entityId:   auditLogsTable.entityId,
    createdAt:  auditLogsTable.createdAt,
    user:       { fullName: usersTable.fullName },
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(20);

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

export async function getImagingDashboard() {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  const [all, today, week, recent] = await Promise.all([
    db.select({ status: xrayRecordsTable.status }).from(xrayRecordsTable),
    db.select({ id: xrayRecordsTable.id }).from(xrayRecordsTable).where(gte(xrayRecordsTable.createdAt, todayStart)),
    db.select({ id: xrayRecordsTable.id }).from(xrayRecordsTable).where(gte(xrayRecordsTable.createdAt, weekStart)),
    db.select({ id: xrayRecordsTable.id, patientId: xrayRecordsTable.patientId, status: xrayRecordsTable.status, createdAt: xrayRecordsTable.createdAt })
      .from(xrayRecordsTable).orderBy(desc(xrayRecordsTable.createdAt)).limit(10),
  ]);

  return imagingShape(
    all.filter(r => r.status === "pending").length,
    all.filter(r => r.status === "uploaded").length,
    all.filter(r => r.status === "reviewed").length,
    today.length, week.length, recent,
  );
}

export async function getLabDashboard() {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  const [all, today, week, recent] = await Promise.all([
    db.select({ status: labTestsTable.status }).from(labTestsTable),
    db.select({ id: labTestsTable.id }).from(labTestsTable).where(gte(labTestsTable.createdAt, todayStart)),
    db.select({ id: labTestsTable.id }).from(labTestsTable).where(gte(labTestsTable.createdAt, weekStart)),
    db.select({ id: labTestsTable.id, patientId: labTestsTable.patientId, status: labTestsTable.status, createdAt: labTestsTable.createdAt })
      .from(labTestsTable).orderBy(desc(labTestsTable.createdAt)).limit(10),
  ]);

  return imagingShape(
    all.filter(r => r.status === "requested").length,
    all.filter(r => r.status === "in_progress").length,
    all.filter(r => r.status === "completed").length,
    today.length, week.length, recent,
  );
}

export async function getFrontDeskDashboard() {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const [todayAppts, pendingInvoices] = await Promise.all([
    db.select({
      id:            appointmentsTable.id,
      status:        appointmentsTable.status,
      bookingSource: appointmentsTable.bookingSource,
      scheduledAt:   appointmentsTable.scheduledAt,
    })
      .from(appointmentsTable)
      .where(and(
        gte(appointmentsTable.scheduledAt, todayStart),
        lte(appointmentsTable.scheduledAt, todayEnd),
      )),

    db.select({ id: invoicesTable.id, total: invoicesTable.total })
      .from(invoicesTable)
      .where(and(isNull(invoicesTable.deletedAt), eq(invoicesTable.status, "pending"))),
  ]);

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

  const pendingInvoiceSum = pendingInvoices.reduce((s, i) => s + parseFloat(String(i.total)), 0);

  return {
    totalToday:        todayAppts.length,
    statusCounts,
    sourceCounts,
    noShowCount:       statusCounts.no_show,
    pendingInvoiceCount: pendingInvoices.length,
    pendingInvoiceSum:   Math.round(pendingInvoiceSum * 100) / 100,
  };
}

export async function getNurseDashboard() {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const todayAppts = await db.select({
    id:           appointmentsTable.id,
    patientId:    appointmentsTable.patientId,
    status:       appointmentsTable.status,
    triagePriority: appointmentsTable.triagePriority,
    checkedInAt:  appointmentsTable.checkedInAt,
  })
    .from(appointmentsTable)
    .where(and(
      gte(appointmentsTable.scheduledAt, todayStart),
      lte(appointmentsTable.scheduledAt, todayEnd),
      notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
    ));

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

export async function getPharmacistDashboard() {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  const [todayRx, weekRx, recentRx, lowStock] = await Promise.all([
    db.select({ id: prescriptionsTable.id })
      .from(prescriptionsTable)
      .where(and(isNull(prescriptionsTable.deletedAt), gte(prescriptionsTable.createdAt, todayStart))),

    db.select({ id: prescriptionsTable.id })
      .from(prescriptionsTable)
      .where(and(isNull(prescriptionsTable.deletedAt), gte(prescriptionsTable.createdAt, weekStart))),

    db.select({
      id:              prescriptionsTable.id,
      patientId:       prescriptionsTable.patientId,
      doctorName:      usersTable.fullName,
      medicationCount: sql<number>`jsonb_array_length(${prescriptionsTable.medications})`,
      createdAt:       prescriptionsTable.createdAt,
    })
      .from(prescriptionsTable)
      .leftJoin(usersTable, eq(prescriptionsTable.doctorId, usersTable.id))
      .where(isNull(prescriptionsTable.deletedAt))
      .orderBy(desc(prescriptionsTable.createdAt))
      .limit(10),

    db.select({
      id:           inventoryTable.id,
      name:         inventoryTable.name,
      category:     inventoryTable.category,
      quantity:     inventoryTable.quantity,
      minimumStock: inventoryTable.minimumStock,
      unit:         inventoryTable.unit,
    })
      .from(inventoryTable)
      .where(and(
        isNull(inventoryTable.deletedAt),
        eq(inventoryTable.isActive, true),
        sql`${inventoryTable.quantity} <= ${inventoryTable.minimumStock}`,
      ))
      .orderBy(inventoryTable.quantity),
  ]);

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

export async function getBillingDashboard() {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [paidInvoices, pendingInvoices, recentPayments, recentCancellations, dailyRevenue] = await Promise.all([
    db.select({ total: invoicesTable.total, paidAt: invoicesTable.paidAt })
      .from(invoicesTable)
      .where(and(
        isNull(invoicesTable.deletedAt),
        eq(invoicesTable.status, "paid"),
        gte(invoicesTable.paidAt, monthStart),
      )),

    db.select({ total: invoicesTable.total })
      .from(invoicesTable)
      .where(and(isNull(invoicesTable.deletedAt), eq(invoicesTable.status, "pending"))),

    db.select({
      id:            invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      total:         invoicesTable.total,
      paidAt:        invoicesTable.paidAt,
    })
      .from(invoicesTable)
      .where(and(isNull(invoicesTable.deletedAt), eq(invoicesTable.status, "paid")))
      .orderBy(desc(invoicesTable.paidAt))
      .limit(10),

    db.select({
      id:            invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      total:         invoicesTable.total,
      updatedAt:     invoicesTable.updatedAt,
    })
      .from(invoicesTable)
      .where(and(isNull(invoicesTable.deletedAt), eq(invoicesTable.status, "cancelled")))
      .orderBy(desc(invoicesTable.updatedAt))
      .limit(5),

    db.select({
      day:    sql<string>`to_char(${invoicesTable.paidAt}, 'YYYY-MM-DD')`,
      amount: sql<number>`cast(coalesce(sum(${invoicesTable.total}), 0) as float)`,
    })
      .from(invoicesTable)
      .where(and(
        isNull(invoicesTable.deletedAt),
        eq(invoicesTable.status, "paid"),
        gte(invoicesTable.paidAt, weekStart),
      ))
      .groupBy(sql`to_char(${invoicesTable.paidAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${invoicesTable.paidAt}, 'YYYY-MM-DD')`),
  ]);

  const todayRevenue  = paidInvoices
    .filter(i => i.paidAt && i.paidAt >= todayStart && i.paidAt <= todayEnd)
    .reduce((s, i) => s + parseFloat(String(i.total)), 0);
  const weekRevenue   = paidInvoices
    .filter(i => i.paidAt && i.paidAt >= weekStart)
    .reduce((s, i) => s + parseFloat(String(i.total)), 0);
  const monthRevenue  = paidInvoices.reduce((s, i) => s + parseFloat(String(i.total)), 0);
  const pendingCount  = pendingInvoices.length;
  const pendingSum    = pendingInvoices.reduce((s, i) => s + parseFloat(String(i.total)), 0);

  return {
    todayRevenue:        Math.round(todayRevenue  * 100) / 100,
    weekRevenue:         Math.round(weekRevenue   * 100) / 100,
    monthRevenue:        Math.round(monthRevenue  * 100) / 100,
    pendingCount,
    pendingSum:          Math.round(pendingSum    * 100) / 100,
    recentPayments:      recentPayments.map(p => ({
      id:            p.id,
      invoiceNumber: p.invoiceNumber,
      total:         parseFloat(String(p.total)),
      paidAt:        p.paidAt,
    })),
    recentCancellations: recentCancellations.map(c => ({
      id:            c.id,
      invoiceNumber: c.invoiceNumber,
      total:         parseFloat(String(c.total)),
      updatedAt:     c.updatedAt,
    })),
    dailyRevenue: dailyRevenue.map(d => ({ day: d.day, amount: parseFloat(String(d.amount)) })),
  };
}

export async function getComplianceDashboard() {
  const now       = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

  const [todayRows, weekRows, topEntities, topUsers, recentDenied, dailyTrend] = await Promise.all([
    // Today: total + denied counts
    db.select({ action: auditLogsTable.action })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, todayStart)),

    // Week: total count
    db.select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, weekStart)),

    // Top 5 accessed entity types (7-day window)
    db.select({
      entityType: auditLogsTable.entityType,
      count: sql<number>`cast(count(*) as int)`,
    })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, weekStart))
      .groupBy(auditLogsTable.entityType)
      .orderBy(desc(sql`count(*)`))
      .limit(5),

    // Top 5 active users (7-day window, exclude system/null)
    db.select({
      userId: auditLogsTable.userId,
      fullName: usersTable.fullName,
      role: usersTable.role,
      count: sql<number>`cast(count(*) as int)`,
    })
      .from(auditLogsTable)
      .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
      .where(gte(auditLogsTable.createdAt, weekStart))
      .groupBy(auditLogsTable.userId, usersTable.fullName, usersTable.role)
      .orderBy(desc(sql`count(*)`))
      .limit(5),

    // Recent 20 denied events
    db.select({
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
      .where(like(auditLogsTable.action, "%DENIED%"))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(20),

    // Daily event counts for last 7 days
    db.select({
      day: sql<string>`to_char(${auditLogsTable.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`cast(count(*) as int)`,
    })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, weekStart))
      .groupBy(sql`to_char(${auditLogsTable.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${auditLogsTable.createdAt}, 'YYYY-MM-DD')`),
  ]);

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
