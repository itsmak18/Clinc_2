import {
  useGetBillingDashboard,
  getGetBillingDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  DollarSign, TrendingUp, BarChart3, AlertCircle, AlertTriangle,
  CreditCard, XCircle,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BillingDashboard() {
  const { t } = useI18n();

  const { data, isLoading, isError, refetch } = useGetBillingDashboard({
    query: { queryKey: getGetBillingDashboardQueryKey(), refetchInterval: 60000 },
  });

  const statCards = [
    {
      label:    t("billingTodayRevenue"),
      value:    `$${formatCurrency(data?.todayRevenue ?? 0)}`,
      icon:     <DollarSign className="w-5 h-5 text-emerald-500" />,
      sublabel: t("billingDashSubtitle"),
    },
    {
      label:    t("billingWeekRevenue"),
      value:    `$${formatCurrency(data?.weekRevenue ?? 0)}`,
      icon:     <TrendingUp className="w-5 h-5 text-primary" />,
      sublabel: "",
    },
    {
      label:    t("billingMonthRevenue"),
      value:    `$${formatCurrency(data?.monthRevenue ?? 0)}`,
      icon:     <BarChart3 className="w-5 h-5 text-indigo-500" />,
      sublabel: "",
    },
    {
      label:     t("billingPendingAR"),
      value:     `$${formatCurrency(data?.pendingSum ?? 0)}`,
      icon:      <AlertCircle className="w-5 h-5 text-amber-500" />,
      sublabel:  `${data?.pendingCount ?? 0} ${t("billingPendingInvoices")}`,
      highlight: (data?.pendingCount ?? 0) > 0,
    },
  ];

  if (isError) {
    return (
      <div>
        <PageHeader title={t("billingDashTitle")} subtitle={t("billingDashSubtitle")} />
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
      <PageHeader title={t("billingDashTitle")} subtitle={t("billingDashSubtitle")} />

      <div className="p-6 space-y-6">

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
                      <div className="h-7 w-24 bg-muted animate-pulse rounded mt-1.5" />
                    ) : (
                      <p className={cn(
                        "text-2xl font-bold mt-1.5 leading-none",
                        card.highlight ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                      )}>
                        {card.value}
                      </p>
                    )}
                    {card.sublabel && (
                      <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">
                        {card.sublabel}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0">{card.icon}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Revenue trend chart */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              {t("billingRevenueTrend")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="h-40 bg-muted animate-pulse rounded" />
            ) : !data?.dailyRevenue?.length ? (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                {t("dashboardNoData")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={data.dailyRevenue} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="billing-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="hsl(142 71% 45%)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(142 71% 45%)" stopOpacity={0.02} />
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
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(val: number) => [`$${formatCurrency(val)}`, t("billingRevenueTrendTooltip")]}
                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="hsl(142 71% 45%)"
                    strokeWidth={2}
                    fill="url(#billing-revenue-fill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Recent payments + cancellations */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Recent payments */}
          <Card className="lg:col-span-3 border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-500" />
                {t("billingRecentPayments")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-9 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : !data?.recentPayments?.length ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t("billingNoPayments")}</p>
              ) : (
                <div className="space-y-1">
                  {data.recentPayments.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 px-2.5 py-2 rounded border border-emerald-200/50 bg-emerald-50/20 dark:border-emerald-800/30 dark:bg-emerald-950/10 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <CreditCard className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        <span className="text-xs font-mono text-foreground truncate">
                          {p.invoiceNumber}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          ${formatCurrency(p.total)}
                        </span>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {p.paidAt ? formatDateTime(p.paidAt) : "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent cancellations */}
          <Card className="lg:col-span-2 border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                {t("billingRecentCancellations")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-9 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : !data?.recentCancellations?.length ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t("billingNoCancellations")}</p>
              ) : (
                <div className="space-y-1">
                  {data.recentCancellations.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded border border-red-200/50 bg-red-50/20 dark:border-red-800/30 dark:bg-red-950/10 text-sm"
                    >
                      <span className="text-xs font-mono text-foreground truncate flex-1 min-w-0">
                        {c.invoiceNumber}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                          ${formatCurrency(c.total)}
                        </span>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {formatDateTime(c.updatedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
