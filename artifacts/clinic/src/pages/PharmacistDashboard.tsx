import {
  useGetPharmacistDashboard,
  getGetPharmacistDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import Metric from "@/components/Metric";
import { SkeletonMetric } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Pill, ClipboardList, AlertTriangle, PackageOpen, FlaskConical, RefreshCw,
} from "lucide-react";

export default function PharmacistDashboard() {
  const { t } = useI18n();

  const { data, isLoading, isError, refetch } = useGetPharmacistDashboard({
    query: { queryKey: getGetPharmacistDashboardQueryKey(), refetchInterval: 60000 },
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

  return (
    <div className="page">

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonMetric key={i} />)
        ) : (
          <>
            <Metric
              label={t("pharmacistTodayRx")}
              value={data?.todayCount ?? 0}
              tone="teal"
              icon={<Pill className="w-4 h-4" />}
            />
            <Metric
              label={t("pharmacistWeekRx")}
              value={data?.weekCount ?? 0}
              tone="blue"
              icon={<ClipboardList className="w-4 h-4" />}
            />
            <Metric
              label={t("pharmacistLowStock")}
              value={data?.lowStockItems?.length ?? 0}
              tone="amber"
              icon={<PackageOpen className="w-4 h-4" />}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Recent prescriptions */}
        <div className="card card-pad lg:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("pharmacistRecentRx")}</span>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : !data?.recentPrescriptions?.length ? (
            <p className="text-[13px] text-[var(--ink-muted)] text-center py-6">{t("pharmacistNoRx")}</p>
          ) : (
            <div className="space-y-1.5">
              {data.recentPrescriptions.map((rx) => (
                <div
                  key={rx.id}
                  className="flex items-center gap-3 px-2.5 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[13px]"
                >
                  <Pill className="w-3.5 h-3.5 text-[var(--teal-600)] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[12px] font-medium text-[var(--ink)]">
                        {t("pharmacistPatient")} #{rx.patientId}
                      </span>
                      <span className="text-[11px] text-[var(--ink-muted)]">· {rx.doctorName}</span>
                      <span className="badge badge-teal text-[10px]">
                        {rx.medicationCount} {t("pharmacistMedications")}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--ink-faint)] flex-shrink-0 whitespace-nowrap">
                    {formatDateTime(rx.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Low stock items */}
        <div className="card card-pad lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <PackageOpen className="w-4 h-4 text-[var(--amber-500)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("pharmacistLowStock")}</span>
            {(data?.lowStockItems?.length ?? 0) > 0 && (
              <span className="badge badge-sand ms-auto">
                {data?.lowStockItems?.length}
              </span>
            )}
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-9 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : !data?.lowStockItems?.length ? (
            <div className="flex flex-col items-center justify-center py-6 text-[var(--ink-faint)] gap-2">
              <FlaskConical className="w-7 h-7 opacity-30" />
              <p className="text-[12px]">{t("pharmacistNoLowStock")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.lowStockItems.map((item) => {
                const pct = Math.min(100, Math.round((item.quantity / (item.minimumStock || 1)) * 100));
                return (
                  <div key={item.id} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-[var(--ink)] truncate flex-1 min-w-0">
                        {item.name}
                      </span>
                      <span className={cn(
                        "text-[12px] font-semibold flex-shrink-0",
                        item.quantity === 0 ? "text-[var(--rose-500)]" : "text-[var(--amber-600)]",
                      )}>
                        {item.quantity} {item.unit}
                      </span>
                    </div>
                    <div className="h-1 bg-[var(--surface-2)] rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          pct === 0 ? "bg-rose-500" : "bg-amber-500",
                        )}
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
