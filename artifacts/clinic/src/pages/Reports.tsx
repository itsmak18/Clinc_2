import { useState } from "react";
import { useGetAppointmentReport, useGetRevenueReport, getGetAppointmentReportQueryKey, getGetRevenueReportQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatCurrency, formatDate } from "@/lib/api";

export default function Reports() {
  const { t } = useI18n();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);

  const apptParams = { dateFrom, dateTo };
  const revenueParams = { dateFrom, dateTo };

  const { data: apptReport, isLoading: loadingAppt } = useGetAppointmentReport(apptParams, { query: { queryKey: getGetAppointmentReportQueryKey(apptParams) } });
  const { data: revenueReport, isLoading: loadingRevenue } = useGetRevenueReport(revenueParams, { query: { queryKey: getGetRevenueReportQueryKey(revenueParams) } });

  return (
    <div>
      <PageHeader title={t("reports")} subtitle="Analytics & performance insights" />
      <div className="p-6 space-y-4">
        {/* Date filters */}
        <div className="flex gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs">{t("dateFrom")}</Label>
            <Input type="date" className="h-8 text-sm w-36" value={dateFrom} onChange={e => setDateFrom(e.target.value)} data-testid="input-date-from" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("dateTo")}</Label>
            <Input type="date" className="h-8 text-sm w-36" value={dateTo} onChange={e => setDateTo(e.target.value)} data-testid="input-date-to" />
          </div>
        </div>

        <Tabs defaultValue="appointments">
          <TabsList>
            <TabsTrigger value="appointments">{t("appointments")}</TabsTrigger>
            <TabsTrigger value="revenue">{t("revenue")}</TabsTrigger>
          </TabsList>

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
        </Tabs>
      </div>
    </div>
  );
}
