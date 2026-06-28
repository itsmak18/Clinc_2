import {
  useGetNurseDashboard,
  getGetNurseDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import Metric from "@/components/Metric";
import { SkeletonMetric } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/api";
import { PRIORITY_TONE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, UserCheck, Stethoscope,
  ClipboardList, Heart, RefreshCw,
} from "lucide-react";

const PRIORITY_STYLE: Record<string, string> = {
  critical: "border-s-red-500 bg-red-50/40",
  urgent:   "border-s-amber-500 bg-amber-50/40",
  normal:   "border-s-blue-400 bg-blue-50/20",
};


export default function NurseDashboard() {
  const { t } = useI18n();

  const { data, isLoading, isError, refetch } = useGetNurseDashboard({
    query: { queryKey: getGetNurseDashboardQueryKey(), refetchInterval: 30000 },
  });

  if (isError) {
    return (
      <div className="page">
        <div className="card card-pad flex flex-col items-center gap-3 text-center py-10">
          <AlertTriangle className="w-8 h-8 opacity-40" style={{ color: "var(--rose-500)" }} />
          <p className="text-[14px] font-medium text-[var(--ink)]">{t("dashboardErrorTitle")}</p>
          <button onClick={() => refetch()} className="btn btn-sm btn-outline gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            {t("dashboardErrorRetry")}
          </button>
        </div>
      </div>
    );
  }

  const critical = data?.priorityCounts?.critical ?? 0;

  return (
    <div className="page">

      {/* Critical alert strip */}
      {!isLoading && critical > 0 && (
        <div
          role="alert"
          className="mb-5 flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px]"
          style={{ borderColor: "var(--rose-300)", background: "var(--rose-50)", color: "var(--rose-700)" }}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">{critical} {t("nursePriorityCritical")} — immediate attention required</span>
        </div>
      )}

      {/* Kanban column metrics */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonMetric key={i} />)
        ) : (
          <>
            <Metric
              label={t("nurseCheckedIn")}
              value={data?.triageCounts?.checked_in ?? 0}
              tone="blue"
              icon={<UserCheck className="w-4 h-4" />}
            />
            <Metric
              label={t("nurseInTriage")}
              value={data?.triageCounts?.in_triage ?? 0}
              tone="amber"
              icon={<Heart className="w-4 h-4" />}
            />
            <Metric
              label={t("nurseReadyForDoctor")}
              value={data?.triageCounts?.ready_for_doctor ?? 0}
              tone="teal"
              icon={<ClipboardList className="w-4 h-4" />}
            />
            <Metric
              label={t("nurseInConsultation")}
              value={data?.triageCounts?.in_consultation ?? 0}
              tone="sage"
              icon={<Stethoscope className="w-4 h-4" />}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Vitals pending */}
        <div className="card card-pad lg:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <Heart className="w-4 h-4 text-[var(--amber-500)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("nurseVitalsPending")}</span>
            {(data?.triageCounts?.checked_in ?? 0) > 0 && (
              <span className="badge badge-sand ms-1">
                {data?.triageCounts?.checked_in}
              </span>
            )}
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : !data?.vitalsPending?.length ? (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--ink-faint)] gap-2">
              <Heart className="w-7 h-7 opacity-30" />
              <p className="text-[13px]">{t("nurseNoVitalsPending")}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {data.vitalsPending.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-center gap-3 px-2.5 py-2 rounded border-s-4 border border-[var(--line)] text-[13px]",
                    PRIORITY_STYLE[p.priority] ?? PRIORITY_STYLE.normal,
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[12px] font-medium text-[var(--ink)]">
                        {t("nursePatient")} #{p.patientId}
                      </span>
                      <span className={cn("badge text-[10px]", PRIORITY_TONE[p.priority] ?? "")}>
                        {p.priority === "critical" ? t("nursePriorityCritical")
                          : p.priority === "urgent" ? t("nursePriorityUrgent")
                          : t("nursePriorityNormal")}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--ink-faint)] flex-shrink-0 whitespace-nowrap">
                    {p.checkedInAt ? formatDateTime(p.checkedInAt) : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Priority breakdown */}
        <div className="card card-pad lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("nurseTodayTotal")}</span>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-8 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--ink-muted)]">{t("nurseTodayTotal")}</span>
                <span className="text-[14px] font-bold text-[var(--ink)]">{data?.todayTotal ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--ink-muted)]">{t("nurseTodayArrived")}</span>
                <span className="text-[14px] font-semibold text-[var(--ink)]">{data?.todayCheckedIn ?? 0}</span>
              </div>
              <div className="border-t border-[var(--line)] pt-3 space-y-2.5">
                {[
                  { key: "critical", label: t("nursePriorityCritical"), color: "bg-rose-500",   count: data?.priorityCounts?.critical ?? 0 },
                  { key: "urgent",   label: t("nursePriorityUrgent"),   color: "bg-amber-500", count: data?.priorityCounts?.urgent   ?? 0 },
                  { key: "normal",   label: t("nursePriorityNormal"),   color: "bg-blue-400",  count: data?.priorityCounts?.normal   ?? 0 },
                ].map((row) => {
                  const total = (data?.priorityCounts?.critical ?? 0)
                    + (data?.priorityCounts?.urgent ?? 0)
                    + (data?.priorityCounts?.normal ?? 0);
                  const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                  return (
                    <div key={row.key} className="flex items-center gap-2">
                      <span className="text-[12px] text-[var(--ink)] w-14 flex-shrink-0">{row.label}</span>
                      <div className="flex-1 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-300", row.color)}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[12px] text-[var(--ink-muted)] w-4 text-end flex-shrink-0">
                        {row.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
