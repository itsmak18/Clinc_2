import { useState } from "react";
import { useListUsers, useCreateUser, useUpdateUser, useDeleteUser, getListUsersQueryKey } from "@workspace/api-client-react";
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
import { Plus, UserX, Coffee, Clock, KeyRound } from "lucide-react";

const BASE = import.meta.env.BASE_URL ?? "/";
const apiUrl = (path: string) => `${BASE}api/${path}`.replace(/\/+/g, "/");

async function apiFetch(path: string, method = "POST", body?: object) {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
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
  const [resetTarget, setResetTarget] = useState<{ id: number; fullName: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ fullName: "", fullNameAr: "", email: "", role: "", phone: "", isActive: true });

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

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setEditingUser(null);
        toast({ title: "User updated" });
      },
      onError: (err: any) => {
        const msg = err.response?.data?.error || "Failed to update user";
        toast({ title: msg, variant: "destructive" });
      }
    }
  });

  const handleEdit = (u: any) => {
    setEditingUser(u);
    setEditForm({
      fullName: u.fullName,
      fullNameAr: u.fullNameAr || "",
      email: u.email || "",
      role: u.role,
      phone: u.phone || "",
      isActive: u.isActive
    });
  };

  const handleUpdate = () => {
    if (!editingUser) return;
    updateMutation.mutate({
      userId: editingUser.id,
      data: editForm as any
    });
  };

  const canResetPasswords = currentUser?.role === "super_admin" || currentUser?.role === "admin";

  const handleResetPassword = async () => {
    if (!resetTarget || !newPassword) return;
    setResetLoading(true);
    try {
      await apiFetch(`users/${resetTarget.id}/reset-password`, "POST", { newPassword });
      toast({ title: "Password reset successfully" });
      setResetTarget(null);
      setNewPassword("");
    } catch {
      toast({ title: "Failed to reset password", variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  };

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
          <Select value={filterRole || "all"} onValueChange={v => setFilterRole(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm w-40" data-testid="select-filter-role">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
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
                  {canResetPasswords && u.id !== currentUser?.id && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                      onClick={(e) => { e.stopPropagation(); setResetTarget({ id: u.id, fullName: u.fullName }); setNewPassword(""); }}>
                      <KeyRound className="w-3 h-3 me-1" /> Reset PW
                    </Button>
                  )}
                  {u.isActive ? (
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                      onClick={(e) => { e.stopPropagation(); handleEdit(u); }}>
                      Edit
                    </Button>
                  ) : null}
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

      {/* Reset Password Dialog */}
      <Dialog open={!!resetTarget} onOpenChange={v => { if (!v) { setResetTarget(null); setNewPassword(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-500" /> Reset Password
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Set a new password for <span className="font-semibold text-foreground">{resetTarget?.fullName}</span>.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">New Password *</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                onKeyDown={e => e.key === "Enter" && handleResetPassword()}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => { setResetTarget(null); setNewPassword(""); }}>
                {t("cancel")}
              </Button>
              <Button size="sm" onClick={handleResetPassword} disabled={!newPassword || resetLoading} className="bg-amber-500 hover:bg-amber-600 text-white">
                {resetLoading ? t("loading") : "Reset Password"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={v => !v && setEditingUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Staff Member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} (EN) *</Label>
                <Input value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} (AR)</Label>
                <Input value={editForm.fullNameAr} onChange={e => setEditForm(f => ({ ...f, fullNameAr: e.target.value }))} dir="rtl" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("role")} *</Label>
                <Select
                  value={editForm.role}
                  onValueChange={v => setEditForm(f => ({ ...f, role: v }))}
                  disabled={editingUser?.id === currentUser?.id || currentUser?.role !== "super_admin" && currentUser?.role !== "admin"}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{roles.map(r => <SelectItem key={r} value={r}>{t(r as any)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("phone")}</Label>
                <Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("email")}</Label>
              <Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
            </div>

            {/* Admin only fields */}
            {(currentUser?.role === "admin" || currentUser?.role === "super_admin") && (
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="editIsActive"
                  checked={editForm.isActive}
                  onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))}
                  disabled={editingUser?.id === currentUser?.id}
                  className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <Label htmlFor="editIsActive" className="text-sm cursor-pointer">{t("active")}</Label>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditingUser(null)}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
