import { useState } from "react";
import { useListInvoices, useCreateInvoice, usePayInvoice, useGetDailyBillingSummary, useListPatients, useListUsers, getListInvoicesQueryKey, getGetDailyBillingSummaryQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatCurrency } from "@/lib/api";
import { Plus, DollarSign, Trash2 } from "lucide-react";

interface InvoiceItem { description: string; quantity: number; unitPrice: number; total: number; }

export default function Billing() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showPay, setShowPay] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [patientId, setPatientId] = useState("");
  const [createdById, setCreatedById] = useState("");
  const [discount, setDiscount] = useState("0");
  const [items, setItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, unitPrice: 0, total: 0 }]);
  const [amountReceived, setAmountReceived] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const params = { status: filterStatus as any || undefined };
  const { data: invoices, isLoading } = useListInvoices(params, { query: { queryKey: getListInvoicesQueryKey(params) } });
  const { data: dailySummary } = useGetDailyBillingSummary({ date: today }, { query: { queryKey: getGetDailyBillingSummaryQueryKey({ date: today }) } });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
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
        toast({ title: "Invoice created" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    }
  });

  const payMutation = usePayInvoice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDailyBillingSummaryQueryKey() });
        setShowPay(null);
        toast({ title: "Payment recorded" });
      },
    }
  });

  const statuses = ["pending", "paid", "cancelled"];

  return (
    <div>
      <PageHeader
        title={t("billing")}
        subtitle="Invoices & cash receipts"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-invoice">
            <Plus className="w-3.5 h-3.5 me-1" /> {t("invoice")}
          </Button>
        }
      />
      <div className="p-6 space-y-4">
        {/* Daily summary */}
        {dailySummary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Today's Revenue", value: `$${formatCurrency(dailySummary.totalRevenue)}`, color: "text-green-600" },
              { label: "Total Invoices", value: dailySummary.totalInvoices },
              { label: "Paid", value: dailySummary.paidInvoices },
              { label: "Pending", value: dailySummary.pendingInvoices, color: "text-orange-600" },
            ].map((s, i) => (
              <Card key={i} className="border border-border">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-xl font-bold mt-0.5 ${s.color || ""}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="flex gap-3 mb-2">
          <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm w-36" data-testid="select-filter-status">
              <SelectValue placeholder={t("all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("all")}</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={invoices ?? []}
            emptyMessage="No invoices"
            columns={[
              { key: "num", header: t("invoiceNumber"), render: inv => <span className="font-mono text-xs font-semibold text-primary">{inv.invoiceNumber}</span> },
              { key: "patient", header: "Patient", render: inv => <span className="font-medium text-sm">{inv.patient?.fullName || `#${inv.patientId}`}</span> },
              { key: "total", header: t("total"), render: inv => <span className="font-semibold text-sm">${formatCurrency(Number(inv.total))}</span> },
              { key: "status", header: t("status"), render: inv => <StatusBadge status={inv.status} /> },
              { key: "date", header: t("date"), render: inv => <span className="text-sm">{formatDate(inv.createdAt)}</span> },
              { key: "actions", header: t("actions"), render: inv => (
                inv.status === "pending" ? (
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-green-700 border-green-200 hover:bg-green-50" onClick={(e) => { e.stopPropagation(); setShowPay(inv.id); setAmountReceived(String(inv.total)); }} data-testid={`button-pay-${inv.id}`}>
                    <DollarSign className="w-3 h-3 me-1" />{t("payNow")}
                  </Button>
                ) : null
              )},
            ]}
          />
        </div>
      </div>

      {/* Create Invoice */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Invoice</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Patient *</Label>
                <Select value={patientId} onValueChange={setPatientId}>
                  <SelectTrigger data-testid="select-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
                  <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Created By *</Label>
                <Select value={createdById} onValueChange={setCreatedById}>
                  <SelectTrigger data-testid="select-staff"><SelectValue placeholder="Select staff" /></SelectTrigger>
                  <SelectContent>{users?.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">Items</Label>
              <div className="space-y-2 mt-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <Input className="col-span-5 h-7 text-xs" placeholder={t("description")} value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} />
                    <Input className="col-span-2 h-7 text-xs" type="number" placeholder={t("quantity")} value={item.quantity} onChange={e => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)} />
                    <Input className="col-span-2 h-7 text-xs" type="number" placeholder={t("unitPrice")} value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} />
                    <div className="col-span-2 text-xs font-medium text-right">${formatCurrency(item.total)}</div>
                    <Button size="sm" variant="ghost" className="col-span-1 h-7 w-7 p-0 text-destructive" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setItems(prev => [...prev, { description: "", quantity: 1, unitPrice: 0, total: 0 }])} data-testid="button-add-item">
                  <Plus className="w-3 h-3 me-1" />{t("addItem")}
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-4 text-sm border-t border-border pt-3">
              <div className="space-y-1 text-right">
                <div className="flex gap-4"><span className="text-muted-foreground">{t("subtotal")}</span><span className="font-medium">${formatCurrency(subtotal)}</span></div>
                <div className="flex gap-4 items-center">
                  <span className="text-muted-foreground">{t("discount")}</span>
                  <Input className="h-7 w-24 text-xs" type="number" value={discount} onChange={e => setDiscount(e.target.value)} />
                </div>
                <div className="flex gap-4"><span className="font-semibold">{t("total")}</span><span className="font-bold text-primary">${formatCurrency(total)}</span></div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { patientId: parseInt(patientId), createdById: parseInt(createdById), items: items as any, discount: parseFloat(discount) } as any })} disabled={createMutation.isPending} data-testid="button-save-invoice">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
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
              <Label className="text-xs">Amount Received *</Label>
              <Input type="number" value={amountReceived} onChange={e => setAmountReceived(e.target.value)} data-testid="input-amount-received" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowPay(null)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => showPay && payMutation.mutate({ invoiceId: showPay, data: { amountReceived: parseFloat(amountReceived) } })} disabled={payMutation.isPending} data-testid="button-confirm-pay">
                {payMutation.isPending ? t("loading") : t("confirm")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
