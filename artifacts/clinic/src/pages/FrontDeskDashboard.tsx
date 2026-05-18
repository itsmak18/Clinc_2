import {
  useGetFrontDeskDashboard,
  getGetFrontDeskDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import GlobalSearch from "@/components/GlobalSearch";
import {
  CalendarDays, UserX, Receipt, AlertTriangle,
  CheckCircle2, Clock, BarChart3,
} from "lucide-react";

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FrontDeskDashboard() {
  const { t } = useI18n();

  const { data, isLoading, isError, refetch } = useGetFrontDeskDashboard({
    query: { queryKey: getGetFrontDeskDashboardQueryKey(), refetchInterval: 30000 },
  });

  const statCards = [
    {
      label:    t("frontDeskTotalToday"),
      value:    data?.totalToday ?? 0,
      icon:     <CalendarDays className="w-5 h-5 text-primary" />,
      sublabel: "",
    },
    {
      label:    t("frontDeskCheckedIn"),
      value:    data?.statusCounts?.checked_in ?? 0,
      icon:     <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
      sublabel: "",
    },
    {
      label:      t("frontDeskNoShow"),
      value:      data?.noShowCount ?? 0,
      icon:       <UserX className="w-5 h-5 text-red-500" />,
      highlight:  (data?.noShowCount ?? 0) > 0,
    },
    {
      label:      t("frontDeskPendingInvoices"),
      value:      `$${formatCurrency(data?.pendingInvoiceSum ?? 0)}`,
      icon:       <Receipt className="w-5 h-5 text-amber-500" />,
      sublabel:   `${data?.pendingInvoiceCount ?? 0} ${t("billingPendingInvoices")}`,
      highlight:  (data?.pendingInvoiceCount ?? 0) > 0,
      isText:     true,
    },
  ];

  if (isError) {
    return (
      <div>
        <PageHeader title={t("frontDeskDashTitle")} subtitle={t("frontDeskDashSubtitle")} />
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

  const statusRows = [
    { label: t("frontDeskScheduled"),  count: data?.statusCounts?.scheduled   ?? 0, color: "bg-muted-foreground/40" },
    { label: t("frontDeskCheckedIn"),  count: data?.statusCounts?.checked_in  ?? 0, color: "bg-blue-400" },
    { label: t("frontDeskInProgress"), count: data?.statusCounts?.in_progress ?? 0, color: "bg-amber-400" },
    { label: t("frontDeskCompleted"),  count: data?.statusCounts?.completed   ?? 0, color: "bg-emerald-500" },
    { label: t("frontDeskCancelled"),  count: data?.statusCounts?.cancelled   ?? 0, color: "bg-red-400" },
    { label: t("frontDeskNoShow"),     count: data?.statusCounts?.no_show     ?? 0, color: "bg-red-600" },
  ];

  const sourceRows = [
    { label: t("frontDeskWalkIn"), count: data?.sourceCounts?.walk_in ?? 0, color: "bg-primary" },
    { label: t("frontDeskPhone"),  count: data?.sourceCounts?.phone   ?? 0, color: "bg-indigo-400" },
    { label: t("frontDeskOnline"), count: data?.sourceCounts?.online  ?? 0, color: "bg-emerald-500" },
  ];

  const totalSource = (data?.sourceCounts?.walk_in ?? 0)
    + (data?.sourceCounts?.phone ?? 0)
    + (data?.sourceCounts?.online ?? 0);

  return (
    <div>
      <PageHeader title={t("frontDeskDashTitle")} subtitle={t("frontDeskDashSubtitle")} />

      <div className="p-6 space-y-6">

        {/* GlobalSearch — above the fold for front desk */}
        <GlobalSearch />

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
                        "font-bold mt-1.5 leading-none",
                        card.isText ? "text-lg truncate" : "text-2xl",
                        card.highlight ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                      )}>
                        {card.value}
                      </p>
                    )}
                    {card.sublabel && (
                      <p className="text-[11px] text-muted-foreground mt-1.5">{card.sublabel}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0">{card.icon}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Status breakdown + Source breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Appointment status */}
          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                {t("frontDeskStatusBreakdown")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-7 bg-muted animate-pulse rounded" />
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
                        <span className="text-xs text-foreground w-24 flex-shrink-0 truncate">{row.label}</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all duration-300", row.color)}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-6 text-right flex-shrink-0">
                          {row.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Booking source */}
          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                {t("frontDeskSourceBreakdown")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-12 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {sourceRows.map((row) => {
                    const pct = totalSource > 0 ? Math.round((row.count / totalSource) * 100) : 0;
                    return (
                      <div key={row.label} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">{row.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {row.count} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
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
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
