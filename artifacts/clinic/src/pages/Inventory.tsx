import { useState, useMemo } from "react";
import {
  useListInventoryItems,
  useCreateInventoryItem,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useAdjustInventoryStock,
  useListInventoryTransactions,
  getListInventoryItemsQueryKey,
  getListInventoryTransactionsQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus, AlertTriangle, Pencil, Trash2, Minus, Package, History, Clock } from "lucide-react";

type Item = {
  id: number; name: string; category: string; quantity: number; unit: string;
  minimumStock: number; expiryDate?: string | null; notes?: string | null;
  isActive: boolean; createdAt: string;
};

const emptyForm = { name: "", category: "", quantity: "", unit: "", minimumStock: "", expiryDate: "", notes: "", isActive: true };
const EXPIRY_SOON_DAYS = 30;

export default function Inventory() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = user?.role === "super_admin" || user?.role === "admin";

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [stockItem, setStockItem] = useState<Item | null>(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [adjust, setAdjust] = useState({ reason: "restock", amount: "", note: "" });

  const params = { search: search || undefined };
  const { data: items, isLoading } = useListInventoryItems(params, { query: { queryKey: getListInventoryItemsQueryKey(params) } });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });

  const createMutation = useCreateInventoryItem({
    mutation: {
      onSuccess: () => { invalidate(); setShowCreate(false); setForm(emptyForm); toast({ title: t("itemAdded") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateInventoryItem({
    mutation: {
      onSuccess: () => { invalidate(); setEditing(null); toast({ title: t("itemUpdated") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteInventoryItem({
    mutation: {
      onSuccess: () => { invalidate(); setDeleting(null); setEditing(null); toast({ title: t("itemDeleted") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const adjustMutation = useAdjustInventoryStock({
    mutation: {
      onSuccess: (_d, vars) => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: getListInventoryTransactionsQueryKey(vars.itemId) });
        toast({ title: t("itemUpdated") });
      },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const isLowStock = (item: Item) => item.quantity <= item.minimumStock;
  const isExpired = (item: Item) => !!item.expiryDate && new Date(item.expiryDate) < new Date();
  const isExpiringSoon = (item: Item) => {
    if (!item.expiryDate) return false;
    const exp = new Date(item.expiryDate);
    const now = new Date();
    const soon = new Date(); soon.setDate(now.getDate() + EXPIRY_SOON_DAYS);
    return exp >= now && exp <= soon;
  };

  const categories = useMemo(
    () => Array.from(new Set((items ?? []).map(i => i.category).filter(Boolean))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    return (items ?? []).filter(i => {
      if (filterCategory && i.category !== filterCategory) return false;
      if (lowStockOnly && !isLowStock(i as Item)) return false;
      return true;
    }) as Item[];
  }, [items, filterCategory, lowStockOnly]);

  const stats = useMemo(() => {
    const list = (items ?? []) as Item[];
    return {
      total: list.length,
      low: list.filter(isLowStock).length,
      soon: list.filter(isExpiringSoon).length,
      expired: list.filter(isExpired).length,
    };
  }, [items]);

  // Quick ±1 stepper → ledger-recorded movement (restock / consumed)
  const step = (item: Item, delta: number) => {
    adjustMutation.mutate({ itemId: item.id, data: { delta, reason: delta > 0 ? "restock" : "consumed" } });
  };

  const openEdit = (item: Item) => {
    setForm({
      name: item.name, category: item.category, quantity: String(item.quantity),
      unit: item.unit, minimumStock: String(item.minimumStock),
      expiryDate: item.expiryDate ? item.expiryDate.slice(0, 10) : "",
      notes: item.notes ?? "", isActive: item.isActive,
    });
    setEditing(item);
  };

  const openStock = (item: Item) => {
    setAdjust({ reason: "restock", amount: "", note: "" });
    setStockItem(item);
  };

  const buildPayload = () => ({
    name: form.name,
    category: form.category,
    quantity: parseInt(form.quantity),
    unit: form.unit,
    minimumStock: parseInt(form.minimumStock),
    expiryDate: form.expiryDate || undefined,
    notes: form.notes || undefined,
  });

  const formInvalid = !form.name || !form.category || form.quantity === "" || !form.unit || form.minimumStock === "";

  const applyAdjust = () => {
    if (!stockItem) return;
    const amount = parseInt(adjust.amount);
    if (!amount || amount <= 0) return;
    const delta = adjust.reason === "restock" ? amount : -amount;
    adjustMutation.mutate(
      { itemId: stockItem.id, data: { delta, reason: adjust.reason as any, note: adjust.note || undefined } },
      { onSuccess: () => setAdjust({ reason: adjust.reason, amount: "", note: "" }) },
    );
  };

  return (
    <div className="page">
      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card card-pad flex items-center gap-3">
          <Package className="w-5 h-5 text-[var(--teal-600)]" />
          <div>
            <div className="text-lg font-semibold text-[var(--ink)]">{stats.total}</div>
            <div className="text-[11px] text-[var(--ink-muted)]">{t("totalItems")}</div>
          </div>
        </div>
        <button
          className={cn("card card-pad flex items-center gap-3 text-start", lowStockOnly && "ring-1 ring-[var(--amber-500)]")}
          onClick={() => setLowStockOnly(v => !v)}
        >
          <AlertTriangle className="w-5 h-5 text-[var(--amber-500)]" />
          <div>
            <div className="text-lg font-semibold text-[var(--ink)]">{stats.low}</div>
            <div className="text-[11px] text-[var(--ink-muted)]">{t("lowStock")}</div>
          </div>
        </button>
        <div className="card card-pad flex items-center gap-3">
          <Clock className="w-5 h-5 text-[var(--amber-500)]" />
          <div>
            <div className="text-lg font-semibold text-[var(--ink)]">{stats.soon}</div>
            <div className="text-[11px] text-[var(--ink-muted)]">{t("expiringSoon")}</div>
          </div>
        </div>
        <div className="card card-pad flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-[var(--rose-500)]" />
          <div>
            <div className="text-lg font-semibold text-[var(--ink)]">{stats.expired}</div>
            <div className="text-[11px] text-[var(--ink-muted)]">{t("expired")}</div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Input
          className="h-8 text-sm max-w-xs"
          placeholder={`${t("search")} ${t("inventory").toLowerCase()}…`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-search"
        />
        <Select value={filterCategory || "all"} onValueChange={v => setFilterCategory(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 text-sm w-44" data-testid="select-filter-category">
            <SelectValue placeholder={t("allCategories")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allCategories")}</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        {lowStockOnly && (
          <button className="btn btn-ghost btn-sm gap-1.5" onClick={() => setLowStockOnly(false)}>
            {t("lowStockOnly")} ✕
          </button>
        )}
        {canWrite && (
          <button className="btn btn-primary btn-sm gap-1.5 ms-auto" onClick={() => { setForm(emptyForm); setShowCreate(true); }} data-testid="button-add-item">
            <Plus className="w-3.5 h-3.5" /> {t("addItem")}
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={filtered}
          emptyMessage={t("noInventoryItems")}
          onRowClick={canWrite ? (item: Item) => openEdit(item) : undefined}
          rowClassName={(item: Item) => (!item.isActive ? "opacity-50" : "")}
          columns={[
            {
              key: "name",
              header: t("name"),
              render: (item: Item) => (
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[13px] text-[var(--ink)]">{item.name}</span>
                  {isLowStock(item) && <AlertTriangle className="w-3 h-3 text-[var(--amber-500)]" />}
                  {isExpired(item) && <AlertTriangle className="w-3 h-3 text-[var(--rose-500)]" />}
                  {!item.isActive && <span className="badge text-[10px]">{t("inactive")}</span>}
                </div>
              ),
            },
            { key: "cat", header: t("category"), render: (item: Item) => <span className="badge text-xs">{item.category}</span> },
            {
              key: "qty",
              header: t("quantity"),
              render: (item: Item) => (
                <div className="flex items-center gap-1.5">
                  {canWrite && (
                    <button
                      className="btn btn-icon btn-ghost btn-sm w-6 h-6"
                      onClick={e => { e.stopPropagation(); step(item, -1); }}
                      disabled={adjustMutation.isPending || item.quantity === 0}
                      aria-label="-1"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                  )}
                  <span className={cn("font-semibold text-[13px] tabular-nums min-w-[3.5rem] text-center", isLowStock(item) ? "text-[var(--amber-600)]" : "text-[var(--ink)]")}>
                    {item.quantity} {item.unit}
                  </span>
                  {canWrite && (
                    <button
                      className="btn btn-icon btn-ghost btn-sm w-6 h-6"
                      onClick={e => { e.stopPropagation(); step(item, 1); }}
                      disabled={adjustMutation.isPending}
                      aria-label="+1"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ),
            },
            { key: "min", header: t("minimumStock"), render: (item: Item) => <span className="text-[13px] text-[var(--ink-muted)]">{item.minimumStock} {item.unit}</span> },
            {
              key: "expiry",
              header: t("expiryDate"),
              render: (item: Item) => (
                <span className={cn("text-[13px]",
                  isExpired(item) ? "text-[var(--rose-500)] font-semibold" :
                  isExpiringSoon(item) ? "text-[var(--amber-600)] font-medium" : "text-[var(--ink-muted)]")}>
                  {item.expiryDate ? formatDate(item.expiryDate) : "—"}
                </span>
              ),
            },
            {
              key: "status",
              header: t("status"),
              render: (item: Item) => (
                isExpired(item)      ? <span className="badge badge-rose text-xs">{t("expired")}</span>  :
                isLowStock(item)     ? <span className="badge badge-sand text-xs">{t("lowStock")}</span> :
                isExpiringSoon(item) ? <span className="badge badge-amber text-xs">{t("expiringSoon")}</span> :
                                       <span className="badge badge-teal text-xs">{t("active")}</span>
              ),
            },
            {
              key: "actions",
              header: "",
              render: (item: Item) => (
                <div className="flex items-center gap-1 justify-end">
                  <button className="btn btn-icon btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openStock(item); }} aria-label={t("stockMovements")} data-testid={`button-history-${item.id}`}>
                    <History className="w-3.5 h-3.5" />
                  </button>
                  {canWrite && <>
                    <button className="btn btn-icon btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openEdit(item); }} aria-label={t("edit")} data-testid={`button-edit-${item.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button className="btn btn-icon btn-ghost btn-sm text-[var(--rose-500)]" onClick={e => { e.stopPropagation(); setDeleting(item); }} aria-label={t("delete")} data-testid={`button-delete-${item.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>}
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={showCreate || !!editing} onOpenChange={o => { if (!o) { setShowCreate(false); setEditing(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? t("editInventoryItem") : t("addInventoryItem")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("category")} *</Label>
                <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Medicine, Supply…" list="inv-categories" />
                <datalist id="inv-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("quantity")} *</Label>
                <Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} data-testid="input-quantity" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("unit")} *</Label>
                <Input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="box, ml, mg…" />
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
            {editing && (
              <div className="flex items-center justify-between rounded-md border border-[var(--line)] px-3 py-2">
                <Label className="text-xs">{t("active")}</Label>
                <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
              </div>
            )}
            <div className="flex justify-between items-center gap-2 pt-2">
              {editing ? (
                <button className="btn btn-ghost btn-sm text-[var(--rose-500)] gap-1.5" onClick={() => setDeleting(editing)}>
                  <Trash2 className="w-3.5 h-3.5" /> {t("delete")}
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button className="btn btn-outline btn-sm" onClick={() => { setShowCreate(false); setEditing(null); }}>{t("cancel")}</button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={formInvalid || createMutation.isPending || updateMutation.isPending}
                  onClick={() => {
                    if (editing) updateMutation.mutate({ itemId: editing.id, data: { ...buildPayload(), isActive: form.isActive } as any });
                    else createMutation.mutate({ data: buildPayload() as any });
                  }}
                  data-testid="button-save-item"
                >
                  {createMutation.isPending || updateMutation.isPending ? t("loading") : editing ? t("saveChanges") : t("save")}
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stock movements (adjust + ledger) */}
      <StockDialog
        item={stockItem}
        canWrite={canWrite}
        adjust={adjust}
        setAdjust={setAdjust}
        onApply={applyAdjust}
        applying={adjustMutation.isPending}
        onClose={() => setStockItem(null)}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={o => { if (!o) setDeleting(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("deleteItem")}</DialogTitle></DialogHeader>
          <p className="text-sm text-[var(--ink-muted)]">{t("deleteItemConfirm")}</p>
          {deleting && <p className="text-sm font-medium text-[var(--ink)]">{deleting.name}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-outline btn-sm" onClick={() => setDeleting(null)}>{t("cancel")}</button>
            <button
              className="btn btn-danger btn-sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate({ itemId: deleting.id })}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? t("loading") : t("delete")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Stock movements dialog: quick adjust form + full ledger ───────────────────
function StockDialog({
  item, canWrite, adjust, setAdjust, onApply, applying, onClose,
}: {
  item: Item | null;
  canWrite: boolean;
  adjust: { reason: string; amount: string; note: string };
  setAdjust: (v: { reason: string; amount: string; note: string }) => void;
  onApply: () => void;
  applying: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: txns, isLoading } = useListInventoryTransactions(item?.id ?? 0, {
    query: { queryKey: getListInventoryTransactionsQueryKey(item?.id ?? 0), enabled: !!item },
  });

  const reasonLabel = (r: string) =>
    r === "initial" ? t("initial") :
    r === "restock" ? t("restock") :
    r === "consumed" ? t("consumed") :
    r === "expired" ? t("expired") :
    t("adjustment");

  return (
    <Dialog open={!!item} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" /> {t("stockMovements")}
          </DialogTitle>
        </DialogHeader>
        {item && (
          <div className="space-y-4">
            <div className="text-sm text-[var(--ink-muted)]">
              <span className="font-medium text-[var(--ink)]">{item.name}</span>
              {" · "}{t("currentStock")}: <span className="font-semibold text-[var(--ink)]">{item.quantity} {item.unit}</span>
            </div>

            {/* Quick adjust form */}
            {canWrite && (
              <div className="card card-pad space-y-2 bg-[var(--surface-2)]">
                <Label className="text-xs font-medium">{t("adjustStock")}</Label>
                <div className="flex gap-2">
                  <Select value={adjust.reason} onValueChange={v => setAdjust({ ...adjust, reason: v })}>
                    <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="restock">{t("restock")}</SelectItem>
                      <SelectItem value="consumed">{t("consumed")}</SelectItem>
                      <SelectItem value="expired">{t("expired")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number" min="1" className="h-8 text-sm w-24"
                    placeholder={t("amount")}
                    value={adjust.amount}
                    onChange={e => setAdjust({ ...adjust, amount: e.target.value })}
                  />
                  <Input
                    className="h-8 text-sm flex-1"
                    placeholder={t("notes")}
                    value={adjust.note}
                    onChange={e => setAdjust({ ...adjust, note: e.target.value })}
                  />
                  <button className="btn btn-primary btn-sm" disabled={applying || !adjust.amount} onClick={onApply}>
                    {t("apply")}
                  </button>
                </div>
              </div>
            )}

            {/* Ledger */}
            <div className="max-h-72 overflow-y-auto -mx-1">
              {isLoading ? (
                <div className="py-8 text-center text-sm text-[var(--ink-muted)]">{t("loading")}</div>
              ) : !txns?.length ? (
                <div className="py-8 text-center text-sm text-[var(--ink-muted)]">{t("noMovements")}</div>
              ) : (
                <ul className="space-y-1.5">
                  {txns.map((tx: any) => (
                    <li key={tx.id} className="flex items-center gap-3 px-1 py-1.5 border-b border-[var(--line)] last:border-0">
                      <span className={cn("font-semibold tabular-nums text-sm w-14 text-end", tx.delta > 0 ? "text-[var(--teal-600)]" : "text-[var(--rose-500)]")}>
                        {tx.delta > 0 ? "+" : ""}{tx.delta}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="badge text-[10px]">{reasonLabel(tx.reason)}</span>
                          <span className="text-xs text-[var(--ink-muted)]">→ {tx.quantityAfter}</span>
                        </div>
                        {tx.note && <div className="text-[11px] text-[var(--ink-muted)] truncate">{tx.note}</div>}
                      </div>
                      <div className="text-[11px] text-[var(--ink-faint)] text-end whitespace-nowrap">
                        <div>{formatDateTime(tx.createdAt)}</div>
                        {tx.performedByName && <div>{tx.performedByName}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
