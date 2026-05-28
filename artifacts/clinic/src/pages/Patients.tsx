import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useListPatients, useCreatePatient, listPatients, getListPatientsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    phone: "", address: "", bloodType: "", allergies: "", emergencyContact: "",
  });

  const barcodeBuffer = useRef("");
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Enter") {
        const mrn = barcodeBuffer.current.trim();
        barcodeBuffer.current = "";
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        if (mrn.length >= 4) {
          listPatients({ search: mrn, limit: 1 })
            .then(data => {
              const patient = data?.patients?.[0];
              if (patient) {
                setLocation(`/patients/${patient.id}`);
              } else {
                toast({ title: t("noPatientFoundMrn"), variant: "destructive" });
              }
            })
            .catch(() => toast({ title: t("barcodeScanFailed"), variant: "destructive" }));
        }
        return;
      }

      if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = ""; }, 200);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setLocation, toast, t]);

  const { data, isLoading } = useListPatients(
    { search: search || undefined, limit: 50 },
    { query: { queryKey: getListPatientsQueryKey({ search: search || undefined, limit: 50 }) } }
  );

  const createMutation = useCreatePatient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
        setShowCreate(false);
        setForm({ fullName: "", fullNameAr: "", dateOfBirth: "", gender: "male", phone: "", address: "", bloodType: "", allergies: "", emergencyContact: "" });
        toast({ title: t("patientRegisteredSuccess") });
      },
      onError: () => toast({ title: t("patientRegisterFailed"), variant: "destructive" }),
    },
  });

  const patients = data?.patients ?? [];

  return (
    <div className="page">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--ink-muted)]" />
          <Input
            className="ps-9 h-8 text-sm"
            placeholder={`${t("search")} ${t("byNameOrMrn")}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-patients"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)] bg-[var(--surface-2)] rounded px-2 py-1 border border-[var(--line)]">
          <Scan className="w-3.5 h-3.5" />
          <span>{t("barcodeScanSupported")}</span>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button
            className="btn btn-outline btn-sm gap-1.5"
            onClick={() => exportToCSV(
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
            )}
            data-testid="button-export-patients"
          >
            <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
          </button>
          <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setShowCreate(true)} data-testid="button-register-patient">
            <Plus className="w-3.5 h-3.5" /> {t("registerPatient")}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          emptyMessage={t("noPatientsFound")}
          data={patients}
          onRowClick={p => setLocation(`/patients/${p.id}`)}
          columns={[
            {
              key: "mrn",
              header: t("mrn"),
              render: p => <span className="font-mono text-xs font-semibold text-[var(--teal-700)]">{p.mrn}</span>,
            },
            {
              key: "name",
              header: t("name"),
              render: p => (
                <div>
                  <div className="font-medium text-[13px] text-[var(--ink)]">{p.fullName}</div>
                  {p.fullNameAr && <div className="text-[11px] text-[var(--ink-muted)]">{p.fullNameAr}</div>}
                </div>
              ),
            },
            { key: "gender",  header: t("gender"),      render: p => <span className="capitalize text-[13px] text-[var(--ink)]">{t(p.gender as any)}</span> },
            {
              key: "dob",
              header: t("dateOfBirth"),
              render: p => (
                <span className="text-[13px] text-[var(--ink)]">
                  {formatDate(p.dateOfBirth)} <span className="text-[11px] text-[var(--ink-muted)]">({calcAge(p.dateOfBirth)})</span>
                </span>
              ),
            },
            { key: "phone",   header: t("phone"),        render: p => <span className="text-[13px] text-[var(--ink)]">{p.phone}</span> },
            {
              key: "blood",
              header: t("bloodType"),
              render: p => p.bloodType
                ? <span className="badge text-[11px]">{p.bloodType}</span>
                : <span className="text-[var(--ink-faint)]">—</span>,
            },
            {
              key: "status",
              header: t("status"),
              render: p => (
                <span className={`badge text-[11px] ${p.isActive ? "badge-teal" : ""}`}>
                  {p.isActive ? t("active") : t("inactive")}
                </span>
              ),
            },
            {
              key: "actions",
              header: t("actions"),
              render: p => (
                <div className="flex gap-1">
                  {["super_admin", "admin", "nurse", "front_desk"].includes(user?.role || "") && (
                    <button
                      className="btn btn-ghost btn-sm h-6 text-xs px-2"
                      onClick={e => { e.stopPropagation(); setLocation(`/patients/${p.id}`); }}
                    >
                      {t("view")}
                    </button>
                  )}
                  {["super_admin", "admin", "nurse", "front_desk"].includes(user?.role || "") && (
                    <button
                      className="btn btn-ghost btn-sm h-6 text-xs px-2"
                      onClick={e => { e.stopPropagation(); setLocation(`/patients/${p.id}?edit=true`); }}
                    >
                      {t("edit")}
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
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
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => createMutation.mutate({ data: form as any })}
                disabled={createMutation.isPending}
                data-testid="button-save-patient"
              >
                {createMutation.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
