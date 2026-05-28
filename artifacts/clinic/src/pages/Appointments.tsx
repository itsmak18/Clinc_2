import { useState } from "react";
import {
  useListAppointments, useCreateAppointment, useCheckInPatient, useCancelAppointment,
  useStartTriage, useStartConsultation, useRequestDiagnostics, usePendingPayment, useCompleteAppointment,
  useListPatients, useListUsers,
  getListAppointmentsQueryKey, getListPatientsQueryKey, getListUsersQueryKey,
  useGetTodayAppointments, getGetTodayAppointmentsQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/auth";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import DischargeSheet from "@/components/DischargeSheet";
import DayScheduleView from "@/components/DayScheduleView";
import GlobalSearch from "@/components/GlobalSearch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime, exportToCSV } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Phone, Globe, Building2, Plus, UserCheck, Stethoscope, CreditCard,
  CheckCircle, AlertTriangle, FileText, Download, CalendarDays, List,
} from "lucide-react";

const ALL_STATUSES = [
  "scheduled", "checked_in", "in_triage", "ready_for_doctor",
  "in_consultation", "awaiting_diagnostics", "pending_payment",
  "completed", "cancelled", "no_show", "in_progress",
];

function bookingSourceBadge(source: string | null | undefined) {
  if (!source || source === "walk_in")
    return <span className="badge text-[10px] gap-0.5"><Building2 className="w-2.5 h-2.5" /> Walk-in</span>;
  if (source === "phone")
    return <span className="badge badge-sand text-[10px] gap-0.5"><Phone className="w-2.5 h-2.5" /> Phone</span>;
  return <span className="badge badge-blue text-[10px] gap-0.5"><Globe className="w-2.5 h-2.5" /> Online</span>;
}

