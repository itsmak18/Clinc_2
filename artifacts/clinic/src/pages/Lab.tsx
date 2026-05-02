import { useState } from "react";
import { useListLabTests, useCreateLabTest, useUpdateLabTest, useListPatients, useListUsers, getListLabTestsQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
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
import { Plus, ClipboardList } from "lucide-react";

export default function Lab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showResults, setShowResults] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [form, setForm] = useState({ patientId: "", requestedById: "", testName: "", notes: "" });
  const [resultsForm, setResultsForm] = useState({ results: "", status: "completed" });

  const params = { status: filterStatus as any || undefined };
  const { data: tests, isLoading } = useListLabTests(params, { query: { queryKey: getListLabTestsQueryKey(params) } });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
  const { data: doctors } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreateLabTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLabTestsQueryKey() });
        setShowCreate(false);
        setForm({ patientId: "", requestedById: "", testName: "", notes: "" });
        toast({ title: "Lab test created" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    }
  });

  const updateMutation = useUpdateLabTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLabTestsQueryKey() });
        setShowResults(null);
        toast({ title: "Lab results saved" });
      },
    }
  });

  const statuses = ["requested", "in_progress", "completed", "cancelled"];

  return (
    <div>
      <PageHeader
        title={t("lab")}
        subtitle={`${tests?.length ?? 0} tests`}
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-lab">
            <Plus className="w-3.5 h-3.5 me-1" /> Request Test
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 text-sm w-36" data-testid="select-filter-status">
              <SelectValue placeholder={t("all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t("all")}</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={tests ?? []}
            emptyMessage="No lab tests"
            columns={[
              { key: "patient", header: "Patient", render: l => <span className="font-medium text-sm">{l.patient?.fullName || `#${l.patientId}`}</span> },
              { key: "test", header: t("testName"), render: l => <span className="text-sm font-medium">{l.testName}</span> },
              { key: "requested", header: "Requested By", render: l => <span className="text-sm">{l.requestedBy?.fullName || `#${l.requestedById}`}</span> },
              { key: "date", header: t("date"), render: l => <span className="text-sm">{formatDate(l.createdAt)}</span> },
              { key: "status", header: t("status"), render: l => <StatusBadge status={l.status} /> },
              { key: "actions", header: t("actions"), render: l => (
                <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); setShowResults(l.id); setResultsForm({ results: l.results || "", status: l.status }); }}>
                  <ClipboardList className="w-3 h-3 me-1" /> Results
                </Button>
              )},
            ]}
          />
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Request Lab Test</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Patient *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
                <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Requested By *</Label>
              <Select value={form.requestedById} onValueChange={v => setForm(f => ({ ...f, requestedById: v }))}>
                <SelectTrigger><SelectValue placeholder="Select doctor" /></SelectTrigger>
                <SelectContent>{doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("testName")} *</Label>
              <Input value={form.testName} onChange={e => setForm(f => ({ ...f, testName: e.target.value }))} placeholder="CBC, Lipid Panel, HbA1c..." data-testid="input-test-name" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { patientId: parseInt(form.patientId), requestedById: parseInt(form.requestedById), testName: form.testName, notes: form.notes || undefined } as any })} disabled={createMutation.isPending} data-testid="button-save-lab">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showResults !== null} onOpenChange={() => setShowResults(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Enter Lab Results</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("results")}</Label>
              <Textarea value={resultsForm.results} onChange={e => setResultsForm(f => ({ ...f, results: e.target.value }))} rows={5} placeholder="Enter test results..." data-testid="input-results" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("status")}</Label>
              <Select value={resultsForm.status} onValueChange={v => setResultsForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowResults(null)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => showResults && updateMutation.mutate({ testId: showResults, data: { results: resultsForm.results || undefined, status: resultsForm.status as any } })} disabled={updateMutation.isPending} data-testid="button-save-results">
                {updateMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
