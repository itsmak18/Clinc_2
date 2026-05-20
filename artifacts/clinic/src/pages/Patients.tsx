import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useListPatients, useCreatePatient, listPatients, getListPatientsQueryKey } from "@workspace/api-client-react";
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
import { useAuth } from "@/hooks/auth";
import { formatDate } from "@/lib/api";
import { Plus, Search, Scan, Download } from "lucide-react";
import { calcAge, exportToCSV } from "@/lib/api";

export default function Patients() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    fullName: "", fullNameAr: "", dateOfBirth: "", gender: "male" as "male" | "female",
    phone: "", address: "", bloodType: "", allergies: "", emergencyContact: ""
  });

  // Barcode scanner (keyboard-wedge): accumulates chars in <50ms intervals
  const barcodeBuffer = useRef("");
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is focused on an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Enter") {
        const mrn = barcodeBuffer.current.trim();
        barcodeBuffer.current = "";
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        if (mrn.length >= 4) {
          listPatients({ search: mrn, limit: 1, offset: 0 })
            .then(data => {
              const patient = data?.patients?.[0];
              if (patient) {
                setLocation(`/patients/${patient.id}`);
              } else {
                toast({ title: `No patient found for MRN: ${mrn}`, variant: "destructive" });
              }
            })
            .catch(() => toast({ title: "Barcode scan failed", variant: "destructive" }));
        }
        return;
      }

      if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        // If no new key in 200ms, reset buffer (manual typing threshold)
        barcodeTimer.current = setTimeout(() => {
          barcodeBuffer.current = "";
        }, 200);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setLocation, toast]);

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
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => exportToCSV(
              patients.map(p => ({
                MRN: p.mrn,
                Name: p.fullName,
                "Name (AR)": p.fullNameAr ?? "",
                Gender: p.gender,
                "Date of Birth": p.dateOfBirth ?? "",
                Age: calcAge(p.dateOfBirth),
                Phone: p.phone ?? "",
                "Blood Type": p.bloodType ?? "",
                Allergies: p.allergies ?? "",
                Status: p.isActive ? "Active" : "Inactive",
              })),
              `patients-${new Date().toISOString().split("T")[0]}.csv`
            )} data-testid="button-export-patients">
              <Download className="w-3.5 h-3.5 me-1" /> Export CSV
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-register-patient">
              <Plus className="w-3.5 h-3.5 me-1" /> {t("registerPatient")}
            </Button>
          </div>
        }
      />

      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              className="ps-9 h-8 text-sm"
              placeholder={`${t("search")} by name or MRN...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-patients"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1 border border-border/50">
            <Scan className="w-3.5 h-3.5" />
            <span>Barcode scan supported</span>
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
              { key: "dob", header: t("dateOfBirth"), render: p => (
                <span className="text-sm">{formatDate(p.dateOfBirth)} <span className="text-muted-foreground text-xs">({calcAge(p.dateOfBirth)})</span></span>
              )},
              { key: "phone", header: t("phone"), render: p => <span className="text-sm">{p.phone}</span> },
              { key: "blood", header: t("bloodType"), render: p => p.bloodType ? <Badge variant="outline" className="text-xs">{p.bloodType}</Badge> : <span className="text-muted-foreground">-</span> },
              { key: "status", header: t("status"), render: p => (
                <Badge variant={p.isActive ? "default" : "secondary"} className="text-xs">
                  {p.isActive ? t("active") : t("inactive")}
                </Badge>
              )},
              { key: "actions", header: t("actions"), render: p => (
                <div className="flex gap-1">
                  {["super_admin", "admin", "nurse", "front_desk"].includes(user?.role || "") && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                      onClick={(e) => { e.stopPropagation(); setLocation(`/patients/${p.id}`); }}>
                      {t("view")}
                    </Button>
                  )}
                  {["super_admin", "admin", "nurse", "front_desk"].includes(user?.role || "") && (
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                      onClick={(e) => { e.stopPropagation(); setLocation(`/patients/${p.id}?edit=true`); }}>
                      {t("edit")}
                    </Button>
                  )}
                </div>
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
