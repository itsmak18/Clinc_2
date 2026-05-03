import { useState } from "react";
import { useListInventoryItems, useCreateInventoryItem, useUpdateInventoryItem, getListInventoryItemsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { Plus, AlertTriangle } from "lucide-react";

export default function Inventory() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = user?.role === "super_admin" || user?.role === "admin";
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", category: "", quantity: "", unit: "", minimumStock: "", expiryDate: "", notes: "" });

  const params = { search: search || undefined };
  const { data: items, isLoading } = useListInventoryItems(params, { query: { queryKey: getListInventoryItemsQueryKey(params) } });

  const createMutation = useCreateInventoryItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
        setShowCreate(false);
        setForm({ name: "", category: "", quantity: "", unit: "", minimumStock: "", expiryDate: "", notes: "" });
        toast({ title: "Item added" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    }
  });

  const isLowStock = (item: any) => item.quantity <= item.minimumStock;
  const isExpired = (item: any) => item.expiryDate && new Date(item.expiryDate) < new Date();

  return (
    <div>
      <PageHeader
        title={t("inventory")}
        subtitle={`${items?.length ?? 0} items`}
        actions={canWrite ? (
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-add-item">
            <Plus className="w-3.5 h-3.5 me-1" /> Add Item
          </Button>
        ) : undefined}
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <Input className="h-8 text-sm max-w-xs" placeholder={`${t("search")} inventory...`} value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={items ?? []}
            emptyMessage="No inventory items"
            columns={[
              { key: "name", header: t("name"), render: item => (
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{item.name}</span>
                  {isLowStock(item) && <AlertTriangle className="w-3 h-3 text-orange-500" />}
                  {isExpired(item) && <AlertTriangle className="w-3 h-3 text-red-500" />}
                </div>
              )},
              { key: "cat", header: t("category"), render: item => <Badge variant="outline" className="text-xs">{item.category}</Badge> },
              { key: "qty", header: "Quantity", render: item => (
                <span className={`font-semibold text-sm ${isLowStock(item) ? "text-orange-600" : "text-foreground"}`}>
                  {item.quantity} {item.unit}
                </span>
              )},
              { key: "min", header: t("minimumStock"), render: item => <span className="text-sm text-muted-foreground">{item.minimumStock} {item.unit}</span> },
              { key: "expiry", header: t("expiryDate"), render: item => (
                <span className={`text-sm ${isExpired(item) ? "text-destructive font-semibold" : ""}`}>
                  {item.expiryDate ? formatDate(item.expiryDate) : "-"}
                </span>
              )},
              { key: "status", header: t("status"), render: item => (
                isExpired(item) ? <Badge variant="destructive" className="text-xs">{t("expired")}</Badge> :
                isLowStock(item) ? <Badge className="text-xs bg-orange-100 text-orange-800 border-none">{t("lowStock")}</Badge> :
                <Badge variant="default" className="text-xs">{t("active")}</Badge>
              )},
            ]}
          />
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Inventory Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("category")} *</Label>
                <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Medicine, Supply..." />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantity *</Label>
                <Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} data-testid="input-quantity" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("unit")} *</Label>
                <Input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="box, ml, mg..." />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("minimumStock")} *</Label>
                <Input type="number" value={form.minimumStock} onChange={e => setForm(f => ({ ...f, minimumStock: e.target.value }))} data-testid="input-min-stock" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("expiryDate")}</Label>
              <Input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { name: form.name, category: form.category, quantity: parseInt(form.quantity), unit: form.unit, minimumStock: parseInt(form.minimumStock), expiryDate: form.expiryDate || undefined, notes: form.notes || undefined } as any })} disabled={createMutation.isPending} data-testid="button-save-item">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
