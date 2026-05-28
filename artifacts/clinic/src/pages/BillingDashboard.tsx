import {
  useGetBillingDashboard,
  getGetBillingDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import Metric from "@/components/Metric";
import { SkeletonMetric } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/api";
import {
  DollarSign, TrendingUp, BarChart3, AlertCircle, AlertTriangle,
  CreditCard, XCircle, RefreshCw,
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
            <Metric
              label={t("billingTodayRevenue")}
              value={`$${formatCurrency(data?.todayRevenue ?? 0)}`}
              tone="teal"
              icon={<DollarSign className="w-4 h-4" />}
            />
            <Metric
              label={t("billingWeekRevenue")}
              value={`$${formatCurrency(data?.weekRevenue ?? 0)}`}
              tone="sage"
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <Metric
              label={t("billingMonthRevenue")}
              value={`$${formatCurrency(data?.monthRevenue ?? 0)}`}
              tone="blue"
              icon={<BarChart3 className="w-4 h-4" />}
            />
            <Metric
              label={t("billingPendingAR")}
              value={`$${formatCurrency(data?.pendingSum ?? 0)}`}
              tone="amber"
              icon={<AlertCircle className="w-4 h-4" />}
            />
          </>
        )}
      </div>

      {/* Revenue trend chart */}
      <div className="card card-pad mb-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-[var(--teal-600)]" />
          <span className="font-semibold text-[var(--ink)] text-[14px]">{t("billingRevenueTrend")}</span>
        </div>
        {isLoading ? (
          <div className="h-40 bg-[var(--surface-2)] animate-pulse rounded" />
        ) : !data?.dailyRevenue?.length ? (
          <div className="h-40 flex items-center justify-center text-[13px] text-[var(--ink-muted)]">
            {t("dashboardNoData")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={data.dailyRevenue} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="billing-revenue-fill" x1="0" y1="0" x2="0" y2="1">
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
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
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
                formatter={(val: number) => [`$${formatCurrency(val)}`, t("billingRevenueTrendTooltip")]}
                labelFormatter={(label) => new Date(label).toLocaleDateString()}
              />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="var(--teal-500)"
                strokeWidth={2}
                fill="url(#billing-revenue-fill)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recent payments + cancellations */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Recent payments */}
        <div className="card card-pad lg:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-4 h-4 text-[var(--teal-600)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("billingRecentPayments")}</span>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-9 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : !data?.recentPayments?.length ? (
            <p className="text-[13px] text-[var(--ink-muted)] text-center py-6">{t("billingNoPayments")}</p>
          ) : (
            <div className="space-y-1">
              {data.recentPayments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg border border-[var(--teal-100)] bg-[var(--teal-50)] text-[13px]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CreditCard className="w-3.5 h-3.5 text-[var(--teal-600)] flex-shrink-0" />
                    <span className="text-[12px] font-mono text-[var(--ink)] truncate">
                      {p.invoiceNumber}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[12px] font-semibold text-[var(--teal-700)]">
                      ${formatCurrency(p.total)}
                    </span>
                    <span className="text-[10px] text-[var(--ink-faint)] whitespace-nowrap">
                      {p.paidAt ? formatDateTime(p.paidAt) : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent cancellations */}
        <div className="card card-pad lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <XCircle className="w-4 h-4 text-[var(--rose-500)]" />
            <span className="font-semibold text-[var(--ink)] text-[14px]">{t("billingRecentCancellations")}</span>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-9 bg-[var(--surface-2)] animate-pulse rounded" />
              ))}
            </div>
          ) : !data?.recentCancellations?.length ? (
            <p className="text-[13px] text-[var(--ink-muted)] text-center py-6">{t("billingNoCancellations")}</p>
          ) : (
            <div className="space-y-1">
              {data.recentCancellations.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-[var(--rose-100)] bg-[var(--rose-50)] text-[13px]"
                >
                  <span className="text-[12px] font-mono text-[var(--ink)] truncate flex-1 min-w-0">
                    {c.invoiceNumber}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[12px] font-semibold text-[var(--rose-600)]">
                      ${formatCurrency(c.total)}
                    </span>
                    <span className="text-[10px] text-[var(--ink-faint)] whitespace-nowrap">
                      {formatDateTime(c.updatedAt)}
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
