import { useGetDashboardSummary, useGetRecentActivity, useGetTodayAppointments, getGetDashboardSummaryQueryKey, getGetRecentActivityQueryKey, getGetTodayAppointmentsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime } from "@/lib/api";
import {
  Users, CalendarDays, FlaskConical, Scan, DollarSign,
  Receipt, Scissors, Package, Activity, TrendingUp
} from "lucide-react";

export default function Dashboard() {
  const { t } = useI18n();
  const { user } = useAuth();

  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() }
  });
  const { data: activity, isLoading: loadingActivity } = useGetRecentActivity({
    query: { queryKey: getGetRecentActivityQueryKey() }
  });
  const { data: todayAppts } = useGetTodayAppointments({
    query: { queryKey: getGetTodayAppointmentsQueryKey() }
  });

  const statCards = summary ? [
    { label: t("todayAppointments"), value: summary.todayAppointments, icon: CalendarDays, color: "text-blue-500" },
    { label: t("checkedInPatients"), value: summary.checkedInPatients, icon: Users, color: "text-yellow-500" },
    { label: t("pendingLabTests"), value: summary.pendingLabTests, icon: FlaskConical, color: "text-purple-500" },
    { label: t("pendingXrays"), value: summary.pendingXrays, icon: Scan, color: "text-indigo-500" },
    { label: t("todayRevenue"), value: `$${formatCurrency(summary.todayRevenue)}`, icon: DollarSign, color: "text-green-500" },
    { label: t("pendingInvoices"), value: summary.pendingInvoices, icon: Receipt, color: "text-orange-500" },
    { label: t("scheduledOperations"), value: summary.scheduledOperations, icon: Scissors, color: "text-red-500" },
    { label: t("lowStockItems"), value: summary.lowStockItems, icon: Package, color: "text-amber-500" },
    { label: t("totalPatients"), value: summary.totalPatients, icon: Users, color: "text-cyan-500" },
    { label: t("totalDoctors"), value: summary.totalDoctors, icon: Activity, color: "text-teal-500" },
  ] : [];

  return (
    <div>
      <PageHeader
        title={t("dashboard")}
        subtitle={`Welcome back, ${user?.fullName}`}
      />
      <div className="p-6 space-y-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {loadingSummary
            ? Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
              ))
            : statCards.map((card, i) => (
                <Card key={i} className="border border-border" data-testid={`stat-card-${i}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground leading-tight">{card.label}</p>
                        <p className="text-xl font-bold text-foreground mt-1">{card.value}</p>
                      </div>
                      <card.icon className={`w-4 h-4 ${card.color} flex-shrink-0 mt-0.5`} />
                    </div>
                  </CardContent>
                </Card>
              ))
          }
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Today's Appointments */}
          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                {t("todayAppointments")}
                {todayAppts && (
                  <span className="ms-auto flex gap-3 text-xs font-normal text-muted-foreground">
                    <span className="text-yellow-600">{todayAppts.checkedIn} checked in</span>
                    <span className="text-green-600">{todayAppts.completed} done</span>
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {!todayAppts?.appointments?.length ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No appointments today</p>
              ) : (
                <div className="space-y-2">
                  {todayAppts.appointments.slice(0, 8).map((apt, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded border border-border/50 text-sm">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground text-xs truncate">{apt.patient?.fullName || `Patient #${apt.patientId}`}</p>
                        <p className="text-[11px] text-muted-foreground">{apt.doctor?.fullName} · {apt.reason}</p>
                      </div>
                      <StatusBadge status={apt.status} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                {t("recentActivity")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {loadingActivity ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-8 rounded bg-muted animate-pulse" />
                  ))}
                </div>
              ) : !activity?.length ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No recent activity</p>
              ) : (
                <div className="space-y-2">
                  {activity.slice(0, 10).map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs" data-testid={`activity-item-${i}`}>
                      <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                      <span className="text-foreground flex-1">{item.description}</span>
                      <span className="text-muted-foreground flex-shrink-0">{formatDateTime(item.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
