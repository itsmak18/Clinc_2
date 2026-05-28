import { useState } from "react";
import { useListUsers, useCreateUser, useUpdateUser, useDeleteUser, useResetUserPassword, useToggleUserShift, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus, UserX, Coffee, Clock, KeyRound } from "lucide-react";

const roles = ["super_admin", "admin", "doctor", "nurse", "front_desk", "xray_staff", "lab_staff"] as const;

export default function Users() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterRole, setFilterRole] = useState("");
  const [form, setForm] = useState({ username: "", password: "", fullName: "", fullNameAr: "", email: "", role: "doctor", phone: "" });
  const [resetTarget, setResetTarget] = useState<{ id: number; fullName: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
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
        toast({ title: t("userCreated") });
      },
      onError: () => toast({ title: t("userCreateFailed"), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: t("userDeactivated") });
      },
    },
  });

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setEditingUser(null);
        toast({ title: t("userUpdated") });
      },
      onError: (err: any) => {
        const msg = err.response?.data?.error || t("failed");
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  const handleEdit = (u: any) => {
    setEditingUser(u);
    setEditForm({ fullName: u.fullName, fullNameAr: u.fullNameAr || "", email: u.email || "", role: u.role, phone: u.phone || "", isActive: u.isActive });
  };

  const handleUpdate = () => {
    if (!editingUser) return;
    updateMutation.mutate({ userId: editingUser.id, data: editForm as any });
  };

  const canResetPasswords = currentUser?.role === "super_admin" || currentUser?.role === "admin";
  const canManageShift = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const resetPasswordMutation = useResetUserPassword({
    mutation: {
      onSuccess: () => { toast({ title: t("passwordResetSuccess") }); setResetTarget(null); setNewPassword(""); },
      onError: () => toast({ title: t("passwordResetFailed"), variant: "destructive" }),
    },
  });

  const toggleShiftMutation = useToggleUserShift({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); toast({ title: t("shiftUpdated") }); },
      onError: () => toast({ title: t("shiftUpdateFailed"), variant: "destructive" }),
    },
  });

  const handleResetPassword = () => {
    if (!resetTarget || !newPassword) return;
    resetPasswordMutation.mutate({ userId: resetTarget.id, data: { newPassword } });
  };

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
          columns={[
            {
              key: "name",
              header: t("name"),
              render: u => (
                <div>
                  <div className="font-medium text-[13px] text-[var(--ink)]">{u.fullName}</div>
                  <div className="text-[11px] text-[var(--ink-muted)] font-mono">@{u.username}</div>
                </div>
              ),
            },
            { key: "role",   header: t("role"),   render: u => <span className="badge text-xs capitalize">{t(u.role as any)}</span> },
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
            { key: "email",  header: t("email"),  render: u => <span className="text-[13px] text-[var(--ink-muted)]">{u.email || "—"}</span> },
            { key: "phone",  header: t("phone"),  render: u => <span className="text-[13px] text-[var(--ink)]">{u.phone || "—"}</span> },
            {
              key: "status",
              header: t("status"),
              render: u => <span className={cn("badge text-xs", u.isActive ? "badge-teal" : "")}>{u.isActive ? t("active") : t("inactive")}</span>,
            },
            { key: "created", header: t("created"), render: u => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(u.createdAt)}</span> },
            {
              key: "actions",
              header: t("actions"),
              render: u => (
                <div className="flex gap-1 flex-wrap">
                  {canManageShift && (
                    <button
                      className="btn btn-ghost btn-sm h-6 text-xs px-2"
                      disabled={toggleShiftMutation.isPending && (toggleShiftMutation.variables as any)?.userId === u.id}
                      onClick={e => { e.stopPropagation(); toggleShiftMutation.mutate({ userId: u.id }); }}
                    >
                      {(u as any).isOnShift ? t("endShift") : t("startShift")}
                    </button>
                  )}
                  {canResetPasswords && u.id !== currentUser?.id && (
                    <button
                      className="btn btn-ghost btn-sm h-6 text-xs px-2 text-[var(--amber-600)]"
                      onClick={e => { e.stopPropagation(); setResetTarget({ id: u.id, fullName: u.fullName }); setNewPassword(""); }}
                    >
                      <KeyRound className="w-3 h-3 me-1" />{t("resetPwShort")}
                    </button>
                  )}
                  {u.isActive && (
                    <button className="btn btn-ghost btn-sm h-6 text-xs px-2" onClick={e => { e.stopPropagation(); handleEdit(u); }}>
                      {t("edit")}
                    </button>
                  )}
                  {u.isActive && (
                    <button
                      className="btn btn-ghost btn-sm h-6 text-xs px-2 text-[var(--rose-500)]"
                      onClick={e => { e.stopPropagation(); deleteMutation.mutate({ userId: u.id }); }}
                      data-testid={`button-deactivate-${u.id}`}
                    >
                      <UserX className="w-3 h-3 me-1" />{t("deactivate")}
                    </button>
                  )}
                </div>
              ),
            },
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
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button className="btn btn-primary btn-sm" onClick={() => createMutation.mutate({ data: form as any })} disabled={createMutation.isPending} data-testid="button-save-user">
                {createMutation.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password */}
      <Dialog open={!!resetTarget} onOpenChange={v => { if (!v) { setResetTarget(null); setNewPassword(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[var(--amber-500)]" /> {t("resetPassword")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-[var(--ink-muted)]">
              {t("resetPasswordInstruction")} <span className="font-semibold text-[var(--ink)]">{resetTarget?.fullName}</span>.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">{t("newPasswordLabel")} *</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={t("enterNewPasswordPlaceholder")}
                onKeyDown={e => e.key === "Enter" && handleResetPassword()}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn btn-outline btn-sm" onClick={() => { setResetTarget(null); setNewPassword(""); }}>{t("cancel")}</button>
              <button
                className="btn btn-sm bg-[var(--amber-500)] text-white"
                onClick={handleResetPassword}
                disabled={!newPassword || resetPasswordMutation.isPending}
              >
                {resetPasswordMutation.isPending ? t("loading") : t("resetPassword")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User */}
      <Dialog open={!!editingUser} onOpenChange={v => !v && setEditingUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("editStaffMember")}</DialogTitle></DialogHeader>
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
                  disabled={editingUser?.id === currentUser?.id || (currentUser?.role !== "super_admin" && currentUser?.role !== "admin")}
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
            {(currentUser?.role === "admin" || currentUser?.role === "super_admin") && (
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="editIsActive"
                  checked={editForm.isActive}
                  onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))}
                  disabled={editingUser?.id === currentUser?.id}
                  className="w-4 h-4 rounded border-[var(--line)]"
                />
                <Label htmlFor="editIsActive" className="text-sm cursor-pointer">{t("active")}</Label>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setEditingUser(null)}>{t("cancel")}</button>
              <button className="btn btn-primary btn-sm" onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
