import {
  useGetTodayAppointments,
  useListAppointments,
  useListLabTests,
  useListXrayImages,
  useListNotifications,
  useMarkAllNotificationsRead,
  getGetTodayAppointmentsQueryKey,
  getListAppointmentsQueryKey,
  getListLabTestsQueryKey,
  getListXrayImagesQueryKey,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import Metric from "@/components/Metric";
import { SkeletonMetric } from "@/components/ui/skeleton";
import StatusBadge from "@/components/StatusBadge";
import { formatDate, formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CalendarDays, Users, FlaskConical, Bell, BellOff,
  CheckCheck, ArrowRight,
} from "lucide-react";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const NOTIF_TONE: Record<string, string> = {
  patient_arrived: "badge-blue",
  lab_ready:       "badge-teal",
  xray_ready:      "badge-sage",
  general:         "",
};

export default function DoctorDashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: todayData, isLoading: loadingToday } = useGetTodayAppointments({
    query: { queryKey: getGetTodayAppointmentsQueryKey(), refetchInterval: 30000 },
  });

  const { data: completedApptsResp } = useListAppointments(
    { status: "completed", limit: 20 },
    { query: { queryKey: getListAppointmentsQueryKey({ status: "completed", limit: 20 }) } },
  );
  const completedAppts = completedApptsResp?.data ?? [];

  const { data: labResults } = useListLabTests(
    { status: "completed" },
    { query: { queryKey: getListLabTestsQueryKey({ status: "completed" }) } },
  );

  const { data: xrayResults } = useListXrayImages(
    { status: "uploaded" },
    { query: { queryKey: getListXrayImagesQueryKey({ status: "uploaded" }) } },
  );

  const { data: notifications } = useListNotifications(
    {},
    { query: { queryKey: getListNotificationsQueryKey({}) } },
  );

  const markAllMutation = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    },
  });

  const queue = (todayData?.appointments ?? [])
    .slice()
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const waitingCount   = queue.filter(a => a.status === "ready_for_doctor").length;
  const completedCount = queue.filter(a => a.status === "completed").length;
  const pendingDiag    = (labResults?.length ?? 0) + (xrayResults?.length ?? 0);

  const unreadNotifs = (notifications ?? []).filter(n => !n.isRead).slice(0, 10);

  const recentPatients = (() => {
    const seen = new Set<number>();
    return (completedAppts ?? [])
      .slice()
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
      .filter(a => {
        if (seen.has(a.patientId)) return false;
        seen.add(a.patientId);
        return true;
      })
      .slice(0, 5);
  })();

  return (
    <div className="page">

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {loadingToday ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonMetric key={i} />)
        ) : (
          <>
            <Metric
              label={t("todayAppointments")}
              value={todayData?.total ?? 0}
              tone="teal"
              icon={<CalendarDays className="w-4 h-4" />}
            />
            <Metric
              label={t("patientsWaiting")}
              value={waitingCount}
              tone="amber"
              icon={<Users className="w-4 h-4" />}
            />
            <Metric
              label={t("pendingResults")}
              value={pendingDiag}
              tone="blue"
              icon={<FlaskConical className="w-4 h-4" />}
            />
          </>
        )}
      </div>

      {/* Queue + Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">

        {/* Today's Queue */}
        <div className="card card-pad lg:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("todayQueue")}</span>
            {todayData && (
              <span className="ms-auto text-[12px] text-[var(--ink-muted)]">
                {todayData.total} {t("patientsToday")} ·{" "}
                <span style={{ color: "var(--teal-600)" }}>{completedCount} {t("doneShort")}</span>
              </span>
            )}
          </div>
          {loadingToday ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 rounded bg-[var(--surface-2)] animate-pulse" />
              ))}
            </div>
          ) : !queue.length ? (
            <p className="text-[13px] text-[var(--ink-muted)] py-6 text-center">{t("noAppointmentsToday")}</p>
          ) : (
            <div className="space-y-2">
              {queue.map(apt => {
                const isActionable =
                  apt.status === "ready_for_doctor" ||
                  apt.status === "in_consultation" ||
                  apt.status === "completed";

                let actionLabel = "";
                if (apt.status === "ready_for_doctor") actionLabel = t("startConsultation");
                else if (apt.status === "in_consultation") actionLabel = t("continueConsultation");
                else if (apt.status === "completed") actionLabel = t("viewRecord");

                return (
                  <div
                    key={apt.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg border border-[var(--line)] text-[13px]"
                  >
                    <span className="text-[11px] text-[var(--ink-muted)] font-mono w-10 flex-shrink-0">
                      {fmtTime(apt.scheduledAt)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[var(--ink)] text-[12px] truncate">
                        {apt.patient?.fullName ?? `Patient #${apt.patientId}`}
                      </p>
                      <p className="text-[11px] text-[var(--ink-muted)] truncate">{apt.reason}</p>
                    </div>
                    <StatusBadge status={apt.status} />
                    {isActionable && (
                      <button
                        className={cn(
                          "btn btn-sm flex-shrink-0 gap-1",
                          apt.status === "ready_for_doctor" ? "btn-primary" : "btn-outline",
                        )}
                        onClick={() => setLocation(`/patients/${apt.patientId}`)}
                      >
                        {actionLabel}
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="card card-pad lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("notifications")}</span>
            {unreadNotifs.length > 0 && (
              <button
                className="btn btn-sm btn-ghost ms-auto text-[11px] gap-1 text-[var(--ink-muted)]"
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
              >
                <CheckCheck className="w-3 h-3" />
                {t("markAllRead")}
              </button>
            )}
          </div>
          {!unreadNotifs.length ? (
            <div className="flex flex-col items-center justify-center py-6 text-[var(--ink-faint)]">
              <BellOff className="w-6 h-6 mb-2 opacity-30" />
              <p className="text-[13px]">{t("noUnreadNotifications")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {unreadNotifs.map(n => (
                <div
                  key={n.id}
                  className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--teal-100)] bg-[var(--teal-50)]"
                  style={{ "--tw-border-opacity": "1" } as React.CSSProperties}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--teal-500)] flex-shrink-0 mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[12px] font-medium text-[var(--ink)] leading-tight">{n.title}</p>
                      <span className={cn("badge text-[10px]", NOTIF_TONE[n.type] ?? "")}>
                        {n.type.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--ink-soft)] mt-0.5 leading-tight">{n.message}</p>
                    <p className="text-[10px] text-[var(--ink-faint)] mt-0.5">{formatDateTime(n.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Patients */}
      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-[var(--teal-600)]" />
          <span className="font-semibold text-[var(--ink)] text-[14px]">{t("recentPatients")}</span>
        </div>
        {!recentPatients.length ? (
          <p className="text-[13px] text-[var(--ink-muted)] py-4 text-center">{t("noRecentPatients")}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {recentPatients.map(apt => (
              <button
                key={apt.patientId}
                onClick={() => setLocation(`/patients/${apt.patientId}`)}
                className="flex flex-col gap-1 p-3 rounded-lg border border-[var(--line)] text-start hover:bg-[var(--surface-2)] transition-colors"
              >
                <p className="text-[12px] font-medium text-[var(--ink)] truncate">
                  {apt.patient?.fullName ?? `Patient #${apt.patientId}`}
                </p>
                <p className="text-[11px] text-[var(--ink-muted)]">{formatDate(apt.scheduledAt)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
