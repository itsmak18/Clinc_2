import { useState } from "react";
import { useGetAppointmentReport, useGetRevenueReport, useListLabTests, useListXrayImages, getGetAppointmentReportQueryKey, getGetRevenueReportQueryKey, getListLabTestsQueryKey, getListXrayImagesQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { formatCurrency, formatDate, exportToCSV } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Download } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  requested:   "#94a3b8",
  in_progress: "#f59e0b",
  completed:   "#14b8a6",
  cancelled:   "#ef4444",
  pending:     "#94a3b8",
  uploaded:    "#3b82f6",
  reviewed:    "#0d9488",
};

function daysAgoStr(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

export default function Reports() {
  const { t } = useI18n();
  const today = new Date().toISOString().split("T")[0];
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

  const apptParams    = { dateFrom, dateTo };
  const revenueParams = { dateFrom, dateTo };

  const { data: apptReport,    isLoading: loadingAppt    } = useGetAppointmentReport(apptParams,    { query: { queryKey: getGetAppointmentReportQueryKey(apptParams)    } });
  const { data: revenueReport, isLoading: loadingRevenue } = useGetRevenueReport(revenueParams,    { query: { queryKey: getGetRevenueReportQueryKey(revenueParams)    } });
  const { data: labTests  } = useListLabTests({},  { query: { queryKey: getListLabTestsQueryKey({})  } });
  const { data: xrays     } = useListXrayImages({}, { query: { queryKey: getListXrayImagesQueryKey({}) } });

  const labStatusCounts = (labTests ?? []).reduce<Record<string, number>>((acc, lab) => {
    acc[lab.status] = (acc[lab.status] ?? 0) + 1; return acc;
  }, {});
  const labStatusData = Object.entries(labStatusCounts).map(([status, count]) => ({ status, count }));

  const labTypeCounts = (labTests ?? []).reduce<Record<string, number>>((acc, lab) => {
    const name = lab.testName ?? "Unknown";
    acc[name] = (acc[name] ?? 0) + 1; return acc;
  }, {});
  const labTypeData = Object.entries(labTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

  const xrayStatusCounts = (xrays ?? []).reduce<Record<string, number>>((acc, x) => {
    acc[x.status] = (acc[x.status] ?? 0) + 1; return acc;
  }, {});
  const xrayStatusData = Object.entries(xrayStatusCounts).map(([status, count]) => ({ status, count }));

  const xrayBodyCounts = (xrays ?? []).reduce<Record<string, number>>((acc, x) => {
    const part = x.bodyPart ?? "Unknown";
    acc[part] = (acc[part] ?? 0) + 1; return acc;
  }, {});
  const xrayBodyData = Object.entries(xrayBodyCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([part, count]) => ({ part, count }));

  const tooltipStyle = { fontSize: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)" };
  const axisStyle    = { fontSize: 11, fill: "var(--ink-muted)" };

  return (
    <div className="page">
      {/* Date filters + presets */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div className="space-y-1">
          <Label className="text-xs">{t("dateFrom")}</Label>
          <Input type="date" className="h-8 text-sm w-36" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }} data-testid="input-date-from" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("dateTo")}</Label>
          <Input type="date" className="h-8 text-sm w-36" value={dateTo} onChange={e => { setDateTo(e.target.value); setActivePreset(null); }} data-testid="input-date-to" />
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
      </div>

      <Tabs defaultValue="appointments">
        <TabsList>
          <TabsTrigger value="appointments">{t("appointments")}</TabsTrigger>
          <TabsTrigger value="revenue">{t("revenue")}</TabsTrigger>
          <TabsTrigger value="diagnostics">{t("labAndXray")}</TabsTrigger>
        </TabsList>

        {/* ── Appointments Tab ── */}
        <TabsContent value="appointments" className="space-y-4 mt-4">
          {loadingAppt ? (
            <div className="h-40 bg-[var(--surface-2)] animate-pulse rounded-lg" />
          ) : apptReport ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: t("totalAppointments"), value: apptReport.totalAppointments },
                  { label: t("completed"),          value: apptReport.completed },
                  { label: t("cancellationRate"),   value: `${(apptReport.cancellationRate * 100).toFixed(1)}%` },
                  { label: t("avgWaitTime"),         value: `${apptReport.averageWaitTimeMinutes.toFixed(0)} min` },
                ].map((s, i) => (
                  <div key={i} className="card card-pad">
                    <p className="text-[11px] text-[var(--ink-muted)]">{s.label}</p>
                    <p className="text-xl font-bold mt-0.5 text-[var(--ink)]">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <button className="btn btn-outline btn-sm gap-1.5" onClick={() => exportToCSV(apptReport.byDoctor, `appointments-by-doctor-${today}.csv`)}>
                  <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
                </button>
              </div>
              <div className="card">
                <div className="card-pad border-b border-[var(--line)]">
                  <span className="font-semibold text-[var(--ink)] text-[14px]">{t("byDoctor")}</span>
                </div>
                <div className="card-pad">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={apptReport.byDoctor}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="doctorName" tick={axisStyle} />
                      <YAxis tick={axisStyle} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" fill="#14b8a6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : null}
        </TabsContent>

        {/* ── Revenue Tab ── */}
        <TabsContent value="revenue" className="space-y-4 mt-4">
          {loadingRevenue ? (
            <div className="h-40 bg-[var(--surface-2)] animate-pulse rounded-lg" />
          ) : revenueReport ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: t("totalRevenue"),         value: `$${formatCurrency(revenueReport.totalRevenue)}` },
                  { label: t("billingTotalInvoices"),  value: revenueReport.totalInvoices },
                  { label: t("paidInvoices"),          value: revenueReport.paidInvoices },
                  { label: t("avgInvoiceValue"),       value: `$${formatCurrency(revenueReport.averageInvoiceValue)}` },
                ].map((s, i) => (
                  <div key={i} className="card card-pad">
                    <p className="text-[11px] text-[var(--ink-muted)]">{s.label}</p>
                    <p className="text-xl font-bold mt-0.5 text-[var(--ink)]">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <button className="btn btn-outline btn-sm gap-1.5" onClick={() => exportToCSV(revenueReport.byDay.map(d => ({ date: formatDate(d.date), revenue: `$${formatCurrency(d.revenue)}` })), `revenue-${today}.csv`)}>
                  <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
                </button>
              </div>
              <div className="card">
                <div className="card-pad border-b border-[var(--line)]">
                  <span className="font-semibold text-[var(--ink)] text-[14px]">{t("dailyBreakdown")}</span>
                </div>
                <div className="card-pad">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={revenueReport.byDay}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="date" tick={axisStyle} tickFormatter={d => formatDate(d)} />
                      <YAxis tick={axisStyle} tickFormatter={v => `$${v}`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`$${formatCurrency(v)}`, t("revenue")]} />
                      <Bar dataKey="revenue" fill="#14b8a6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : null}
        </TabsContent>

        {/* ── Lab & X-Ray Tab ── */}
        <TabsContent value="diagnostics" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: t("totalLabTests"), value: labTests?.length ?? 0 },
              { label: t("labCompleted"),  value: labTests?.filter(l => l.status === "completed").length ?? 0 },
              { label: t("totalXrays"),    value: xrays?.length ?? 0 },
              { label: t("xraysReviewed"), value: xrays?.filter(x => x.status === "reviewed").length ?? 0 },
            ].map((s, i) => (
              <div key={i} className="card card-pad">
                <p className="text-[11px] text-[var(--ink-muted)]">{s.label}</p>
                <p className="text-xl font-bold mt-0.5 text-[var(--ink)]">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="card">
              <div className="card-pad border-b border-[var(--line)]">
                <span className="font-semibold text-[var(--ink)] text-[14px]">{t("labTestsByStatus")}</span>
              </div>
              <div className="card-pad">
                {labStatusData.length ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={labStatusData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {labStatusData.map(entry => <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-[var(--ink-muted)] text-center py-8">{t("noLabData")}</p>}
              </div>
            </div>

            <div className="card">
              <div className="card-pad border-b border-[var(--line)]">
                <span className="font-semibold text-[var(--ink)] text-[14px]">{t("xraysByStatus")}</span>
              </div>
              <div className="card-pad">
                {xrayStatusData.length ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={xrayStatusData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {xrayStatusData.map(entry => <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-[var(--ink-muted)] text-center py-8">{t("noXrayData")}</p>}
              </div>
            </div>

            <div className="card">
              <div className="card-pad border-b border-[var(--line)]">
                <span className="font-semibold text-[var(--ink)] text-[14px]">{t("topLabTestTypes")}</span>
              </div>
              <div className="card-pad">
                {labTypeData.length ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={labTypeData} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis type="number" tick={axisStyle} />
                      <YAxis type="category" dataKey="name" tick={axisStyle} width={100} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" fill="#14b8a6" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-[var(--ink-muted)] text-center py-8">{t("noLabData")}</p>}
              </div>
            </div>

            <div className="card">
              <div className="card-pad border-b border-[var(--line)]">
                <span className="font-semibold text-[var(--ink)] text-[14px]">{t("topXrayBodyParts")}</span>
              </div>
              <div className="card-pad">
                {xrayBodyData.length ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={xrayBodyData} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis type="number" tick={axisStyle} />
                      <YAxis type="category" dataKey="part" tick={axisStyle} width={100} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-[var(--ink-muted)] text-center py-8">{t("noXrayData")}</p>}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
