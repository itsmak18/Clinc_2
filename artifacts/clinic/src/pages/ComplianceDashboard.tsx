import {
  useGetComplianceDashboard,
  getGetComplianceDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import Metric from "@/components/Metric";
import { SkeletonMetric } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ShieldAlert, ShieldCheck, Activity, Users,
  TrendingUp, FileText, AlertTriangle,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const ROLE_TONE: Record<string, string> = {
  super_admin:        "badge-rose",
  admin:              "badge-sand",
  doctor:             "badge-blue",
  nurse:              "badge-teal",
  front_desk:         "badge-sage",
  xray_staff:         "badge-sage",
  lab_staff:          "badge-teal",
  compliance_officer: "badge-teal",
  billing_manager:    "badge-teal",
  pharmacist:         "badge-blue",
};

function ActionBadge({ action }: { action: string }) {
  const isDenied = action.includes("DENIED");
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium",
        isDenied ? "badge-rose" : "badge text-[var(--ink-muted)] bg-[var(--surface-2)]",
      )}
    >
      {action.replace(/_/g, " ")}
    </span>
  );
}

export default function ComplianceDashboard() {
  const { t } = useI18n();

  const { data, isLoading } = useGetComplianceDashboard({
    query: { queryKey: getGetComplianceDashboardQueryKey(), refetchInterval: 60000 },
  });

  return (
    <div className="page">

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonMetric key={i} />)
        ) : (
          <>
            <Metric
              label={t("complianceTodayEvents")}
              value={data?.todayEvents ?? 0}
              tone="teal"
              icon={<Activity className="w-4 h-4" />}
            />
            <Metric
              label={t("complianceTodayDenied")}
              value={data?.todayDenied ?? 0}
              tone="rose"
              icon={<ShieldAlert className="w-4 h-4" />}
            />
            <Metric
              label={t("complianceWeekEventsCard")}
              value={data?.weekEvents ?? 0}
              tone="blue"
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <Metric
              label={t("complianceTopEntitiesCard")}
              value={data?.topEntities?.[0]?.entityType?.replace(/_/g, " ") ?? "—"}
              tone="sage"
              icon={<FileText className="w-4 h-4" />}
            />
          </>
        )}
      </div>

      {/* Trend chart + Top entities */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">

        {/* 7-day trend */}
        <div className="card card-pad lg:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("complianceTrendTitle")}</span>
          </div>
          {isLoading ? (
            <div className="h-40 bg-[var(--surface-2)] animate-pulse rounded" />
          ) : !data?.dailyTrend?.length ? (
            <div className="h-40 flex items-center justify-center text-[13px] text-[var(--ink-muted)]">
              {t("complianceNoData")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={data.dailyTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="compliance-trend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--teal-500)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--teal-500)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "var(--ink-muted)" }}
                  tickFormatter={(v) => {
                    const d = new Date(v);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
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
                  formatter={(val) => [val, t("complianceTrendTooltipLabel")]}
                  labelFormatter={(label) => new Date(label).toLocaleDateString()}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--teal-500)"
                  strokeWidth={2}
                  fill="url(#compliance-trend-fill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top entities + Top users */}
        <div className="lg:col-span-2 flex flex-col gap-4">

          {/* Top entity types */}
          <div className="card card-pad flex-1">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-[var(--teal-600)]" />
              <span className="font-semibold text-[var(--ink)] text-[14px]">{t("complianceTopEntities")}</span>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-7 bg-[var(--surface-2)] animate-pulse rounded" />
                ))}
              </div>
            ) : !data?.topEntities?.length ? (
              <p className="text-[13px] text-[var(--ink-muted)] text-center py-4">{t("complianceNoData")}</p>
            ) : (
              <div className="space-y-1.5">
                {data.topEntities.map((e) => {
                  const pct = Math.round((e.count / (data.topEntities[0]?.count || 1)) * 100);
                  return (
                    <div key={e.entityType} className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-[var(--ink)] w-28 truncate capitalize flex-shrink-0">
                        {e.entityType.replace(/_/g, " ")}
                      </span>
                      <div className="flex-1 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--teal-500)] rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[12px] text-[var(--ink-muted)] w-8 text-end flex-shrink-0">
                        {e.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top users */}
          <div className="card card-pad flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-[var(--teal-600)]" />
              <span className="font-semibold text-[var(--ink)] text-[14px]">{t("complianceTopUsers")}</span>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-7 bg-[var(--surface-2)] animate-pulse rounded" />
                ))}
              </div>
            ) : !data?.topUsers?.length ? (
              <p className="text-[13px] text-[var(--ink-muted)] text-center py-4">{t("complianceNoData")}</p>
            ) : (
              <div className="space-y-1.5">
                {data.topUsers.map((u) => (
                  <div key={u.userId} className="flex items-center gap-2">
                    <p className="text-[12px] font-medium text-[var(--ink)] truncate flex-1 min-w-0">
                      {u.fullName}
                    </p>
                    <span className={cn("badge text-[10px] flex-shrink-0", ROLE_TONE[u.role] ?? "")}>
                      {u.role.replace(/_/g, " ")}
                    </span>
                    <span className="text-[12px] text-[var(--ink-muted)] w-8 text-end flex-shrink-0">
                      {u.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent denied events */}
      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-[var(--rose-500)]" />
          <span className="font-semibold text-[var(--ink)] text-[14px]">{t("complianceRecentDenied")}</span>
          {(data?.todayDenied ?? 0) > 0 && (
            <span className="badge badge-rose ms-1">
              {data?.todayDenied} {t("complianceTodayLabel")}
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-[var(--surface-2)] animate-pulse rounded" />
            ))}
          </div>
        ) : !data?.recentDenied?.length ? (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--ink-faint)] gap-2">
            <ShieldCheck className="w-8 h-8 opacity-30" />
            <p className="text-[13px]">{t("complianceNoDenied")}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.recentDenied.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-[var(--rose-100)] bg-[var(--rose-50)] text-[13px]"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-[var(--rose-500)] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[12px] font-medium text-[var(--ink)]">{event.userName}</span>
                    <span className={cn("badge text-[10px]", ROLE_TONE[event.userRole] ?? "")}>
                      {event.userRole.replace(/_/g, " ")}
                    </span>
                    <ActionBadge action={event.action} />
                    <span className="text-[11px] text-[var(--ink-muted)] capitalize">
                      {event.entityType.replace(/_/g, " ")}
                      {event.entityId ? ` #${event.entityId}` : ""}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] text-[var(--ink-faint)] flex-shrink-0 whitespace-nowrap">
                  {formatDateTime(event.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
