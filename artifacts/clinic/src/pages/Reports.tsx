import { useState } from "react";
import { useGetAppointmentReport, useGetRevenueReport, useListLabTests, useListXrayImages, getGetAppointmentReportQueryKey, getGetRevenueReportQueryKey, getListLabTestsQueryKey, getListXrayImagesQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { formatCurrency, formatDate } from "@/lib/api";
import { exportToCSV } from "@/lib/api";
import { Download } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  requested:   "#94a3b8",
  in_progress: "#f59e0b",
  completed:   "#22c55e",
  cancelled:   "#ef4444",
  pending:     "#94a3b8",
  uploaded:    "#3b82f6",
  reviewed:    "#8b5cf6",
};

const PRESET_RANGES = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "3 months", days: 90 },
  { label: "1 year", days: 365 },
];

function daysAgoStr(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

export default function Reports() {
  const { t } = useI18n();
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(daysAgoStr(30));
  const [dateTo, setDateTo] = useState(today);
  const [activePreset, setActivePreset] = useState<number | null>(30);

  function applyPreset(days: number) {
    setDateFrom(days === 0 ? today : daysAgoStr(days));
    setDateTo(today);
    setActivePreset(days === 0 ? 0 : days);
  }

  const apptParams = { dateFrom, dateTo };
  const revenueParams = { dateFrom, dateTo };

  const { data: apptReport, isLoading: loadingAppt } = useGetAppointmentReport(apptParams, { query: { queryKey: getGetAppointmentReportQueryKey(apptParams) } });
  const { data: revenueReport, isLoading: loadingRevenue } = useGetRevenueReport(revenueParams, { query: { queryKey: getGetRevenueReportQueryKey(revenueParams) } });
  const { data: labTests } = useListLabTests({}, { query: { queryKey: getListLabTestsQueryKey({}) } });
  const { data: xrays } = useListXrayImages({}, { query: { queryKey: getListXrayImagesQueryKey({}) } });

  // Lab analytics
  const labStatusCounts = (labTests ?? []).reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1; return acc;
  }, {});
  const labStatusData = Object.entries(labStatusCounts).map(([status, count]) => ({ status, count }));

  const labTypeCounts = (labTests ?? []).reduce<Record<string, number>>((acc, t) => {
    const name = t.testName ?? "Unknown";
    acc[name] = (acc[name] ?? 0) + 1; return acc;
  }, {});
  const labTypeData = Object.entries(labTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // XRay analytics
  const xrayStatusCounts = (xrays ?? []).reduce<Record<string, number>>((acc, x) => {
    acc[x.status] = (acc[x.status] ?? 0) + 1; return acc;
  }, {});
  const xrayStatusData = Object.entries(xrayStatusCounts).map(([status, count]) => ({ status, count }));

  const xrayBodyCounts = (xrays ?? []).reduce<Record<string, number>>((acc, x) => {
    const part = x.bodyPart ?? "Unknown";
    acc[part] = (acc[part] ?? 0) + 1; return acc;
  }, {});
  const xrayBodyData = Object.entries(xrayBodyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([part, count]) => ({ part, count }));

  return (
    <div>
      <PageHeader title={t("reports")} subtitle="Analytics & performance insights" />
      <div className="p-6 space-y-4">

        {/* Date filters + presets */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">{t("dateFrom")}</Label>
            <Input type="date" className="h-8 text-sm w-36" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }} data-testid="input-date-from" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("dateTo")}</Label>
            <Input type="date" className="h-8 text-sm w-36" value={dateTo} onChange={e => { setDateTo(e.target.value); setActivePreset(null); }} data-testid="input-date-to" />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_RANGES.map(p => (
              <Button
                key={p.days}
                size="sm"
                variant={activePreset === p.days ? "default" : "outline"}
                className="h-8 text-xs px-3"
                onClick={() => applyPreset(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <Tabs defaultValue="appointments">
          <TabsList>
            <TabsTrigger value="appointments">{t("appointments")}</TabsTrigger>
            <TabsTrigger value="revenue">{t("revenue")}</TabsTrigger>
            <TabsTrigger value="diagnostics">Lab & X-Ray</TabsTrigger>
          </TabsList>

          {/* ── Appointments Tab ── */}
          <TabsContent value="appointments" className="space-y-4 mt-4">
            {loadingAppt ? (
              <div className="h-40 bg-muted animate-pulse rounded-lg" />
            ) : apptReport ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: t("totalAppointments"), value: apptReport.totalAppointments },
                    { label: t("completed"), value: apptReport.completed },
                    { label: t("cancellationRate"), value: `${(apptReport.cancellationRate * 100).toFixed(1)}%` },
                    { label: t("avgWaitTime"), value: `${apptReport.averageWaitTimeMinutes.toFixed(0)} min` },
                  ].map((s, i) => (
                    <Card key={i} className="border border-border">
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className="text-xl font-bold mt-0.5">{s.value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => exportToCSV(apptReport.byDoctor, `appointments-by-doctor-${today}.csv`)}>
                    <Download className="w-3.5 h-3.5 me-1" /> Export
                  </Button>
                </div>
                <Card className="border border-border">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm">{t("byDoctor")}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={apptReport.byDoctor}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="doctorName" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </TabsContent>

          {/* ── Revenue Tab ── */}
          <TabsContent value="revenue" className="space-y-4 mt-4">
            {loadingRevenue ? (
              <div className="h-40 bg-muted animate-pulse rounded-lg" />
            ) : revenueReport ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Total Revenue", value: `$${formatCurrency(revenueReport.totalRevenue)}` },
                    { label: "Total Invoices", value: revenueReport.totalInvoices },
                    { label: "Paid Invoices", value: revenueReport.paidInvoices },
                    { label: "Avg Invoice", value: `$${formatCurrency(revenueReport.averageInvoiceValue)}` },
                  ].map((s, i) => (
                    <Card key={i} className="border border-border">
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className="text-xl font-bold mt-0.5">{s.value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => exportToCSV(revenueReport.byDay.map(d => ({ date: formatDate(d.date), revenue: `$${formatCurrency(d.revenue)}` })), `revenue-${today}.csv`)}>
                    <Download className="w-3.5 h-3.5 me-1" /> Export
                  </Button>
                </div>
                <Card className="border border-border">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm">{t("dailyBreakdown")}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={revenueReport.byDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => formatDate(d)} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                        <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: any) => [`$${formatCurrency(v)}`, t("revenue")]} />
                        <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </TabsContent>

          {/* ── Lab & X-Ray Tab ── */}
          <TabsContent value="diagnostics" className="space-y-4 mt-4">
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Lab Tests", value: labTests?.length ?? 0 },
                { label: "Lab Completed", value: labTests?.filter(t => t.status === "completed").length ?? 0 },
                { label: "Total X-Rays", value: xrays?.length ?? 0 },
                { label: "X-Rays Reviewed", value: xrays?.filter(x => x.status === "reviewed").length ?? 0 },
              ].map((s, i) => (
                <Card key={i} className="border border-border">
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-xl font-bold mt-0.5">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Lab status pie */}
              <Card className="border border-border">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm">Lab Tests by Status</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {labStatusData.length ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={labStatusData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                          {labStatusData.map(entry => (
                            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-muted-foreground text-center py-8">No lab data</p>}
                </CardContent>
              </Card>

              {/* XRay status pie */}
              <Card className="border border-border">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm">X-Rays by Status</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {xrayStatusData.length ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={xrayStatusData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                          {xrayStatusData.map(entry => (
                            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-muted-foreground text-center py-8">No X-ray data</p>}
                </CardContent>
              </Card>

              {/* Top lab test types */}
              <Card className="border border-border">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm">Top Lab Test Types</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {labTypeData.length ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={labTypeData} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-muted-foreground text-center py-8">No lab data</p>}
                </CardContent>
              </Card>

              {/* Top X-ray body parts */}
              <Card className="border border-border">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm">Top X-Ray Body Parts</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {xrayBodyData.length ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={xrayBodyData} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="part" tick={{ fontSize: 11 }} width={100} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="count" fill="#0ea5e9" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-muted-foreground text-center py-8">No X-ray data</p>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
