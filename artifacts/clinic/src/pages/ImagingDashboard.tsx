import {
  useGetImagingDashboard,
  getGetImagingDashboardQueryKey,
  useGetLabDashboard,
  getGetLabDashboardQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, CheckCircle2, Clock,
  BarChart3, Upload, Eye,
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
    { label: t("imagingDashPending"),  count: data?.firstCount  ?? 0, color: "bg-amber-400",   icon: <Clock   className="w-4 h-4 text-amber-500" /> },
    { label: t("imagingDashUploaded"), count: data?.secondCount ?? 0, color: "bg-blue-400",    icon: <Upload  className="w-4 h-4 text-blue-500"  /> },
    { label: t("imagingDashReviewed"), count: data?.thirdCount  ?? 0, color: "bg-emerald-500", icon: <Eye     className="w-4 h-4 text-emerald-500" /> },
  ];

  const total = (data?.firstCount ?? 0) + (data?.secondCount ?? 0) + (data?.thirdCount ?? 0);

  return (
    <ImagingView
      title={t("imagingDashXrayTitle")}
      subtitle={t("imagingDashXraySubtitle")}
      data={data}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      statusRows={statusRows}
      total={total}
    />
  );
}

function LabView() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useGetLabDashboard({
    query: { queryKey: getGetLabDashboardQueryKey(), refetchInterval: 30000 },
  });

  const statusRows = [
    { label: t("imagingDashRequested"),  count: data?.firstCount  ?? 0, color: "bg-amber-400",   icon: <Activity className="w-4 h-4 text-amber-500"   /> },
    { label: t("imagingDashInProgress"), count: data?.secondCount ?? 0, color: "bg-blue-400",    icon: <Clock    className="w-4 h-4 text-blue-500"     /> },
    { label: t("imagingDashCompleted"),  count: data?.thirdCount  ?? 0, color: "bg-emerald-500", icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" /> },
  ];

  const total = (data?.firstCount ?? 0) + (data?.secondCount ?? 0) + (data?.thirdCount ?? 0);

  return (
    <ImagingView
      title={t("imagingDashLabTitle")}
      subtitle={t("imagingDashLabSubtitle")}
      data={data}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      statusRows={statusRows}
      total={total}
    />
  );
}

interface StatusRow {
  label: string;
  count: number;
  color: string;
  icon: React.ReactNode;
}

interface ImagingViewProps {
  title: string;
  subtitle: string;
  data: { firstCount: number; secondCount: number; thirdCount: number; todayCount: number; weekCount: number; recentItems: { id: number; patientId: number; status: string; createdAt: string }[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  statusRows: StatusRow[];
  total: number;
}

function ImagingView({ title, subtitle, data, isLoading, isError, refetch, statusRows, total }: ImagingViewProps) {
  const { t } = useI18n();

  if (isError) {
    return (
      <div>
        <PageHeader title={title} subtitle={subtitle} />
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

  const pendingHighlight = (data?.firstCount ?? 0) > 0;

  const statCards = [
    {
      label: statusRows[0].label,
      value: data?.firstCount ?? 0,
      icon: statusRows[0].icon,
      highlight: pendingHighlight,
    },
    {
      label: statusRows[1].label,
      value: data?.secondCount ?? 0,
      icon: statusRows[1].icon,
      highlight: false,
    },
    {
      label: statusRows[2].label,
      value: data?.thirdCount ?? 0,
      icon: statusRows[2].icon,
      highlight: false,
    },
    {
      label: t("imagingDashTodayVolume"),
      value: data?.todayCount ?? 0,
      icon: <Activity className="w-5 h-5 text-primary" />,
      highlight: false,
      sublabel: `${data?.weekCount ?? 0} ${t("imagingDashWeekVolume")}`,
    },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={
          pendingHighlight
            ? <Badge variant="destructive" className="text-xs">{data?.firstCount} {statusRows[0].label}</Badge>
            : subtitle
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
                    {"sublabel" in card && card.sublabel && (
                      <p className="text-[11px] text-muted-foreground mt-1.5">{card.sublabel}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0">{card.icon}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Status breakdown + Recent items */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Status breakdown */}
          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                {t("imagingDashStatusBreakdown")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {statusRows.map((row) => {
                    const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                    return (
                      <div key={row.label} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {row.icon}
                            <span className="text-xs font-medium text-foreground">{row.label}</span>
                          </div>
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

          {/* Recent items */}
          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                {t("imagingDashRecentItems")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-9 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : !data?.recentItems?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t("imagingDashNoItems")}</p>
              ) : (
                <div className="space-y-2">
                  {data.recentItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">#{item.id}</span>
                        <span className="text-xs text-foreground">Patient #{item.patientId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusChip status={item.status} />
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(item.createdAt).toLocaleDateString()}
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

function StatusChip({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending:     "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    uploaded:    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
    reviewed:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    requested:   "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
    completed:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    cancelled:   "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  };
  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded capitalize", colorMap[status] ?? "bg-muted text-muted-foreground")}>
      {status.replace("_", " ")}
    </span>
  );
}

export default function ImagingDashboard({ domain }: ImagingDashboardProps) {
  if (domain === "xray") return <XrayView />;
  return <LabView />;
}
