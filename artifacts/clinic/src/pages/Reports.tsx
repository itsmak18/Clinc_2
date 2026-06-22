import { useMemo, useState } from "react";
import {
  useGetAppointmentReport,
  useGetRevenueReport,
  useGetDiagnosticsReport,
  useGetOperationsReport,
  getGetAppointmentReportQueryKey,
  getGetRevenueReportQueryKey,
  getGetDiagnosticsReportQueryKey,
  getGetOperationsReportQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { formatCurrency, formatDate, exportToCSV } from "@/lib/api";
import { escapeHtml, openPrintWindow } from "@/lib/print";
import { cn } from "@/lib/utils";
import { Download, Printer, TrendingUp, TrendingDown, Minus } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  requested:   "#94a3b8",
  scheduled:   "#8b5cf6",
  in_progress: "#f59e0b",
  completed:   "#14b8a6",
  cancelled:   "#ef4444",
  pending:     "#94a3b8",
  uploaded:    "#3b82f6",
  reviewed:    "#0d9488",
};
// Generic categorical palette for appointment statuses (cycled by index).
const PALETTE = ["#14b8a6", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#10b981", "#ef4444", "#0d9488", "#64748b", "#eab308"];

/** YYYY-MM-DD in the browser's local timezone (NOT UTC) — matches the clinic's
 *  business day, so "Today" before ~03:00 local doesn't silently ask for yesterday. */
function localYmd(d = new Date()) {
  return d.toLocaleDateString("en-CA");
}
function daysAgoStr(n: number) {
  return localYmd(new Date(Date.now() - n * 86400000));
}

type DeltaDir = "up" | "down" | "flat";

/** Percentage change cur-vs-prev, with arrow by numeric direction and colour by
 *  whether that direction is good for this metric. */
function DeltaChip({ cur, prev, goodWhen = "up", t }: { cur: number; prev: number; goodWhen?: "up" | "down"; t: (k: string) => string }) {
  let dir: DeltaDir;
  let label: string;
  if (prev === 0) {
    dir = cur > 0 ? "up" : "flat";
    label = cur > 0 ? "—" : "—";
  } else {
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    dir = Math.abs(pct) < 0.5 ? "flat" : pct > 0 ? "up" : "down";
    label = `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
  }
  const good = dir === "flat" ? "flat" : dir === goodWhen ? "good" : "bad";
  const colors = {
    good: "text-[var(--teal-600)] bg-[var(--teal-50)]",
    bad:  "text-[var(--rose-500)] bg-[#fff0f0]",
    flat: "text-[var(--ink-muted)] bg-[var(--surface-2)]",
  } as const;
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded", colors[good])} title={t("vsPrevPeriod")}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}

function StatCard({ label, value, delta }: { label: string; value: string | number; delta?: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <p className="text-[11px] text-[var(--ink-muted)]">{label}</p>
      <div className="flex items-end justify-between gap-2 mt-0.5">
        <p className="text-xl font-bold text-[var(--ink)] tabular-nums">{value}</p>
        {delta}
      </div>
    </div>
  );
}

function ChartFrame({ title, ariaLabel, children }: { title: string; ariaLabel: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-pad border-b border-[var(--line)]">
        <span className="font-semibold text-[var(--ink)] text-[14px]">{title}</span>
      </div>
      <div className="card-pad" role="img" aria-label={ariaLabel}>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="text-sm text-[var(--ink-muted)] text-center py-12">{label}</p>;
}

export default function Reports() {
  const { t } = useI18n();
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = role === "super_admin" || role === "admin";
  const canAppts = isAdmin || role === "doctor";
  const canRevenue = isAdmin || role === "billing_manager";
  const canDiag = isAdmin || role === "doctor" || role === "billing_manager";
  const canOps = isAdmin;

  const today = localYmd();
  const [dateFrom, setDateFrom] = useState(daysAgoStr(30));
  const [dateTo, setDateTo]     = useState(today);
  const [activePreset, setActivePreset] = useState<number | null>(30);

  const PRESET_RANGES = [
    { label: t("today"),       days: 0   },
    { label: t("sevenDays"),   days: 7   },
    { label: t("thirtyDays"),  days: 30  },
    { label: t("threeMonths"), days: 90  },
    { label: t("oneYear"),     days: 365 },
  ];

  function applyPreset(days: number) {
    setDateFrom(days === 0 ? today : daysAgoStr(days));
    setDateTo(today);
    setActivePreset(days === 0 ? 0 : days);
  }

  // Period-over-period comparison is computed server-side and returned inline as
  // `previous` on each report (the immediately-preceding window of equal length).
  const apptParams = { dateFrom, dateTo };
  const revParams  = { dateFrom, dateTo };
  const diagParams = { dateFrom, dateTo };
  const opsParams  = { dateFrom, dateTo };

  const { data: apptReport,    isLoading: loadingAppt } = useGetAppointmentReport(apptParams, { query: { queryKey: getGetAppointmentReportQueryKey(apptParams), enabled: canAppts } });
  const { data: revenueReport, isLoading: loadingRev }  = useGetRevenueReport(revParams,      { query: { queryKey: getGetRevenueReportQueryKey(revParams),      enabled: canRevenue } });
  const { data: diagReport,    isLoading: loadingDiag } = useGetDiagnosticsReport(diagParams, { query: { queryKey: getGetDiagnosticsReportQueryKey(diagParams), enabled: canDiag } });
  const { data: opsReport,     isLoading: loadingOps }  = useGetOperationsReport(opsParams,   { query: { queryKey: getGetOperationsReportQueryKey(opsParams),  enabled: canOps } });

  const labStatusData = useMemo(() => (diagReport?.labByStatus ?? []).map(r => ({ status: r.status, name: t(r.status as any), count: r.count })), [diagReport, t]);
  const xrayStatusData = useMemo(() => (diagReport?.xrayByStatus ?? []).map(r => ({ status: r.status, name: t(r.status as any), count: r.count })), [diagReport, t]);
  const ultrasoundStatusData = useMemo(() => (diagReport?.ultrasoundByStatus ?? []).map(r => ({ status: r.status, name: t(r.status as any), count: r.count })), [diagReport, t]);
  const labTypeData = useMemo(() => (diagReport?.topLabTypes ?? []).map(r => ({ name: r.name, count: r.count })), [diagReport]);
  const xrayBodyData = useMemo(() => (diagReport?.topXrayBodyParts ?? []).map(r => ({ part: r.part, count: r.count })), [diagReport]);
  const ultrasoundTypeData = useMemo(() => (diagReport?.topUltrasoundExamTypes ?? []).map(r => ({ name: r.name, count: r.count })), [diagReport]);

  const opsStatusData = useMemo(() => (opsReport?.byStatus ?? []).map(r => ({ status: r.status, name: t(r.status as any), count: r.count })), [opsReport, t]);
  const opsStaffData = useMemo(() => (opsReport?.byStaff ?? []).map(r => ({ name: r.name, role: r.role, count: r.count })), [opsReport]);

  const tooltipStyle = { fontSize: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)" };
  const axisStyle    = { fontSize: 11, fill: "var(--ink-muted)" };

  const tabs: { value: string; label: string }[] = [
    canAppts  && { value: "appointments", label: t("appointments") },
    canRevenue && { value: "revenue",     label: t("revenue") },
    canDiag   && { value: "diagnostics",  label: t("labXrayUltrasound") },
    canOps    && { value: "operations",   label: t("operations") },
  ].filter(Boolean) as { value: string; label: string }[];

  function handlePrint() {
    const rows: string[] = [];
    const section = (title: string, body: string) => `<h2>${escapeHtml(title)}</h2>${body}`;
    const table = (headers: string[], data: (string | number)[][]) =>
      `<table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${
        data.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")
      }</tbody></table>`;

    if (canAppts && apptReport) {
      rows.push(section(t("appointments"), table(
        [t("totalAppointments"), t("completed"), t("noShows"), t("cancellationRate"), t("avgWaitTime")],
        [[apptReport.totalAppointments, apptReport.completed, apptReport.noShow, `${(apptReport.cancellationRate * 100).toFixed(1)}%`, `${apptReport.averageWaitTimeMinutes.toFixed(0)} min`]],
      )));
      rows.push(table([t("byDoctor"), ""], apptReport.byDoctor.map(d => [d.doctorName, d.count])));
    }
    if (canRevenue && revenueReport) {
      rows.push(section(t("revenue"), table(
        [t("totalRevenue"), t("billingTotalInvoices"), t("paidInvoices"), t("avgInvoiceValue")],
        [[`$${formatCurrency(revenueReport.totalRevenue)}`, revenueReport.totalInvoices, revenueReport.paidInvoices, `$${formatCurrency(revenueReport.averageInvoiceValue)}`]],
      )));
    }
    if (canDiag && diagReport) {
      rows.push(section(t("labXrayUltrasound"), table(
        [t("totalLabTests"), t("labCompleted"), t("totalXrays"), t("xraysReviewed"), t("totalUltrasounds"), t("ultrasoundsReviewed")],
        [[diagReport.totalLabTests, diagReport.labCompleted, diagReport.totalXrays, diagReport.xraysReviewed, diagReport.totalUltrasounds, diagReport.ultrasoundsReviewed]],
      )));
    }
    if (canOps && opsReport) {
      rows.push(section(t("operations"), table(
        [t("totalOperations"), t("completed"), t("operationsInProgress"), t("cancelled")],
        [[opsReport.totalOperations, opsReport.completed, opsReport.inProgress, opsReport.cancelled]],
      )));
      rows.push(table([t("surgeon"), t("operationsPerformed")], opsReport.bySurgeon.map(s => [s.surgeonName, s.performed])));
      rows.push(table([t("staffMember"), t("timesInOR")], opsReport.byStaff.map(s => [s.name, s.count])));
    }
    const html = `
      <style>
        body{font-family:system-ui,sans-serif;padding:24px;color:#1a1a1a}
        h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:20px 0 8px}
        .meta{color:#666;font-size:12px;margin-bottom:8px}
        table{border-collapse:collapse;width:100%;margin-bottom:12px;font-size:12px}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:start} th{background:#f5f5f5}
      </style>
      <h1>${escapeHtml(t("reports"))}</h1>
      <div class="meta">${escapeHtml(formatDate(dateFrom))} — ${escapeHtml(formatDate(dateTo))}</div>
      ${rows.join("")}`;
    openPrintWindow(html, `${t("reports")} ${dateFrom}_${dateTo}`);
  }

  return (
    <div className="page">
      {/* Date filters + presets + actions */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div className="space-y-1">
          <Label className="text-xs">{t("dateFrom")}</Label>
          <Input type="date" className="h-8 text-sm w-36" value={dateFrom} max={dateTo} onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }} data-testid="input-date-from" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("dateTo")}</Label>
          <Input type="date" className="h-8 text-sm w-36" value={dateTo} min={dateFrom} max={today} onChange={e => { setDateTo(e.target.value); setActivePreset(null); }} data-testid="input-date-to" />
        </div>
        <div className="flex gap-1.5 flex-wrap self-end">
          {PRESET_RANGES.map(p => (
            <button
              key={p.days}
              className={cn("btn btn-sm h-8 text-xs px-3", activePreset === p.days ? "btn-primary" : "btn-outline")}
              onClick={() => applyPreset(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button className="btn btn-outline btn-sm gap-1.5 self-end ms-auto" onClick={handlePrint}>
          <Printer className="w-3.5 h-3.5" /> {t("printReport")}
        </button>
      </div>

      <Tabs defaultValue={tabs[0]?.value}>
        <TabsList>
          {tabs.map(tb => <TabsTrigger key={tb.value} value={tb.value}>{tb.label}</TabsTrigger>)}
        </TabsList>

        {/* ── Appointments Tab ── */}
        {canAppts && (
        <TabsContent value="appointments" className="space-y-4 mt-4">
          {loadingAppt ? (
            <div className="h-40 bg-[var(--surface-2)] animate-pulse rounded-lg" />
          ) : apptReport && apptReport.totalAppointments > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label={t("totalAppointments")} value={apptReport.totalAppointments}
                  delta={<DeltaChip cur={apptReport.totalAppointments} prev={apptReport.previous.totalAppointments} t={t} />} />
                <StatCard label={t("completed")} value={apptReport.completed}
                  delta={<DeltaChip cur={apptReport.completed} prev={apptReport.previous.completed} t={t} />} />
                <StatCard label={t("cancellationRate")} value={`${(apptReport.cancellationRate * 100).toFixed(1)}%`}
                  delta={<DeltaChip cur={apptReport.cancellationRate} prev={apptReport.previous.cancellationRate} goodWhen="down" t={t} />} />
                <StatCard label={t("avgWaitTime")} value={`${apptReport.averageWaitTimeMinutes.toFixed(0)} min`} />
              </div>
              <div className="flex justify-end">
                <button className="btn btn-outline btn-sm gap-1.5" onClick={() => exportToCSV([
                  { metric: t("totalAppointments"), value: apptReport.totalAppointments },
                  { metric: t("completed"),         value: apptReport.completed },
                  { metric: t("noShows"),           value: apptReport.noShow },
                  { metric: t("cancellationRate"),  value: `${(apptReport.cancellationRate * 100).toFixed(1)}%` },
                  { metric: t("noShowRate"),        value: `${(apptReport.noShowRate * 100).toFixed(1)}%` },
                  { metric: t("avgWaitTime"),       value: `${apptReport.averageWaitTimeMinutes.toFixed(0)} min` },
                  ...apptReport.byDoctor.map(d => ({ metric: d.doctorName, value: d.count })),
                ], `appointments-${today}.csv`)}>
                  <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
                </button>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <ChartFrame title={t("byDoctor")} ariaLabel={`${t("byDoctor")}: ${apptReport.byDoctor.map(d => `${d.doctorName} ${d.count}`).join(", ")}`}>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={apptReport.byDoctor}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="doctorName" tick={axisStyle} />
                      <YAxis tick={axisStyle} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" fill="#14b8a6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartFrame>

                <ChartFrame title={t("appointmentsByStatus")} ariaLabel={`${t("appointmentsByStatus")}: ${apptReport.byStatus.map(s => `${t(s.status as any)} ${s.count}`).join(", ")}`}>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={apptReport.byStatus.map(s => ({ ...s, name: t(s.status as any) }))} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                        {apptReport.byStatus.map((s, i) => <Cell key={s.status} fill={PALETTE[i % PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartFrame>
              </div>

              <ChartFrame title={t("appointmentsTrend")} ariaLabel={`${t("appointmentsTrend")}: ${apptReport.totalAppointments}`}>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={apptReport.byDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="date" tick={axisStyle} tickFormatter={d => formatDate(d)} minTickGap={24} />
                    <YAxis tick={axisStyle} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={d => formatDate(d as string)} />
                    <Line type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
            </>
          ) : <EmptyState label={t("noDataForRange")} />}
        </TabsContent>
        )}

        {/* ── Revenue Tab ── */}
        {canRevenue && (
        <TabsContent value="revenue" className="space-y-4 mt-4">
          {loadingRev ? (
            <div className="h-40 bg-[var(--surface-2)] animate-pulse rounded-lg" />
          ) : revenueReport && revenueReport.totalInvoices > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label={t("totalRevenue")} value={`$${formatCurrency(revenueReport.totalRevenue)}`}
                  delta={<DeltaChip cur={revenueReport.totalRevenue} prev={revenueReport.previous.totalRevenue} t={t} />} />
                <StatCard label={t("paidInvoices")} value={revenueReport.paidInvoices}
                  delta={<DeltaChip cur={revenueReport.paidInvoices} prev={revenueReport.previous.paidInvoices} t={t} />} />
                <StatCard label={t("collectionRate")} value={`${(revenueReport.collectionRate * 100).toFixed(1)}%`}
                  delta={<DeltaChip cur={revenueReport.collectionRate} prev={revenueReport.previous.collectionRate} t={t} />} />
                <StatCard label={t("avgInvoiceValue")} value={`$${formatCurrency(revenueReport.averageInvoiceValue)}`} />
              </div>
              <div className="flex justify-end">
                <button className="btn btn-outline btn-sm gap-1.5" onClick={() => exportToCSV(revenueReport.byDay.map(d => ({ date: formatDate(d.date), revenue: `$${formatCurrency(d.revenue)}`, invoices: d.invoices })), `revenue-${today}.csv`)}>
                  <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
                </button>
              </div>
              <ChartFrame title={t("dailyBreakdown")} ariaLabel={`${t("dailyBreakdown")}: ${t("totalRevenue")} $${formatCurrency(revenueReport.totalRevenue)}`}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={revenueReport.byDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="date" tick={axisStyle} tickFormatter={d => formatDate(d)} />
                    <YAxis tick={axisStyle} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`$${formatCurrency(v)}`, t("revenue")]} labelFormatter={d => formatDate(d)} />
                    <Bar dataKey="revenue" fill="#14b8a6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
              {revenueReport.topServices.length > 0 && (
                <ChartFrame title={t("topServices")} ariaLabel={`${t("topServices")}: ${revenueReport.topServices.map(s => `${s.name} $${formatCurrency(s.revenue)}`).join(", ")}`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[var(--ink-muted)] text-[11px] border-b border-[var(--line)]">
                        <th className="text-start font-medium pb-1.5">{t("description")}</th>
                        <th className="text-end font-medium pb-1.5">{t("quantity")}</th>
                        <th className="text-end font-medium pb-1.5">{t("revenue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revenueReport.topServices.map((s, i) => (
                        <tr key={i} className="border-b border-[var(--line)] last:border-0">
                          <td className="py-1.5 text-[var(--ink)]">{s.name}</td>
                          <td className="py-1.5 text-end tabular-nums text-[var(--ink-soft)]">{s.count}</td>
                          <td className="py-1.5 text-end tabular-nums text-[var(--ink)]">${formatCurrency(s.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ChartFrame>
              )}
            </>
          ) : <EmptyState label={t("noDataForRange")} />}
        </TabsContent>
        )}

        {/* ── Lab & X-Ray Tab ── */}
        {canDiag && (
        <TabsContent value="diagnostics" className="space-y-4 mt-4">
          {loadingDiag ? (
            <div className="h-40 bg-[var(--surface-2)] animate-pulse rounded-lg" />
          ) : diagReport ? (
          <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label={t("totalLabTests")}      value={diagReport.totalLabTests} />
            <StatCard label={t("labCompleted")}       value={diagReport.labCompleted} />
            <StatCard label={t("totalXrays")}         value={diagReport.totalXrays} />
            <StatCard label={t("xraysReviewed")}      value={diagReport.xraysReviewed} />
            <StatCard label={t("totalUltrasounds")}   value={diagReport.totalUltrasounds} />
            <StatCard label={t("ultrasoundsReviewed")} value={diagReport.ultrasoundsReviewed} />
          </div>

          <div className="flex justify-end">
            <button className="btn btn-outline btn-sm gap-1.5" onClick={() => exportToCSV([
              ...labStatusData.map(r => ({ category: "lab_status", key: r.status, count: r.count })),
              ...labTypeData.map(r => ({ category: "lab_type", key: r.name, count: r.count })),
              ...xrayStatusData.map(r => ({ category: "xray_status", key: r.status, count: r.count })),
              ...xrayBodyData.map(r => ({ category: "xray_body_part", key: r.part, count: r.count })),
              ...ultrasoundStatusData.map(r => ({ category: "ultrasound_status", key: r.status, count: r.count })),
              ...ultrasoundTypeData.map(r => ({ category: "ultrasound_type", key: r.name, count: r.count })),
            ], `diagnostics-${today}.csv`)}>
              <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartFrame title={t("labTestsByStatus")} ariaLabel={`${t("labTestsByStatus")}: ${labStatusData.map(d => `${d.status} ${d.count}`).join(", ") || t("noLabData")}`}>
              {labStatusData.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={labStatusData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                      {labStatusData.map(entry => <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyState label={t("noLabData")} />}
            </ChartFrame>

            <ChartFrame title={t("xraysByStatus")} ariaLabel={`${t("xraysByStatus")}: ${xrayStatusData.map(d => `${d.status} ${d.count}`).join(", ") || t("noXrayData")}`}>
              {xrayStatusData.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={xrayStatusData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                      {xrayStatusData.map(entry => <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyState label={t("noXrayData")} />}
            </ChartFrame>

            <ChartFrame title={t("topLabTestTypes")} ariaLabel={`${t("topLabTestTypes")}: ${labTypeData.map(d => `${d.name} ${d.count}`).join(", ") || t("noLabData")}`}>
              {labTypeData.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={labTypeData} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis type="number" tick={axisStyle} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={axisStyle} width={100} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" fill="#14b8a6" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState label={t("noLabData")} />}
            </ChartFrame>

            <ChartFrame title={t("topXrayBodyParts")} ariaLabel={`${t("topXrayBodyParts")}: ${xrayBodyData.map(d => `${d.part} ${d.count}`).join(", ") || t("noXrayData")}`}>
              {xrayBodyData.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={xrayBodyData} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis type="number" tick={axisStyle} allowDecimals={false} />
                    <YAxis type="category" dataKey="part" tick={axisStyle} width={100} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState label={t("noXrayData")} />}
            </ChartFrame>

            <ChartFrame title={t("ultrasoundsByStatus")} ariaLabel={`${t("ultrasoundsByStatus")}: ${ultrasoundStatusData.map(d => `${d.status} ${d.count}`).join(", ") || t("noUltrasoundData")}`}>
              {ultrasoundStatusData.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={ultrasoundStatusData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                      {ultrasoundStatusData.map(entry => <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyState label={t("noUltrasoundData")} />}
            </ChartFrame>

            <ChartFrame title={t("topUltrasoundExamTypes")} ariaLabel={`${t("topUltrasoundExamTypes")}: ${ultrasoundTypeData.map(d => `${d.name} ${d.count}`).join(", ") || t("noUltrasoundData")}`}>
              {ultrasoundTypeData.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ultrasoundTypeData} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis type="number" tick={axisStyle} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={axisStyle} width={100} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState label={t("noUltrasoundData")} />}
            </ChartFrame>
          </div>
          </>
          ) : <EmptyState label={t("noDataForRange")} />}
        </TabsContent>
        )}

        {/* ── Operations Tab ── */}
        {canOps && (
        <TabsContent value="operations" className="space-y-4 mt-4">
          {loadingOps ? (
            <div className="h-40 bg-[var(--surface-2)] animate-pulse rounded-lg" />
          ) : opsReport && opsReport.totalOperations > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label={t("totalOperations")}      value={opsReport.totalOperations} />
                <StatCard label={t("completed")}            value={opsReport.completed} />
                <StatCard label={t("operationsInProgress")} value={opsReport.inProgress} />
                <StatCard label={t("cancelled")}            value={opsReport.cancelled} />
              </div>

              <div className="flex justify-end">
                <button className="btn btn-outline btn-sm gap-1.5" onClick={() => exportToCSV([
                  ...opsReport.bySurgeon.map(s => ({ category: "surgeon", key: s.surgeonName, performed: s.performed, total: s.total })),
                  ...opsReport.byStaff.map(s => ({ category: "or_team", key: s.name, performed: s.count, total: s.count })),
                  ...opsReport.byProcedure.map(p => ({ category: "procedure", key: p.name, performed: p.count, total: p.count })),
                ], `operations-${today}.csv`)}>
                  <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <ChartFrame title={t("bySurgeon")} ariaLabel={`${t("bySurgeon")}: ${opsReport.bySurgeon.map(s => `${s.surgeonName} ${s.performed}`).join(", ") || t("noDataForRange")}`}>
                  {opsReport.bySurgeon.length ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={opsReport.bySurgeon} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                        <XAxis type="number" tick={axisStyle} allowDecimals={false} />
                        <YAxis type="category" dataKey="surgeonName" tick={axisStyle} width={110} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("operationsPerformed")]} />
                        <Bar dataKey="performed" fill="#14b8a6" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState label={t("noDataForRange")} />}
                </ChartFrame>

                <ChartFrame title={t("operationsByStatus")} ariaLabel={`${t("operationsByStatus")}: ${opsStatusData.map(d => `${d.status} ${d.count}`).join(", ") || t("noDataForRange")}`}>
                  {opsStatusData.length ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={opsStatusData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                          {opsStatusData.map(entry => <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <EmptyState label={t("noDataForRange")} />}
                </ChartFrame>

                <ChartFrame title={t("orTeamParticipation")} ariaLabel={`${t("orTeamParticipation")}: ${opsStaffData.map(d => `${d.name} ${d.count}`).join(", ") || t("noDataForRange")}`}>
                  {opsStaffData.length ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={opsStaffData} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                        <XAxis type="number" tick={axisStyle} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" tick={axisStyle} width={110} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("timesInOR")]} />
                        <Bar dataKey="count" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState label={t("noDataForRange")} />}
                </ChartFrame>

                <ChartFrame title={t("topProcedures")} ariaLabel={`${t("topProcedures")}: ${opsReport.byProcedure.map(p => `${p.name} ${p.count}`).join(", ") || t("noDataForRange")}`}>
                  {opsReport.byProcedure.length ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={opsReport.byProcedure} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                        <XAxis type="number" tick={axisStyle} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" tick={axisStyle} width={110} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState label={t("noDataForRange")} />}
                </ChartFrame>
              </div>

              {/* OR-team detail table — staff member, their role, and times in OR. */}
              {opsStaffData.length > 0 && (
                <ChartFrame title={t("orTeamParticipation")} ariaLabel={`${t("orTeamParticipation")}: ${opsStaffData.map(d => `${d.name} ${d.count}`).join(", ")}`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[var(--ink-muted)] text-[11px] border-b border-[var(--line)]">
                        <th className="text-start font-medium pb-1.5">{t("staffMember")}</th>
                        <th className="text-start font-medium pb-1.5">{t("role")}</th>
                        <th className="text-end font-medium pb-1.5">{t("timesInOR")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opsStaffData.map((s, i) => (
                        <tr key={i} className="border-b border-[var(--line)] last:border-0">
                          <td className="py-1.5 text-[var(--ink)]">{s.name}</td>
                          <td className="py-1.5 text-[var(--ink-soft)] capitalize">{s.role ? t(s.role as any) : "—"}</td>
                          <td className="py-1.5 text-end tabular-nums text-[var(--ink)]">{s.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ChartFrame>
              )}

              <ChartFrame title={t("operationsTrend")} ariaLabel={`${t("operationsTrend")}: ${opsReport.totalOperations}`}>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={opsReport.byDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="date" tick={axisStyle} tickFormatter={d => formatDate(d)} minTickGap={24} />
                    <YAxis tick={axisStyle} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={d => formatDate(d as string)} />
                    <Line type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
            </>
          ) : <EmptyState label={t("noDataForRange")} />}
        </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
