import {
  useGetImagingDashboard,
  getGetImagingDashboardQueryKey,
  useGetLabDashboard,
  getGetLabDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import Metric from "@/components/Metric";
import { SkeletonMetric } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, CheckCircle2, Clock,
  BarChart3, Upload, Eye, RefreshCw,
} from "lucide-react";

interface ImagingDashboardProps {
  domain: "xray" | "lab";
}

function XrayView() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useGetImagingDashboard({
    query: { queryKey: getGetImagingDashboardQueryKey(), refetchInterval: 30000 },
  });

  const statusRows = [
    { label: t("imagingDashPending"),  count: data?.firstCount  ?? 0, color: "bg-amber-400",  icon: <Clock       className="w-4 h-4 text-amber-500"  />, tone: "amber" as const },
    { label: t("imagingDashUploaded"), count: data?.secondCount ?? 0, color: "bg-blue-400",   icon: <Upload      className="w-4 h-4 text-blue-500"   />, tone: "blue"  as const },
    { label: t("imagingDashReviewed"), count: data?.thirdCount  ?? 0, color: "bg-teal-500",   icon: <Eye         className="w-4 h-4 text-teal-500"   />, tone: "teal"  as const },
  ];
  const total = (data?.firstCount ?? 0) + (data?.secondCount ?? 0) + (data?.thirdCount ?? 0);

  return <ImagingView data={data} isLoading={isLoading} isError={isError} refetch={refetch} statusRows={statusRows} total={total} />;
}

function LabView() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useGetLabDashboard({
    query: { queryKey: getGetLabDashboardQueryKey(), refetchInterval: 30000 },
  });

  const statusRows = [
    { label: t("imagingDashRequested"),  count: data?.firstCount  ?? 0, color: "bg-amber-400", icon: <Activity     className="w-4 h-4 text-amber-500"  />, tone: "amber" as const },
    { label: t("imagingDashInProgress"), count: data?.secondCount ?? 0, color: "bg-blue-400",  icon: <Clock        className="w-4 h-4 text-blue-500"   />, tone: "blue"  as const },
    { label: t("imagingDashCompleted"),  count: data?.thirdCount  ?? 0, color: "bg-teal-500",  icon: <CheckCircle2 className="w-4 h-4 text-teal-500"   />, tone: "teal"  as const },
  ];
  const total = (data?.firstCount ?? 0) + (data?.secondCount ?? 0) + (data?.thirdCount ?? 0);

  return <ImagingView data={data} isLoading={isLoading} isError={isError} refetch={refetch} statusRows={statusRows} total={total} />;
}

interface StatusRow {
  label: string;
  count: number;
  color: string;
  icon: React.ReactNode;
  tone: "amber" | "blue" | "teal";
}

interface ImagingViewProps {
  data: { firstCount: number; secondCount: number; thirdCount: number; todayCount: number; weekCount: number; recentItems: { id: number; patientId: number; status: string; createdAt: string }[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  statusRows: StatusRow[];
  total: number;
}

function StatusChip({ status }: { status: string }) {
  const toneMap: Record<string, string> = {
    pending:     "badge-sand",
    uploaded:    "badge-blue",
    reviewed:    "badge-teal",
    requested:   "badge-sand",
    in_progress: "badge-blue",
    completed:   "badge-teal",
    cancelled:   "badge-rose",
  };
  return (
    <span className={cn("badge text-[10px] capitalize", toneMap[status] ?? "")}>
      {status.replace("_", " ")}
    </span>
  );
}

function ImagingView({ data, isLoading, isError, refetch, statusRows, total }: ImagingViewProps) {
  const { t } = useI18n();

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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonMetric key={i} />)
        ) : (
          <>
            {statusRows.map((row) => (
              <Metric
                key={row.label}
                label={row.label}
                value={row.count}
                tone={row.tone}
                icon={row.icon}
              />
            ))}
            <Metric
              label={t("imagingDashTodayVolume")}
              value={data?.todayCount ?? 0}
              tone="sage"
              icon={<Activity className="w-4 h-4" />}
            />
          </>
        )}
      </div>

      {/* Status breakdown + Recent items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Status breakdown */}
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("imagingDashStatusBreakdown")}</span>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {statusRows.map((row) => {
                const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                return (
                  <div key={row.label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {row.icon}
                        <span className="text-[12px] font-medium text-[var(--ink)]">{row.label}</span>
                      </div>
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

        {/* Recent items */}
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("imagingDashRecentItems")}</span>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-9 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : !data?.recentItems?.length ? (
            <p className="text-[13px] text-[var(--ink-muted)] text-center py-4">{t("imagingDashNoItems")}</p>
          ) : (
            <div className="space-y-2">
              {data.recentItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-[var(--line)] last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--ink-faint)]">#{item.id}</span>
                    <span className="text-[12px] text-[var(--ink)]">Patient #{item.patientId}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusChip status={item.status} />
                    <span className="text-[11px] text-[var(--ink-muted)]">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default function ImagingDashboard({ domain }: ImagingDashboardProps) {
  if (domain === "xray") return <XrayView />;
  return <LabView />;
}