export default function Appointments() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isFrontDeskUser = user?.role === "front_desk";
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [search, setSearch] = useState("");
  const [transitionLoading, setTransitionLoading] = useState<number | null>(null);
  const [form, setForm] = useState({ patientId: "", doctorId: "", scheduledAt: "", reason: "", notes: "", bookingSource: "walk_in" });
  const [dischargeApptId, setDischargeApptId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "day">(isFrontDeskUser ? "day" : "list");
  const todayStr = new Date().toISOString().split("T")[0];
  const dayViewDate = filterDate || todayStr;

  const params = {
    status: filterStatus as any || undefined,
    date: filterDate || undefined,
    limit: 50,
  };

  const { data: appointmentsResp, isLoading } = useListAppointments(params, {
    query: { queryKey: getListAppointmentsQueryKey(params), refetchInterval: 30000 },
  });
  const appointments = appointmentsResp?.data ?? [];
  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });
  const { data: users } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayAppointmentsQueryKey() });
  };

  const createMutation = useCreateAppointment({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        setShowCreate(false);
        setForm({ patientId: "", doctorId: "", scheduledAt: "", reason: "", notes: "", bookingSource: "walk_in" });
        toast({ title: t("appointmentCreated") });
      },
      onError: () => toast({ title: t("appointmentCreateFailed"), variant: "destructive" }),
    },
  });

  const checkInMutation = useCheckInPatient({
    mutation: { onSuccess: () => { invalidateAll(); toast({ title: t("patientCheckedIn") }); } },
  });

  const cancelMutation = useCancelAppointment({
    mutation: { onSuccess: () => { invalidateAll(); toast({ title: t("appointmentCancelled") }); } },
  });

  const transitionHooks = {
    triage:      useStartTriage(),
    consult:     useStartConsultation(),
    diagnostics: useRequestDiagnostics(),
    payment:     usePendingPayment(),
    complete:    useCompleteAppointment(),
  } as const;

  type TransitionKey = keyof typeof transitionHooks;

  const transition = async (apptId: number, endpoint: TransitionKey, label: string) => {
    setTransitionLoading(apptId);
    try {
      await transitionHooks[endpoint].mutateAsync({ appointmentId: apptId });
      invalidateAll();
      toast({ title: label });
    } catch {
      toast({ title: `${t("failed")}: ${label}`, variant: "destructive" });
    } finally {
      setTransitionLoading(null);
    }
  };

  const role = user?.role;
  const isNurse   = role === "nurse"      || role === "admin" || role === "super_admin";
  const isDoctor  = role === "doctor"     || role === "admin" || role === "super_admin";
  const isFrontDesk = role === "front_desk" || role === "admin" || role === "super_admin";

  return (
    <div className="page">
      {isFrontDeskUser && (
        <div className="mb-4">
          <GlobalSearch />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* View toggle */}
        <div className="flex border border-[var(--line)] rounded-lg overflow-hidden">
          <button
            className={cn("h-8 px-3 text-xs flex items-center gap-1.5 transition-colors", viewMode === "list" ? "bg-[var(--teal-600)] text-white" : "hover:bg-[var(--surface-2)] text-[var(--ink-muted)]")}
            onClick={() => setViewMode("list")}
          >
            <List className="w-3.5 h-3.5" /> {t("list")}
          </button>
          <button
            className={cn("h-8 px-3 text-xs flex items-center gap-1.5 border-s border-[var(--line)] transition-colors", viewMode === "day" ? "bg-[var(--teal-600)] text-white" : "hover:bg-[var(--surface-2)] text-[var(--ink-muted)]")}
            onClick={() => setViewMode("day")}
          >
            <CalendarDays className="w-3.5 h-3.5" /> {t("dayView")}
          </button>
        </div>

        {viewMode === "list" && (
          <Input className="h-8 text-sm max-w-xs" placeholder={t("searchByPatientOrReason")} value={search} onChange={e => setSearch(e.target.value)} />
        )}
        <Input type="date" className="h-8 text-sm w-40" value={filterDate} onChange={e => setFilterDate(e.target.value)} data-testid="input-filter-date" />
        {viewMode === "list" && (
          <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm w-44" data-testid="select-filter-status">
              <SelectValue placeholder={t("all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("all")}</SelectItem>
              {ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {(filterDate || filterStatus) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setFilterDate(""); setFilterStatus(""); }}>{t("clear")}</button>
        )}

        <div className="ms-auto flex items-center gap-2">
          <button
            className="btn btn-outline btn-sm gap-1.5"
            onClick={() => exportToCSV(
              (appointments ?? []).map(a => ({
                Patient: (a.patient as any)?.fullName ?? `#${a.patientId}`,
                MRN: (a.patient as any)?.mrn ?? "",
                Doctor: (a.doctor as any)?.fullName ?? "",
                "Scheduled At": a.scheduledAt ? new Date(a.scheduledAt).toLocaleString("en-GB") : "",
                Reason: a.reason ?? "",
                Status: a.status,
                Notes: a.notes ?? "",
              })),
              `appointments-${new Date().toISOString().split("T")[0]}.csv`
            )}
            data-testid="button-export-appointments"
          >
            <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
          </button>
          <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setShowCreate(true)} data-testid="button-new-appointment">
            <Plus className="w-3.5 h-3.5" /> {t("newAppointment")}
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === "day" ? (
        <DayScheduleView appointments={(appointments ?? []) as any} selectedDate={dayViewDate} />
      ) : (
        <div className="card overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={(appointments ?? []).filter(a => {
              if (!search) return true;
              const q = search.toLowerCase();
              return (
                (a.patient as any)?.fullName?.toLowerCase().includes(q) ||
                a.reason?.toLowerCase().includes(q)
              );
            })}
            emptyMessage={t("noAppointmentsFound")}
            columns={[
              {
                key: "patient",
                header: t("patient"),
                render: a => (
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-[13px] text-[var(--ink)]">{a.patient?.fullName || `#${a.patientId}`}</span>
                      {(a.patient as any)?.allergies && (
                        <span title={`Allergies: ${(a.patient as any).allergies}`}>
                          <AlertTriangle className="w-3.5 h-3.5 text-[var(--rose-500)] flex-shrink-0" />
                        </span>
                      )}
                      {bookingSourceBadge((a as any).bookingSource)}
                    </div>
                    {a.patient?.mrn && <div className="text-[11px] text-[var(--ink-muted)] font-mono">{a.patient.mrn}</div>}
                    {(a.patient as any)?.allergies && (
                      <div className="text-[11px] text-[var(--rose-500)] mt-0.5 truncate max-w-[180px]">
                        ⚠ {(a.patient as any).allergies}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "doctor",  header: t("doctorLabel"),  render: a => <span className="text-[13px] text-[var(--ink)]">{a.doctor?.fullName || `#${a.doctorId}`}</span> },
              { key: "time",    header: t("scheduledAt"),  render: a => <span className="text-[12px] text-[var(--ink-muted)]">{formatDateTime(a.scheduledAt)}</span> },
              { key: "reason",  header: t("reason"),       render: a => <span className="text-[13px] text-[var(--ink)] max-w-xs truncate block">{a.reason}</span> },
              { key: "status",  header: t("status"),       render: a => <StatusBadge status={a.status} /> },
              {
                key: "actions",
                header: t("actions"),
                render: a => {
                  const busy = transitionLoading === a.id;
                  return (
                    <div className="flex gap-1 flex-wrap">
                      {a.status === "scheduled" && isFrontDesk && (
                        <button className="btn btn-outline btn-sm h-6 text-xs px-2 gap-1" disabled={busy}
                          onClick={e => { e.stopPropagation(); checkInMutation.mutate({ appointmentId: a.id }); }}
                          data-testid={`button-checkin-${a.id}`}>
                          <UserCheck className="w-3 h-3" />{t("checkIn")}
                        </button>
                      )}
                      {a.status === "checked_in" && isNurse && (
                        <button className="btn btn-outline btn-sm h-6 text-xs px-2" disabled={busy}
                          onClick={e => { e.stopPropagation(); transition(a.id, "triage", t("triageStarted")); }}>
                          {t("triage")}
                        </button>
                      )}
                      {a.status === "ready_for_doctor" && isDoctor && (
                        <button className="btn btn-primary btn-sm h-6 text-xs px-2 gap-1" disabled={busy}
                          onClick={e => { e.stopPropagation(); transition(a.id, "consult", t("consultationStarted")); }}>
                          <Stethoscope className="w-3 h-3" />{t("consult")}
                        </button>
                      )}
                      {a.status === "in_consultation" && isDoctor && (
                        <button className="btn btn-outline btn-sm h-6 text-xs px-2" disabled={busy}
                          onClick={e => { e.stopPropagation(); transition(a.id, "diagnostics", t("awaitingDiagnostics")); }}>
                          {t("diagnostics")}
                        </button>
                      )}
                      {["in_consultation", "awaiting_diagnostics"].includes(a.status) && (isDoctor || isNurse) && (
                        <button className="btn btn-outline btn-sm h-6 text-xs px-2 gap-1" disabled={busy}
                          onClick={e => { e.stopPropagation(); transition(a.id, "payment", t("pendingPayment")); }}>
                          <CreditCard className="w-3 h-3" />{t("payment")}
                        </button>
                      )}
                      {a.status === "pending_payment" && isFrontDesk && (
                        <button className="btn btn-outline btn-sm h-6 text-xs px-2 gap-1" disabled={busy}
                          onClick={e => { e.stopPropagation(); transition(a.id, "complete", t("appointmentCompleted")); }}>
                          <CheckCircle className="w-3 h-3" />{t("complete")}
                        </button>
                      )}
                      {["scheduled", "checked_in", "in_triage"].includes(a.status) && isFrontDesk && (
                        <button className="btn btn-ghost btn-sm h-6 text-xs px-2 text-[var(--rose-500)]" disabled={busy}
                          onClick={e => { e.stopPropagation(); cancelMutation.mutate({ appointmentId: a.id }); }}>
                          {t("cancel")}
                        </button>
                      )}
                      {["pending_payment", "completed"].includes(a.status) && (
                        <button className="btn btn-outline btn-sm h-6 text-xs px-2 gap-1"
                          onClick={e => { e.stopPropagation(); setDischargeApptId(a.id); }}
                          title={t("printVisitSummary")}>
                          <FileText className="w-3 h-3" />{t("summary")}
                        </button>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      )}

      {/* Create Appointment Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("newAppointment")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("patient")} *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger data-testid="select-patient"><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                <SelectContent>
                  {patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName} ({p.mrn})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("doctorLabel")} *</Label>
              <Select value={form.doctorId} onValueChange={v => setForm(f => ({ ...f, doctorId: v }))}>
                <SelectTrigger data-testid="select-doctor"><SelectValue placeholder={t("selectDoctor")} /></SelectTrigger>
                <SelectContent>
                  {users?.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("scheduledAt")} *</Label>
              <Input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} data-testid="input-scheduled-at" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("reason")} *</Label>
              <Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} data-testid="input-reason" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            {isFrontDeskUser && (
              <div className="space-y-1">
                <Label className="text-xs">{t("bookingSource")}</Label>
                <Select value={form.bookingSource} onValueChange={v => setForm(f => ({ ...f, bookingSource: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="walk_in"><Building2 className="w-3.5 h-3.5 inline me-1.5" />{t("walkIn")}</SelectItem>
                    <SelectItem value="phone"><Phone className="w-3.5 h-3.5 inline me-1.5" />{t("phone")}</SelectItem>
                    <SelectItem value="online"><Globe className="w-3.5 h-3.5 inline me-1.5" />{t("online")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => createMutation.mutate({ data: { ...form, patientId: parseInt(form.patientId), doctorId: parseInt(form.doctorId), scheduledAt: new Date(form.scheduledAt).toISOString() } as any })}
                disabled={createMutation.isPending}
                data-testid="button-save-appointment"
              >
                {createMutation.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DischargeSheet
        appointmentId={dischargeApptId}
        open={dischargeApptId !== null}
        onClose={() => setDischargeApptId(null)}
      />
    </div>
  );
}
