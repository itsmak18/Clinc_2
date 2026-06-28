import { useState } from "react";
import {
  useListServices, useCreateService, useUpdateService, useDeleteService, useSeedDefaultServices,
  getListServicesQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, Tag, Sparkles } from "lucide-react";

type Service = {
  id: number; name: string; nameAr?: string | null; description?: string | null;
  defaultPrice: string; category?: string | null; code?: string | null; active: boolean; createdAt: string;
};

const emptyForm = { name: "", nameAr: "", defaultPrice: "", category: "", code: "", active: true };

export default function ServicePrices() {
  const { t, language } = useI18n();
  const displayName = (s: Service) => (language === "ar" && s.nameAr ? s.nameAr : s.name);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = user?.role === "super_admin" || user?.role === "admin";

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);

  const params = { includeInactive: true };
  const { data: servicesResp, isLoading } = useListServices(params, { query: { queryKey: getListServicesQueryKey(params) } });
  const services = servicesResp?.data ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });

  const createMutation = useCreateService({
    mutation: {
      onSuccess: () => { invalidate(); setShowCreate(false); setForm(emptyForm); toast({ title: t("itemAdded") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateService({
    mutation: {
      onSuccess: () => { invalidate(); setEditing(null); toast({ title: t("itemUpdated") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteService({
    mutation: {
      onSuccess: () => { invalidate(); setDeleting(null); setEditing(null); toast({ title: t("itemDeleted") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });
  const seedMutation = useSeedDefaultServices({
    mutation: {
      onSuccess: (d) => { invalidate(); toast({ title: t("loadDefaults"), description: `+${(d as any)?.inserted ?? 0}` }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const filtered = (services ?? []).filter((s: Service) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.nameAr ?? "").toLowerCase().includes(q) || (s.category ?? "").toLowerCase().includes(q) || (s.code ?? "").toLowerCase().includes(q);
  }) as Service[];

  const categories = Array.from(new Set((services ?? []).map((s: Service) => s.category).filter(Boolean))) as string[];

  const openEdit = (s: Service) => {
    setForm({ name: s.name, nameAr: s.nameAr ?? "", defaultPrice: String(s.defaultPrice), category: s.category ?? "", code: s.code ?? "", active: s.active });
    setEditing(s);
  };

  const payload = () => ({
    name: form.name,
    nameAr: form.nameAr || undefined,
    defaultPrice: parseFloat(form.defaultPrice),
    category: form.category || undefined,
    code: form.code || undefined,
  });
  const invalid = !form.name || form.defaultPrice === "" || isNaN(parseFloat(form.defaultPrice));

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Input className="h-8 text-sm max-w-xs" placeholder={`${t("search")}…`} value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
        <span className="text-xs text-[var(--ink-muted)]">{filtered.length} {t("services")}</span>
        {canWrite && (
          <div className="ms-auto flex items-center gap-2">
            <button className="btn btn-outline btn-sm gap-1.5" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-load-defaults">
              <Sparkles className="w-3.5 h-3.5" /> {t("loadDefaults")}
            </button>
            <button className="btn btn-primary btn-sm gap-1.5" onClick={() => { setForm(emptyForm); setShowCreate(true); }} data-testid="button-add-service">
              <Plus className="w-3.5 h-3.5" /> {t("addService")}
            </button>
          </div>
        )}
      </div>

      {canWrite && !isLoading && (services?.length ?? 0) === 0 && (
        <div className="card card-pad mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-[var(--ink-muted)]">{t("noServicesHint")}</div>
          <button className="btn btn-primary btn-sm gap-1.5" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
            <Sparkles className="w-3.5 h-3.5" /> {t("loadDefaults")}
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={filtered}
          emptyMessage={t("noServices")}
          onRowClick={canWrite ? (s: Service) => openEdit(s) : undefined}
          rowClassName={(s: Service) => (!s.active ? "opacity-50" : "")}
          columns={[
            {
              key: "name", header: t("name"),
              render: (s: Service) => {
                const alt = language === "ar" ? s.name : s.nameAr;
                return (
                  <div>
                    <div className="font-medium text-[13px] text-[var(--ink)]">{displayName(s)}</div>
                    {alt && <div className="text-[11px] text-[var(--ink-muted)]" dir="auto">{alt}</div>}
                    {s.code && <div className="text-[11px] text-[var(--ink-faint)] font-mono">{s.code}</div>}
                  </div>
                );
              },
            },
            { key: "cat", header: t("category"), render: (s: Service) => s.category ? <span className="badge text-xs">{s.category}</span> : <span className="text-[var(--ink-faint)]">—</span> },
            { key: "price", header: t("price"), render: (s: Service) => <span className="font-semibold text-[13px] text-[var(--ink)] tabular-nums">${formatCurrency(Number(s.defaultPrice))}</span> },
            { key: "status", header: t("status"), render: (s: Service) => <span className={cn("badge text-xs", s.active ? "badge-teal" : "")}>{s.active ? t("active") : t("inactive")}</span> },
            ...(canWrite ? [{
              key: "actions", header: "",
              render: (s: Service) => (
                <div className="flex items-center gap-1 justify-end">
                  <button className="btn btn-icon btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openEdit(s); }} aria-label={t("edit")}><Pencil className="w-3.5 h-3.5" /></button>
                  <button className="btn btn-icon btn-ghost btn-sm text-[var(--rose-500)]" onClick={e => { e.stopPropagation(); setDeleting(s); }} aria-label={t("delete")}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ),
            }] : []),
          ]}
        />
      </div>

      {/* Create / Edit */}
      <Dialog open={showCreate || !!editing} onOpenChange={o => { if (!o) { setShowCreate(false); setEditing(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Tag className="w-4 h-4" />{editing ? t("editService") : t("addService")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} (AR)</Label>
                <Input value={form.nameAr} onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))} dir="rtl" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("price")} *</Label>
                <Input type="number" step="0.01" min="0" value={form.defaultPrice} onChange={e => setForm(f => ({ ...f, defaultPrice: e.target.value }))} data-testid="input-price" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("category")}</Label>
                <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder={t("egSvcCategory")} list="svc-categories" />
                <datalist id="svc-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("serviceCode")}</Label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="CONSULTATION, LAB_DEFAULT…" className="font-mono" />
            </div>
            {editing && (
              <div className="flex items-center justify-between rounded-md border border-[var(--line)] px-3 py-2">
                <Label className="text-xs">{t("active")}</Label>
                <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
              </div>
            )}
            <div className="flex justify-between items-center gap-2 pt-2">
              {editing ? (
                <button className="btn btn-ghost btn-sm text-[var(--rose-500)] gap-1.5" onClick={() => setDeleting(editing)}><Trash2 className="w-3.5 h-3.5" /> {t("delete")}</button>
              ) : <span />}
              <div className="flex gap-2">
                <button className="btn btn-outline btn-sm" onClick={() => { setShowCreate(false); setEditing(null); }}>{t("cancel")}</button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={invalid || createMutation.isPending || updateMutation.isPending}
                  onClick={() => {
                    if (editing) updateMutation.mutate({ serviceId: editing.id, data: { ...payload(), active: form.active } as any });
                    else createMutation.mutate({ data: payload() as any });
                  }}
                  data-testid="button-save-service"
                >
                  {createMutation.isPending || updateMutation.isPending ? t("loading") : editing ? t("saveChanges") : t("save")}
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={o => { if (!o) setDeleting(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("delete")}</DialogTitle></DialogHeader>
          <p className="text-sm text-[var(--ink-muted)]">{t("deleteItemConfirm")}</p>
          {deleting && <p className="text-sm font-medium text-[var(--ink)]">{displayName(deleting)}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-outline btn-sm" onClick={() => setDeleting(null)}>{t("cancel")}</button>
            <button className="btn btn-danger btn-sm" disabled={deleteMutation.isPending} onClick={() => deleting && deleteMutation.mutate({ serviceId: deleting.id })}>
              {deleteMutation.isPending ? t("loading") : t("delete")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
