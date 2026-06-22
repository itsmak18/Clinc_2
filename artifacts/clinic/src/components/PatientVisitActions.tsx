import { useState } from "react";
import {
  useStartConsultation, useRequestDiagnostics, useReconsultAppointment, usePendingPayment, useCompleteAppointment,
  getGetPatientSummaryQueryKey, getListAppointmentsQueryKey, getGetTodayAppointmentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/hooks/i18n";
import { useToast } from "@/hooks/use-toast";
import { Stethoscope, FlaskConical, CheckCircle } from "lucide-react";

interface VisitAppt { id: number; status: string }

interface PatientVisitActionsProps {
  patientId: number;
  appointments: VisitAppt[] | undefined;
}

// Statuses where the doctor still has an action to take on the visit.
const ACTIVE_STATUSES = ["ready_for_doctor", "in_consultation", "awaiting_diagnostics", "pending_payment"];

/**
 * Doctor-facing visit actions on the patient page. Resolves the patient's active
 * visit from their recent appointments and surfaces the next clinical step —
 * including **Complete Consultation**, which is the `payment` transition
 * (in_consultation / awaiting_diagnostics → pending_payment). That hands the
 * visit off to front-desk checkout; the literal `completed` state stays a
 * front-desk action (billing separation of duties).
 */
export default function PatientVisitActions({ patientId, appointments }: PatientVisitActionsProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const consult = useStartConsultation();
  const diagnostics = useRequestDiagnostics();
  const reconsult = useReconsultAppointment();
  const payment = usePendingPayment();
  const complete = useCompleteAppointment();

  // Most-recent appointment still needing a doctor action.
  const visit = (appointments ?? []).find(a => ACTIVE_STATUSES.includes(a.status));
  if (!visit) return null;

  const run = async (
    mut: { mutateAsync: (v: { appointmentId: number }) => Promise<unknown> },
    label: string,
  ) => {
    setBusy(true);
    try {
      await mut.mutateAsync({ appointmentId: visit.id });
      qc.invalidateQueries({ queryKey: getGetPatientSummaryQueryKey(patientId) });
      qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetTodayAppointmentsQueryKey() });
      toast({ title: label });
    } catch {
      toast({ title: `${t("failed")}: ${label}`, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const canComplete = ["in_consultation", "awaiting_diagnostics"].includes(visit.status);

  return (
    <div className="flex gap-2">
      {visit.status === "ready_for_doctor" && (
        <button
          className="btn btn-primary btn-sm gap-1.5"
          disabled={busy}
          onClick={() => run(consult, t("consultationStarted"))}
          data-testid="button-start-consult"
        >
          <Stethoscope className="w-3.5 h-3.5" /> {t("consult")}
        </button>
      )}
      {visit.status === "in_consultation" && (
        <button
          className="btn btn-outline btn-sm gap-1.5"
          disabled={busy}
          onClick={() => run(diagnostics, t("awaitingDiagnostics"))}
          data-testid="button-order-diagnostics"
        >
          <FlaskConical className="w-3.5 h-3.5" /> {t("diagnostics")}
        </button>
      )}
      {visit.status === "awaiting_diagnostics" && (
        <button
          className="btn btn-outline btn-sm gap-1.5"
          disabled={busy}
          onClick={() => run(reconsult, t("resumeConsult"))}
          data-testid="button-resume-consult"
        >
          <Stethoscope className="w-3.5 h-3.5" /> {t("resumeConsult")}
        </button>
      )}
      {canComplete && (
        <button
          className="btn btn-primary btn-sm gap-1.5"
          disabled={busy}
          onClick={() => run(payment, t("consultationComplete"))}
          data-testid="button-complete-consult"
        >
          <CheckCircle className="w-3.5 h-3.5" /> {t("completeConsultation")}
        </button>
      )}
      {visit.status === "pending_payment" && (
        <button
          className="btn btn-primary btn-sm gap-1.5"
          disabled={busy}
          onClick={() => run(complete, t("appointmentCompleted"))}
          data-testid="button-mark-completed"
        >
          <CheckCircle className="w-3.5 h-3.5" /> {t("complete")}
        </button>
      )}
    </div>
  );
}
