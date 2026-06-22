import { useState } from "react";
import { useListUsers, useCreateUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus, Coffee, Clock } from "lucide-react";

const roles = ["super_admin", "admin", "doctor", "nurse", "front_desk", "xray_staff", "lab_staff"] as const;

export default function Users() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterRole, setFilterRole] = useState("");
  const emptyForm = { username: "", password: "", fullName: "", fullNameAr: "", email: "", role: "doctor", phone: "", addressLine: "", city: "", region: "", postalCode: "", country: "" };
  const [form, setForm] = useState(emptyForm);

  const params = { role: filterRole as any || undefined };
  const { data: users, isLoading } = useListUsers(params, { query: { queryKey: getListUsersQueryKey(params) } });

  const createMutation = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setShowCreate(false);
        setForm(emptyForm);
        toast({ title: t("userCreated") });
      },
      onError: () => toast({ title: t("userCreateFailed"), variant: "destructive" }),
    },
  });

  return (
    <div className="page">
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <Select value={filterRole || "all"} onValueChange={v => setFilterRole(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 text-sm w-40" data-testid="select-filter-role">
            <SelectValue placeholder={t("allRoles")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allRoles")}</SelectItem>
            {roles.map(r => <SelectItem key={r} value={r}>{t(r as any)}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-[var(--ink-muted)]">{users?.length ?? 0} {t("staffMembers")}</span>
        <button className="btn btn-primary btn-sm gap-1.5 ms-auto" onClick={() => setShowCreate(true)} data-testid="button-create-user">
          <Plus className="w-3.5 h-3.5" /> {t("addUser")}
        </button>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={users ?? []}
          emptyMessage={t("noUsersFound")}
          onRowClick={u => setLocation(`/users/${u.id}`)}
          columns={[
            {
              key: "name",
              header: t("name"),
              render: u => (
                <div data-testid={`link-profile-${u.id}`}>
                  <div className="font-medium text-[13px] text-[var(--ink)]">{u.fullName}</div>
                  <div className="text-[11px] text-[var(--ink-muted)] font-mono">@{u.username}</div>
                </div>
              ),
            },
            { key: "role", header: t("role"), render: u => <span className="badge text-xs capitalize">{t(u.role as any)}</span> },
            {
              key: "shift",
              header: t("shift"),
              render: u => (
                <span className={cn("badge text-xs gap-1", (u as any).isOnShift ? "badge-teal" : "")}>
                  {(u as any).isOnShift
                    ? <><Coffee className="w-2.5 h-2.5 inline me-0.5" />{t("onShift")}</>
                    : <><Clock className="w-2.5 h-2.5 inline me-0.5" />{t("offShift")}</>}
                </span>
              ),
            },
            { key: "email", header: t("email"), render: u => <span className="text-[13px] text-[var(--ink-muted)]">{u.email || "—"}</span> },
            { key: "phone", header: t("phone"), render: u => <span className="text-[13px] text-[var(--ink)]">{u.phone || "—"}</span> },
            {
              key: "status",
              header: t("status"),
              render: u => <span className={cn("badge text-xs", u.isActive ? "badge-teal" : "")}>{u.isActive ? t("active") : t("inactive")}</span>,
            },
            { key: "created", header: t("created"), render: u => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(u.createdAt)}</span> },
          ]}
        />
      </div>

      {/* Create User */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("addStaffUser")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("username")} *</Label>
                <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} data-testid="input-username" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("password")} *</Label>
                <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} data-testid="input-password" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} (EN) *</Label>
                <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} data-testid="input-full-name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} (AR)</Label>
                <Input value={form.fullNameAr} onChange={e => setForm(f => ({ ...f, fullNameAr: e.target.value }))} dir="rtl" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("role")} *</Label>
                <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger data-testid="select-role"><SelectValue /></SelectTrigger>
                  <SelectContent>{roles.map(r => <SelectItem key={r} value={r}>{t(r as any)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("phone")}</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("email")}</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-email" />
            </div>

            {/* Home address */}
            <div className="pt-1 border-t border-[var(--line)]">
              <p className="text-[11px] font-semibold text-[var(--ink-muted)] uppercase tracking-wide pt-2 pb-1">{t("homeAddress")}</p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t("addressLine")}</Label>
                  <Input value={form.addressLine} onChange={e => setForm(f => ({ ...f, addressLine: e.target.value }))} data-testid="input-address-line" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("city")}</Label>
                    <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} data-testid="input-city" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("region")}</Label>
                    <Input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} data-testid="input-region" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("postalCode")}</Label>
                    <Input value={form.postalCode} onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))} data-testid="input-postal-code" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("country")}</Label>
                    <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} data-testid="input-country" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button className="btn btn-primary btn-sm" onClick={() => createMutation.mutate({ data: form as any })} disabled={createMutation.isPending} data-testid="button-save-user">
                {createMutation.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
