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
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CalendarDays, Users, FlaskConical, Bell, BellOff,
  CheckCheck, ArrowRight,
} from "lucide-react";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const notifColors: Record<string, string> = {
  patient_arrived: "bg-blue-100 text-blue-700",
  lab_ready: "bg-green-100 text-green-700",
  xray_ready: "bg-purple-100 text-purple-700",
  general: "bg-gray-100 text-gray-700",
};

export default function DoctorDashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: todayData, isLoading: loadingToday } = useGetTodayAppointments({
    query: {
      queryKey: getGetTodayAppointmentsQueryKey(),
      refetchInterval: 30000,
    },
  });

  const { data: completedAppts } = useListAppointments(
    { status: "completed", limit: 20 },
    { query: { queryKey: getListAppointmentsQueryKey({ status: "completed", limit: 20 }) } },
  );

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

  // Derived data
  const queue = (todayData?.appointments ?? [])
    .slice()
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const waitingCount = queue.filter(a => a.status === "ready_for_doctor").length;
  const pendingDiagnostics = (labResults?.length ?? 0) + (xrayResults?.length ?? 0);

  const unreadNotifs = (notifications ?? []).filter(n => !n.isRead).slice(0, 10);

  // Dedupe completed appointments by patientId, take 5 most recent
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
    <div>
      <PageHeader
        title={t("dashboard")}
        subtitle={`${t("welcome")}, ${user?.fullName}`}
      />
      <div className="p-6 space-y-6">

        {/* Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border border-border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t("todayAppointments")}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">
                    {loadingToday ? "—" : todayData?.total ?? 0}
                  </p>
                </div>
                <CalendarDays className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t("patientsWaiting")}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">
                    {loadingToday ? "—" : waitingCount}
                  </p>
                </div>
                <Users className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t("pendingResults")}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{pendingDiagnostics}</p>
                </div>
                <FlaskConical className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Queue + Notifications */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Today's Queue */}
          <Card className="lg:col-span-3 border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                {t("todayQueue")}
                {todayData && (
                  <span className="ms-auto text-xs font-normal text-muted-foreground">
                    {todayData.total} {t("patientsToday")} · {todayData.completed} {t("doneShort")}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {loadingToday ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-12 rounded bg-muted animate-pulse" />
                  ))}
                </div>
              ) : !queue.length ? (
                <p className="text-sm text-muted-foreground py-6 text-center">{t("noAppointmentsToday")}</p>
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
                        className="flex items-center gap-3 p-2.5 rounded border border-border/60 text-sm"
                      >
                        <span className="text-xs text-muted-foreground font-mono w-10 flex-shrink-0">
                          {fmtTime(apt.scheduledAt)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground text-xs truncate">
                            {apt.patient?.fullName ?? `Patient #${apt.patientId}`}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">{apt.reason}</p>
                        </div>
                        <StatusBadge status={apt.status} />
                        {isActionable && (
                          <Button
                            size="sm"
                            variant={apt.status === "ready_for_doctor" ? "default" : "outline"}
                            className="h-7 text-xs px-2 flex-shrink-0"
                            onClick={() => setLocation(`/patients/${apt.patientId}`)}
                          >
                            {actionLabel}
                            <ArrowRight className="w-3 h-3 ms-1" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card className="lg:col-span-2 border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" />
                {t("notifications")}
                {unreadNotifs.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto h-6 text-xs px-2"
                    onClick={() => markAllMutation.mutate()}
                    disabled={markAllMutation.isPending}
                  >
                    <CheckCheck className="w-3 h-3 me-1" />
                    {t("markAllRead")}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {!unreadNotifs.length ? (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                  <BellOff className="w-6 h-6 mb-2 opacity-30" />
                  <p className="text-xs">{t("noUnreadNotifications")}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {unreadNotifs.map(n => (
                    <div
                      key={n.id}
                      className="flex items-start gap-2 p-2.5 rounded border border-primary/20 bg-card"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-medium text-foreground leading-tight">{n.title}</p>
                          <Badge
                            className={cn(
                              "text-[10px] px-1 py-0 border-none leading-none",
                              notifColors[n.type] ?? notifColors.general,
                            )}
                          >
                            {n.type.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">{formatDateTime(n.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Patients */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              {t("recentPatients")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {!recentPatients.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("noRecentPatients")}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {recentPatients.map(apt => (
                  <button
                    key={apt.patientId}
                    onClick={() => setLocation(`/patients/${apt.patientId}`)}
                    className="flex flex-col gap-1 p-3 rounded border border-border/60 text-start hover:bg-muted/50 transition-colors"
                  >
                    <p className="text-xs font-medium text-foreground truncate">
                      {apt.patient?.fullName ?? `Patient #${apt.patientId}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(apt.scheduledAt)}</p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
