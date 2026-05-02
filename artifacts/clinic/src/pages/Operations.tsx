import { useState } from "react";
import { useListOperations, useCreateOperation, useUpdateOperation, useListPatients, useListUsers, getListOperationsQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/api";
import { Plus } from "lucide-react";

export default function Operations() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [form, setForm] = useState({ patientId: "", surgeonId: "", procedureName: "", scheduledAt: "", operatingRoom: "", notes: "" });

  const params = { status: filterStatus as any || undefined };
  const { data: operations, isLoading } = useListOperations(params, { query: { queryKey: getListOperationsQueryKey(params) } });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
  const { data: doctors } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreateOperation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOperationsQueryKey() });
        setShowCreate(false);
        setForm({ patientId: "", surgeonId: "", procedureName: "", scheduledAt: "", operatingRoom: "", notes: "" });
        toast({ title: "Operation scheduled" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    }
  });

  const statuses = ["scheduled", "in_progress", "completed", "cancelled"];

  return (
    <div>
      <PageHeader
        title={t("operations")}
        subtitle={`${operations?.length ?? 0} operations`}
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-schedule-operation">
            <Plus className="w-3.5 h-3.5 me-1" /> Schedule Operation
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 text-sm w-36"><SelectValue placeholder={t("all")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t("all")}</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={operations ?? []}
            emptyMessage="No operations scheduled"
            columns={[
              { key: "patient", header: "Patient", render: op => <span className="font-medium text-sm">{op.patient?.fullName || `#${op.patientId}`}</span> },
              { key: "procedure", header: t("procedureName"), render: op => <span className="text-sm font-medium">{op.procedureName}</span> },
              { key: "surgeon", header: t("surgeon"), render: op => <span className="text-sm">{op.surgeon?.fullName || `#${op.surgeonId}`}</span> },
              { key: "room", header: t("operatingRoom"), render: op => <span className="text-sm">{op.operatingRoom}</span> },
              { key: "time", header: t("scheduledAt"), render: op => <span className="text-sm">{formatDateTime(op.scheduledAt)}</span> },
              { key: "status", header: t("status"), render: op => <StatusBadge status={op.status} /> },
            ]}
          />
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Schedule Operation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Patient *</Label>
                <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                  <SelectTrigger data-testid="select-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
                  <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("surgeon")} *</Label>
                <Select value={form.surgeonId} onValueChange={v => setForm(f => ({ ...f, surgeonId: v }))}>
                  <SelectTrigger data-testid="select-surgeon"><SelectValue placeholder="Select surgeon" /></SelectTrigger>
                  <SelectContent>{doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}</SelectContent>
                </Select>
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
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { ...form, patientId: parseInt(form.patientId), surgeonId: parseInt(form.surgeonId), scheduledAt: new Date(form.scheduledAt).toISOString(), staffAssigned: [] } as any })} disabled={createMutation.isPending} data-testid="button-save-operation">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
