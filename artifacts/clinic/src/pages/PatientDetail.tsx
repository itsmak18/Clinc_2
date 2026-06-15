import { useGetPatientSummary, getGetPatientSummaryQueryKey, useUpdatePatient, useListMedicalRecords, getListMedicalRecordsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import StatusBadge from "@/components/StatusBadge";
import PatientTimeline from "@/components/PatientTimeline";
import ChangeHistoryCard from "@/components/ChangeHistory";
import PatientConsentCard from "@/components/PatientConsentCard";
import BreakGlassButton from "@/components/BreakGlassButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime, formatCurrency, calcAge } from "@/lib/api";
import { ArrowLeft, User, CalendarDays, FileText, Scan, FlaskConical, AlertTriangle, Activity, Edit2, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { BLOOD_TYPES } from "@/lib/constants";

export default function PatientDetail() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const patientId = parseInt(params.id ?? "0");

  const [showEdit, setShowEdit] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("edit") === "true") {
      setShowEdit(true);
    }
  }, []);
  const [form, setForm] = useState({
    fullName: "",
    fullNameAr: "",
    phone: "",
    address: "",
    dateOfBirth: "",
    gender: "male" as "male" | "female",
    bloodType: "",
    allergies: "",
    emergencyContact: "",
    isActive: true
  });

  const { data, isLoading, error } = useGetPatientSummary(patientId, {
    query: { enabled: !!patientId, queryKey: getGetPatientSummaryQueryKey(patientId) }
  });

  const { data: medicalRecords } = useListMedicalRecords(
    { patientId },
    { query: { enabled: !!patientId, queryKey: getListMedicalRecordsQueryKey({ patientId }) } }
  );

  useEffect(() => {
    if (data?.patient) {
      setForm({
        fullName: data.patient.fullName,
        fullNameAr: data.patient.fullNameAr || "",
        phone: data.patient.phone,
        address: data.patient.address || "",
        dateOfBirth: data.patient.dateOfBirth ? new Date(data.patient.dateOfBirth).toISOString().split("T")[0] : "",
        gender: data.patient.gender as any,
        bloodType: data.patient.bloodType || "",
        allergies: data.patient.allergies || "",
        emergencyContact: data.patient.emergencyContact || "",
        isActive: data.patient.isActive
      });
    }
  }, [data]);

  const updateMutation = useUpdatePatient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPatientSummaryQueryKey(patientId) });
        setShowEdit(false);
        toast({ title: t("patientUpdated") });
      },
      onError: (err: any) => {
        // ApiError (custom-fetch) carries the canonical envelope on `err.data`,
        // with the human reason in `message` — NOT `err.response.data.error`
        // (that path never matched, so every failure showed a bare "Failed").
        const msg = err?.data?.message ?? err?.message ?? t("failed");
        toast({ title: t("failed"), description: msg, variant: "destructive" });
      }
    }
  });

  const handleUpdate = () => {
    const missing = [
      !form.fullName.trim() && `${t("name")} (EN)`,
      !form.dateOfBirth && t("dateOfBirth"),
      !form.phone.trim() && t("phone"),
    ].filter(Boolean);
    if (missing.length > 0) {
      toast({ title: t("fillRequiredFields"), description: missing.join("، "), variant: "destructive" });
      return;
    }
    updateMutation.mutate({ patientId, data: form as any });
  };

  const canEdit = ["super_admin", "admin", "nurse", "front_desk"].includes(user?.role || "");

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--ink-muted)]">{t("loading")}</div>;
  if ((error as any)?.status === 403) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
        <ShieldOff className="w-12 h-12 text-[var(--rose-500)]" />
        <h2 className="text-xl font-semibold text-[var(--ink)]">{t("patientForbidden")}</h2>
        <p className="text-[var(--ink-muted)] max-w-sm">{t("patientForbiddenDesc")}</p>
        <button className="btn btn-outline btn-sm gap-1.5" onClick={() => setLocation("/patients")}>
          <ArrowLeft className="w-3.5 h-3.5" />{t("back")}
        </button>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-[var(--ink-muted)]">{t("patientNotFound")}</div>;

  const { patient, recentAppointments, recentRecords, recentXrays, recentLabTests, outstandingBalance } = data;

  return (
    <div className="page">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-[var(--ink)] text-[15px] leading-tight">{patient.fullName}</h1>
          <p className="text-[12px] text-[var(--ink-muted)] font-mono">MRN: {patient.mrn}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <BreakGlassButton patientId={patientId} />
          {canEdit && (
            <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setShowEdit(true)} data-testid="button-edit-patient">
              <Edit2 className="w-3.5 h-3.5" /> {t("edit")}
            </button>
          )}
          <button className="btn btn-outline btn-sm gap-1.5" onClick={() => setLocation("/patients")} data-testid="button-back">
            <ArrowLeft className="w-3.5 h-3.5" /> {t("back")}
          </button>
        </div>
      </div>

      {/* Allergies Banner */}
      {patient.allergies && (
        <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-[var(--rose-500)]/60 bg-[var(--rose-500)]/10 mb-4">
          <AlertTriangle className="w-5 h-5 text-[var(--rose-500)] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-[var(--rose-500)] uppercase tracking-wide">{t("allergiesContraindications")}</p>
            <p className="text-sm text-[var(--rose-500)] mt-0.5">{patient.allergies}</p>
          </div>
        </div>
      )}

      {/* Patient Info Card */}
      <div className="card mb-4">
        <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
          <User className="w-4 h-4 text-[var(--teal-600)]" />
          <span className="font-semibold text-[14px] text-[var(--ink)]">{t("patientInformation")}</span>
        </div>
        <div className="card-pad grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 text-sm">
          {[
            { label: t("mrn"),              value: <span className="font-mono font-semibold text-[var(--teal-600)]">{patient.mrn}</span> },
            { label: t("gender"),           value: <span className="text-[var(--ink)]">{t(patient.gender as any)}</span> },
            { label: t("dateOfBirth"),      value: <span className="text-[var(--ink)]">{formatDate(patient.dateOfBirth)} ({calcAge(patient.dateOfBirth)})</span> },
            { label: t("phone"),            value: <span className="text-[var(--ink)]">{patient.phone}</span> },
            { label: t("bloodType"),        value: <span className="text-[var(--ink)]">{patient.bloodType || "-"}</span> },
            { label: t("allergies"),        value: <span className="text-[var(--ink)]">{patient.allergies || "-"}</span> },
            { label: t("address"),          value: <span className="text-[var(--ink)]">{patient.address || "-"}</span> },
            { label: t("emergencyContact"), value: <span className="text-[var(--ink)]">{patient.emergencyContact || "-"}</span> },
            { label: t("outstandingBalance"), value: <span className={cn("font-semibold", outstandingBalance > 0 ? "text-[var(--rose-500)]" : "text-[var(--ink)]")}>${formatCurrency(outstandingBalance)}</span> },
            { label: t("status"),           value: <span className={cn("badge text-xs", patient.isActive ? "badge-teal" : "")}>{patient.isActive ? t("active") : t("inactive")}</span> },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[11px] text-[var(--ink-muted)] mb-0.5">{label}</p>
              <div className="font-medium text-[13px]">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs: Overview / Timeline */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("overview")}</TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5">
            <Activity className="w-3.5 h-3.5" /> {t("timeline")}
            <span className="badge text-[10px] px-1.5 ms-1">
              {(recentAppointments?.length ?? 0) + (recentRecords?.length ?? 0) + (recentLabTests?.length ?? 0) + (recentXrays?.length ?? 0)}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Appointments */}
            <div className="card">
              <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[var(--teal-600)]" />
                <span className="font-semibold text-[13px] text-[var(--ink)]">{t("recentAppointments")}</span>
                <span className="badge text-xs ms-auto">{recentAppointments?.length ?? 0}</span>
              </div>
              <div className="card-pad space-y-2">
                {!recentAppointments?.length
                  ? <p className="text-xs text-[var(--ink-muted)]">{t("noAppointments")}</p>
                  : recentAppointments.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs border-b border-[var(--line)]/40 pb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-[var(--ink)]">{a.reason}</p>
                        <p className="text-[var(--ink-muted)]">{formatDateTime(a.scheduledAt)} · {a.doctor?.fullName}</p>
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                  ))
                }
              </div>
            </div>

            {/* Medical Records */}
            <div className="card">
              <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--teal-600)]" />
                <span className="font-semibold text-[13px] text-[var(--ink)]">{t("recentMedicalRecords")}</span>
                <span className="badge text-xs ms-auto">{medicalRecords?.length ?? recentRecords?.length ?? 0}</span>
              </div>
              <div className="card-pad space-y-2">
                {!(medicalRecords ?? recentRecords)?.length
                  ? <p className="text-xs text-[var(--ink-muted)]">{t("noRecords")}</p>
                  : (medicalRecords ?? recentRecords ?? []).map((r, i) => {
                    const isOwn = user?.role === "doctor" && (r as any).doctorId === user?.id;
                    return (
                      <div key={i} className={cn(
                        "relative text-xs border rounded-md p-2",
                        isOwn ? "bg-[var(--teal-50)] border-[var(--teal-300)]" : "border-[var(--line)]/40"
                      )}>
                        {isOwn && (
                          <span className="absolute top-2 end-2 badge text-[9px] px-1 py-0 border-[var(--teal-300)] text-[var(--teal-600)]">
                            {t("yourNote")}
                          </span>
                        )}
                        <p className="font-medium pe-14 text-[var(--ink)]">{r.diagnosis}</p>
                        <p className="text-[var(--ink-muted)]">{r.chiefComplaint} · {formatDate(r.createdAt)}</p>
                      </div>
                    );
                  })
                }
              </div>
            </div>

            {/* X-Rays */}
            <div className="card">
              <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
                <Scan className="w-4 h-4 text-[var(--teal-600)]" />
                <span className="font-semibold text-[13px] text-[var(--ink)]">{t("xrayHistory")}</span>
                <span className="badge text-xs ms-auto">{recentXrays?.length ?? 0}</span>
              </div>
              <div className="card-pad space-y-2">
                {!recentXrays?.length
                  ? <p className="text-xs text-[var(--ink-muted)]">{t("noXrays")}</p>
                  : recentXrays.map((x, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs border-b border-[var(--line)]/40 pb-2">
                      <div className="flex-1">
                        <p className="font-medium text-[var(--ink)]">{x.bodyPart}</p>
                        <p className="text-[var(--ink-muted)]">{formatDate(x.createdAt)}</p>
                      </div>
                      <StatusBadge status={x.status} />
                    </div>
                  ))
                }
              </div>
            </div>

            {/* Lab Tests */}
            <div className="card">
              <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-[var(--teal-600)]" />
                <span className="font-semibold text-[13px] text-[var(--ink)]">{t("labTests")}</span>
                <span className="badge text-xs ms-auto">{recentLabTests?.length ?? 0}</span>
              </div>
              <div className="card-pad space-y-2">
                {!recentLabTests?.length
                  ? <p className="text-xs text-[var(--ink-muted)]">{t("noRecords")}</p>
                  : recentLabTests.map((l, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs border-b border-[var(--line)]/40 pb-2">
                      <div className="flex-1">
                        <p className="font-medium text-[var(--ink)]">{l.testName}</p>
                        <p className="text-[var(--ink-muted)]">{formatDate(l.createdAt)}</p>
                      </div>
                      <StatusBadge status={l.status} />
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="mt-4">
          <div className="card">
            <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--teal-600)]" />
              <span className="font-semibold text-[13px] text-[var(--ink)]">{t("completeClinicalTimeline")}</span>
              <span className="text-[12px] font-normal text-[var(--ink-muted)] ms-1">— {t("mostRecentFirst")}</span>
            </div>
            <div className="card-pad pb-6 pt-2">
              <PatientTimeline
                appointments={recentAppointments as any}
                records={recentRecords as any}
                labTests={recentLabTests as any}
                xrays={recentXrays as any}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("editPatient")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} (EN) *</Label>
                <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("name")} (AR)</Label>
                <Input value={form.fullNameAr} onChange={e => setForm(f => ({ ...f, fullNameAr: e.target.value }))} dir="rtl" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("dateOfBirth")} *</Label>
                <Input type="date" value={form.dateOfBirth} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("phone")} *</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("address")}</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("gender")}</Label>
              <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{t("male")}</SelectItem>
                  <SelectItem value="female">{t("female")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {["super_admin", "admin", "nurse"].includes(user?.role || "") && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("bloodType")}</Label>
                    <Select value={form.bloodType} onValueChange={v => setForm(f => ({ ...f, bloodType: v === "none" ? "" : v }))}>
                      <SelectTrigger data-testid="select-blood-type"><SelectValue placeholder={t("selectBloodType")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("notSpecified")}</SelectItem>
                        {BLOOD_TYPES.map(bt => <SelectItem key={bt} value={bt}>{bt}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("emergencyContact")}</Label>
                    <Input value={form.emergencyContact} onChange={e => setForm(f => ({ ...f, emergencyContact: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("allergies")}</Label>
                  <Input value={form.allergies} onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))} />
                </div>
              </>
            )}

            {["super_admin", "admin"].includes(user?.role || "") && (
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={form.isActive}
                  onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                  className="w-4 h-4 rounded border-[var(--line)] text-[var(--teal-600)] focus:ring-[var(--teal-600)]"
                />
                <Label htmlFor="isActive" className="text-sm cursor-pointer">{t("active")}</Label>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowEdit(false)}>{t("cancel")}</button>
              <button className="btn btn-primary btn-sm" onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("loading") : t("saveChanges")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Patient consent management (grant/view/revoke). The card internally
          gates list vs grant vs revoke by role. */}
      {patientId > 0 && (
        <div className="mt-4">
          <PatientConsentCard patientId={patientId} />
        </div>
      )}

      {/* Compliance change-history (who/when/before→after). The backing route is
          gated to super_admin + compliance_officer, so only render for them. */}
      {patientId > 0 && ["super_admin", "compliance_officer"].includes(user?.role || "") && (
        <div className="mt-4">
          <ChangeHistoryCard entityType="patient" entityId={patientId} />
        </div>
      )}
    </div>
  );
}
