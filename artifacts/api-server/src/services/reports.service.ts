// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { appointmentsTable, invoicesTable, usersTable } from "@workspace/db";
import { eq, isNull, and, gte, lte } from "drizzle-orm";
import { logRead } from "../lib/audit";
import type { AuthRequest } from "../middlewares/auth";

function parseDateRange(dateFrom?: string, dateTo?: string) {
  const start = dateFrom ? new Date(`${dateFrom}T00:00:00Z`) : new Date(Date.now() - 30 * 86400000);
  const end = dateTo ? new Date(`${dateTo}T23:59:59Z`) : new Date();
  return { start, end };
}

export async function appointmentsSummary(
  req: AuthRequest,
  params: { dateFrom?: string; dateTo?: string },
) {
  const { start, end } = parseDateRange(params.dateFrom, params.dateTo);

  const appointments = await runInTenantContext(req.user!, async (tx) => {
    return tx
      .select({
        id: appointmentsTable.id,
        status: appointmentsTable.status,
        scheduledAt: appointmentsTable.scheduledAt,
        checkedInAt: appointmentsTable.checkedInAt,
        doctorId: appointmentsTable.doctorId,
        doctor: { fullName: usersTable.fullName },
      })
      .from(appointmentsTable)
      .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
      .where(
        and(
          eq(appointmentsTable.clinicId, req.user!.clinicId),
          gte(appointmentsTable.scheduledAt, start),
          lte(appointmentsTable.scheduledAt, end)
        )
      );
  });

  const total = appointments.length;
  const completed = appointments.filter((a) => a.status === "completed").length;
  const cancelled = appointments.filter((a) => a.status === "cancelled").length;
  const cancellationRate = total > 0 ? cancelled / total : 0;

  const waitTimes = appointments
    .filter((a) => a.checkedInAt && a.scheduledAt)
    .map((a) => (new Date(a.checkedInAt!).getTime() - new Date(a.scheduledAt).getTime()) / 60000);
  const averageWaitTimeMinutes =
    waitTimes.length > 0 ? waitTimes.reduce((s, t) => s + t, 0) / waitTimes.length : 0;

  const doctorMap: Record<number, { doctorName: string; count: number }> = {};
  for (const appt of appointments) {
    if (!doctorMap[appt.doctorId]) {
      doctorMap[appt.doctorId] = { doctorName: appt.doctor?.fullName || `#${appt.doctorId}`, count: 0 };
    }
    doctorMap[appt.doctorId].count++;
  }
  const byDoctor = Object.values(doctorMap).sort((a, b) => b.count - a.count);

  void logRead(req, "REPORT", undefined);
  return { totalAppointments: total, completed, cancelled, cancellationRate, averageWaitTimeMinutes, byDoctor };
}

export async function revenueSummary(
  req: AuthRequest,
  params: { dateFrom?: string; dateTo?: string },
) {
  const { start, end } = parseDateRange(params.dateFrom, params.dateTo);

  const invoices = await runInTenantContext(req.user!, async (tx) => {
    return tx
      .select()
      .from(invoicesTable)
      .where(
        and(
          isNull(invoicesTable.deletedAt),
          eq(invoicesTable.clinicId, req.user!.clinicId),
          gte(invoicesTable.createdAt, start),
          lte(invoicesTable.createdAt, end)
        )
      );
  });

  const totalRevenue = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + parseFloat(String(i.total)), 0);
  const totalInvoices = invoices.length;
  const paidInvoices = invoices.filter((i) => i.status === "paid").length;
  const averageInvoiceValue = paidInvoices > 0 ? totalRevenue / paidInvoices : 0;

  const dayMap: Record<string, { date: string; revenue: number; count: number }> = {};
  for (const inv of invoices) {
    const day = inv.createdAt.toISOString().split("T")[0];
    if (!dayMap[day]) dayMap[day] = { date: day, revenue: 0, count: 0 };
    dayMap[day].count++;
    if (inv.status === "paid") dayMap[day].revenue += parseFloat(String(inv.total));
  }
  const byDay = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

  void logRead(req, "REPORT", undefined);
  return { totalRevenue, totalInvoices, paidInvoices, averageInvoiceValue, byDay };
}
