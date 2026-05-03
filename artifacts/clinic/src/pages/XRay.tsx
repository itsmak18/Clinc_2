import { useState } from "react";
import { useListXrayImages, useCreateXrayRecord, useUpdateXrayRecord, useListPatients, useListUsers, getListXrayImagesQueryKey, getGetXrayRecordQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
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
import { formatDate } from "@/lib/api";
import { Plus, FileImage } from "lucide-react";

export default function XRay() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showReport, setShowReport] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [form, setForm] = useState({ patientId: "", requestedById: "", bodyPart: "", notes: "" });
  const [reportForm, setReportForm] = useState({ report: "", imageUrl: "", status: "uploaded" });

  const params = { status: filterStatus as any || undefined };
  const { data: xrays, isLoading } = useListXrayImages(params, { query: { queryKey: getListXrayImagesQueryKey(params) } });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
  const { data: doctors } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreateXrayRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListXrayImagesQueryKey() });
        setShowCreate(false);
        setForm({ patientId: "", requestedById: "", bodyPart: "", notes: "" });
        toast({ title: "X-ray record created" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    }
  });

  const updateMutation = useUpdateXrayRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListXrayImagesQueryKey() });
        setShowReport(null);
        toast({ title: "X-ray updated" });
      },
    }
  });

  const statuses = ["pending", "uploaded", "reviewed"];

  return (
    <div>
      <PageHeader
        title={t("xray")}
        subtitle={`${xrays?.length ?? 0} records`}
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-xray">
            <Plus className="w-3.5 h-3.5 me-1" /> New X-Ray Request
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm w-36" data-testid="select-filter-status">
              <SelectValue placeholder={t("all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("all")}</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={xrays ?? []}
            emptyMessage="No X-ray records"
            columns={[
              { key: "patient", header: "Patient", render: x => <span className="font-medium text-sm">{x.patient?.fullName || `#${x.patientId}`}</span> },
              { key: "body", header: t("bodyPart"), render: x => <span className="text-sm">{x.bodyPart}</span> },
              { key: "requested", header: "Requested By", render: x => <span className="text-sm">{x.requestedBy?.fullName || `#${x.requestedById}`}</span> },
              { key: "date", header: t("date"), render: x => <span className="text-sm">{formatDate(x.createdAt)}</span> },
              { key: "status", header: t("status"), render: x => <StatusBadge status={x.status} /> },
              { key: "actions", header: t("actions"), render: x => (
                <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); setShowReport(x.id); setReportForm({ report: x.report || "", imageUrl: x.imageUrl || "", status: x.status }); }}>
                  <FileImage className="w-3 h-3 me-1" /> Report
                </Button>
              )},
            ]}
          />
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New X-Ray Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Patient *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
                <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Requested By (Doctor) *</Label>
              <Select value={form.requestedById} onValueChange={v => setForm(f => ({ ...f, requestedById: v }))}>
                <SelectTrigger><SelectValue placeholder="Select doctor" /></SelectTrigger>
                <SelectContent>{doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("bodyPart")} *</Label>
              <Input value={form.bodyPart} onChange={e => setForm(f => ({ ...f, bodyPart: e.target.value }))} placeholder="e.g. Chest, Left Hand..." data-testid="input-body-part" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { patientId: parseInt(form.patientId), requestedById: parseInt(form.requestedById), bodyPart: form.bodyPart, notes: form.notes || undefined } as any })} disabled={createMutation.isPending} data-testid="button-save-xray">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showReport !== null} onOpenChange={() => setShowReport(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>X-Ray Report</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Image URL</Label>
              <Input value={reportForm.imageUrl} onChange={e => setReportForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://..." data-testid="input-image-url" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("report")}</Label>
              <Textarea value={reportForm.report} onChange={e => setReportForm(f => ({ ...f, report: e.target.value }))} rows={4} data-testid="input-report" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("status")}</Label>
              <Select value={reportForm.status} onValueChange={v => setReportForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="uploaded">Uploaded</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowReport(null)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => showReport && updateMutation.mutate({ xrayId: showReport, data: { report: reportForm.report || undefined, imageUrl: reportForm.imageUrl || undefined, status: reportForm.status as any } })} disabled={updateMutation.isPending} data-testid="button-save-report">
                {updateMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
