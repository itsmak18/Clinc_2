import { useState } from "react";
import { useListAppointments, useCreateAppointment, useCheckInPatient, useCancelAppointment, useListPatients, useListUsers, getListAppointmentsQueryKey, getListPatientsQueryKey, getListUsersQueryKey, useGetTodayAppointments, getGetTodayAppointmentsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/api";
import { Plus, UserCheck } from "lucide-react";

export default function Appointments() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [form, setForm] = useState({ patientId: "", doctorId: "", scheduledAt: "", reason: "", notes: "" });

  const params = {
    status: filterStatus as any || undefined,
    date: filterDate || undefined,
    limit: 50,
    offset: 0,
  };

  const { data: appointments, isLoading } = useListAppointments(params, {
    query: { queryKey: getListAppointmentsQueryKey(params) }
  });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
  const { data: users } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreateAppointment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTodayAppointmentsQueryKey() });
        setShowCreate(false);
        setForm({ patientId: "", doctorId: "", scheduledAt: "", reason: "", notes: "" });
        toast({ title: "Appointment created" });
      },
      onError: () => toast({ title: "Failed to create appointment", variant: "destructive" }),
    }
  });

  const checkInMutation = useCheckInPatient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTodayAppointmentsQueryKey() });
        toast({ title: "Patient checked in" });
      },
    }
  });

  const cancelMutation = useCancelAppointment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        toast({ title: "Appointment cancelled" });
      },
    }
  });

  const statuses = ["scheduled", "checked_in", "in_progress", "completed", "cancelled", "no_show"];

  return (
    <div>
      <PageHeader
        title={t("appointments")}
        subtitle={`${appointments?.length ?? 0} appointments`}
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-new-appointment">
            <Plus className="w-3.5 h-3.5 me-1" /> {t("newAppointment")}
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4 flex-wrap">
          <Input type="date" className="h-8 text-sm w-40" value={filterDate} onChange={e => setFilterDate(e.target.value)} data-testid="input-filter-date" />
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 text-sm w-36" data-testid="select-filter-status">
              <SelectValue placeholder={t("all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t("all")}</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
            </SelectContent>
          </Select>
          {(filterDate || filterStatus) && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterDate(""); setFilterStatus(""); }}>Clear</Button>
          )}
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={appointments ?? []}
            emptyMessage="No appointments found"
            columns={[
              { key: "patient", header: "Patient", render: a => <span className="font-medium text-sm">{a.patient?.fullName || `#${a.patientId}`}</span> },
              { key: "doctor", header: t("doctorLabel"), render: a => <span className="text-sm">{a.doctor?.fullName || `#${a.doctorId}`}</span> },
              { key: "time", header: t("scheduledAt"), render: a => <span className="text-sm">{formatDateTime(a.scheduledAt)}</span> },
              { key: "reason", header: t("reason"), render: a => <span className="text-sm max-w-xs truncate block">{a.reason}</span> },
              { key: "status", header: t("status"), render: a => <StatusBadge status={a.status} /> },
              { key: "actions", header: t("actions"), render: a => (
                <div className="flex gap-1">
                  {a.status === "scheduled" && (
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); checkInMutation.mutate({ appointmentId: a.id }); }} data-testid={`button-checkin-${a.id}`}>
                      <UserCheck className="w-3 h-3 me-1" />{t("checkIn")}
                    </Button>
                  )}
                  {["scheduled", "checked_in"].includes(a.status) && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); cancelMutation.mutate({ appointmentId: a.id }); }}>
                      {t("cancel")}
                    </Button>
                  )}
                </div>
              )},
            ]}
          />
        </div>
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
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { ...form, patientId: parseInt(form.patientId), doctorId: parseInt(form.doctorId), scheduledAt: new Date(form.scheduledAt).toISOString() } as any })} disabled={createMutation.isPending} data-testid="button-save-appointment">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
