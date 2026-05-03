import { useGetPatientSummary, getGetPatientSummaryQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useLocation, useParams } from "wouter";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/api";
import { ArrowLeft, User, CalendarDays, FileText, Scan, FlaskConical, Receipt, AlertTriangle } from "lucide-react";

export default function PatientDetail() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const patientId = parseInt(params.id ?? "0");

  const { data, isLoading } = useGetPatientSummary(patientId, {
    query: { enabled: !!patientId, queryKey: getGetPatientSummaryQueryKey(patientId) }
  });

  if (isLoading) return <div className="flex items-center justify-center h-full text-muted-foreground">{t("loading")}</div>;
  if (!data) return <div className="p-6 text-muted-foreground">Patient not found</div>;

  const { patient, recentAppointments, recentRecords, recentXrays, recentLabTests, outstandingBalance } = data;

  return (
    <div>
      <PageHeader
        title={patient.fullName}
        subtitle={`MRN: ${patient.mrn}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => setLocation("/patients")} data-testid="button-back">
            <ArrowLeft className="w-3.5 h-3.5 me-1" /> Back
          </Button>
        }
      />

      <div className="p-6 space-y-4">
        {/* Allergies Banner - pinned for doctor/nurse visibility */}
        {patient.allergies && (
          <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-destructive/60 bg-destructive/10">
            <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-destructive uppercase tracking-wide">Allergies / Contraindications</p>
              <p className="text-sm text-destructive mt-0.5">{patient.allergies}</p>
            </div>
          </div>
        )}
        {/* Patient info */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Patient Information</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 text-sm">
            {[
              { label: t("mrn"), value: <span className="font-mono font-semibold text-primary">{patient.mrn}</span> },
              { label: t("gender"), value: t(patient.gender as any) },
              { label: t("dateOfBirth"), value: formatDate(patient.dateOfBirth) },
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

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Appointments */}
          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="w-4 h-4 text-primary" /> Recent Appointments</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {!recentAppointments?.length ? <p className="text-xs text-muted-foreground">No appointments</p> :
                recentAppointments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs border-b border-border/40 pb-2">
                    <div className="flex-1">
                      <p className="font-medium">{a.reason}</p>
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
              <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> Recent Medical Records</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {!recentRecords?.length ? <p className="text-xs text-muted-foreground">No records</p> :
                recentRecords.map((r, i) => (
                  <div key={i} className="text-xs border-b border-border/40 pb-2">
                    <p className="font-medium">{r.diagnosis}</p>
                    <p className="text-muted-foreground">{r.chiefComplaint} · {formatDate(r.createdAt)}</p>
                  </div>
                ))
              }
            </CardContent>
          </Card>

          {/* X-Rays */}
          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Scan className="w-4 h-4 text-primary" /> X-Ray History</CardTitle>
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
              <CardTitle className="text-sm flex items-center gap-2"><FlaskConical className="w-4 h-4 text-primary" /> Lab Tests</CardTitle>
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
      </div>
    </div>
  );
}
