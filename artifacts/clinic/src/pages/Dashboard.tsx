import {
  useGetDashboardSummary,
  useGetRecentActivity,
  useGetTodayAppointments,
  useGetPatientFlow,
  getGetDashboardSummaryQueryKey,
  getGetRecentActivityQueryKey,
  getGetTodayAppointmentsQueryKey,
  getGetPatientFlowQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Users, CalendarDays, FlaskConical, Scan, DollarSign,
  Receipt, Scissors, Package, Activity, TrendingUp,
  RefreshCw, Clock, ArrowRight,
} from "lucide-react";

const STAGE_PIPELINE = [
  { key: "scheduled",           label: "Scheduled",     labelAr: "مجدول",         color: "bg-slate-100 text-slate-700 border-slate-300",          dot: "bg-slate-400"  },
  { key: "checked_in",          label: "Checked In",    labelAr: "تم التسجيل",   color: "bg-yellow-50 text-yellow-800 border-yellow-300",         dot: "bg-yellow-400" },
  { key: "in_triage",           label: "In Triage",     labelAr: "في الفرز",       color: "bg-orange-50 text-orange-800 border-orange-300",         dot: "bg-orange-400" },
  { key: "ready_for_doctor",    label: "Ready",         labelAr: "جاهز",           color: "bg-blue-50 text-blue-800 border-blue-300",               dot: "bg-blue-400"   },
  { key: "in_consultation",     label: "Consultation",  labelAr: "استشارة",       color: "bg-indigo-50 text-indigo-800 border-indigo-300",         dot: "bg-indigo-500" },
  { key: "awaiting_diagnostics",label: "Diagnostics",   labelAr: "تشخيص",         color: "bg-purple-50 text-purple-800 border-purple-300",         dot: "bg-purple-500" },
  { key: "pending_payment",     label: "Payment",       labelAr: "دفع",             color: "bg-pink-50 text-pink-800 border-pink-300",               dot: "bg-pink-500"   },
  { key: "completed",           label: "Completed",     labelAr: "مكتمل",         color: "bg-green-50 text-green-800 border-green-300",            dot: "bg-green-500"  },
] as const;

function fmtWait(mins: number | null | undefined) {
  if (mins === null || mins === undefined) return "—";
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function Dashboard() {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [secAgo, setSecAgo] = useState(0);

  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() }
  });
  const { data: activity, isLoading: loadingActivity } = useGetRecentActivity({
    query: { queryKey: getGetRecentActivityQueryKey() }
  });
  const { data: todayAppts } = useGetTodayAppointments({
    query: { queryKey: getGetTodayAppointmentsQueryKey() }
  });
  const { data: flow, isFetching: fetchingFlow } = useGetPatientFlow({
    query: { queryKey: getGetPatientFlowQueryKey(), refetchInterval: 30000 }
  });

  // Track seconds since last flow refresh
  useEffect(() => {
    if (flow?.refreshedAt) setLastRefresh(new Date(flow.refreshedAt));
  }, [flow?.refreshedAt]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecAgo(Math.floor((Date.now() - lastRefresh.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [lastRefresh]);

  const handleManualRefresh = () => {
    qc.invalidateQueries({ queryKey: getGetPatientFlowQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetTodayAppointmentsQueryKey() });
  };

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

  const stageCounts = flow?.stageCounts as Record<string, number> | undefined;

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
                <Card key={i} className="border border-border">
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

        {/* Live Patient Flow Panel */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Live Patient Flow
              {flow && (
                <span className="ms-2 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
                  {flow.activePatients} active
                </span>
              )}
              <div className="ms-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
                {fetchingFlow ? (
                  <RefreshCw className="w-3 h-3 animate-spin text-primary" />
                ) : (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {secAgo < 5 ? "just now" : `${secAgo}s ago`}
                  </span>
                )}
                <button
                  onClick={handleManualRefresh}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  title="Refresh now"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {/* Stage pipeline */}
            <div className="flex items-stretch gap-0.5 overflow-x-auto pb-1">
              {STAGE_PIPELINE.map((stage, i) => {
                const count = stageCounts?.[stage.key] ?? 0;
                const isActive = count > 0;
                return (
                  <div key={stage.key} className="flex items-center min-w-0">
                    <div className={`flex flex-col items-center px-3 py-2.5 rounded border transition-all min-w-[82px] ${
                      isActive ? stage.color + " shadow-sm" : "bg-muted/30 text-muted-foreground border-border/50"
                    }`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? stage.dot : "bg-muted-foreground/30"}`} />
                        <span className="text-[10px] font-medium leading-tight truncate">
                          {language === "ar" ? stage.labelAr : stage.label}
                        </span>
                      </div>
                      <span className={`text-lg font-bold leading-none ${isActive ? "" : "text-muted-foreground/50"}`}>
                        {flow ? count : "·"}
                      </span>
                    </div>
                    {i < STAGE_PIPELINE.length - 1 && (
                      <ArrowRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0 mx-0.5" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Avg wait times */}
            {flow && (
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground border-t border-border/50 pt-3">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span className="font-medium text-foreground">Arrival → Triage:</span>
                  {fmtWait(flow.avgWaitMins.arrivalToTriage)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span className="font-medium text-foreground">Triage → Consultation:</span>
                  {fmtWait(flow.avgWaitMins.triageToConsultation)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span className="font-medium text-foreground">Consultation → Done:</span>
                  {fmtWait(flow.avgWaitMins.consultationToPayment)}
                </span>
                <span className="ms-auto text-[11px]">
                  {flow.totalToday} patients today · {flow.stageCounts.completed} completed · {flow.stageCounts.cancelled} cancelled
                </span>
              </div>
            )}
            {!flow && (
              <div className="mt-3 h-8 rounded bg-muted animate-pulse" />
            )}
          </CardContent>
        </Card>

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
                    <div key={i} className="flex items-center gap-2 text-xs">
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
