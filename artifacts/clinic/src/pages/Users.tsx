import { useState } from "react";
import { useListUsers, useCreateUser, useDeleteUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { Plus, UserX, Coffee, Clock } from "lucide-react";

const BASE = import.meta.env.BASE_URL ?? "/";
const apiUrl = (path: string) => `${BASE}api/${path}`.replace(/\/+/g, "/");

async function apiFetch(path: string, method = "POST", body?: object) {
  const token = localStorage.getItem("clinic_token");
  const res = await fetch(apiUrl(path), {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const roles = ["super_admin", "admin", "doctor", "nurse", "front_desk", "xray_staff", "lab_staff"] as const;

export default function Users() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterRole, setFilterRole] = useState("");
  const [shiftLoading, setShiftLoading] = useState<number | null>(null);
  const [form, setForm] = useState({ username: "", password: "", fullName: "", fullNameAr: "", email: "", role: "doctor", phone: "" });

  const params = { role: filterRole as any || undefined };
  const { data: users, isLoading } = useListUsers(params, { query: { queryKey: getListUsersQueryKey(params) } });

  const createMutation = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setShowCreate(false);
        setForm({ username: "", password: "", fullName: "", fullNameAr: "", email: "", role: "doctor", phone: "" });
        toast({ title: "User created" });
      },
      onError: () => toast({ title: "Failed to create user", variant: "destructive" }),
    }
  });

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "User deactivated" });
      },
    }
  });

  const toggleShift = async (userId: number) => {
    setShiftLoading(userId);
    try {
      await apiFetch(`users/${userId}/toggle-shift`);
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      toast({ title: "Shift status updated" });
    } catch {
      toast({ title: "Failed to update shift", variant: "destructive" });
    } finally {
      setShiftLoading(null);
    }
  };

  const canManageShift = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  return (
    <div>
      <PageHeader
        title={t("users")}
        subtitle={`${users?.length ?? 0} staff members`}
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-user">
            <Plus className="w-3.5 h-3.5 me-1" /> Add User
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="h-8 text-sm w-40" data-testid="select-filter-role">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All roles</SelectItem>
              {roles.map(r => <SelectItem key={r} value={r}>{t(r as any)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={users ?? []}
            emptyMessage="No users found"
            columns={[
              { key: "name", header: t("name"), render: u => (
                <div>
                  <div className="font-medium text-sm">{u.fullName}</div>
                  <div className="text-xs text-muted-foreground">@{u.username}</div>
                </div>
              )},
              { key: "role", header: t("role"), render: u => <Badge variant="outline" className="text-xs capitalize">{t(u.role as any)}</Badge> },
              { key: "shift", header: "Shift", render: u => (
                <Badge variant={(u as any).isOnShift ? "default" : "secondary"} className="text-xs gap-1">
                  {(u as any).isOnShift ? <><Coffee className="w-2.5 h-2.5" /> On Shift</> : <><Clock className="w-2.5 h-2.5" /> Off</>}
                </Badge>
              )},
              { key: "email", header: t("email"), render: u => <span className="text-sm text-muted-foreground">{u.email || "-"}</span> },
              { key: "phone", header: t("phone"), render: u => <span className="text-sm">{u.phone || "-"}</span> },
              { key: "status", header: t("status"), render: u => <Badge variant={u.isActive ? "default" : "secondary"} className="text-xs">{u.isActive ? t("active") : t("inactive")}</Badge> },
              { key: "created", header: "Created", render: u => <span className="text-sm">{formatDate(u.createdAt)}</span> },
              { key: "actions", header: t("actions"), render: u => (
                <div className="flex gap-1">
                  {canManageShift && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" disabled={shiftLoading === u.id}
                      onClick={(e) => { e.stopPropagation(); toggleShift(u.id); }}>
                      {(u as any).isOnShift ? "End Shift" : "Start Shift"}
                    </Button>
                  )}
                  {u.isActive ? (
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ userId: u.id }); }}
                      data-testid={`button-deactivate-${u.id}`}>
                      <UserX className="w-3 h-3 me-1" /> Deactivate
                    </Button>
                  ) : null}
                </div>
              )},
            ]}
          />
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Staff User</DialogTitle></DialogHeader>
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
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: form as any })} disabled={createMutation.isPending} data-testid="button-save-user">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
