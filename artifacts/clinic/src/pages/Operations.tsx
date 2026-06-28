import { useState } from "react";
import { useListOperations, useCreateOperation, useUpdateOperation, useListPatients, useListDoctors, useListUsers, getListOperationsQueryKey, getListPatientsQueryKey, getListDoctorsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import SearchSelect from "@/components/SearchSelect";
import PatientSearchSelect from "@/components/PatientSearchSelect";
import { DetailSection, DetailGrid, DetailField } from "@/components/DetailView";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/api";
import { Plus, Trash2, Users, Check, X, Play, CheckCircle2 } from "lucide-react";

interface TeamMember { userId: number; role: string; }

export default function Operations() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = user?.role === "super_admin" || user?.role === "admin" || user?.role === "doctor";
  const canApprove = user?.role === "super_admin" || user?.role === "admin";
  // Only these roles may call GET /users (the full staff directory). Doctors cannot,
  // so the OR-team picker is shown only to staff who can enumerate everyone; for a
  // doctor's request the admin assigns the team at approval time.
  const canManageTeam = user?.role === "super_admin" || user?.role === "admin" || user?.role === "front_desk" || user?.role === "nurse";
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ patientId: "", surgeonId: "", procedureName: "", scheduledAt: "", operatingRoom: "", notes: "" });
  const [team, setTeam] = useState<TeamMember[]>([]);

  const params = { status: filterStatus as any || undefined };
  const { data: operationsResp, isLoading } = useListOperations(params, { query: { queryKey: getListOperationsQueryKey(params) } });
  const operations = operationsResp?.data ?? [];
  // Read-only "view all information" detail — opened by clicking a row.
  const [viewOp, setViewOp] = useState<NonNullable<typeof operations>[number] | null>(null);
  // Reject flow — the operation pending decline + its optional reason.
  const [rejectOp, setRejectOp] = useState<NonNullable<typeof operations>[number] | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });
  // Surgeon list: /users/doctors is accessible to clinical staff (incl. doctors).
  const { data: doctors } = useListDoctors({ query: { queryKey: getListDoctorsQueryKey() } });
  // Full staff directory (for OR team) — only fetched for roles allowed to call GET /users.
  const { data: allStaff } = useListUsers({}, { query: { queryKey: getListUsersQueryKey({}), enabled: canManageTeam } });

  const userName = (id: number) => (allStaff ?? []).find(u => u.id === id)?.fullName ?? `#${id}`;

  function resetCreate() {
    setForm({ patientId: "", surgeonId: "", procedureName: "", scheduledAt: "", operatingRoom: "", notes: "" });
    setTeam([]);
  }

  const createMutation = useCreateOperation({
    mutation: {
      onSuccess: (created: any) => {
        queryClient.invalidateQueries({ queryKey: getListOperationsQueryKey() });
        setShowCreate(false);
        resetCreate();
        toast({ title: created?.status === "requested" ? t("operationRequested") : t("operationScheduled") });
      },
      onError: (err: any) => toast({ title: t("operationScheduleFailed"), description: err?.data?.message, variant: "destructive" }),
    }
  });

  const updateMutation = useUpdateOperation({
    mutation: {
      onSuccess: (updated: any) => {
        queryClient.invalidateQueries({ queryKey: getListOperationsQueryKey() });
        const titleByStatus: Record<string, string> = {
          cancelled: t("operationRejected"),
          scheduled: t("operationApproved"),
          in_progress: t("operationStarted"),
          completed: t("operationCompleted"),
        };
        toast({ title: titleByStatus[updated?.status] ?? t("operationApproved") });
      },
      onError: (err: any) => toast({ title: t("failed"), description: err?.data?.message, variant: "destructive" }),
    }
  });

  function openReject(op: NonNullable<typeof operations>[number]) {
    setRejectReason("");
    setRejectOp(op);
  }

  function confirmReject() {
    if (!rejectOp) return;
    updateMutation.mutate({ operationId: rejectOp.id, data: { status: "cancelled", notes: rejectReason.trim() || undefined } });
    setRejectOp(null);
    setViewOp(null);
  }

  // Status-driven action buttons (approve/reject, start, complete) shared by the
  // table row and the detail dialog. Lifecycle actions are visible to admins and
  // the operation's own surgeon; approve/reject stays admin-only.
  function statusActions(op: NonNullable<typeof operations>[number], opts: { compact?: boolean; onDone?: () => void }) {
    const { compact, onDone } = opts;
    const sz = compact ? "btn-sm h-7 text-xs gap-1" : "btn-sm gap-1.5";
    const ic = compact ? "w-3 h-3" : "w-3.5 h-3.5";
    const canManage = canApprove || (user?.role === "doctor" && op.surgeonId === user.id);
    const advance = (status: "scheduled" | "in_progress" | "completed") => { updateMutation.mutate({ operationId: op.id, data: { status } }); onDone?.(); };

    if (op.status === "requested" && canApprove) {
      return (
        <>
          <button className={`btn btn-primary ${sz}`} onClick={() => advance("scheduled")} disabled={updateMutation.isPending} data-testid={`button-approve-${op.id}`}>
            <Check className={ic} /> {t("approve")}
          </button>
          <button className={`btn btn-danger ${sz}`} onClick={() => openReject(op)} disabled={updateMutation.isPending} data-testid={`button-reject-${op.id}`}>
            <X className={ic} /> {t("reject")}
          </button>
        </>
      );
    }
    if (op.status === "scheduled" && canManage) {
      return (
        <button className={`btn btn-primary ${sz}`} onClick={() => advance("in_progress")} disabled={updateMutation.isPending} data-testid={`button-start-${op.id}`}>
          <Play className={ic} /> {t("startOperation")}
        </button>
      );
    }
    if (op.status === "in_progress" && canManage) {
      return (
        <button className={`btn btn-primary ${sz}`} onClick={() => advance("completed")} disabled={updateMutation.isPending} data-testid={`button-complete-${op.id}`}>
          <CheckCircle2 className={ic} /> {t("completeOperation")}
        </button>
      );
    }
    return null;
  }

  function handleSave() {
    const missing = [
      !form.patientId && t("patient"),
      !form.surgeonId && t("surgeon"),
      !form.procedureName.trim() && t("procedureName"),
      !form.scheduledAt && t("scheduledAt"),
      !form.operatingRoom.trim() && t("operatingRoom"),
    ].filter(Boolean);
    if (missing.length) { toast({ title: t("fillRequiredFields"), description: missing.join(", "), variant: "destructive" }); return; }
    const when = new Date(form.scheduledAt);
    if (isNaN(when.getTime())) { toast({ title: t("fillRequiredFields"), description: t("scheduledAt"), variant: "destructive" }); return; }
    createMutation.mutate({ data: {
      patientId: parseInt(form.patientId),
      surgeonId: parseInt(form.surgeonId),
      procedureName: form.procedureName,
      scheduledAt: when.toISOString(),
      operatingRoom: form.operatingRoom,
      notes: form.notes || undefined,
      staffAssigned: team.map(m => ({ userId: m.userId, role: m.role.trim() || undefined })),
    } as any });
  }

  const statuses = ["requested", "scheduled", "in_progress", "completed", "cancelled"];

  return (
    <div className="page">
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <Input
          className="h-8 text-sm max-w-xs"
          placeholder={t("searchByPatientOrProcedure")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 text-sm w-36"><SelectValue placeholder={t("all")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
          </SelectContent>
        </Select>
        {canWrite && (
          <button className="btn btn-primary btn-sm gap-1.5 ms-auto" onClick={() => setShowCreate(true)} data-testid="button-schedule-operation">
            <Plus className="w-3.5 h-3.5" /> {t("scheduleOperation")}
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          onRowClick={op => setViewOp(op)}
          data={(operations ?? []).filter(op => {
            if (!search) return true;
            const q = search.toLowerCase();
            return op.patient?.fullName?.toLowerCase().includes(q) || op.procedureName?.toLowerCase().includes(q);
          })}
          emptyMessage={t("noOperationsScheduled")}
          columns={[
            { key: "patient",    header: t("patient"),       render: op => <span className="font-medium text-[13px] text-[var(--ink)]">{op.patient?.fullName || `#${op.patientId}`}</span> },
            { key: "procedure",  header: t("procedureName"), render: op => <span className="text-[13px] font-medium text-[var(--ink)]">{op.procedureName}</span> },
            { key: "surgeon",    header: t("surgeon"),       render: op => (
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] text-[var(--ink)]">{op.surgeon?.fullName || `#${op.surgeonId}`}</span>
                {Array.isArray(op.staffAssigned) && op.staffAssigned.length > 0 && (
                  <span className="badge badge-teal text-[10px] gap-0.5" title={t("surgicalTeam")}><Users className="w-2.5 h-2.5" />{op.staffAssigned.length}</span>
                )}
              </div>
            ) },
            { key: "room",       header: t("operatingRoom"), render: op => <span className="text-[13px] text-[var(--ink)]">{op.operatingRoom}</span> },
            { key: "requestedBy", header: t("requestedBy"),  render: op => <span className="text-[12px] text-[var(--ink-muted)]">{op.requestedBy?.fullName ?? (op.requestedById ? `#${op.requestedById}` : "—")}</span> },
            { key: "time",       header: t("scheduledAt"),   render: op => <span className="text-[12px] text-[var(--ink-muted)]">{formatDateTime(op.scheduledAt)}</span> },
            { key: "status",     header: t("status"),        render: op => <StatusBadge status={op.status} /> },
            { key: "actions",    header: "",                 render: op => {
              const actions = statusActions(op, { compact: true });
              // Stop row-click (opens detail) from firing when an action button is pressed.
              return actions ? <div className="flex items-center gap-1.5 justify-end" onClick={e => e.stopPropagation()}>{actions}</div> : null;
            } },
          ]}
        />
      </div>

      {/* Read-only detail — all information for one operation */}
      <Dialog open={!!viewOp} onOpenChange={o => !o && setViewOp(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("operationDetails")}</DialogTitle></DialogHeader>
          {viewOp && (
            <div className="space-y-5">
              <DetailGrid cols={3}>
                <DetailField label={t("patient")} value={viewOp.patient?.fullName || `#${viewOp.patientId}`} />
                <DetailField label={t("procedureName")} value={viewOp.procedureName} />
                <DetailField label={t("status")} value={<StatusBadge status={viewOp.status} />} />
                <DetailField label={t("surgeon")} value={viewOp.surgeon?.fullName || `#${viewOp.surgeonId}`} />
                <DetailField label={t("operatingRoom")} value={viewOp.operatingRoom} />
                <DetailField label={t("scheduledAt")} value={formatDateTime(viewOp.scheduledAt)} />
                <DetailField label={t("requestedBy")} value={viewOp.requestedBy?.fullName ?? (viewOp.requestedById ? `#${viewOp.requestedById}` : null)} />
              </DetailGrid>

              <DetailSection title={t("surgicalTeam")}>
                {Array.isArray(viewOp.staffAssigned) && viewOp.staffAssigned.length > 0 ? (
                  <div className="space-y-1.5">
                    {(viewOp.staffAssigned as any[]).map((m: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-[13px]">
                        <Users className="w-3.5 h-3.5 text-[var(--ink-muted)] flex-shrink-0" />
                        <span className="text-[var(--ink)]">{userName(m.userId)}</span>
                        {m.role && <span className="badge badge-sage text-[10px] capitalize">{m.role}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-[var(--ink-faint)]">{t("noTeamAssigned")}</p>
                )}
              </DetailSection>

              {viewOp.notes && (
                <DetailSection>
                  <DetailField label={t("notes")} value={viewOp.notes} full />
                </DetailSection>
              )}

              <div className="flex justify-between gap-2 pt-1">
                {(() => {
                  const actions = statusActions(viewOp, { compact: false, onDone: () => setViewOp(null) });
                  return actions ? <div className="flex gap-2">{actions}</div> : <span />;
                })()}
                <button className="btn btn-outline btn-sm" onClick={() => setViewOp(null)}>{t("close")}</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject a pending request — optional decline reason. */}
      <Dialog open={!!rejectOp} onOpenChange={o => !o && setRejectOp(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("rejectOperation")}</DialogTitle></DialogHeader>
          {rejectOp && (
            <div className="space-y-3">
              <p className="text-[13px] text-[var(--ink-muted)]">{t("rejectOperationConfirm")}</p>
              <div className="space-y-1">
                <Label className="text-xs">{t("rejectionReason")} <span className="text-[var(--ink-faint)]">({t("optional")})</span></Label>
                <Textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder={t("rejectionReasonPlaceholder")}
                  data-testid="input-reject-reason"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button className="btn btn-outline btn-sm" onClick={() => setRejectOp(null)}>{t("cancel")}</button>
                <button
                  className="btn btn-danger btn-sm gap-1.5"
                  onClick={confirmReject}
                  disabled={updateMutation.isPending}
                  data-testid="button-confirm-reject"
                >
                  <X className="w-3.5 h-3.5" /> {t("reject")}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("scheduleOperation")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("patient")} *</Label>
                <PatientSearchSelect
                  testId="select-patient"
                  value={form.patientId}
                  onChange={v => setForm(f => ({ ...f, patientId: v }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("surgeon")} *</Label>
                <SearchSelect
                  data-testid="select-surgeon"
                  value={form.surgeonId}
                  onChange={v => setForm(f => ({ ...f, surgeonId: v }))}
                  placeholder={t("selectDoctor2")}
                  searchPlaceholder={t("searchDoctor")}
                  emptyText={t("noDoctorsFound")}
                  options={(doctors ?? []).map(d => ({ value: String(d.id), label: d.fullName, search: d.fullName }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("procedureName")} *</Label>
              <Input value={form.procedureName} onChange={e => setForm(f => ({ ...f, procedureName: e.target.value }))} data-testid="input-procedure" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("scheduledAt")} *</Label>
                <Input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} data-testid="input-scheduled-at" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("operatingRoom")} *</Label>
                <Input value={form.operatingRoom} onChange={e => setForm(f => ({ ...f, operatingRoom: e.target.value }))} placeholder="OR-1, OR-2..." data-testid="input-or" />
              </div>
            </div>

            {/* Surgical team — everyone assisting in the OR (anesthetist, scrub/circulating nurse, assistants).
                Only roles that can list the full staff directory see this; for a doctor's request the
                admin assigns the team when approving. */}
            {canManageTeam && (
              <div className="space-y-2">
                <Label className="text-xs">{t("surgicalTeam")}</Label>
                {team.map((m, i) => (
                  <div key={m.userId} className="flex items-center gap-2">
                    <span className="text-[13px] text-[var(--ink)] flex-shrink-0 min-w-[120px] truncate">{userName(m.userId)}</span>
                    <Input
                      value={m.role}
                      onChange={e => setTeam(ts => ts.map((x, idx) => idx === i ? { ...x, role: e.target.value } : x))}
                      placeholder={t("staffRolePlaceholder")}
                      className="h-8 text-xs"
                      data-testid={`input-team-role-${i}`}
                    />
                    <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0 text-[var(--ink-muted)] hover:text-[var(--rose-500)] flex-shrink-0" onClick={() => setTeam(ts => ts.filter((_, idx) => idx !== i))} aria-label={t("remove")}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <SearchSelect
                  data-testid="select-team-member"
                  value=""
                  onChange={v => { const id = parseInt(v); if (id && !team.some(m => m.userId === id)) setTeam(ts => [...ts, { userId: id, role: "" }]); }}
                  placeholder={t("addStaffMember")}
                  searchPlaceholder={t("searchStaff")}
                  emptyText={t("noStaffFound")}
                  options={(allStaff ?? [])
                    .filter(u => String(u.id) !== form.surgeonId && !team.some(m => m.userId === u.id))
                    .map(u => ({ value: String(u.id), label: `${u.fullName} (${t(u.role as any)})`, search: `${u.fullName} ${u.role}` }))}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            {!canApprove && (
              <p className="text-[11px] text-[var(--ink-muted)] flex items-center gap-1.5">
                <Check className="w-3 h-3 flex-shrink-0" /> {t("operationNeedsApprovalHint")}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={createMutation.isPending}
                data-testid="button-save-operation"
              >
                {createMutation.isPending ? t("loading") : (canApprove ? t("save") : t("sendRequest"))}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
