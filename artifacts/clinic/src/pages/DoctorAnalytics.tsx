import { useState } from "react";
import {
  useGetDoctorAnalytics, getGetDoctorAnalyticsQueryKey,
  useListDoctorAnalytics, getListDoctorAnalyticsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/auth";
import { useI18n } from "@/hooks/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Users, Clock, DollarSign, ClipboardList, UserX, XCircle } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }
function min(n: number) { return `${n.toFixed(1)}`; }
function cur(n: number) { return `$${n.toFixed(0)}`; }
function rate(n: number) { return n.toFixed(2); }

type DeltaDir = "up" | "down" | "flat";

function delta(val: number, avg: number, higherIsBetter = true): DeltaDir {
  if (Math.abs(val - avg) < 0.001) return "flat";
  const better = val > avg;
  return (better === higherIsBetter) ? "up" : "down";
}

function DeltaChip({ dir, label }: { dir: DeltaDir; label: string }) {
  const colors = {
    up:   "text-[var(--teal-600)] bg-[var(--teal-50)]",
    down: "text-[var(--rose-500)] bg-[#fff0f0]",
    flat: "text-[var(--ink-muted)] bg-[var(--surface-2)]",
  };
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${colors[dir]}`}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  avgLabel: string;
  dir: DeltaDir;
  sub?: string;
}

function MetricCard({ icon, label, value, avgLabel, dir, sub }: MetricCardProps) {
  return (
    <div className="card card-pad flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2 text-[var(--ink-muted)]">
        <span className="text-[var(--teal-600)]">{icon}</span>
        <span className="text-xs font-medium truncate">{label}</span>
      </div>
      <div className="text-2xl font-bold text-[var(--ink)] tabular-nums">{value}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <DeltaChip dir={dir} label={avgLabel} />
        {sub && <span className="text-[11px] text-[var(--ink-muted)]">{sub}</span>}
      </div>
    </div>
  );
}

// ─── Doctor KPI view ─────────────────────────────────────────────────────────

function DoctorView({ doctorId, dateFrom, dateTo }: { doctorId: number; dateFrom?: string; dateTo?: string }) {
  const { t } = useI18n();
  const params = { dateFrom, dateTo };

  const { data, isLoading, isError } = useGetDoctorAnalytics(doctorId, params, {
    query: { queryKey: getGetDoctorAnalyticsQueryKey(doctorId, params) },
  });

  if (isLoading) return <div className="text-sm text-[var(--ink-muted)]">{t("loading")}</div>;
  if (isError || !data) return <div className="text-sm text-[var(--rose-500)]">{t("noAnalyticsData")}</div>;

  const d = data.doctor;
  const avg = data.clinicAverage;

  const metrics: MetricCardProps[] = [
    {
      icon: <Users className="w-4 h-4" />,
      label: t("patientVolume"),
      value: String(d.completedAppointments),
      avgLabel: `${t("clinicAverage")}: ${avg.completedAppointments}`,
      dir: delta(d.completedAppointments, avg.completedAppointments, true),
      sub: `${d.totalAppointments} ${t("totalAppointments")}`,
    },
    {
      icon: <UserX className="w-4 h-4" />,
      label: t("noShowRate"),
      value: pct(d.noShowRate),
      avgLabel: `${t("clinicAverage")}: ${pct(avg.noShowRate)}`,
      dir: delta(d.noShowRate, avg.noShowRate, false),
      sub: `${d.noShowCount} ${t("noShows")}`,
    },
    {
      icon: <Clock className="w-4 h-4" />,
      label: t("avgConsultTime"),
      value: `${min(d.avgConsultMinutes)} ${t("minutes")}`,
      avgLabel: `${t("clinicAverage")}: ${min(avg.avgConsultMinutes)} ${t("minutes")}`,
      dir: "flat",
    },
    {
      icon: <DollarSign className="w-4 h-4" />,
      label: t("revenueGenerated"),
      value: cur(d.revenueGenerated),
      avgLabel: `${t("clinicAverage")}: ${cur(avg.revenueGenerated)}`,
      dir: delta(d.revenueGenerated, avg.revenueGenerated, true),
    },
    {
      icon: <ClipboardList className="w-4 h-4" />,
      label: t("orderRate"),
      value: `${rate(d.orderRate)} ${t("ordersPerVisit")}`,
      avgLabel: `${t("clinicAverage")}: ${rate(avg.orderRate)}`,
      dir: delta(d.orderRate, avg.orderRate, true),
      sub: `${d.labOrders} ${t("labOrders")} · ${d.xrayOrders} ${t("xrayOrders")}`,
    },
    {
      icon: <XCircle className="w-4 h-4" />,
      label: t("cancellationRate"),
      value: pct(d.cancellationRate),
      avgLabel: `${t("clinicAverage")}: ${pct(avg.cancellationRate)}`,
      dir: delta(d.cancellationRate, avg.cancellationRate, false),
      sub: `${d.cancelledCount} ${t("cancelled")}`,
    },
  ];

  const trendData = (data.trend ?? []).map((pt: any) => ({
    month: pt.month,
    completed: pt.completedAppointments,
    noShows: pt.noShowCount,
    revenue: Math.round(pt.revenueGenerated),
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map(m => <MetricCard key={m.label} {...m} />)}
      </div>

      {trendData.length > 0 && (
        <div className="card card-pad">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">{t("monthlyTrend")}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="completed" name={t("completedAppointments")} stroke="var(--teal-600)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="noShows" name={t("noShows")} stroke="var(--rose-500)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Admin leaderboard ───────────────────────────────────────────────────────

function AdminView({ dateFrom, dateTo }: { dateFrom?: string; dateTo?: string }) {
  const { t } = useI18n();
  const params = { dateFrom, dateTo };

  const { data, isLoading, isError } = useListDoctorAnalytics(params, {
    query: { queryKey: getListDoctorAnalyticsQueryKey(params) },
  });

  if (isLoading) return <div className="text-sm text-[var(--ink-muted)]">{t("loading")}</div>;
  if (isError || !data) return <div className="text-sm text-[var(--rose-500)]">{t("noAnalyticsData")}</div>;

  const maxCompleted = Math.max(1, ...data.doctors.map((d: any) => d.kpis.completedAppointments));

  return (
    <div className="space-y-6">
      {/* Clinic-average row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t("patientVolume"),   value: String(data.clinicAverage.completedAppointments) },
          { label: t("noShowRate"),       value: pct(data.clinicAverage.noShowRate) },
          { label: t("avgConsultTime"),   value: `${min(data.clinicAverage.avgConsultMinutes)} ${t("minutes")}` },
          { label: t("revenueGenerated"), value: cur(data.clinicAverage.revenueGenerated) },
        ].map(m => (
          <div key={m.label} className="card card-pad">
            <div className="text-xs text-[var(--ink-muted)] mb-1">{m.label} · {t("clinicAverage")}</div>
            <div className="text-xl font-bold text-[var(--ink)] tabular-nums">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Leaderboard */}
      <div className="card card-pad">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">{t("leaderboard")} — {t("completedAppointments")}</h3>
        <div className="space-y-3">
          {data.doctors.map((row: any, i: number) => {
            const barPct = Math.round((row.kpis.completedAppointments / maxCompleted) * 100);
            return (
              <div key={row.doctorId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-[var(--ink)]">
                    <span className="text-[var(--ink-muted)] me-2 tabular-nums text-xs">#{i + 1}</span>
                    {row.doctorName}
                  </span>
                  <span className="tabular-nums text-[var(--ink-muted)] text-xs">
                    {row.kpis.completedAppointments} · {cur(row.kpis.revenueGenerated)} · {pct(row.kpis.noShowRate)} {t("noShowRate")}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--surface-2)]">
                  <div
                    className="h-1.5 rounded-full bg-[var(--teal-600)]"
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {data.doctors.length === 0 && (
            <p className="text-sm text-[var(--ink-muted)] text-center py-4">{t("noAnalyticsData")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DoctorAnalytics() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdminView = user?.role === "super_admin" || user?.role === "admin";

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo]     = useState(today);

  return (
    <div className="page space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-semibold text-[var(--ink)] me-auto">{t("doctorPerformance")}</h1>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-[var(--ink-muted)] hidden sm:block">{t("dateFrom")}</Label>
          <Input
            type="date"
            className="h-8 text-sm w-36"
            value={dateFrom}
            max={dateTo}
            onChange={e => setDateFrom(e.target.value)}
          />
          <Label className="text-xs text-[var(--ink-muted)] hidden sm:block">{t("dateTo")}</Label>
          <Input
            type="date"
            className="h-8 text-sm w-36"
            value={dateTo}
            min={dateFrom}
            max={today}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {isAdminView ? (
        <AdminView dateFrom={dateFrom} dateTo={dateTo} />
      ) : (
        user?.id && (
          <DoctorView doctorId={user.id} dateFrom={dateFrom} dateTo={dateTo} />
        )
      )}
    </div>
  );
}
