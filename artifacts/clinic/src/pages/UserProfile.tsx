import { useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetUser, useUpdateUser, getGetUserQueryKey, getListUsersQueryKey,
  useGetDoctorSchedule, useUpsertWeeklyBlock, useDeleteWeeklyBlock, useUpdateWeeklyBlockStatus,
  getGetDoctorScheduleQueryKey,
  useListAppointments, getListAppointmentsQueryKey,
  useToggleUserShift, useResetUserPassword,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import StatusBadge from "@/components/StatusBadge";
import ChangeHistoryCard from "@/components/ChangeHistory";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ArrowLeft, User, Clock, CalendarDays, Users as UsersIcon, Pencil, Power, Trash2, Edit2, KeyRound, Coffee, MapPin } from "lucide-react";

const ROLES = ["super_admin", "admin", "doctor", "nurse", "front_desk", "xray_staff", "lab_staff"] as const;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type Day = typeof DAYS[number];

interface BlockForm { dayOfWeek: Day; startTime: string; endTime: string; slotMinutes: number; maxPatients: number; }
const defaultBlock = (day: Day): BlockForm => ({ dayOfWeek: day, startTime: "09:00", endTime: "17:00", slotMinutes: 30, maxPatients: 16 });

export default function UserProfile() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const params = useParams<{ userId: string }>();
  const userId = parseInt(params.userId ?? "0");

  const canManage = currentUser?.role === "super_admin" || currentUser?.role === "admin";

  const { data: user, isLoading } = useGetUser(userId, { query: { enabled: !!userId, queryKey: getGetUserQueryKey(userId) } });
  const isDoctor = user?.role === "doctor";

  const { data: schedule } = useGetDoctorSchedule(userId, { query: { enabled: !!userId && isDoctor, queryKey: getGetDoctorScheduleQueryKey(userId) } });
  const blocks: any[] = (schedule as any)?.weeklyTemplate ?? [];
  const blockByDay = (day: Day) => blocks.find(b => b.dayOfWeek === day);

  const apptParams = { doctorId: userId } as any;
  const { data: apptResp } = useListAppointments(apptParams, { query: { enabled: !!userId && isDoctor, queryKey: getListAppointmentsQueryKey(apptParams) } });
  const appointments: any[] = (apptResp as any)?.data ?? [];

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ fullName: "", fullNameAr: "", email: "", role: "", phone: "", isActive: true, addressLine: "", city: "", region: "", postalCode: "", country: "" });
  const [blockDialog, setBlockDialog] = useState<BlockForm | null>(null);
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDoctorScheduleQueryKey(userId) });
  }

  const updateUser = useUpdateUser({
    mutation: {
      onSuccess: () => { invalidate(); setEditing(false); toast({ title: t("userUpdated") }); },
      onError: (err: any) => toast({ title: err?.data?.message ?? t("failed"), variant: "destructive" }),
    },
  });
  const upsertBlock = useUpsertWeeklyBlock({
    mutation: {
      onSuccess: () => { invalidate(); setBlockDialog(null); toast({ title: t("save") }); },
      onError: (err: any) => toast({ title: err?.data?.message ?? t("failed"), variant: "destructive" }),
    },
  });
  const deleteBlock = useDeleteWeeklyBlock({
    mutation: { onSuccess: () => { invalidate(); toast({ title: t("dayOff") }); }, onError: () => toast({ title: t("failed"), variant: "destructive" }) },
  });
  const toggleStatus = useUpdateWeeklyBlockStatus({
    mutation: { onSuccess: invalidate, onError: () => toast({ title: t("failed"), variant: "destructive" }) },
  });
  const toggleShift = useToggleUserShift({
    mutation: { onSuccess: () => { invalidate(); toast({ title: t("shiftUpdated") }); }, onError: () => toast({ title: t("shiftUpdateFailed"), variant: "destructive" }) },
  });
  const resetPassword = useResetUserPassword({
    mutation: {
      onSuccess: () => { setResetting(false); setNewPassword(""); toast({ title: t("passwordResetSuccess") }); },
      onError: () => toast({ title: t("passwordResetFailed"), variant: "destructive" }),
    },
  });

  function openEdit() {
    if (!user) return;
    setEditForm({ fullName: user.fullName, fullNameAr: (user as any).fullNameAr ?? "", email: user.email ?? "", role: user.role, phone: user.phone ?? "", isActive: user.isActive, addressLine: (user as any).addressLine ?? "", city: (user as any).city ?? "", region: (user as any).region ?? "", postalCode: (user as any).postalCode ?? "", country: (user as any).country ?? "" });
    setEditing(true);
  }

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--ink-muted)]">{t("loading")}</div>;
  if (!user) return <div className="p-6 text-[var(--ink-muted)]">{t("noUsersFound")}</div>;

  const infoFields = [
    { label: t("username"),   value: <span className="font-mono text-[var(--ink)]">@{user.username}</span> },
    { label: t("role"),       value: <span className="badge text-xs capitalize">{t(user.role as any)}</span> },
    { label: t("email"),      value: <span className="text-[var(--ink)]">{user.email || "-"}</span> },
    { label: t("phone"),      value: <span className="text-[var(--ink)]">{user.phone || "-"}</span> },
    ...(isDoctor ? [
      { label: t("specialty"),  value: <span className="text-[var(--ink)]">{(user as any).specialty || "-"}</span> },
      { label: t("department"), value: <span className="text-[var(--ink)]">{(user as any).department || "-"}</span> },
    ] : []),
    { label: t("shift"),      value: <span className={cn("badge text-xs", (user as any).isOnShift ? "badge-sage" : "")}>{(user as any).isOnShift ? t("onShift") : t("offShift")}</span> },
    { label: t("status"),     value: <span className={cn("badge text-xs", user.isActive ? "badge-teal" : "")}>{user.isActive ? t("active") : t("inactive")}</span> },
    { label: t("created"),    value: <span className="text-[var(--ink)]">{formatDate(user.createdAt)}</span> },
  ];

  return (
    <div className="page">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-[var(--ink)] text-[15px] leading-tight">{user.fullName}</h1>
          <p className="text-[12px] text-[var(--ink-muted)] font-mono">@{user.username} · {t(user.role as any)}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {canManage && (
            <>
              <button className="btn btn-ghost btn-sm gap-1.5" onClick={() => toggleShift.mutate({ userId })} disabled={toggleShift.isPending} data-testid="button-toggle-shift">
                <Coffee className="w-3.5 h-3.5" /> {(user as any).isOnShift ? t("endShift") : t("startShift")}
              </button>
              {userId !== currentUser?.id && (
                <button className="btn btn-ghost btn-sm gap-1.5 text-[var(--amber-600)]" onClick={() => { setNewPassword(""); setResetting(true); }} data-testid="button-reset-pw">
                  <KeyRound className="w-3.5 h-3.5" /> {t("resetPwShort")}
                </button>
              )}
              <button className="btn btn-primary btn-sm gap-1.5" onClick={openEdit} data-testid="button-edit-profile">
                <Edit2 className="w-3.5 h-3.5" /> {t("edit")}
              </button>
            </>
          )}
          <button className="btn btn-outline btn-sm gap-1.5" onClick={() => setLocation("/users")} data-testid="button-back">
            <ArrowLeft className="w-3.5 h-3.5" /> {t("back")}
          </button>
        </div>
      </div>

      {/* Staff Info Card */}
      <div className="card mb-4">
        <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
          <User className="w-4 h-4 text-[var(--teal-600)]" />
          <span className="font-semibold text-[14px] text-[var(--ink)]">{t("staffInformation")}</span>
        </div>
        <div className="card-pad grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 text-sm">
          {infoFields.map(({ label, value }) => (
            <div key={label}>
              <p className="text-[11px] text-[var(--ink-muted)] mb-0.5">{label}</p>
              <div className="font-medium text-[13px]">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Home Address Card */}
      <div className="card mb-4">
        <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[var(--teal-600)]" />
          <span className="font-semibold text-[14px] text-[var(--ink)]">{t("homeAddress")}</span>
        </div>
        {((user as any).addressLine || (user as any).city || (user as any).region || (user as any).postalCode || (user as any).country) ? (
          <div className="card-pad grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 text-sm">
            {[
              { label: t("addressLine"), value: (user as any).addressLine },
              { label: t("city"),        value: (user as any).city },
              { label: t("region"),      value: (user as any).region },
              { label: t("postalCode"),  value: (user as any).postalCode },
              { label: t("country"),     value: (user as any).country },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[11px] text-[var(--ink-muted)] mb-0.5">{label}</p>
                <div className="font-medium text-[13px] text-[var(--ink)]">{value || "-"}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card-pad text-sm text-[var(--ink-muted)]">{t("noAddressOnFile")}</div>
        )}
      </div>

      {/* Tabs: Overview / Working hours (doctors) */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("overview")}</TabsTrigger>
          {isDoctor && (
            <TabsTrigger value="hours" className="gap-1.5">
              <Clock className="w-3.5 h-3.5" /> {t("workingHours")}
              <span className="badge text-[10px] px-1.5 ms-1">{blocks.length}</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4">
          {isDoctor ? (
            <div className="card">
              <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[var(--teal-600)]" />
                <span className="font-semibold text-[13px] text-[var(--ink)]">{t("appointments")}</span>
                <span className="badge text-xs ms-auto">{appointments.length}</span>
              </div>
              <div className="card-pad space-y-2">
                {!appointments.length
                  ? <p className="text-xs text-[var(--ink-muted)]">{t("noAppointments")}</p>
                  : appointments.slice(0, 12).map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs border-b border-[var(--line)]/40 pb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-[var(--ink)]">{a.patient?.fullName ?? `#${a.patientId}`}</p>
                        <p className="text-[var(--ink-muted)]">{formatDateTime(a.scheduledAt)}{a.reason ? ` · ${a.reason}` : ""}</p>
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                  ))
                }
              </div>
            </div>
          ) : (
            <div className="card card-pad text-sm text-[var(--ink-muted)]">{t("noClinicalActivity")}</div>
          )}
        </TabsContent>

        {/* Working hours (doctors) */}
        {isDoctor && (
          <TabsContent value="hours" className="mt-4">
            <div className="card">
              <div className="card-pad border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[var(--teal-600)]" />
                <span className="font-medium text-sm text-[var(--ink)]">{t("workingHours")}</span>
                <span className="text-[11px] text-[var(--ink-muted)] ms-auto">{t("workingHoursHint")}</span>
              </div>
              <div className="p-3 space-y-2">
                {DAYS.map(day => {
                  const b = blockByDay(day);
                  return (
                    <div key={day} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-[var(--line)] px-3 py-2.5", b && b.status === "active" ? "bg-[var(--surface)]" : "bg-[var(--surface-2)]")}>
                      <div className="w-24 flex-shrink-0 font-medium text-[13px] text-[var(--ink)] capitalize">{t(day as any)}</div>
                      {b ? (
                        <>
                          <span className="text-[13px] text-[var(--ink)]">{b.startTime.slice(0, 5)} – {b.endTime.slice(0, 5)}</span>
                          <span className="badge text-[11px] gap-1"><Clock className="w-3 h-3" />{b.slotMinutes} {t("min")}</span>
                          <span className="badge text-[11px] gap-1"><UsersIcon className="w-3 h-3" />{b.maxPatients}</span>
                          {b.status !== "active" && <span className="badge text-[11px]">{t("inactive")}</span>}
                          {canManage && (
                            <div className="ms-auto flex items-center gap-1">
                              <button className="btn btn-ghost btn-sm h-7 w-7 p-0" title={b.status === "active" ? t("inactive") : t("active")} onClick={() => toggleStatus.mutate({ doctorId: userId, day, data: { status: b.status === "active" ? "inactive" : "active" } })}><Power className="w-3.5 h-3.5" /></button>
                              <button className="btn btn-ghost btn-sm h-7 w-7 p-0" title={t("edit")} onClick={() => setBlockDialog({ dayOfWeek: day, startTime: b.startTime.slice(0, 5), endTime: b.endTime.slice(0, 5), slotMinutes: b.slotMinutes, maxPatients: b.maxPatients })}><Pencil className="w-3.5 h-3.5" /></button>
                              <button className="btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--rose-500)]" title={t("dayOff")} onClick={() => deleteBlock.mutate({ doctorId: userId, day })}><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-[13px] text-[var(--ink-faint)]">{t("dayOff")}</span>
                          {canManage && (
                            <button className="btn btn-outline btn-sm h-7 text-xs ms-auto" onClick={() => setBlockDialog(defaultBlock(day))}>{t("setHours")}</button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Change history (super_admin / compliance) */}
      {userId > 0 && ["super_admin", "compliance_officer"].includes(currentUser?.role || "") && (
        <div className="mt-4">
          <ChangeHistoryCard entityType="user" entityId={userId} />
        </div>
      )}

      {/* Edit user dialog */}
      <Dialog open={editing} onOpenChange={v => !v && setEditing(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("editStaffMember")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t("name")} (EN) *</Label><Input value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("name")} (AR)</Label><Input value={editForm.fullNameAr} onChange={e => setEditForm(f => ({ ...f, fullNameAr: e.target.value }))} dir="rtl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("role")} *</Label>
                <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))} disabled={userId === currentUser?.id}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{t(r as any)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">{t("phone")}</Label><Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">{t("email")}</Label><Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></div>

            {/* Home address */}
            <div className="pt-1 border-t border-[var(--line)]">
              <p className="text-[11px] font-semibold text-[var(--ink-muted)] uppercase tracking-wide pt-2 pb-1">{t("homeAddress")}</p>
              <div className="space-y-3">
                <div className="space-y-1"><Label className="text-xs">{t("addressLine")}</Label><Input value={editForm.addressLine} onChange={e => setEditForm(f => ({ ...f, addressLine: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">{t("city")}</Label><Input value={editForm.city} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} /></div>
                  <div className="space-y-1"><Label className="text-xs">{t("region")}</Label><Input value={editForm.region} onChange={e => setEditForm(f => ({ ...f, region: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">{t("postalCode")}</Label><Input value={editForm.postalCode} onChange={e => setEditForm(f => ({ ...f, postalCode: e.target.value }))} /></div>
                  <div className="space-y-1"><Label className="text-xs">{t("country")}</Label><Input value={editForm.country} onChange={e => setEditForm(f => ({ ...f, country: e.target.value }))} /></div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input type="checkbox" id="profileActive" checked={editForm.isActive} onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))} disabled={userId === currentUser?.id} className="w-4 h-4 rounded border-[var(--line)]" />
              <Label htmlFor="profileActive" className="text-sm cursor-pointer">{t("active")}</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>{t("cancel")}</button>
              <button className="btn btn-primary btn-sm" onClick={() => updateUser.mutate({ userId, data: editForm as any })} disabled={updateUser.isPending}>{updateUser.isPending ? t("loading") : t("save")}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={resetting} onOpenChange={v => { if (!v) { setResetting(false); setNewPassword(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-[var(--amber-500)]" />{t("resetPassword")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-[var(--ink-muted)]">{t("resetPasswordInstruction")} <span className="font-semibold text-[var(--ink)]">{user.fullName}</span>.</p>
            <div className="space-y-1">
              <Label className="text-xs">{t("newPasswordLabel")} *</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={t("enterNewPasswordPlaceholder")} onKeyDown={e => e.key === "Enter" && newPassword && resetPassword.mutate({ userId, data: { newPassword } })} autoFocus />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn btn-outline btn-sm" onClick={() => { setResetting(false); setNewPassword(""); }}>{t("cancel")}</button>
              <button className="btn btn-sm bg-[var(--amber-500)] text-white" onClick={() => resetPassword.mutate({ userId, data: { newPassword } })} disabled={!newPassword || resetPassword.isPending}>
                {resetPassword.isPending ? t("loading") : t("resetPassword")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Set/edit working-hours block */}
      <Dialog open={!!blockDialog} onOpenChange={v => !v && setBlockDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2 capitalize">{t("workingHours")} — {blockDialog && t(blockDialog.dayOfWeek as any)}</DialogTitle></DialogHeader>
          {blockDialog && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">{t("startTime")} *</Label><Input type="time" value={blockDialog.startTime} onChange={e => setBlockDialog(b => b && ({ ...b, startTime: e.target.value }))} /></div>
                <div className="space-y-1"><Label className="text-xs">{t("endTime")} *</Label><Input type="time" value={blockDialog.endTime} onChange={e => setBlockDialog(b => b && ({ ...b, endTime: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">{t("slotMinutes")}</Label><Input type="number" min={5} step={5} value={blockDialog.slotMinutes} onChange={e => setBlockDialog(b => b && ({ ...b, slotMinutes: parseInt(e.target.value) || 30 }))} /></div>
                <div className="space-y-1"><Label className="text-xs">{t("maxPatients")}</Label><Input type="number" min={1} value={blockDialog.maxPatients} onChange={e => setBlockDialog(b => b && ({ ...b, maxPatients: parseInt(e.target.value) || 1 }))} /></div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn btn-outline btn-sm" onClick={() => setBlockDialog(null)}>{t("cancel")}</button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={upsertBlock.isPending || !blockDialog.startTime || !blockDialog.endTime || blockDialog.endTime <= blockDialog.startTime}
                  onClick={() => upsertBlock.mutate({ doctorId: userId, data: { dayOfWeek: blockDialog.dayOfWeek, startTime: blockDialog.startTime, endTime: blockDialog.endTime, slotMinutes: blockDialog.slotMinutes, maxPatients: blockDialog.maxPatients } })}
                >
                  {upsertBlock.isPending ? t("loading") : t("save")}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
