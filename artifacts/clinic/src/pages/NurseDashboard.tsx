import {
  useGetNurseDashboard,
  getGetNurseDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, UserCheck, Stethoscope,
  ClipboardList, Heart,
} from "lucide-react";

const PRIORITY_STYLE: Record<string, string> = {
  critical: "border-l-red-500 bg-red-50/40 dark:bg-red-950/10",
  urgent:   "border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/10",
  normal:   "border-l-blue-400 bg-blue-50/20 dark:bg-blue-950/10",
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  urgent:   "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  normal:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

export default function NurseDashboard() {
  const { t } = useI18n();

  const { data, isLoading, isError, refetch } = useGetNurseDashboard({
    query: { queryKey: getGetNurseDashboardQueryKey(), refetchInterval: 30000 },
  });

  const kanbanCols = [
    {
      label: t("nurseCheckedIn"),
      count: data?.triageCounts?.checked_in ?? 0,
      icon:  <UserCheck className="w-4 h-4 text-blue-500" />,
      color: "border-t-blue-400",
    },
    {
      label: t("nurseInTriage"),
      count: data?.triageCounts?.in_triage ?? 0,
      icon:  <Heart className="w-4 h-4 text-amber-500" />,
      color: "border-t-amber-400",
    },
    {
      label: t("nurseReadyForDoctor"),
      count: data?.triageCounts?.ready_for_doctor ?? 0,
      icon:  <ClipboardList className="w-4 h-4 text-emerald-500" />,
      color: "border-t-emerald-400",
    },
    {
      label: t("nurseInConsultation"),
      count: data?.triageCounts?.in_consultation ?? 0,
      icon:  <Stethoscope className="w-4 h-4 text-primary" />,
      color: "border-t-primary",
    },
  ];

  if (isError) {
    return (
      <div>
        <PageHeader title={t("nurseDashTitle")} subtitle={t("nurseDashSubtitle")} />
        <div className="p-6">
          <Card className="border border-border">
            <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
              <AlertTriangle className="w-8 h-8 text-destructive opacity-60" />
              <p className="text-sm font-medium text-foreground">{t("dashboardErrorTitle")}</p>
              <button onClick={() => refetch()} className="text-xs text-primary underline cursor-pointer">
                {t("dashboardErrorRetry")}
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const critical = data?.priorityCounts?.critical ?? 0;

  return (
    <div>
      <PageHeader
        title={t("nurseDashTitle")}
        subtitle={
          <span className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <span>{t("nurseDashSubtitle")}</span>
            {critical > 0 && (
              <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-none text-[10px] px-1.5 py-0">
                {critical} {t("nursePriorityCritical")}
              </Badge>
            )}
          </span>
        }
      />

      <div className="p-6 space-y-6">

        {/* Kanban column summary */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kanbanCols.map((col) => (
            <Card key={col.label} className={cn("border border-t-2", col.color)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground leading-none">{col.label}</p>
                    {isLoading ? (
                      <div className="h-8 w-12 bg-muted animate-pulse rounded mt-1.5" />
                    ) : (
                      <p className="text-3xl font-bold mt-1.5 text-foreground leading-none">
                        {col.count}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0">{col.icon}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Vitals pending */}
          <Card className="lg:col-span-3 border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Heart className="w-4 h-4 text-amber-500" />
                {t("nurseVitalsPending")}
                {(data?.triageCounts?.checked_in ?? 0) > 0 && (
                  <Badge className="ms-1 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-none text-[10px] px-1.5 py-0">
                    {data?.triageCounts?.checked_in}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : !data?.vitalsPending?.length ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                  <Heart className="w-7 h-7 opacity-30" />
                  <p className="text-sm">{t("nurseNoVitalsPending")}</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {data.vitalsPending.map((p) => (
                    <div
                      key={p.id}
                      className={cn(
                        "flex items-center gap-3 px-2.5 py-2 rounded border-l-4 border border-border text-sm",
                        PRIORITY_STYLE[p.priority] ?? PRIORITY_STYLE.normal,
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-foreground">
                            {t("nursePatient")} #{p.patientId}
                          </span>
                          <Badge className={cn(
                            "text-[10px] px-1 py-0 border-none leading-none",
                            PRIORITY_BADGE[p.priority] ?? PRIORITY_BADGE.normal,
                          )}>
                            {p.priority === "critical" ? t("nursePriorityCritical")
                              : p.priority === "urgent" ? t("nursePriorityUrgent")
                              : t("nursePriorityNormal")}
                          </Badge>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 whitespace-nowrap">
                        {p.checkedInAt ? formatDateTime(p.checkedInAt) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Priority breakdown */}
          <Card className="lg:col-span-2 border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                {t("nurseTodayTotal")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-8 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{t("nurseTodayTotal")}</span>
                    <span className="text-sm font-bold text-foreground">{data?.todayTotal ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{t("nurseTodayArrived")}</span>
                    <span className="text-sm font-semibold text-foreground">{data?.todayCheckedIn ?? 0}</span>
                  </div>
                  <div className="border-t border-border pt-2 space-y-2">
                    {[
                      { key: "critical", label: t("nursePriorityCritical"), color: "bg-red-500",   count: data?.priorityCounts?.critical ?? 0 },
                      { key: "urgent",   label: t("nursePriorityUrgent"),   color: "bg-amber-500", count: data?.priorityCounts?.urgent   ?? 0 },
                      { key: "normal",   label: t("nursePriorityNormal"),   color: "bg-blue-400",  count: data?.priorityCounts?.normal   ?? 0 },
                    ].map((row) => {
                      const total = (data?.priorityCounts?.critical ?? 0)
                        + (data?.priorityCounts?.urgent ?? 0)
                        + (data?.priorityCounts?.normal ?? 0);
                      const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                      return (
                        <div key={row.key} className="flex items-center gap-2">
                          <span className="text-xs text-foreground w-14 flex-shrink-0">{row.label}</span>
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all duration-300", row.color)}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-4 text-right flex-shrink-0">
                            {row.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
