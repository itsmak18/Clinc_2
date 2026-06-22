import { useState } from "react";
import { useGetBillingReconciliation, getGetBillingReconciliationQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDateTime, exportToCSV } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Download, Printer, Wallet, FileText, Clock, Ban } from "lucide-react";

function todayStr() {
  // Local (clinic) calendar day, not UTC — `toISOString()` would roll to the
  // previous/next day for staff west/east of UTC and show an empty report.
  return new Date().toLocaleDateString("en-CA");
}

export default function Reconciliation() {
  const { t } = useI18n();
  const [date, setDate] = useState(todayStr());

  const params = { date };
  const { data, isLoading } = useGetBillingReconciliation(params, {
    query: { queryKey: getGetBillingReconciliationQueryKey(params) },
  });

  const s = data?.summary;
  const payments = data?.payments ?? [];

  const cards = [
    { key: "collected",   label: t("collectedToday"),  amount: s?.collectedTotal,   count: s?.collectedCount,   icon: Wallet,   tone: "text-[var(--teal-600)]" },
    { key: "invoiced",    label: t("invoicedToday"),   amount: s?.invoicedTotal,    count: s?.invoicedCount,    icon: FileText, tone: "text-[var(--blue-500)]" },
    { key: "outstanding", label: t("outstanding"),     amount: s?.outstandingTotal, count: s?.outstandingCount, icon: Clock,    tone: "text-[var(--amber-500)]" },
    { key: "cancelled",   label: t("cancelled"),       amount: s?.cancelledTotal,   count: s?.cancelledCount,   icon: Ban,      tone: "text-[var(--rose-500)]" },
  ];

  return (
    <div className="page">
      {/* Toolbar */}
      <div className="flex items-end gap-3 mb-4 flex-wrap print:hidden">
        <div className="space-y-1">
          <Label className="text-xs">{t("date")}</Label>
          <Input type="date" max={todayStr()} className="h-8 text-sm w-44" value={date} onChange={e => setDate(e.target.value)} data-testid="input-date" />
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button
            className="btn btn-outline btn-sm gap-1.5"
            disabled={!payments.length}
            onClick={() => exportToCSV(
              payments.map(p => ({
                Invoice: p.invoiceNumber,
                Patient: p.patientName ?? "",
                Amount: formatCurrency(p.total),
                PaidAt: p.paidAt ? new Date(p.paidAt).toISOString() : "",
                CreatedBy: p.createdByName ?? "",
              })),
              `z-report-${date}.csv`,
            )}
          >
            <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
          </button>
          <button className="btn btn-outline btn-sm gap-1.5" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5" /> {t("print")}
          </button>
        </div>
      </div>

      {/* Report header (prints) */}
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-[var(--ink)]">{t("zReport")}</h1>
        <p className="text-sm text-[var(--ink-muted)]">{data?.date ?? date}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {cards.map(c => (
          <div key={c.key} className="card card-pad">
            <div className="flex items-center gap-2 mb-1">
              <c.icon className={cn("w-4 h-4", c.tone)} />
              <span className="text-[11px] text-[var(--ink-muted)]">{c.label}</span>
            </div>
            <div className="text-xl font-semibold text-[var(--ink)] tabular-nums">
              {isLoading ? "…" : `$${formatCurrency(c.amount ?? 0)}`}
            </div>
            <div className="text-[11px] text-[var(--ink-faint)]">
              {isLoading ? "" : `${c.count ?? 0} ${t("invoices").toLowerCase()}`}
            </div>
          </div>
        ))}
      </div>

      {/* Payments collected today (cash-drawer list) */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--ink)]">{t("paymentsCollected")}</h2>
        {s && <span className="text-xs text-[var(--ink-muted)]">{t("collectedTotalLabel")}: <span className="font-semibold text-[var(--teal-700)]">${formatCurrency(s.collectedTotal)}</span></span>}
      </div>
      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={payments}
          emptyMessage={t("noPaymentsToday")}
          columns={[
            { key: "inv", header: t("invoice"), render: p => <span className="font-mono text-[12px] text-[var(--ink)]">{p.invoiceNumber}</span> },
            { key: "patient", header: t("patient"), render: p => <span className="text-[13px] text-[var(--ink)]">{p.patientName ?? "—"}</span> },
            { key: "total", header: t("amount"), render: p => <span className="font-semibold text-[13px] text-[var(--ink)] tabular-nums">${formatCurrency(p.total)}</span> },
            { key: "by", header: t("createdBy"), render: p => <span className="text-[12px] text-[var(--ink-muted)]">{p.createdByName ?? "—"}</span> },
            { key: "at", header: t("timestamp"), render: p => <span className="text-[12px] text-[var(--ink-muted)] whitespace-nowrap">{p.paidAt ? formatDateTime(p.paidAt) : "—"}</span> },
          ]}
        />
      </div>
    </div>
  );
}
