import { useState } from "react";
import { useListAppointments, useCreateAppointment, useCheckInPatient, useCancelAppointment, useListPatients, useListUsers, getListAppointmentsQueryKey, getListPatientsQueryKey, getListUsersQueryKey, useGetTodayAppointments, getGetTodayAppointmentsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/auth";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import DischargeSheet from "@/components/DischargeSheet";
import DayScheduleView from "@/components/DayScheduleView";
import GlobalSearch from "@/components/GlobalSearch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime, exportToCSV } from "@/lib/api";
import { Phone, Globe, Building2, Plus, UserCheck, Stethoscope, CreditCard, CheckCircle, AlertTriangle, FileText, Download, CalendarDays, List } from "lucide-react";

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

const ALL_STATUSES = [
  "scheduled", "checked_in", "in_triage", "ready_for_doctor",
  "in_consultation", "awaiting_diagnostics", "pending_payment",
  "completed", "cancelled", "no_show", "in_progress"
];

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
    offset: 0,
  };

  const { data: appointments, isLoading } = useListAppointments(params, {
    query: { queryKey: getListAppointmentsQueryKey(params), refetchInterval: 30000 }
  });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
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
        toast({ title: "Appointment created" });
      },
      onError: () => toast({ title: "Failed to create appointment", variant: "destructive" }),
    }
  });

  const checkInMutation = useCheckInPatient({
    mutation: {
      onSuccess: () => { invalidateAll(); toast({ title: "Patient checked in" }); },
    }
  });

  const cancelMutation = useCancelAppointment({
    mutation: {
      onSuccess: () => { invalidateAll(); toast({ title: "Appointment cancelled" }); },
    }
  });

  const transition = async (apptId: number, endpoint: string, label: string) => {
    setTransitionLoading(apptId);
    try {
      await apiFetch(`appointments/${apptId}/${endpoint}`);
      invalidateAll();
      toast({ title: label });
    } catch {
      toast({ title: `Failed: ${label}`, variant: "destructive" });
    } finally {
      setTransitionLoading(null);
    }
  };

  const role = user?.role;
  const isNurse = role === "nurse" || role === "admin" || role === "super_admin";
  const isDoctor = role === "doctor" || role === "admin" || role === "super_admin";
  const isFrontDesk = role === "front_desk" || role === "admin" || role === "super_admin";

  const bookingSourceBadge = (source: string | null | undefined) => {
    if (!source || source === "walk_in") return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5"><Building2 className="w-2.5 h-2.5" /> Walk-in</Badge>;
    if (source === "phone") return <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 border-orange-300 text-orange-700 bg-orange-50"><Phone className="w-2.5 h-2.5" /> Phone</Badge>;
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 border-blue-300 text-blue-700 bg-blue-50"><Globe className="w-2.5 h-2.5" /> Online</Badge>;
  };

  return (
    <div>
      {isFrontDeskUser && (
        <div className="px-6 pt-4 pb-0">
          <GlobalSearch />
        </div>
      )}
      <PageHeader
        title={t("appointments")}
        subtitle={`${appointments?.length ?? 0} appointments`}
        actions={
          <div className="flex gap-2">
            <div className="flex border border-border rounded-md overflow-hidden">
              <Button size="sm" variant={viewMode === "list" ? "default" : "ghost"} className="rounded-none h-8 px-2.5" onClick={() => setViewMode("list")}>
                <List className="w-3.5 h-3.5 me-1" /> List
              </Button>
              <Button size="sm" variant={viewMode === "day" ? "default" : "ghost"} className="rounded-none h-8 px-2.5 border-s border-border" onClick={() => setViewMode("day")}>
                <CalendarDays className="w-3.5 h-3.5 me-1" /> Day
              </Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => exportToCSV(
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
            )} data-testid="button-export-appointments">
              <Download className="w-3.5 h-3.5 me-1" /> Export CSV
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-new-appointment">
              <Plus className="w-3.5 h-3.5 me-1" /> {t("newAppointment")}
            </Button>
          </div>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4 flex-wrap">
          {viewMode === "list" && (
            <Input className="h-8 text-sm max-w-xs" placeholder="Search by patient or reason…" value={search} onChange={e => setSearch(e.target.value)} />
          )}
          <Input type="date" className="h-8 text-sm w-40" value={filterDate} onChange={e => setFilterDate(e.target.value)} data-testid="input-filter-date"
            title={viewMode === "day" ? "Schedule date" : "Filter by date"}
          />
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
            <Button variant="ghost" size="sm" onClick={() => { setFilterDate(""); setFilterStatus(""); }}>Clear</Button>
          )}
        </div>

        {viewMode === "day" ? (
          <DayScheduleView appointments={(appointments ?? []) as any} selectedDate={dayViewDate} />
        ) : (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
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
            emptyMessage="No appointments found"
            columns={[
              { key: "patient", header: "Patient", render: a => (
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-sm">{a.patient?.fullName || `#${a.patientId}`}</span>
                    {(a.patient as any)?.allergies && (
                      <span title={`Allergies: ${(a.patient as any).allergies}`}>
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                      </span>
                    )}
                    {bookingSourceBadge((a as any).bookingSource)}
                  </div>
                  {a.patient?.mrn && <div className="text-xs text-muted-foreground font-mono">{a.patient.mrn}</div>}
                  {(a.patient as any)?.allergies && (
                    <div className="text-xs text-destructive mt-0.5 truncate max-w-[180px]">
                      ⚠ {(a.patient as any).allergies}
                    </div>
                  )}
                </div>
              )},
              { key: "doctor", header: t("doctorLabel"), render: a => <span className="text-sm">{a.doctor?.fullName || `#${a.doctorId}`}</span> },
              { key: "time", header: t("scheduledAt"), render: a => <span className="text-sm">{formatDateTime(a.scheduledAt)}</span> },
              { key: "reason", header: t("reason"), render: a => <span className="text-sm max-w-xs truncate block">{a.reason}</span> },
              { key: "status", header: t("status"), render: a => <StatusBadge status={a.status} /> },
              { key: "actions", header: t("actions"), render: a => {
                const busy = transitionLoading === a.id;
                return (
                  <div className="flex gap-1 flex-wrap">
                    {/* Check-in: Front Desk for scheduled */}
                    {a.status === "scheduled" && isFrontDesk && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); checkInMutation.mutate({ appointmentId: a.id }); }}
                        data-testid={`button-checkin-${a.id}`}>
                        <UserCheck className="w-3 h-3 me-1" />{t("checkIn")}
                      </Button>
                    )}
                    {/* Triage: Nurse for checked_in */}
                    {a.status === "checked_in" && isNurse && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-blue-600 border-blue-200 hover:bg-blue-50" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); transition(a.id, "triage", "Triage started"); }}>
                        Triage
                      </Button>
                    )}
                    {/* Consult: Doctor for ready_for_doctor */}
                    {a.status === "ready_for_doctor" && isDoctor && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-purple-600 border-purple-200 hover:bg-purple-50" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); transition(a.id, "consult", "Consultation started"); }}>
                        <Stethoscope className="w-3 h-3 me-1" />Consult
                      </Button>
                    )}
                    {/* Diagnostics: Doctor for in_consultation */}
                    {a.status === "in_consultation" && isDoctor && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); transition(a.id, "diagnostics", "Awaiting diagnostics"); }}>
                        Diagnostics
                      </Button>
                    )}
                    {/* Payment: Doctor/Nurse for in_consultation/awaiting_diagnostics */}
                    {["in_consultation", "awaiting_diagnostics"].includes(a.status) && (isDoctor || isNurse) && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-amber-600 border-amber-200 hover:bg-amber-50" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); transition(a.id, "payment", "Pending payment"); }}>
                        <CreditCard className="w-3 h-3 me-1" />Payment
                      </Button>
                    )}
                    {/* Complete: Front Desk for pending_payment */}
                    {a.status === "pending_payment" && isFrontDesk && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-green-600 border-green-200 hover:bg-green-50" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); transition(a.id, "complete", "Appointment completed"); }}>
                        <CheckCircle className="w-3 h-3 me-1" />Complete
                      </Button>
                    )}
                    {/* Cancel: early stages */}
                    {["scheduled", "checked_in", "in_triage"].includes(a.status) && isFrontDesk && (
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-destructive hover:text-destructive" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); cancelMutation.mutate({ appointmentId: a.id }); }}>
                        {t("cancel")}
                      </Button>
                    )}
                    {/* Print discharge sheet: completed or pending_payment */}
                    {["pending_payment", "completed"].includes(a.status) && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-slate-600 border-slate-200 hover:bg-slate-50"
                        onClick={(e) => { e.stopPropagation(); setDischargeApptId(a.id); }}
                        title="Print Visit Summary">
                        <FileText className="w-3 h-3 me-1" />Summary
                      </Button>
                    )}
                  </div>
                );
              }},
            ]}
          />
        </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("newAppointment")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Patient *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger data-testid="select-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
                <SelectContent>
                  {patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName} ({p.mrn})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("doctorLabel")} *</Label>
              <Select value={form.doctorId} onValueChange={v => setForm(f => ({ ...f, doctorId: v }))}>
                <SelectTrigger data-testid="select-doctor"><SelectValue placeholder="Select doctor" /></SelectTrigger>
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
                <Label className="text-xs">Booking Source</Label>
                <Select value={form.bookingSource} onValueChange={v => setForm(f => ({ ...f, bookingSource: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="walk_in"><Building2 className="w-3.5 h-3.5 inline me-1.5" />Walk-in</SelectItem>
                    <SelectItem value="phone"><Phone className="w-3.5 h-3.5 inline me-1.5" />Phone</SelectItem>
                    <SelectItem value="online"><Globe className="w-3.5 h-3.5 inline me-1.5" />Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { ...form, patientId: parseInt(form.patientId), doctorId: parseInt(form.doctorId), scheduledAt: new Date(form.scheduledAt).toISOString() } as any })} disabled={createMutation.isPending} data-testid="button-save-appointment">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
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
