import { db } from "@workspace/db";
import {
  appointmentsTable, patientsTable, usersTable, labTestsTable,
  xrayRecordsTable, invoicesTable, operationsTable, inventoryTable, auditLogsTable,
} from "@workspace/db";
import { eq, isNull, gte, lte, and, desc, notInArray } from "drizzle-orm";

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
