import { Router } from "express";
import { db } from "@workspace/db";
import {
  appointmentsTable, patientsTable, usersTable, labTestsTable,
  xrayRecordsTable, invoicesTable, operationsTable, inventoryTable, auditLogsTable
} from "@workspace/db";
import { eq, isNull, gte, lte, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

router.get("/dashboard/summary", async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const [
    todayAppts, allPatients, allUsers, pendingLabs, pendingXrays,
    todayInvoices, scheduledOps, inventory
  ] = await Promise.all([
    db.select().from(appointmentsTable).where(and(gte(appointmentsTable.scheduledAt, todayStart), lte(appointmentsTable.scheduledAt, todayEnd))),
    db.select({ id: patientsTable.id }).from(patientsTable).where(isNull(patientsTable.deletedAt)),
    db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(and(isNull(usersTable.deletedAt), eq(usersTable.isActive, true))),
    db.select({ id: labTestsTable.id }).from(labTestsTable).where(eq(labTestsTable.status, "requested")),
    db.select({ id: xrayRecordsTable.id }).from(xrayRecordsTable).where(eq(xrayRecordsTable.status, "pending")),
    db.select().from(invoicesTable).where(and(isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, todayStart), lte(invoicesTable.createdAt, todayEnd))),
    db.select({ id: operationsTable.id }).from(operationsTable).where(eq(operationsTable.status, "scheduled")),
    db.select().from(inventoryTable).where(and(isNull(inventoryTable.deletedAt), eq(inventoryTable.isActive, true))),
  ]);

  const todayRevenue = todayInvoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(String(i.total)), 0);
  const lowStockItems = inventory.filter(i => i.quantity <= i.minimumStock).length;

  res.json({
    todayAppointments: todayAppts.length,
    checkedInPatients: todayAppts.filter(a => a.status === "checked_in").length,
    pendingLabTests: pendingLabs.length,
    pendingXrays: pendingXrays.length,
    todayRevenue,
    pendingInvoices: todayInvoices.filter(i => i.status === "pending").length,
    scheduledOperations: scheduledOps.length,
    lowStockItems,
    totalPatients: allPatients.length,
    totalDoctors: allUsers.filter(u => u.role === "doctor").length,
  });
});

router.get("/dashboard/recent-activity", async (_req, res) => {
  const rows = await db.select({
    id: auditLogsTable.id,
    action: auditLogsTable.action,
    entityType: auditLogsTable.entityType,
    entityId: auditLogsTable.entityId,
    createdAt: auditLogsTable.createdAt,
    user: { fullName: usersTable.fullName },
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(20);

  const activity = rows.map(r => ({
    ...r,
    description: `${r.user?.fullName || "System"} ${r.action.toLowerCase()}d ${r.entityType.replace(/_/g, " ")}${r.entityId ? ` #${r.entityId}` : ""}`,
  }));

  res.json(activity);
});

export default router;
