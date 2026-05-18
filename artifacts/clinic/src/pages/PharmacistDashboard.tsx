import {
  useGetPharmacistDashboard,
  getGetPharmacistDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Pill, ClipboardList, AlertTriangle, PackageOpen, FlaskConical,
} from "lucide-react";

export default function PharmacistDashboard() {
  const { t } = useI18n();

  const { data, isLoading, isError, refetch } = useGetPharmacistDashboard({
    query: { queryKey: getGetPharmacistDashboardQueryKey(), refetchInterval: 60000 },
  });

  const statCards = [
    {
      label:   t("pharmacistTodayRx"),
      value:   data?.todayCount ?? 0,
      icon:    <Pill className="w-5 h-5 text-primary" />,
    },
    {
      label:   t("pharmacistWeekRx"),
      value:   data?.weekCount ?? 0,
      icon:    <ClipboardList className="w-5 h-5 text-indigo-500" />,
    },
    {
      label:      t("pharmacistLowStock"),
      value:      data?.lowStockItems?.length ?? 0,
      icon:       <PackageOpen className="w-5 h-5 text-amber-500" />,
      highlight:  (data?.lowStockItems?.length ?? 0) > 0,
    },
  ];

  if (isError) {
    return (
      <div>
        <PageHeader title={t("pharmacistDashTitle")} subtitle={t("pharmacistDashSubtitle")} />
        <div className="p-6">
          <Card className="border border-border">
            <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
              <AlertTriangle className="w-8 h-8 text-destructive opacity-60" />
              <p className="text-sm font-medium text-foreground">{t("dashboardErrorTitle")}</p>
              <button
                onClick={() => refetch()}
                className="text-xs text-primary underline cursor-pointer"
              >
                {t("dashboardErrorRetry")}
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("pharmacistDashTitle")} subtitle={t("pharmacistDashSubtitle")} />

      <div className="p-6 space-y-6">

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {statCards.map((card) => (
            <Card
              key={card.label}
              className={cn(
                "border",
                card.highlight
                  ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
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
                        "text-2xl font-bold mt-1.5 leading-none",
                        card.highlight ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                      )}>
                        {card.value}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0">{card.icon}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Recent prescriptions */}
          <Card className="lg:col-span-3 border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-primary" />
                {t("pharmacistRecentRx")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : !data?.recentPrescriptions?.length ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t("pharmacistNoRx")}</p>
              ) : (
                <div className="space-y-1.5">
                  {data.recentPrescriptions.map((rx) => (
                    <div
                      key={rx.id}
                      className="flex items-center gap-3 px-2.5 py-2 rounded border border-border bg-muted/30 text-sm"
                    >
                      <Pill className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-foreground">
                            {t("pharmacistPatient")} #{rx.patientId}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            · {rx.doctorName}
                          </span>
                          <Badge className="text-[10px] px-1 py-0 border-none bg-primary/10 text-primary leading-none">
                            {rx.medicationCount} {t("pharmacistMedications")}
                          </Badge>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 whitespace-nowrap">
                        {formatDateTime(rx.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Low stock items */}
          <Card className="lg:col-span-2 border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <PackageOpen className="w-4 h-4 text-amber-500" />
                {t("pharmacistLowStock")}
                {(data?.lowStockItems?.length ?? 0) > 0 && (
                  <Badge className="ms-1 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-none text-[10px] px-1.5 py-0">
                    {data?.lowStockItems?.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-9 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : !data?.lowStockItems?.length ? (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
                  <FlaskConical className="w-7 h-7 opacity-30" />
                  <p className="text-xs">{t("pharmacistNoLowStock")}</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {data.lowStockItems.map((item) => {
                    const pct = Math.min(100, Math.round((item.quantity / (item.minimumStock || 1)) * 100));
                    return (
                      <div key={item.id} className="space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-foreground truncate flex-1 min-w-0">
                            {item.name}
                          </span>
                          <span className={cn(
                            "text-xs font-semibold flex-shrink-0",
                            item.quantity === 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-amber-600 dark:text-amber-400",
                          )}>
                            {item.quantity} {item.unit}
                          </span>
                        </div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              pct === 0 ? "bg-red-500" : "bg-amber-500",
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
