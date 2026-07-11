import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer, Loader2 } from "lucide-react";
import { formatDate, formatDateTime, formatCurrency } from "@/lib/api";
import { useGetAppointmentDischarge, getGetAppointmentDischargeQueryKey } from "@workspace/api-client-react";
import { useI18n, translations } from "@/hooks/i18n";

type PrintLang = "en" | "ar";

interface Medication { name: string; dosage: string; frequency: string; duration: string; instructions?: string | null }
interface Vitals { bloodPressure?: string | null; heartRate?: number | null; temperature?: number | null; weight?: number | null; oxygenSaturation?: number | null; respiratoryRate?: number | null }
interface InvoiceItem { description: string; quantity: number; unitPrice: number; total: number }

interface DischargeData {
  appointment: {
    id: number; reason: string; status: string; scheduledAt: string; notes?: string | null;
    checkedInAt?: string | null; consultationStartedAt?: string | null;
    doctor?: { id: number; fullName: string } | null;
  };
  patient: {
    id: number; fullName: string; fullNameAr?: string | null; mrn: string;
    dateOfBirth?: string | null; gender?: string | null; phone?: string | null;
    allergies?: string | null;
  };
  medicalRecord?: {
    id: number; chiefComplaint: string; diagnosis: string; treatment: string;
    notes?: string | null; vitals?: Vitals | null;
  } | null;
  prescriptions: Array<{ id: number; medications: Medication[]; notes?: string | null; createdAt: string }>;
  labTests: Array<{ id: number; testName: string; results?: string | null; status: string; notes?: string | null }>;
  xrays: Array<{ id: number; bodyPart: string; report?: string | null; status: string; notes?: string | null }>;
  invoice?: {
    id: number; invoiceNumber: string; subtotal: number; discount: number; total: number;
    status: string; paidAt?: string | null; items: InvoiceItem[];
  } | null;
}

interface Props {
  appointmentId: number | null;
  open: boolean;
  onClose: () => void;
}

