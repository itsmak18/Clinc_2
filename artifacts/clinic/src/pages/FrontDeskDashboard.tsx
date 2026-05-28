import {
  useGetFrontDeskDashboard,
  getGetFrontDeskDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import Metric from "@/components/Metric";
import { SkeletonMetric } from "@/components/ui/skeleton";
import GlobalSearch from "@/components/GlobalSearch";
import { cn } from "@/lib/utils";
import {
  CalendarDays, UserX, Receipt, AlertTriangle,
  CheckCircle2, Clock, BarChart3, RefreshCw,
} from "lucide-react";

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FrontDeskDashboard() {
  const { t } = useI18n();

  const { data, isLoading, isError, refetch } = useGetFrontDeskDashboard({
    query: { queryKey: getGetFrontDeskDashboardQueryKey(), refetchInterval: 30000 },
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

  const statusRows = [
    { label: t("frontDeskScheduled"),  count: data?.statusCounts?.scheduled   ?? 0, color: "bg-slate-400" },
    { label: t("frontDeskCheckedIn"),  count: data?.statusCounts?.checked_in  ?? 0, color: "bg-blue-400" },
    { label: t("frontDeskInProgress"), count: data?.statusCounts?.in_progress ?? 0, color: "bg-amber-400" },
    { label: t("frontDeskCompleted"),  count: data?.statusCounts?.completed   ?? 0, color: "bg-teal-500" },
    { label: t("frontDeskCancelled"),  count: data?.statusCounts?.cancelled   ?? 0, color: "bg-rose-400" },
    { label: t("frontDeskNoShow"),     count: data?.statusCounts?.no_show     ?? 0, color: "bg-rose-600" },
  ];

  const sourceRows = [
    { label: t("frontDeskWalkIn"), count: data?.sourceCounts?.walk_in ?? 0, color: "bg-[var(--teal-500)]" },
    { label: t("frontDeskPhone"),  count: data?.sourceCounts?.phone   ?? 0, color: "bg-indigo-400" },
    { label: t("frontDeskOnline"), count: data?.sourceCounts?.online  ?? 0, color: "bg-teal-400" },
  ];

  const totalSource = (data?.sourceCounts?.walk_in ?? 0)
    + (data?.sourceCounts?.phone ?? 0)
    + (data?.sourceCounts?.online ?? 0);

  return (
    <div className="page">

      {/* GlobalSearch — above the fold for front desk */}
      <div className="mb-6">
        <GlobalSearch />
      </div>

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonMetric key={i} />)
        ) : (
          <>
            <Metric
              label={t("frontDeskTotalToday")}
              value={data?.totalToday ?? 0}
              tone="teal"
              icon={<CalendarDays className="w-4 h-4" />}
            />
            <Metric
              label={t("frontDeskCheckedIn")}
              value={data?.statusCounts?.checked_in ?? 0}
              tone="blue"
              icon={<CheckCircle2 className="w-4 h-4" />}
            />
            <Metric
              label={t("frontDeskNoShow")}
              value={data?.noShowCount ?? 0}
              tone={(data?.noShowCount ?? 0) > 0 ? "rose" as any : "sand" as any}
              icon={<UserX className="w-4 h-4" />}
            />
            <Metric
              label={t("frontDeskPendingInvoices")}
              value={`$${formatCurrency(data?.pendingInvoiceSum ?? 0)}`}
              tone="amber"
              icon={<Receipt className="w-4 h-4" />}
            />
          </>
        )}
      </div>

      {/* Status breakdown + Source breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Appointment status */}
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("frontDeskStatusBreakdown")}</span>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-7 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {statusRows.map((row) => {
                const pct = data?.totalToday
                  ? Math.round((row.count / data.totalToday) * 100)
                  : 0;
                return (
                  <div key={row.label} className="flex items-center gap-2">
                    <span className="text-[12px] text-[var(--ink)] w-24 flex-shrink-0 truncate">{row.label}</span>
                    <div className="flex-1 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all duration-300", row.color)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[12px] text-[var(--ink-muted)] w-6 text-end flex-shrink-0">
                      {row.count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Booking source */}
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("frontDeskSourceBreakdown")}</span>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {sourceRows.map((row) => {
                const pct = totalSource > 0 ? Math.round((row.count / totalSource) * 100) : 0;
                return (
                  <div key={row.label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-[var(--ink)]">{row.label}</span>
                      <span className="text-[12px] text-[var(--ink-muted)]">
                        {row.count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all duration-300", row.color)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
