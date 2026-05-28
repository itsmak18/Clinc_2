import { useState } from "react";
import { useListInvoices, useCreateInvoice, usePayInvoice, useGetDailyBillingSummary, useListPatients, useListUsers, getListInvoicesQueryKey, getGetDailyBillingSummaryQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatCurrency } from "@/lib/api";
import { Plus, DollarSign, Trash2, Printer } from "lucide-react";
import { openPrintWindow, invoiceHtml } from "@/lib/print";

interface InvoiceItem { description: string; quantity: number; unitPrice: number; total: number; }

export default function Billing() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showPay, setShowPay] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [createdById, setCreatedById] = useState("");
  const [discount, setDiscount] = useState("0");
  const [items, setItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, unitPrice: 0, total: 0 }]);
  const [amountReceived, setAmountReceived] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const params = { status: filterStatus as any || undefined };
  const { data: invoices, isLoading } = useListInvoices(params, { query: { queryKey: getListInvoicesQueryKey(params) } });
  const { data: dailySummary } = useGetDailyBillingSummary({ date: today }, { query: { queryKey: getGetDailyBillingSummaryQueryKey({ date: today }) } });
  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });
  const { data: users } = useListUsers({}, { query: { queryKey: getListUsersQueryKey({}) } });

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const total = subtotal - parseFloat(discount || "0");

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === "quantity" || field === "unitPrice") {
        updated.total = updated.quantity * updated.unitPrice;
      }
      return updated;
    }));
  };

  const createMutation = useCreateInvoice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDailyBillingSummaryQueryKey() });
        setShowCreate(false);
        setItems([{ description: "", quantity: 1, unitPrice: 0, total: 0 }]);
        toast({ title: t("invoiceCreated") });
      },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const payMutation = usePayInvoice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDailyBillingSummaryQueryKey() });
        setShowPay(null);
        toast({ title: t("paymentRecorded") });
      },
    },
  });

  const statuses = ["pending", "paid", "cancelled"];

  return (
    <div className="page">
      {/* Daily summary metrics */}
      {dailySummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[
            { label: t("billingTodayRevenue"),   value: `$${formatCurrency(dailySummary.totalRevenue)}`,   tone: "teal"  },
            { label: t("billingTotalInvoices"),   value: dailySummary.totalInvoices,                       tone: ""      },
            { label: t("billingPaid"),            value: dailySummary.paidInvoices,                        tone: "teal"  },
            { label: t("billingPending"),         value: dailySummary.pendingInvoices,                     tone: "amber" },
          ].map((s, i) => (
            <div key={i} className="card card-pad">
              <p className="text-[11px] text-[var(--ink-muted)] mb-1">{s.label}</p>
              <p className={`text-xl font-bold text-[var(--${s.tone || "ink"}${s.tone ? "-700" : ""})]`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Input
          className="h-8 text-sm max-w-xs"
          placeholder={t("searchByPatientOrInvoice")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 text-sm w-36" data-testid="select-filter-status">
            <SelectValue placeholder={t("all")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
          </SelectContent>
        </Select>
        <button className="btn btn-primary btn-sm gap-1.5 ms-auto" onClick={() => setShowCreate(true)} data-testid="button-create-invoice">
          <Plus className="w-3.5 h-3.5" /> {t("invoice")}
        </button>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          rowClassName={inv => {
            if (inv.status !== "pending") return "";
            const daysOld = Math.floor((Date.now() - new Date(inv.createdAt).getTime()) / 86400000);
            return daysOld >= 7 ? "bg-[var(--rose-50)]" : daysOld >= 3 ? "bg-amber-50/60" : "";
          }}
          data={(invoices ?? []).filter(inv => {
            if (!search) return true;
            const q = search.toLowerCase();
            return (inv as any).patient?.fullName?.toLowerCase().includes(q) || inv.invoiceNumber?.toLowerCase().includes(q);
          })}
          emptyMessage={t("noInvoices")}
          columns={[
            { key: "num",     header: t("invoiceNumber"), render: inv => <span className="font-mono text-xs font-semibold text-[var(--teal-700)]">{inv.invoiceNumber}</span> },
            { key: "patient", header: t("patient"),       render: inv => <span className="font-medium text-[13px] text-[var(--ink)]">{inv.patient?.fullName || `#${inv.patientId}`}</span> },
            { key: "total",   header: t("total"),         render: inv => <span className="font-semibold text-[13px] text-[var(--ink)]">${formatCurrency(Number(inv.total))}</span> },
            { key: "status",  header: t("status"),        render: inv => <StatusBadge status={inv.status} /> },
            { key: "date",    header: t("date"),           render: inv => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(inv.createdAt)}</span> },
            {
              key: "actions",
              header: t("actions"),
              render: inv => (
                <div className="flex items-center gap-1.5">
                  {inv.status === "pending" && (
                    <button
                      className="btn btn-outline btn-sm h-6 text-xs px-2 gap-1 text-[var(--teal-700)]"
                      onClick={e => { e.stopPropagation(); setShowPay(inv.id); setAmountReceived(String(inv.total)); }}
                      data-testid={`button-pay-${inv.id}`}
                    >
                      <DollarSign className="w-3 h-3" />{t("payNow")}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--ink-muted)]"
                    onClick={e => { e.stopPropagation(); openPrintWindow(invoiceHtml(inv as any), `Invoice ${inv.invoiceNumber ?? inv.id}`); }}
                    title={t("printInvoice")}
                    data-testid={`button-print-inv-${inv.id}`}
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* Create Invoice */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("newInvoice")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("patient")} *</Label>
                <Select value={patientId} onValueChange={setPatientId}>
                  <SelectTrigger data-testid="select-patient"><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                  <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("createdBy")} *</Label>
                <Select value={createdById} onValueChange={setCreatedById}>
                  <SelectTrigger data-testid="select-staff"><SelectValue placeholder={t("selectStaff")} /></SelectTrigger>
                  <SelectContent>{users?.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">{t("items")}</Label>
              <div className="space-y-2 mt-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <Input className="col-span-5 h-7 text-xs" placeholder={t("description")} value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} />
                    <Input className="col-span-2 h-7 text-xs" type="number" placeholder={t("quantity")} value={item.quantity} onChange={e => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)} />
                    <Input className="col-span-2 h-7 text-xs" type="number" placeholder={t("unitPrice")} value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} />
                    <div className="col-span-2 text-xs font-medium text-end text-[var(--ink)]">${formatCurrency(item.total)}</div>
                    <button
                      className="col-span-1 btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--rose-500)]"
                      onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  className="btn btn-outline btn-sm h-7 text-xs gap-1"
                  onClick={() => setItems(prev => [...prev, { description: "", quantity: 1, unitPrice: 0, total: 0 }])}
                  data-testid="button-add-item"
                >
                  <Plus className="w-3 h-3" />{t("addItem")}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-4 text-sm border-t border-[var(--line)] pt-3">
              <div className="space-y-1 text-end">
                <div className="flex gap-4">
                  <span className="text-[var(--ink-muted)]">{t("subtotal")}</span>
                  <span className="font-medium text-[var(--ink)]">${formatCurrency(subtotal)}</span>
                </div>
                <div className="flex gap-4 items-center">
                  <span className="text-[var(--ink-muted)]">{t("discount")}</span>
                  <Input className="h-7 w-24 text-xs" type="number" value={discount} onChange={e => setDiscount(e.target.value)} />
                </div>
                <div className="flex gap-4">
                  <span className="font-semibold text-[var(--ink)]">{t("total")}</span>
                  <span className="font-bold text-[var(--teal-700)]">${formatCurrency(total)}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => createMutation.mutate({ data: { patientId: parseInt(patientId), createdById: parseInt(createdById), items: items as any, discount: parseFloat(discount) } as any })}
                disabled={createMutation.isPending}
                data-testid="button-save-invoice"
              >
                {createMutation.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pay Invoice */}
      <Dialog open={showPay !== null} onOpenChange={() => setShowPay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("payNow")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("amountReceived")} *</Label>
              <Input type="number" value={amountReceived} onChange={e => setAmountReceived(e.target.value)} data-testid="input-amount-received" />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowPay(null)}>{t("cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => showPay && payMutation.mutate({ invoiceId: showPay, data: { amountReceived: parseFloat(amountReceived) } })}
                disabled={payMutation.isPending}
                data-testid="button-confirm-pay"
              >
                {payMutation.isPending ? t("loading") : t("confirm")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
