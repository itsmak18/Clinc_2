import { useState } from "react";
import { useLocation } from "wouter";
import { useListPatients, useCreatePatient, getListPatientsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
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
import { Plus, Search, User } from "lucide-react";

export default function Patients() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    fullName: "", fullNameAr: "", dateOfBirth: "", gender: "male" as "male" | "female",
    phone: "", address: "", bloodType: "", allergies: "", emergencyContact: ""
  });

  const { data, isLoading } = useListPatients(
    { search: search || undefined, limit: 50, offset: 0 },
    { query: { queryKey: getListPatientsQueryKey({ search: search || undefined, limit: 50, offset: 0 }) } }
  );

  const createMutation = useCreatePatient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
        setShowCreate(false);
        setForm({ fullName: "", fullNameAr: "", dateOfBirth: "", gender: "male", phone: "", address: "", bloodType: "", allergies: "", emergencyContact: "" });
        toast({ title: "Patient registered successfully" });
      },
      onError: () => toast({ title: "Failed to register patient", variant: "destructive" }),
    }
  });

  const patients = data?.patients ?? [];

  return (
    <div>
      <PageHeader
        title={t("patients")}
        subtitle={`${data?.total ?? 0} total patients`}
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-register-patient">
            <Plus className="w-3.5 h-3.5 me-1" /> {t("registerPatient")}
          </Button>
        }
      />

      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              className="ps-9 h-8 text-sm"
              placeholder={`${t("search")} patients...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-patients"
            />
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            emptyMessage="No patients found"
            data={patients}
            onRowClick={p => setLocation(`/patients/${p.id}`)}
            columns={[
              { key: "mrn", header: t("mrn"), render: p => <span className="font-mono text-xs font-semibold text-primary">{p.mrn}</span> },
              { key: "name", header: t("name"), render: p => (
                <div>
                  <div className="font-medium text-sm">{p.fullName}</div>
                  {p.fullNameAr && <div className="text-xs text-muted-foreground">{p.fullNameAr}</div>}
                </div>
              )},
              { key: "gender", header: t("gender"), render: p => <span className="capitalize text-sm">{t(p.gender as any)}</span> },
              { key: "dob", header: t("dateOfBirth"), render: p => <span className="text-sm">{formatDate(p.dateOfBirth)}</span> },
              { key: "phone", header: t("phone"), render: p => <span className="text-sm">{p.phone}</span> },
              { key: "blood", header: t("bloodType"), render: p => p.bloodType ? <Badge variant="outline" className="text-xs">{p.bloodType}</Badge> : <span className="text-muted-foreground">-</span> },
              { key: "status", header: t("status"), render: p => (
                <Badge variant={p.isActive ? "default" : "secondary"} className="text-xs">
                  {p.isActive ? t("active") : t("inactive")}
                </Badge>
              )},
            ]}
          />
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("registerPatient")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
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
                <Label className="text-xs">{t("dateOfBirth")} *</Label>
                <Input type="date" value={form.dateOfBirth} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} data-testid="input-dob" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("gender")} *</Label>
                <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v as any }))}>
                  <SelectTrigger data-testid="select-gender"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">{t("male")}</SelectItem>
                    <SelectItem value="female">{t("female")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("phone")} *</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-phone" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("bloodType")}</Label>
                <Input value={form.bloodType} onChange={e => setForm(f => ({ ...f, bloodType: e.target.value }))} placeholder="A+, B-, O+..." />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("address")}</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("allergies")}</Label>
              <Input value={form.allergies} onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("emergencyContact")}</Label>
              <Input value={form.emergencyContact} onChange={e => setForm(f => ({ ...f, emergencyContact: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: form as any })} disabled={createMutation.isPending} data-testid="button-save-patient">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
