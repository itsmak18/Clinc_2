import { useGetPatientSummary, getGetPatientSummaryQueryKey, useUpdatePatient, useListMedicalRecords, getListMedicalRecordsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import PatientTimeline from "@/components/PatientTimeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime, formatCurrency, calcAge } from "@/lib/api";
import { ArrowLeft, User, CalendarDays, FileText, Scan, FlaskConical, AlertTriangle, Activity, Edit2, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";

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
        const msg = err.response?.data?.error || "Failed to update patient";
        toast({ title: msg, variant: "destructive" });
      }
    }
  });

  const handleUpdate = () => {
    updateMutation.mutate({
      patientId,
      data: form as any
    });
  };

  const canEdit = ["super_admin", "admin", "nurse", "front_desk"].includes(user?.role || "");

  if (isLoading) return <div className="flex items-center justify-center h-full text-muted-foreground">{t("loading")}</div>;
  if ((error as any)?.status === 403) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
        <ShieldOff className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-semibold">{t("patientForbidden")}</h2>
        <p className="text-muted-foreground max-w-sm">{t("patientForbiddenDesc")}</p>
        <Button variant="outline" onClick={() => setLocation("/patients")}>
          <ArrowLeft className="w-4 h-4 me-2" />{t("back")}
        </Button>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-muted-foreground">Patient not found</div>;

  const { patient, recentAppointments, recentRecords, recentXrays, recentLabTests, outstandingBalance } = data;

  return (
    <div>
      <PageHeader
        title={patient.fullName}
        subtitle={`MRN: ${patient.mrn}`}
        actions={
          <div className="flex gap-2">
            {canEdit && (
              <Button size="sm" onClick={() => setShowEdit(true)} data-testid="button-edit-patient">
                <Edit2 className="w-3.5 h-3.5 me-1" /> {t("edit")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setLocation("/patients")} data-testid="button-back">
              <ArrowLeft className="w-3.5 h-3.5 me-1" /> {t("back")}
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-4">
        {/* Allergies Banner */}
        {patient.allergies && (
          <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-destructive/60 bg-destructive/10">
            <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-destructive uppercase tracking-wide">Allergies / Contraindications</p>
              <p className="text-sm text-destructive mt-0.5">{patient.allergies}</p>
            </div>
          </div>
        )}

        {/* Patient Info Card */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Patient Information</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 text-sm">
            {[
              { label: t("mrn"), value: <span className="font-mono font-semibold text-primary">{patient.mrn}</span> },
              { label: t("gender"), value: t(patient.gender as any) },
              { label: t("dateOfBirth"), value: `${formatDate(patient.dateOfBirth)} (${calcAge(patient.dateOfBirth)})` },
              { label: t("phone"), value: patient.phone },
              { label: t("bloodType"), value: patient.bloodType || "-" },
              { label: t("allergies"), value: patient.allergies || "-" },
              { label: t("address"), value: patient.address || "-" },
              { label: t("emergencyContact"), value: patient.emergencyContact || "-" },
              { label: "Outstanding Balance", value: <span className={outstandingBalance > 0 ? "text-destructive font-semibold" : ""}>${formatCurrency(outstandingBalance)}</span> },
              { label: t("status"), value: <Badge variant={patient.isActive ? "default" : "secondary"}>{patient.isActive ? t("active") : t("inactive")}</Badge> },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                <div className="font-medium">{value}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Tabs: Overview / Timeline */}
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="timeline" className="gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Timeline
              <Badge variant="secondary" className="ms-1 text-[10px] px-1.5 py-0">
                {(recentAppointments?.length ?? 0) + (recentRecords?.length ?? 0) + (recentLabTests?.length ?? 0) + (recentXrays?.length ?? 0)}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Appointments */}
              <Card className="border border-border">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-primary" /> Recent Appointments
                    <Badge variant="outline" className="ms-auto text-xs">{recentAppointments?.length ?? 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {!recentAppointments?.length ? <p className="text-xs text-muted-foreground">No appointments</p> :
                    recentAppointments.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs border-b border-border/40 pb-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{a.reason}</p>
                          <p className="text-muted-foreground">{formatDateTime(a.scheduledAt)} · {a.doctor?.fullName}</p>
                        </div>
                        <StatusBadge status={a.status} />
                      </div>
                    ))
                  }
                </CardContent>
              </Card>

              {/* Medical Records */}
              <Card className="border border-border">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" /> Recent Medical Records
                    <Badge variant="outline" className="ms-auto text-xs">{medicalRecords?.length ?? recentRecords?.length ?? 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {!(medicalRecords ?? recentRecords)?.length ? <p className="text-xs text-muted-foreground">No records</p> :
                    (medicalRecords ?? recentRecords ?? []).map((r, i) => {
                      const isOwn = user?.role === "doctor" && (r as any).doctorId === user?.id;
                      return (
                        <div key={i} className={cn(
                          "relative text-xs border border-border/40 rounded-md p-2",
                          isOwn ? "bg-primary/5 border-primary/30" : "border-transparent"
                        )}>
                          {isOwn && (
                            <Badge variant="outline" className="absolute top-2 end-2 text-[9px] px-1 py-0 border-primary/40 text-primary">
                              {t("yourNote")}
                            </Badge>
                          )}
                          <p className="font-medium pe-14">{r.diagnosis}</p>
                          <p className="text-muted-foreground">{r.chiefComplaint} · {formatDate(r.createdAt)}</p>
                        </div>
                      );
                    })
                  }
                </CardContent>
              </Card>

              {/* X-Rays */}
              <Card className="border border-border">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Scan className="w-4 h-4 text-primary" /> X-Ray History
                    <Badge variant="outline" className="ms-auto text-xs">{recentXrays?.length ?? 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {!recentXrays?.length ? <p className="text-xs text-muted-foreground">No X-rays</p> :
                    recentXrays.map((x, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs border-b border-border/40 pb-2">
                        <div className="flex-1">
                          <p className="font-medium">{x.bodyPart}</p>
                          <p className="text-muted-foreground">{formatDate(x.createdAt)}</p>
                        </div>
                        <StatusBadge status={x.status} />
                      </div>
                    ))
                  }
                </CardContent>
              </Card>

              {/* Lab Tests */}
              <Card className="border border-border">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-primary" /> Lab Tests
                    <Badge variant="outline" className="ms-auto text-xs">{recentLabTests?.length ?? 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {!recentLabTests?.length ? <p className="text-xs text-muted-foreground">No lab tests</p> :
                    recentLabTests.map((l, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs border-b border-border/40 pb-2">
                        <div className="flex-1">
                          <p className="font-medium">{l.testName}</p>
                          <p className="text-muted-foreground">{formatDate(l.createdAt)}</p>
                        </div>
                        <StatusBadge status={l.status} />
                      </div>
                    ))
                  }
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="mt-4">
            <Card className="border border-border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" /> Complete Clinical Timeline
                  <span className="text-xs font-normal text-muted-foreground ms-1">— most recent first</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-6 pt-2">
                <PatientTimeline
                  appointments={recentAppointments as any}
                  records={recentRecords as any}
                  labTests={recentLabTests as any}
                  xrays={recentXrays as any}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
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

            {/* Clinical fields - only for nurse/admin */}
            {["super_admin", "admin", "nurse"].includes(user?.role || "") && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("bloodType")}</Label>
                    <Input value={form.bloodType} onChange={e => setForm(f => ({ ...f, bloodType: e.target.value }))} />
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

            {/* Admin only fields */}
            {["super_admin", "admin"].includes(user?.role || "") && (
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={form.isActive}
                  onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <Label htmlFor="isActive" className="text-sm cursor-pointer">{t("active")}</Label>
              </div>
            )}

            <DialogFooter className="gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowEdit(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("loading") : t("saveChanges")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
