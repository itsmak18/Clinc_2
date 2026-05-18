import {
  useGetComplianceDashboard,
  getGetComplianceDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ShieldAlert, ShieldCheck, Activity, Users,
  TrendingUp, FileText, AlertTriangle,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const ROLE_BADGE: Record<string, string> = {
  super_admin:        "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  admin:              "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  doctor:             "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  nurse:              "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  front_desk:         "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  xray_staff:         "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  lab_staff:          "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  compliance_officer: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  billing_manager:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  pharmacist:         "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
};

function ActionBadge({ action }: { action: string }) {
  const isDenied = action.includes("DENIED");
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium",
        isDenied
          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
          : "bg-muted text-muted-foreground",
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

  const statCards = [
    {
      label: t("complianceTodayEvents"),
      value: data?.todayEvents ?? 0,
      icon: <Activity className="w-5 h-5 text-primary" />,
      sublabel: `${data?.weekEvents ?? 0} ${t("complianceWeekSuffix")}`,
    },
    {
      label: t("complianceTodayDenied"),
      value: data?.todayDenied ?? 0,
      icon: <ShieldAlert className="w-5 h-5 text-red-500" />,
      sublabel: `${data?.deniedRate ?? 0}${t("complianceDeniedRateSuffix")}`,
      highlight: (data?.todayDenied ?? 0) > 0,
    },
    {
      label: t("complianceWeekEventsCard"),
      value: data?.weekEvents ?? 0,
      icon: <TrendingUp className="w-5 h-5 text-emerald-500" />,
      sublabel: t("complianceLast7Days"),
    },
    {
      label: t("complianceTopEntitiesCard"),
      value: data?.topEntities?.[0]?.entityType?.replace(/_/g, " ") ?? "—",
      icon: <FileText className="w-5 h-5 text-indigo-500" />,
      sublabel: data?.topEntities?.[0]
        ? `${data.topEntities[0].count} ${t("complianceAccessesSuffix")}`
        : t("complianceNoData"),
      isText: true,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("complianceDashboardTitle")}
        subtitle={
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>{t("complianceDashboardSubtitle")}</span>
          </span>
        }
      />

      <div className="p-6 space-y-6">

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <Card
              key={card.label}
              className={cn(
                "border",
                card.highlight
                  ? "border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
                  : "border-border",
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground leading-none">{card.label}</p>
                    {isLoading ? (
                      <div className="h-7 w-16 bg-muted animate-pulse rounded mt-1.5" />
                    ) : (
                      <p className={cn(
                        "font-bold mt-1.5 leading-none",
                        card.isText ? "text-lg truncate" : "text-2xl",
                        card.highlight ? "text-red-600 dark:text-red-400" : "text-foreground",
                      )}>
                        {card.value}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">
                      {card.sublabel}
                    </p>
                  </div>
                  <div className="flex-shrink-0">{card.icon}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Trend chart + Top entities */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* 7-day trend */}
          <Card className="lg:col-span-3 border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                {t("complianceTrendTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="h-40 bg-muted animate-pulse rounded" />
              ) : !data?.dailyTrend?.length ? (
                <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                  {t("complianceNoData")}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={data.dailyTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="compliance-trend-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(199 85% 38%)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="hsl(199 85% 38%)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => {
                        const d = new Date(v);
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      }}
                    />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(val) => [val, t("complianceTrendTooltipLabel")]}
                      labelFormatter={(label) => new Date(label).toLocaleDateString()}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="hsl(199 85% 38%)"
                      strokeWidth={2}
                      fill="url(#compliance-trend-fill)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Top entities + Top users */}
          <div className="lg:col-span-2 flex flex-col gap-4">

            {/* Top entity types */}
            <Card className="border border-border flex-1">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  {t("complianceTopEntities")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-7 bg-muted animate-pulse rounded" />
                    ))}
                  </div>
                ) : !data?.topEntities?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-4">{t("complianceNoData")}</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.topEntities.map((e) => {
                      const pct = Math.round((e.count / (data.topEntities[0]?.count || 1)) * 100);
                      return (
                        <div key={e.entityType} className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground w-28 truncate capitalize flex-shrink-0">
                            {e.entityType.replace(/_/g, " ")}
                          </span>
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-8 text-right flex-shrink-0">
                            {e.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top users */}
            <Card className="border border-border flex-1">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  {t("complianceTopUsers")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-7 bg-muted animate-pulse rounded" />
                    ))}
                  </div>
                ) : !data?.topUsers?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-4">{t("complianceNoData")}</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.topUsers.map((u) => (
                      <div key={u.userId} className="flex items-center gap-2">
                        <p className="text-xs font-medium text-foreground truncate flex-1 min-w-0">
                          {u.fullName}
                        </p>
                        <Badge
                          className={cn(
                            "text-[10px] px-1 py-0 border-none leading-none flex-shrink-0",
                            ROLE_BADGE[u.role] ?? "bg-muted text-muted-foreground",
                          )}
                        >
                          {u.role.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground w-8 text-right flex-shrink-0">
                          {u.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Recent denied events */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              {t("complianceRecentDenied")}
              {(data?.todayDenied ?? 0) > 0 && (
                <Badge className="ms-1 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-none text-[10px] px-1.5 py-0">
                  {data?.todayDenied} {t("complianceTodayLabel")}
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
            ) : !data?.recentDenied?.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <ShieldCheck className="w-8 h-8 opacity-30" />
                <p className="text-sm">{t("complianceNoDenied")}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {data.recentDenied.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 p-2.5 rounded border border-red-200/60 bg-red-50/30 dark:border-red-800/40 dark:bg-red-950/10 text-sm"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium text-foreground">{event.userName}</span>
                        <Badge
                          className={cn(
                            "text-[10px] px-1 py-0 border-none leading-none",
                            ROLE_BADGE[event.userRole] ?? "bg-muted text-muted-foreground",
                          )}
                        >
                          {event.userRole.replace(/_/g, " ")}
                        </Badge>
                        <ActionBadge action={event.action} />
                        <span className="text-[11px] text-muted-foreground capitalize">
                          {event.entityType.replace(/_/g, " ")}
                          {event.entityId ? ` #${event.entityId}` : ""}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 whitespace-nowrap">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