export default function DischargeSheet({ appointmentId, open, onClose }: Props) {
  const { language } = useI18n();
  // The printed paper can be produced in either language regardless of the UI
  // language — staff choose per print (e.g. Arabic copy for the patient, English
  // copy for an external referral). Defaults to the current UI language.
  const [printLang, setPrintLang] = useState<PrintLang>(language);
  const printRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useGetAppointmentDischarge(appointmentId ?? 0, {
    query: {
      queryKey: getGetAppointmentDischargeQueryKey(appointmentId ?? 0),
      enabled: open && !!appointmentId,
    },
  });

  // Resolve a label in the chosen print language (independent of the UI language).
  const tr = (key: keyof typeof translations.en): string =>
    translations[printLang][key] ?? translations.en[key] ?? key;
  const isRtl = printLang === "ar";

  useEffect(() => { if (open) setPrintLang(language); }, [open, language]);

  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html lang="${printLang}" dir="${isRtl ? "rtl" : "ltr"}"><head>
      <meta charset="utf-8"/>
      <title>${tr("visitSummary")}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #111; padding: 24px; }
        .header { text-align: center; border-bottom: 2px solid #1a56db; padding-bottom: 12px; margin-bottom: 16px; }
        .header h1 { font-size: 20px; color: #1a56db; font-weight: 800; letter-spacing: 1px; }
        .header p { font-size: 10px; color: #555; margin-top: 2px; }
        .meta { display: flex; justify-content: space-between; background: #f0f4ff; border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; font-size: 10px; }
        .meta .block { line-height: 1.7; }
        .meta strong { display: inline-block; min-width: 90px; }
        .allergy { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 4px; padding: 8px 12px; margin-bottom: 12px; color: #b91c1c; font-weight: 600; font-size: 10px; }
        section { margin-bottom: 14px; }
        section h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #1a56db; border-bottom: 1px solid #dde5ff; padding-bottom: 4px; margin-bottom: 8px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; }
        .row { display: flex; gap: 4px; margin-bottom: 4px; }
        .row .label { color: #555; min-width: 120px; flex-shrink: 0; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        th { background: #f0f4ff; text-align: ${isRtl ? "right" : "left"}; padding: 4px 8px; font-weight: 600; border: 1px solid #dde5ff; }
        td { padding: 4px 8px; border: 1px solid #e5e7eb; vertical-align: top; }
        .sig { margin-top: 32px; display: flex; justify-content: space-between; }
        .sig .line { text-align: center; min-width: 200px; }
        .sig .line div { border-top: 1px solid #333; padding-top: 4px; margin-top: 40px; font-size: 10px; color: #555; }
        .footer { text-align: center; margin-top: 20px; font-size: 9px; color: #888; border-top: 1px solid #e5e7eb; padding-top: 8px; }
        .badge { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 600; }
        .badge-green { background: #dcfce7; color: #15803d; }
        .badge-yellow { background: #fef9c3; color: #854d0e; }
        .badge-red { background: #fee2e2; color: #b91c1c; }
      </style>
    </head><body dir="${isRtl ? "rtl" : "ltr"}">${el.innerHTML}</body></html>`);
    win.document.close();
    // Set the patient name via the DOM API rather than interpolating it into the
    // written HTML string — assigning to .title treats the value as text, so it
    // cannot break out of the <title> element and inject markup.
    if (data?.patient.fullName) win.document.title = `${tr("visitSummary")} — ${data.patient.fullName}`;
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  // Cast to local interface: generated DischargeSheet vitals shape diverges from
  // component's bloodPressure string field — keep cast until vitals schema unified.
  const d = data as unknown as DischargeData | null;
  const appt = d?.appointment;
  const patient = d?.patient;
  const rec = d?.medicalRecord;
  const vitals = rec?.vitals;
  const inv = d?.invoice;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between gap-2 pb-2 border-b">
          <DialogTitle className="text-base font-semibold">{tr("visitDischargeSummary")}</DialogTitle>
          <div className="flex items-center gap-2 ms-auto">
            {/* Print-language picker — choose English or Arabic for this paper */}
            <div className="flex rounded-md border border-[var(--line)] overflow-hidden text-xs" role="group" aria-label={tr("printLanguage")}>
              <button
                type="button"
                className={`px-2.5 py-1 ${printLang === "en" ? "bg-[var(--teal-600)] text-white" : "text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"}`}
                onClick={() => setPrintLang("en")}
              >English</button>
              <button
                type="button"
                className={`px-2.5 py-1 ${printLang === "ar" ? "bg-[var(--teal-600)] text-white" : "text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"}`}
                onClick={() => setPrintLang("ar")}
              >العربية</button>
            </div>
            <button className="btn btn-primary btn-sm gap-1.5" onClick={handlePrint} disabled={!data || isLoading}>
              <Printer className="w-3.5 h-3.5" /> {tr("printSavePdf")}
            </button>
          </div>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> {tr("loadingVisitData")}
          </div>
        )}
        {error && (
          <div className="p-4 text-destructive text-sm">{tr("failedToLoadColon")} {error.message}</div>
        )}

        {d && (
          <div ref={printRef} dir={isRtl ? "rtl" : "ltr"} className="text-[11px] leading-relaxed">
            {/* Header */}
            <div className="header text-center border-b-2 border-primary pb-3 mb-4">
              <h1 className="text-xl font-black text-primary tracking-wide">Wateen Clinic</h1>
              <p className="text-xs text-muted-foreground">{tr("clinicMgmtVisitSummary")}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {tr("appointmentLabel")} #{appt?.id} · {appt?.scheduledAt ? formatDateTime(appt.scheduledAt) : ""}
              </p>
            </div>

            {/* Patient + Visit Info */}
            <div className="meta grid grid-cols-2 gap-4 bg-blue-50/50 border border-blue-100 rounded-lg p-3 mb-4 text-[11px]">
              <div className="space-y-1">
                <p className="font-bold text-base text-foreground">{patient?.fullName}</p>
                {patient?.fullNameAr && <p className="text-muted-foreground text-sm" dir="rtl">{patient.fullNameAr}</p>}
                <p className="text-muted-foreground font-mono text-xs">{tr("mrn")}: {patient?.mrn}</p>
                {patient?.dateOfBirth && <p><span className="text-muted-foreground">{tr("dobLabel")}:</span> {formatDate(patient.dateOfBirth)}</p>}
                {patient?.gender && <p><span className="text-muted-foreground">{tr("gender")}:</span> {patient.gender}</p>}
                {patient?.phone && <p><span className="text-muted-foreground">{tr("phone")}:</span> {patient.phone}</p>}
              </div>
              <div className="space-y-1">
                <p><span className="text-muted-foreground">{tr("doctorLabel")}:</span> <span className="font-medium">{appt?.doctor?.fullName ?? "—"}</span></p>
                <p><span className="text-muted-foreground">{tr("reason")}:</span> {appt?.reason}</p>
                <p><span className="text-muted-foreground">{tr("status")}:</span> <span className="capitalize">{appt?.status?.replace(/_/g, " ")}</span></p>
                {appt?.checkedInAt && <p><span className="text-muted-foreground">{tr("checkedInLabel")}:</span> {formatDateTime(appt.checkedInAt)}</p>}
                {appt?.consultationStartedAt && <p><span className="text-muted-foreground">{tr("consultationLabel")}:</span> {formatDateTime(appt.consultationStartedAt)}</p>}
                <p><span className="text-muted-foreground">{tr("printedLabel")}:</span> {new Date().toLocaleString()}</p>
              </div>
            </div>

            {/* Allergies */}
            {patient?.allergies && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded p-2.5 mb-4 text-red-800">
                <span className="text-red-600 font-black text-sm">⚠</span>
                <div>
                  <p className="font-bold text-xs uppercase tracking-wide">{tr("allergiesContraindications")}</p>
                  <p className="mt-0.5">{patient.allergies}</p>
                </div>
              </div>
            )}

            {/* Vitals */}
            {vitals && Object.values(vitals).some(v => v !== null && v !== undefined) && (
              <section className="mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-primary border-b border-blue-100 pb-1 mb-2">{tr("vitals")}</h2>
                <div className="grid grid-cols-3 gap-2">
                  {vitals.bloodPressure && <div className="bg-muted/30 rounded p-1.5 text-center"><p className="text-[10px] text-muted-foreground">{tr("bloodPressure")}</p><p className="font-bold">{vitals.bloodPressure}</p></div>}
                  {vitals.heartRate && <div className="bg-muted/30 rounded p-1.5 text-center"><p className="text-[10px] text-muted-foreground">{tr("heartRate")}</p><p className="font-bold">{vitals.heartRate} bpm</p></div>}
                  {vitals.temperature && <div className="bg-muted/30 rounded p-1.5 text-center"><p className="text-[10px] text-muted-foreground">{tr("temperature")}</p><p className="font-bold">{vitals.temperature}°C</p></div>}
                  {vitals.weight && <div className="bg-muted/30 rounded p-1.5 text-center"><p className="text-[10px] text-muted-foreground">{tr("weight")}</p><p className="font-bold">{vitals.weight} kg</p></div>}
                  {vitals.oxygenSaturation && <div className="bg-muted/30 rounded p-1.5 text-center"><p className="text-[10px] text-muted-foreground">{tr("dischargeSpo2")}</p><p className="font-bold">{vitals.oxygenSaturation}%</p></div>}
                  {vitals.respiratoryRate && <div className="bg-muted/30 rounded p-1.5 text-center"><p className="text-[10px] text-muted-foreground">{tr("dischargeRespRate")}</p><p className="font-bold">{vitals.respiratoryRate}/min</p></div>}
                </div>
              </section>
            )}

            {/* Diagnosis & Treatment */}
            {rec && (
              <section className="mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-primary border-b border-blue-100 pb-1 mb-2">{tr("diagnosis")} & {tr("treatment")}</h2>
                <div className="space-y-2">
                  <div><p className="text-[10px] text-muted-foreground font-medium uppercase">{tr("chiefComplaint")}</p><p className="mt-0.5">{rec.chiefComplaint}</p></div>
                  <div><p className="text-[10px] text-muted-foreground font-medium uppercase">{tr("diagnosis")}</p><p className="mt-0.5 font-medium">{rec.diagnosis}</p></div>
                  <div><p className="text-[10px] text-muted-foreground font-medium uppercase">{tr("treatmentPlan")}</p><p className="mt-0.5">{rec.treatment}</p></div>
                  {rec.notes && <div><p className="text-[10px] text-muted-foreground font-medium uppercase">{tr("notes")}</p><p className="mt-0.5 italic">{rec.notes}</p></div>}
                </div>
              </section>
            )}

            {/* Prescriptions */}
            {d.prescriptions.length > 0 && (
              <section className="mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-primary border-b border-blue-100 pb-1 mb-2">{tr("prescriptions")}</h2>
                {d.prescriptions.map((rx, ri) => (
                  <div key={ri} className="mb-2">
                    <table className="w-full text-[10px] border-collapse">
                      <thead>
                        <tr className="bg-blue-50">
                          <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("medication")}</th>
                          <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("dosage")}</th>
                          <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("frequency")}</th>
                          <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("duration")}</th>
                          <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("instructions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(rx.medications as Medication[]).map((med, mi) => (
                          <tr key={mi} className={mi % 2 === 0 ? "bg-white" : "bg-muted/20"}>
                            <td className="p-1.5 border border-border/50 font-medium">{med.name}</td>
                            <td className="p-1.5 border border-border/50">{med.dosage}</td>
                            <td className="p-1.5 border border-border/50">{med.frequency}</td>
                            <td className="p-1.5 border border-border/50">{med.duration}</td>
                            <td className="p-1.5 border border-border/50 text-muted-foreground">{med.instructions ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rx.notes && <p className="text-[10px] text-muted-foreground mt-1 italic">{tr("notes")}: {rx.notes}</p>}
                  </div>
                ))}
              </section>
            )}

            {/* Lab Tests */}
            {d.labTests.length > 0 && (
              <section className="mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-primary border-b border-blue-100 pb-1 mb-2">{tr("labResultsSection")}</h2>
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-blue-50">
                      <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("testName")}</th>
                      <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("status")}</th>
                      <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("results")}</th>
                      <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.labTests.map((lt, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-muted/20"}>
                        <td className="p-1.5 border border-border/50 font-medium">{lt.testName}</td>
                        <td className="p-1.5 border border-border/50 capitalize">{lt.status.replace(/_/g, " ")}</td>
                        <td className="p-1.5 border border-border/50">{lt.results ?? <span className="text-muted-foreground">{tr("pending")}</span>}</td>
                        <td className="p-1.5 border border-border/50 text-muted-foreground">{lt.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* X-Rays */}
            {d.xrays.length > 0 && (
              <section className="mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-primary border-b border-blue-100 pb-1 mb-2">{tr("radiologyXray")}</h2>
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-blue-50">
                      <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("bodyPart")}</th>
                      <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("status")}</th>
                      <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("report")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.xrays.map((xr, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-muted/20"}>
                        <td className="p-1.5 border border-border/50 font-medium capitalize">{xr.bodyPart}</td>
                        <td className="p-1.5 border border-border/50 capitalize">{xr.status}</td>
                        <td className="p-1.5 border border-border/50">{xr.report ?? <span className="text-muted-foreground">{tr("pending")}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Invoice */}
            {inv && (
              <section className="mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-primary border-b border-blue-100 pb-1 mb-2">
                  {tr("invoice")} #{inv.invoiceNumber}
                  <span className={`ms-2 text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${inv.status === "paid" ? "bg-green-100 text-green-700" : inv.status === "cancelled" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
                    {tr(inv.status === "paid" ? "paid" : inv.status === "cancelled" ? "cancelled" : "pending")}
                  </span>
                </h2>
                <table className="w-full text-[10px] border-collapse mb-2">
                  <thead>
                    <tr className="bg-blue-50">
                      <th className="text-start p-1.5 border border-blue-100 font-semibold">{tr("description")}</th>
                      <th className="text-end p-1.5 border border-blue-100 font-semibold">{tr("qtyShort")}</th>
                      <th className="text-end p-1.5 border border-blue-100 font-semibold">{tr("unitPrice")}</th>
                      <th className="text-end p-1.5 border border-blue-100 font-semibold">{tr("total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(inv.items as InvoiceItem[]).map((item, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-muted/20"}>
                        <td className="p-1.5 border border-border/50">{item.description}</td>
                        <td className="p-1.5 border border-border/50 text-end">{item.quantity}</td>
                        <td className="p-1.5 border border-border/50 text-end">${formatCurrency(item.unitPrice)}</td>
                        <td className="p-1.5 border border-border/50 text-end font-medium">${formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-end">
                  <div className="text-[10px] space-y-0.5 min-w-[180px]">
                    <div className="flex justify-between gap-6"><span className="text-muted-foreground">{tr("subtotal")}</span><span>${formatCurrency(inv.subtotal)}</span></div>
                    {Number(inv.discount) > 0 && <div className="flex justify-between gap-6 text-green-700"><span>{tr("discount")}</span><span>-${formatCurrency(inv.discount)}</span></div>}
                    <div className="flex justify-between gap-6 font-bold border-t border-border pt-0.5 mt-0.5"><span>{tr("total")}</span><span>${formatCurrency(inv.total)}</span></div>
                    {inv.status === "paid" && inv.paidAt && <div className="flex justify-between gap-6 text-green-700 text-[9px]"><span>{tr("paid")}</span><span>{formatDate(inv.paidAt)}</span></div>}
                  </div>
                </div>
              </section>
            )}

            {/* Appointment notes */}
            {appt?.notes && (
              <section className="mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-primary border-b border-blue-100 pb-1 mb-2">{tr("generalNotes")}</h2>
                <p className="italic text-muted-foreground">{appt.notes}</p>
              </section>
            )}

            {/* Signature line */}
            <div className="sig flex justify-between mt-8 border-t border-border/50 pt-4">
              <div className="line text-center min-w-[180px]">
                <div className="mt-10 border-t border-foreground/40 pt-1 text-[10px] text-muted-foreground">
                  {tr("doctorSignature")}<br />{appt?.doctor?.fullName ?? ""}
                </div>
              </div>
              <div className="line text-center min-w-[180px]">
                <div className="mt-10 border-t border-foreground/40 pt-1 text-[10px] text-muted-foreground">
                  {tr("patientGuardianSignature")}<br />{patient?.fullName ?? ""}
                </div>
              </div>
            </div>

            <div className="footer text-center mt-5 pt-3 border-t border-border/30 text-[9px] text-muted-foreground">
              {tr("confidentialFooter")} — {new Date().getFullYear()}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
