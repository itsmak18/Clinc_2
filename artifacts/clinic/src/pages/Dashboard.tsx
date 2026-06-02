import DoctorDashboard from "./DoctorDashboard";
import ComplianceDashboard from "./ComplianceDashboard";
import BillingDashboard from "./BillingDashboard";
import PharmacistDashboard from "./PharmacistDashboard";
import NurseDashboard from "./NurseDashboard";
import FrontDeskDashboard from "./FrontDeskDashboard";
import ImagingDashboard from "./ImagingDashboard";
import {
  useGetDashboardSummary,
  useGetRecentActivity,
  useGetTodayAppointments,
  useGetPatientFlow,
  useGetDepartmentLoad,
  useGetOnShiftUsers,
  useToggleUserShift,
  getGetDashboardSummaryQueryKey,
  getGetRecentActivityQueryKey,
  getGetTodayAppointmentsQueryKey,
  getGetPatientFlowQueryKey,
  getGetDepartmentLoadQueryKey,
  getGetOnShiftUsersQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import Metric from "@/components/Metric";
import LiveActivityFeed, { ActivityEvent } from "@/components/LiveActivityFeed";
import { SkeletonMetric } from "@/components/ui/skeleton";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import BreakGlassQueue from "@/components/BreakGlassQueue";
import ErasurePanel from "@/components/ErasurePanel";
import {
  Users, CalendarDays, FlaskConical, Scan, DollarSign,
  Receipt, Scissors, Package, Activity, TrendingUp,
  RefreshCw, Clock, ArrowRight, AlertTriangle, X,
  UserPlus, CalendarPlus, UserCog, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const STAGE_PIPELINE = [
  { key: "scheduled",            label: "Scheduled",    labelAr: "مجدول",       color: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-600",         dot: "bg-slate-400"   },
  { key: "checked_in",           label: "Checked In",   labelAr: "تم التسجيل", color: "bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700",     dot: "bg-yellow-400"  },
  { key: "in_triage",            label: "In Triage",    labelAr: "في الفرز",    color: "bg-orange-50 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700",    dot: "bg-orange-400"  },
  { key: "ready_for_doctor",     label: "Ready",        labelAr: "جاهز",        color: "bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700",                dot: "bg-blue-400"    },
  { key: "in_consultation",      label: "Consultation", labelAr: "استشارة",    color: "bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700",    dot: "bg-indigo-500"  },
  { key: "awaiting_diagnostics", label: "Diagnostics",  labelAr: "تشخيص",      color: "bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700",   dot: "bg-purple-500"  },
  { key: "pending_payment",      label: "Payment",      labelAr: "دفع",          color: "bg-pink-50 text-pink-800 border-pink-300 dark:bg-pink-900/40 dark:text-pink-300 dark:border-pink-700",               dot: "bg-pink-500"    },
  { key: "completed",            label: "Completed",    labelAr: "مكتمل",      color: "bg-green-50 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700",          dot: "bg-green-500"   },
] as const;

const BAR_COLORS = ["#2e9a7a", "#3aaf8e", "#4dc4a2", "#67d5b5", "#8ae0c8", "#aaebd9"];

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-rose-100 text-rose-700",
  admin:       "bg-amber-100 text-amber-700",
  doctor:      "bg-blue-100 text-blue-700",
  nurse:       "bg-teal-100 text-teal-700",
  front_desk:  "bg-yellow-100 text-yellow-700",
  xray_staff:  "bg-purple-100 text-purple-700",
  lab_staff:   "bg-green-100 text-green-700",
};

function fmtWait(mins: number | null | undefined) {
  if (mins === null || mins === undefined) return "—";
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function revenueDelta(today: number, yesterday: number) {
  if (yesterday === 0) return null;
  return ((today - yesterday) / yesterday) * 100;
}

export default function Dashboard() {
  const { t, language } = useI18n();
  const { user } = useAuth();

  if (user?.role === "doctor")             return <DoctorDashboard />;
  if (user?.role === "compliance_officer") return <ComplianceDashboard />;
  if (user?.role === "billing_manager")    return <BillingDashboard />;
  if (user?.role === "pharmacist")         return <PharmacistDashboard />;
  if (user?.role === "nurse")              return <NurseDashboard />;
  if (user?.role === "front_desk")         return <FrontDeskDashboard />;
  if (user?.role === "xray_staff")         return <ImagingDashboard domain="xray" />;
  if (user?.role === "lab_staff")          return <ImagingDashboard domain="lab" />;

  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [secAgo, setSecAgo] = useState(0);
  const [stockBannerDismissed, setStockBannerDismissed] = useState(false);

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
  const { data: deptLoad } = useGetDepartmentLoad({
    query: { queryKey: getGetDepartmentLoadQueryKey() }
  });
  const { data: onShiftUsers } = useGetOnShiftUsers({
    query: { queryKey: getGetOnShiftUsersQueryKey() }
  });
  const toggleShift = useToggleUserShift({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetOnShiftUsersQueryKey() }),
    },
  });

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

  const delta = summary ? revenueDelta(summary.todayRevenue, summary.yesterdayRevenue) : null;
  const isAdminRole = user?.role === "super_admin" || user?.role === "admin";

  const shiftByRole = (onShiftUsers ?? []).reduce<Record<string, typeof onShiftUsers>>((acc, u) => {
    if (!acc[u.role]) acc[u.role] = [];
    acc[u.role]!.push(u);
    return acc;
  }, {});

  const stageCounts = flow?.stageCounts as Record<string, number> | undefined;

  const activityEvents: ActivityEvent[] = (activity ?? []).slice(0, 15).map((item, i) => ({
    id: i,
    timestamp: item.createdAt,
    action: item.description,
  }));

  return (
    <div className="page">

      {/* Low Stock Alert Banner */}
      {!stockBannerDismissed && summary && summary.lowStockItems > 0 && (
        <div
          role="alert"
          className="mb-5 flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px] relative pe-10"
          style={{ borderColor: "var(--amber-400)", background: "var(--amber-50)", color: "var(--amber-800)" }}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">
            {t("lowStockAlertBanner")}
            <span className="font-semibold ms-1">({summary.lowStockItems} {t("lowStockItems").toLowerCase()})</span>
          </span>
          <button
            onClick={() => setStockBannerDismissed(true)}
            className="absolute top-3 end-3 p-0.5 rounded hover:opacity-70 transition-opacity"
            style={{ color: "var(--amber-800)" }}
            aria-label={t("dismiss")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button className="btn btn-sm btn-outline gap-1.5" onClick={() => navigate("/patients?new=1")}>
          <UserPlus className="w-3.5 h-3.5" />
          {t("newPatient")}
        </button>
        <button className="btn btn-sm btn-outline gap-1.5" onClick={() => navigate("/appointments?new=1")}>
          <CalendarPlus className="w-3.5 h-3.5" />
          {t("newAppointment")}
        </button>
        {isAdminRole && (
          <button className="btn btn-sm btn-outline gap-1.5" onClick={() => navigate("/users?new=1")}>
            <UserCog className="w-3.5 h-3.5" />
            {t("addUser")}
          </button>
        )}
        <button className="btn btn-sm btn-outline gap-1.5" onClick={() => navigate("/reports")}>
          <BarChart3 className="w-3.5 h-3.5" />
          {t("viewReports")}
        </button>
      </div>

      {/* KPI Metric Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {loadingSummary ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonMetric key={i} />)
        ) : summary ? (
          <>
            <Metric
              label={t("todayAppointments")}
              value={summary.todayAppointments}
              tone="teal"
              icon={<CalendarDays className="w-4 h-4" />}
            />
            <Metric
              label={t("checkedInPatients")}
              value={summary.checkedInPatients}
              tone="blue"
              icon={<Users className="w-4 h-4" />}
            />
            <Metric
              label={t("pendingLabTests")}
              value={summary.pendingLabTests + summary.pendingXrays}
              tone="amber"
              icon={<FlaskConical className="w-4 h-4" />}
            />
            <Metric
              label={t("todayRevenue")}
              value={`$${formatCurrency(summary.todayRevenue)}`}
              delta={delta !== null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : undefined}
              deltaDir={delta !== null ? (delta >= 0 ? "up" : "down") : undefined}
              tone="sage"
              icon={<DollarSign className="w-4 h-4" />}
            />
          </>
        ) : null}
      </div>

      {/* Secondary stats row */}
      {!loadingSummary && summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
          {([
            { label: t("pendingInvoices"),     value: summary.pendingInvoices,     icon: Receipt,  color: "text-orange-500" },
            { label: t("scheduledOperations"), value: summary.scheduledOperations, icon: Scissors, color: "text-rose-500"   },
            { label: t("lowStockItems"),        value: summary.lowStockItems,       icon: Package,  color: "text-amber-500"  },
            { label: t("totalPatients"),        value: summary.totalPatients,       icon: Users,    color: "text-cyan-600"   },
            { label: t("totalDoctors"),         value: summary.totalDoctors,        icon: Activity, color: "text-teal-600"   },
            { label: t("pendingXrays"),         value: summary.pendingXrays,        icon: Scan,     color: "text-indigo-500" },
          ] as const).map((card, i) => (
            <div key={i} className="card card-pad flex items-center gap-3 py-3">
              <card.icon className={`w-5 h-5 ${card.color} flex-shrink-0`} />
              <div className="min-w-0">
                <p className="text-[11px] text-[var(--ink-muted)] leading-tight truncate">{card.label}</p>
                <p className="text-[20px] font-bold text-[var(--ink)] leading-none mt-0.5">{card.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Live Patient Flow */}
      <div className="card card-pad mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("livePatientFlow")}</span>
            {flow && (
              <span className="badge badge-teal ms-1">
                {flow.activePatients} {t("activeCount")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[12px] text-[var(--ink-muted)]">
            {fetchingFlow ? (
              <RefreshCw className="w-3 h-3 animate-spin text-[var(--teal-500)]" />
            ) : (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {secAgo < 5 ? t("justNow") : `${secAgo}${t("secondsAgo")}`}
              </span>
            )}
            <button
              onClick={handleManualRefresh}
              className="p-1 rounded hover:bg-[var(--surface-2)] transition-colors"
              title={t("refreshNow")}
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="flex items-stretch gap-0.5 overflow-x-auto pb-1">
          {STAGE_PIPELINE.map((stage, i) => {
            const count = stageCounts?.[stage.key] ?? 0;
            const isActive = count > 0;
            return (
              <div key={stage.key} className="flex items-center min-w-0">
                <div className={`flex flex-col items-center px-3 py-2.5 rounded border transition-all min-w-[82px] ${
                  isActive ? stage.color + " shadow-sm" : "bg-[var(--surface-2)] text-[var(--ink-muted)] border-[var(--line)]"
                }`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? stage.dot : "bg-[var(--ink-faint)]"}`} />
                    <span className="text-[10px] font-medium leading-tight truncate">
                      {language === "ar" ? stage.labelAr : stage.label}
                    </span>
                  </div>
                  <span className={`text-lg font-bold leading-none ${isActive ? "" : "text-[var(--ink-faint)]"}`}>
                    {flow ? count : "·"}
                  </span>
                </div>
                {i < STAGE_PIPELINE.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-[var(--ink-faint)] flex-shrink-0 mx-0.5" />
                )}
              </div>
            );
          })}
        </div>

        {flow && (
          <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-[var(--ink-muted)] border-t border-[var(--line)] pt-3">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span className="font-medium text-[var(--ink)]">{t("arrivalToTriage")}:</span>
              {fmtWait(flow.avgWaitMins.arrivalToTriage)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span className="font-medium text-[var(--ink)]">{t("triageToConsultation")}:</span>
              {fmtWait(flow.avgWaitMins.triageToConsultation)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span className="font-medium text-[var(--ink)]">{t("consultationToDone")}:</span>
              {fmtWait(flow.avgWaitMins.consultationToPayment)}
            </span>
            <span className="ms-auto text-[11px]">
              {flow.totalToday} {t("patientsToday")} · {flow.stageCounts.completed} {t("doneShort")} · {flow.stageCounts.cancelled} {t("cancelledCount")}
            </span>
          </div>
        )}
        {!flow && <div className="mt-3 h-8 rounded bg-[var(--surface-2)] animate-pulse" />}
      </div>

      {/* Staff On Shift + Department Load */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">

        {/* Staff On Shift */}
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("staffOnShift")}</span>
            {onShiftUsers && (
              <span className="badge badge-teal ms-auto">{onShiftUsers.length}</span>
            )}
          </div>
          {!onShiftUsers ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 rounded bg-[var(--surface-2)] animate-pulse" />
              ))}
            </div>
          ) : onShiftUsers.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-muted)] py-4 text-center">{t("noStaffOnShift")}</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(shiftByRole).map(([role, members]) => (
                <div key={role}>
                  <p className="eyebrow text-[10px] text-[var(--ink-faint)] mb-1.5">
                    {t(role as Parameters<typeof t>[0])}
                  </p>
                  <div className="space-y-1.5">
                    {members?.map(member => (
                      <div key={member.id} className="flex items-center gap-2.5 p-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]">
                        <div className="w-8 h-8 rounded-full bg-[var(--teal-100)] text-[var(--teal-700)] flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                          {initials(member.fullName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-[var(--ink)] truncate">{member.fullName}</p>
                          <span className={`badge text-[10px] mt-0.5 ${ROLE_COLORS[member.role] ?? ""}`}>
                            {t(member.role as Parameters<typeof t>[0])}
                          </span>
                        </div>
                        {isAdminRole && (
                          <button
                            className="btn btn-sm btn-ghost text-[11px] text-[var(--ink-muted)] hover:text-[var(--rose-500)]"
                            onClick={() => toggleShift.mutate({ userId: member.id })}
                            disabled={toggleShift.isPending}
                          >
                            {t("endShift")}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Department Load */}
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("departmentLoad")}</span>
          </div>
          {!deptLoad ? (
            <div className="h-48 rounded bg-[var(--surface-2)] animate-pulse" />
          ) : deptLoad.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-muted)] py-4 text-center">{t("noData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={deptLoad} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                <XAxis
                  dataKey="doctorName"
                  tick={{ fontSize: 10, fill: "var(--ink-muted)" }}
                  tickFormatter={name => name.split(" ")[0]}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--ink-muted)" }}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                  cursor={{ fill: "var(--surface-2)", opacity: 0.8 }}
                  formatter={(val: number) => [val, t("todayAppointments")]}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {deptLoad.map((_, idx) => (
                    <Cell key={idx} fill={BAR_COLORS[idx % BAR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Today's Appointments + Live Activity Feed */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Today's Appointments */}
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("todayAppointments")}</span>
            {todayAppts && (
              <span className="ms-auto flex gap-3 text-[12px] text-[var(--ink-muted)]">
                <span style={{ color: "var(--amber-600)" }}>{todayAppts.checkedIn} {t("checkedInShort")}</span>
                <span style={{ color: "var(--teal-600)" }}>{todayAppts.completed} {t("doneShort")}</span>
              </span>
            )}
          </div>
          {!todayAppts?.appointments?.length ? (
            <p className="text-[13px] text-[var(--ink-muted)] py-4 text-center">{t("noAppointmentsToday")}</p>
          ) : (
            <div className="space-y-2">
              {todayAppts.appointments.slice(0, 8).map((apt, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg border border-[var(--line)] text-[13px]">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[var(--ink)] text-[12px] truncate">
                      {apt.patient?.fullName || `Patient #${apt.patientId}`}
                    </p>
                    <p className="text-[11px] text-[var(--ink-muted)]">{apt.doctor?.fullName} · {apt.reason}</p>
                  </div>
                  <StatusBadge status={apt.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Activity Feed */}
        <div className="card card-pad">
          {loadingActivity ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 rounded bg-[var(--surface-2)] animate-pulse" />
              ))}
            </div>
          ) : !activityEvents.length ? (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--ink-muted)]">
              <TrendingUp className="w-6 h-6 mb-2 opacity-30" />
              <p className="text-[13px]">{t("noRecentActivity")}</p>
            </div>
          ) : (
            <LiveActivityFeed events={activityEvents} maxVisible={12} />
          )}
        </div>
      </div>

      {/* Compliance controls for admin roles (compliance_officer has these on
          its own ComplianceDashboard). Buttons inside gate by exact role —
          erasure execute is super_admin-only. */}
      {isAdminRole && (
        <>
          <BreakGlassQueue />
          <ErasurePanel />
        </>
      )}
    </div>
  );
}
