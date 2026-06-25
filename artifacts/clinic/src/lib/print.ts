// Escape every dynamic value before it is interpolated into a document.write()
// HTML string. The print window is same-origin, so an unescaped staff-entered
// PHI field (patient name, findings, etc.) would otherwise execute as markup.
export function escapeHtml(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Allow only http/https URLs in href context; everything else (javascript:,
// data:, etc.) collapses to empty. Returned value is HTML-attribute-escaped.
function safeUrl(u: string | null | undefined): string {
  if (!u) return "";
  try {
    const parsed = new URL(u, window.location.origin);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return escapeHtml(u);
  } catch { /* malformed URL → drop */ }
  return "";
}

export function openPrintWindow(html: string, title: string) {
  const win = window.open("", "_blank", "width=860,height=720");
  if (!win) { alert("Pop-up blocked — please allow pop-ups for this site."); return; }
  // The window is about:blank, so relative image URLs (server-stored study
  // images are served from /api/{modality}/{id}/images/{uuid}) need an explicit
  // base to resolve against the app origin. Same-origin → the auth cookie is
  // sent, so the authenticated download endpoint serves the bytes.
  const base = `<base href="${escapeHtml(window.location.origin)}/">`;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">${base}<title>${escapeHtml(title)}</title></head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

const STYLES = `
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;padding:30px 40px;color:#111;font-size:13px;line-height:1.5}
    .ar-block{font-family:'Segoe UI','Arial',sans-serif;direction:rtl;text-align:right;color:#555;font-size:12px;margin-top:4px;border-top:1px dashed #e5e7eb;padding-top:4px}
    .header{text-align:center;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:16px}
    .clinic-name{font-size:20px;font-weight:bold;letter-spacing:-.5px}
    .doc-type{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:2px;margin-top:3px}
    .section-title{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;border-bottom:1px solid #e5e7eb;padding-bottom:3px;margin:16px 0 10px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:5px 32px}
    .lbl{font-size:11px;color:#888}
    .val{font-weight:500}
    .med-card{border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-bottom:8px}
    .med-name{font-size:14px;font-weight:bold}
    .med-detail{font-size:12px;color:#555;margin-top:3px}
    .allergy-box{background:#fef2f2;border:1px solid #fecaca;border-radius:4px;padding:8px;color:#b91c1c;font-size:12px;margin:10px 0}
    table{width:100%;border-collapse:collapse;margin-bottom:8px}
    th{text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;padding:5px 8px;border-bottom:2px solid #e5e7eb}
    td{padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px}
    .text-right{text-align:right}
    .totals{display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin-top:12px;font-size:13px}
    .total-row{display:flex;gap:32px}
    .total-label{color:#555;min-width:80px;text-align:right}
    .total-value{min-width:80px;text-align:right;font-weight:500}
    .grand-total{font-size:15px;font-weight:bold;border-top:2px solid #111;padding-top:6px;margin-top:4px}
    .status-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
    .status-paid{background:#dcfce7;color:#16a34a}
    .status-pending{background:#fff7ed;color:#c2410c}
    .status-cancelled{background:#f3f4f6;color:#6b7280}
    .footer{margin-top:40px;display:flex;justify-content:flex-end}
    .sig{text-align:center}
    .sig-line{border-top:1px solid #111;padding-top:5px;font-size:12px;color:#555;width:180px}
    @media print{body{padding:15mm 20mm}}
  </style>`;

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Printed-document localization ────────────────────────────────────────────
// The printed paper can be produced in English or Arabic independent of the UI
// language — callers pass the language the user picked at print time. PHI free
// text (findings, notes, names) is printed as entered; only the fixed labels and
// document direction switch.
export type PrintLang = "en" | "ar";

const PRINT_LABELS = {
  en: {
    clinicName: "Wateen Clinic",
    prescriptionDoc: "Medical Prescription", date: "Date", patientInfo: "Patient Information",
    name: "Name", mrn: "MRN", dob: "Date of Birth", gender: "Gender", bloodType: "Blood Type",
    allergies: "Allergies", medications: "Medications", dose: "Dose", frequency: "Frequency",
    duration: "Duration", instructions: "Instructions", noMeds: "No medications listed",
    notes: "Notes", notesHeadingAr: "ملاحظات", prescribingPhysician: "Prescribing Physician",
    physician: "Physician", mrnIdCard: "MRN / ID Card", rx: "Rx",
    labDoc: "Laboratory Report", reportDate: "Report Date", requestedBy: "Requested by",
    test: "Test", unknown: "Unknown", parameter: "Parameter", value: "Value", unit: "Unit",
    refRange: "Reference Range", flag: "Flag", noParams: "No parameters entered",
    notesInterpretation: "Notes / Interpretation", hlLegend: "H = High&nbsp;|&nbsp;L = Low&nbsp;|&nbsp;N = Normal",
    labTech: "Laboratory Technician",
    radiologyDoc: "Radiology Report", examination: "Examination", unknownArea: "Unknown area",
    findings: "Findings", impression: "Impression / Conclusion", radiologistSig: "Radiologist Signature",
    ultrasoundDoc: "Ultrasound Report", examType: "Exam Type", bodyPart: "Body Part",
    sonographerSig: "Sonographer / Radiologist Signature", images: "Images",
    invoiceDoc: "Invoice", billedTo: "Billed To", patient: "Patient", items: "Items",
    description: "Description", qty: "Qty", unitPrice: "Unit Price", total: "Total",
    subtotal: "Subtotal", discount: "Discount", totalCaps: "TOTAL", noLineItems: "No line items",
    statusPaid: "PAID", statusPending: "PENDING", statusCancelled: "CANCELLED",
  },
  ar: {
    clinicName: "عيادة وتين",
    prescriptionDoc: "وصفة طبية", date: "التاريخ", patientInfo: "معلومات المريض",
    name: "الاسم", mrn: "رقم السجل", dob: "تاريخ الميلاد", gender: "الجنس", bloodType: "فصيلة الدم",
    allergies: "الحساسية", medications: "الأدوية", dose: "الجرعة", frequency: "التكرار",
    duration: "المدة", instructions: "التعليمات", noMeds: "لا توجد أدوية",
    notes: "ملاحظات", notesHeadingAr: "ملاحظات", prescribingPhysician: "الطبيب الواصف",
    physician: "الطبيب", mrnIdCard: "رقم السجل / الهوية", rx: "العلاج",
    labDoc: "تقرير مختبر", reportDate: "تاريخ التقرير", requestedBy: "بطلب من",
    test: "الفحص", unknown: "غير معروف", parameter: "المعيار", value: "القيمة", unit: "الوحدة",
    refRange: "النطاق المرجعي", flag: "العلامة", noParams: "لا توجد معايير",
    notesInterpretation: "ملاحظات / تفسير", hlLegend: "م = مرتفع&nbsp;|&nbsp;خ = منخفض&nbsp;|&nbsp;ط = طبيعي",
    labTech: "فني المختبر",
    radiologyDoc: "تقرير الأشعة", examination: "الفحص", unknownArea: "منطقة غير محددة",
    findings: "النتائج", impression: "الانطباع / الخلاصة", radiologistSig: "توقيع أخصائي الأشعة",
    ultrasoundDoc: "تقرير الموجات فوق الصوتية", examType: "نوع الفحص", bodyPart: "منطقة الجسم",
    sonographerSig: "توقيع أخصائي الموجات", images: "الصور",
    invoiceDoc: "فاتورة", billedTo: "فاتورة إلى", patient: "المريض", items: "البنود",
    description: "الوصف", qty: "الكمية", unitPrice: "سعر الوحدة", total: "الإجمالي",
    subtotal: "المجموع الفرعي", discount: "الخصم", totalCaps: "الإجمالي", noLineItems: "لا توجد بنود",
    statusPaid: "مدفوعة", statusPending: "معلّقة", statusCancelled: "ملغاة",
  },
} as const;

// Direction-aware overrides + an opening wrapper <div dir=…>. Callers append the
// matching </div> at the end of the returned template. In RTL we flip the table
// header and the invoice numeric columns so the Arabic copy reads correctly.
function dirOpen(lang: PrintLang): string {
  if (lang !== "ar") return `<div dir="ltr">`;
  return `<style>
    [dir=rtl] th{text-align:right}
    [dir=rtl] .text-right{text-align:left}
    [dir=rtl] .total-label,[dir=rtl] .total-value{text-align:left}
    [dir=rtl] .sig-line{margin-left:auto}
  </style><div dir="rtl">`;
}

export interface ReportImage { url: string; fileName?: string | null; caption?: string | null }

// Builds the imaging gallery for radiology/ultrasound reports. Merges the cover
// (imageUrl) with the extra images[] array, dedupes by URL, and renders each as an
// embedded <img> (safe http/https only) with an optional caption.
function imagesSectionHtml(imageUrl: string | null | undefined, images: ReportImage[] | null | undefined, lang: PrintLang = "en"): string {
  const all: ReportImage[] = [];
  if (imageUrl) all.push({ url: imageUrl });
  for (const im of images ?? []) if (im?.url) all.push(im);
  const seen = new Set<string>();
  const unique = all.filter(im => { const u = safeUrl(im.url); if (!u || seen.has(u)) return false; seen.add(u); return true; });
  if (!unique.length) return "";
  const cards = unique.map(im => {
    const u = safeUrl(im.url);
    const cap = im.caption ? `<div style="font-size:11px;color:#666;margin-top:3px">${escapeHtml(im.caption)}</div>` : "";
    return `<div style="display:inline-block;width:48%;vertical-align:top;margin:0 2% 10px 0;text-align:center">
      <img src="${u}" style="max-width:100%;max-height:240px;border:1px solid #e5e7eb;border-radius:4px" />
      ${cap}
      <div style="font-size:10px;color:#aaa;word-break:break-all;margin-top:2px"><a href="${u}">${u}</a></div>
    </div>`;
  }).join("");
  return `<div class="section-title">${PRINT_LABELS[lang].images} (${unique.length})</div><div style="margin-bottom:12px">${cards}</div>`;
}
function fmtCur(v: number | string | null | undefined) {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

interface PrescriptionData {
  createdAt: string | Date;
  patient?: { fullName?: string | null; mrn?: string | null; dateOfBirth?: string | null; gender?: string | null; bloodType?: string | null; allergies?: string | null } | null;
  doctor?: { fullName?: string | null } | null;
  medications?: Array<{ name: string; dosage: string; frequency: string; duration: string; instructions?: string }>;
  notes?: string | null;
  notesAr?: string | null;
}

export function prescriptionHtml(rx: PrescriptionData, lang: PrintLang = "en"): string {
  const L = PRINT_LABELS[lang];
  const p = rx.patient;
  const meds = (rx.medications ?? []) as Array<{ name: string; dosage: string; frequency: string; duration: string; instructions?: string }>;

  const ageStr = (() => {
    if (!p?.dateOfBirth) return "";
    const d = new Date(p.dateOfBirth);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return ` (${age}y)`;
  })();

  const medsHtml = meds.length
    ? meds.map((m, i) => `
        <div class="med-card">
          <div class="med-name">${i + 1}. ${escapeHtml(m.name)}</div>
          <div class="med-detail">
            ${L.dose}: <strong>${escapeHtml(m.dosage)}</strong> &nbsp;|&nbsp;
            ${L.frequency}: <strong>${escapeHtml(m.frequency)}</strong> &nbsp;|&nbsp;
            ${L.duration}: <strong>${escapeHtml(m.duration)}</strong>
            ${m.instructions ? `<br>${L.instructions}: ${escapeHtml(m.instructions)}` : ""}
          </div>
        </div>`).join("")
    : `<div style="color:#888;font-size:12px;padding:8px">${L.noMeds}</div>`;

  return `${STYLES}${dirOpen(lang)}
    <div class="header">
      <div class="clinic-name">${L.clinicName}</div>
      <div class="doc-type">${L.prescriptionDoc}</div>
    </div>
    <div style="display:flex;justify-content:flex-end;font-size:12px;color:#666;margin-bottom:8px">${L.date}: ${fmtDate(rx.createdAt)}</div>

    <div class="section-title">${L.patientInfo}</div>
    <div class="grid2">
      <div><div class="lbl">${L.name}</div><div class="val">${escapeHtml(p?.fullName) || "-"}</div></div>
      <div><div class="lbl">${L.mrn}</div><div class="val" style="font-family:monospace">${escapeHtml(p?.mrn) || "-"}</div></div>
      <div><div class="lbl">${L.dob}</div><div class="val">${fmtDate(p?.dateOfBirth)}${ageStr}</div></div>
      <div><div class="lbl">${L.gender}</div><div class="val" style="text-transform:capitalize">${escapeHtml(p?.gender) || "-"}</div></div>
      <div><div class="lbl">${L.bloodType}</div><div class="val">${escapeHtml(p?.bloodType) || "-"}</div></div>
    </div>
    ${p?.allergies ? `<div class="allergy-box">⚠ ${L.allergies}: ${escapeHtml(p.allergies)}</div>` : ""}

    <div class="section-title">${L.medications}</div>
    ${medsHtml}
    ${rx.notes ? `<div class="section-title">${L.notes}</div><p style="font-size:13px;white-space:pre-wrap">${escapeHtml(rx.notes)}</p>` : ""}
    ${rx.notesAr ? `<div class="section-title" style="direction:rtl;text-align:right">${L.notesHeadingAr}</div><p class="ar-block" style="white-space:pre-wrap">${escapeHtml(rx.notesAr)}</p>` : ""}

    <div class="footer">
      <div class="sig">
        <div class="sig-line">${escapeHtml(rx.doctor?.fullName) || L.physician}<br>${L.prescribingPhysician}</div>
      </div>
    </div></div>`;
}

// A printable EMPTY prescription form for the physician to fill in by hand (e.g. when
// the patient will take it to an external pharmacy). Creates no record — pure print.
export function blankPrescriptionHtml(doctor?: { fullName?: string | null } | null, lang: PrintLang = "en"): string {
  const L = PRINT_LABELS[lang];
  const blankLine = `<div style="border-bottom:1px solid #bbb;height:22px"></div>`;
  const labeledBlank = (label: string) =>
    `<div style="margin-bottom:10px"><span style="font-size:11px;color:#888">${escapeHtml(label)}</span><div style="border-bottom:1px solid #bbb;height:20px"></div></div>`;
  return `${STYLES}${dirOpen(lang)}
    <div class="header">
      <div class="clinic-name">${L.clinicName}</div>
      <div class="doc-type">${L.prescriptionDoc}</div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:8px">
      <span>${L.date}: ____ / ____ / ________</span>
    </div>

    <div class="section-title">${L.patientInfo}</div>
    <div class="grid2">
      ${labeledBlank(L.name)}
      ${labeledBlank(L.mrnIdCard)}
      ${labeledBlank(L.dob)}
      ${labeledBlank(L.gender)}
    </div>
    <div style="margin-bottom:12px"><span style="font-size:11px;color:#888">${L.allergies}</span><div style="border-bottom:1px solid #bbb;height:20px"></div></div>

    <div class="section-title">${L.rx}</div>
    <div style="margin:8px 0 16px">
      ${Array.from({ length: 8 }).map(() => blankLine).join("")}
    </div>

    <div class="footer">
      <div class="sig">
        <div class="sig-line">${escapeHtml(doctor?.fullName) || L.physician}<br>${L.prescribingPhysician}</div>
      </div>
    </div></div>`;
}

export interface LabParam { name: string; value: string; unit: string; refRange: string; flag: "H" | "L" | "N" | "" }

interface LabReportData {
  createdAt: string | Date;
  testName?: string | null;
  testNameAr?: string | null;
  patient?: { fullName?: string | null; mrn?: string | null; dateOfBirth?: string | null; gender?: string | null } | null;
  requestedBy?: { fullName?: string | null } | null;
  params: LabParam[];
  notes?: string | null;
  notesAr?: string | null;
}

export function labReportHtml(d: LabReportData, lang: PrintLang = "en"): string {
  const L = PRINT_LABELS[lang];
  const rowStyle = (flag: string) =>
    flag === "H" ? "background:#fff1f2;color:#be123c" :
    flag === "L" ? "background:#eff6ff;color:#1d4ed8" : "";

  const rows = d.params.length
    ? d.params.map(p => `
      <tr style="${rowStyle(p.flag)}">
        <td>${escapeHtml(p.name)}</td>
        <td style="text-align:center"><strong>${escapeHtml(p.value) || "-"}</strong></td>
        <td style="text-align:center">${escapeHtml(p.unit) || "-"}</td>
        <td style="text-align:center">${escapeHtml(p.refRange) || "-"}</td>
        <td style="text-align:center;font-weight:700">${escapeHtml(p.flag) || "N"}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" style="color:#888;text-align:center">${L.noParams}</td></tr>`;

  return `${STYLES}${dirOpen(lang)}
    <style>
      .flag-H{background:#fff1f2;color:#be123c}
      .flag-L{background:#eff6ff;color:#1d4ed8}
    </style>
    <div class="header">
      <div class="clinic-name">${L.clinicName}</div>
      <div class="doc-type">${L.labDoc}</div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;color:#666">
      <span>${L.reportDate}: ${fmtDate(d.createdAt)}</span>
      <span>${L.requestedBy}: ${escapeHtml(d.requestedBy?.fullName) || "-"}</span>
    </div>
    <div class="section-title">${L.patientInfo}</div>
    <div class="grid2" style="margin-bottom:12px">
      <div><div class="lbl">${L.name}</div><div class="val">${escapeHtml(d.patient?.fullName) || "-"}</div></div>
      <div><div class="lbl">${L.mrn}</div><div class="val" style="font-family:monospace">${escapeHtml(d.patient?.mrn) || "-"}</div></div>
      <div><div class="lbl">${L.dob}</div><div class="val">${fmtDate(d.patient?.dateOfBirth)}</div></div>
      <div><div class="lbl">${L.gender}</div><div class="val" style="text-transform:capitalize">${escapeHtml(d.patient?.gender) || "-"}</div></div>
    </div>
    <div class="section-title">${L.test}: ${escapeHtml(d.testName) || L.unknown}${d.testNameAr ? ` / ${escapeHtml(d.testNameAr)}` : ""}</div>
    <table>
      <thead><tr>
        <th>${L.parameter}</th>
        <th style="text-align:center">${L.value}</th>
        <th style="text-align:center">${L.unit}</th>
        <th style="text-align:center">${L.refRange}</th>
        <th style="text-align:center">${L.flag}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${d.notes ? `<div class="section-title">${L.notesInterpretation}</div><p style="font-size:13px;white-space:pre-wrap">${escapeHtml(d.notes)}</p>` : ""}
    ${d.notesAr ? `<p class="ar-block" style="white-space:pre-wrap;margin-top:6px">${escapeHtml(d.notesAr)}</p>` : ""}
    <div style="margin-top:32px;font-size:11px;color:#888">${L.hlLegend}</div>
    <div class="footer">
      <div class="sig"><div class="sig-line">${L.labTech}</div></div>
    </div></div>`;
}

interface XrayReportData {
  createdAt: string | Date;
  bodyPart?: string | null;
  bodyPartAr?: string | null;
  patient?: { fullName?: string | null; mrn?: string | null } | null;
  requestedBy?: { fullName?: string | null } | null;
  findings: string;
  impression: string;
  findingsAr?: string | null;
  impressionAr?: string | null;
  imageUrl?: string | null;
  images?: ReportImage[] | null;
}

export function xrayReportHtml(d: XrayReportData, lang: PrintLang = "en"): string {
  const L = PRINT_LABELS[lang];
  return `${STYLES}${dirOpen(lang)}
    <div class="header">
      <div class="clinic-name">${L.clinicName}</div>
      <div class="doc-type">${L.radiologyDoc}</div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;color:#666">
      <span>${L.reportDate}: ${fmtDate(d.createdAt)}</span>
      <span>${L.requestedBy}: ${escapeHtml(d.requestedBy?.fullName) || "-"}</span>
    </div>
    <div class="section-title">${L.patientInfo}</div>
    <div class="grid2" style="margin-bottom:12px">
      <div><div class="lbl">${L.name}</div><div class="val">${escapeHtml(d.patient?.fullName) || "-"}</div></div>
      <div><div class="lbl">${L.mrn}</div><div class="val" style="font-family:monospace">${escapeHtml(d.patient?.mrn) || "-"}</div></div>
    </div>
    <div class="section-title">${L.examination}</div>
    <p style="font-size:14px;font-weight:600;margin-bottom:4px">${escapeHtml(d.bodyPart) || L.unknownArea}</p>
    ${d.bodyPartAr ? `<p class="ar-block" style="font-size:13px;margin-bottom:12px">${escapeHtml(d.bodyPartAr)}</p>` : "<p style='margin-bottom:12px'></p>"}
    ${imagesSectionHtml(d.imageUrl, d.images, lang)}
    <div class="section-title">${L.findings}</div>
    <p style="font-size:13px;white-space:pre-wrap;margin-bottom:4px">${escapeHtml(d.findings) || "—"}</p>
    ${d.findingsAr ? `<p class="ar-block" style="white-space:pre-wrap;margin-bottom:12px">${escapeHtml(d.findingsAr)}</p>` : "<p style='margin-bottom:12px'></p>"}
    <div class="section-title">${L.impression}</div>
    <p style="font-size:13px;white-space:pre-wrap;border-left:3px solid #111;padding-left:10px;margin-bottom:4px">${escapeHtml(d.impression) || "—"}</p>
    ${d.impressionAr ? `<p class="ar-block" style="white-space:pre-wrap;border-right:3px solid #111;padding-right:10px;margin-bottom:16px">${escapeHtml(d.impressionAr)}</p>` : "<p style='margin-bottom:16px'></p>"}
    <div class="footer">
      <div class="sig"><div class="sig-line">${L.radiologistSig}</div></div>
    </div></div>`;
}

interface UltrasoundReportData {
  createdAt: string | Date;
  examType?: string | null;
  bodyPart?: string | null;
  bodyPartAr?: string | null;
  patient?: { fullName?: string | null; mrn?: string | null } | null;
  requestedBy?: { fullName?: string | null } | null;
  findings: string;
  impression: string;
  findingsAr?: string | null;
  impressionAr?: string | null;
  imageUrl?: string | null;
  images?: ReportImage[] | null;
}

export function ultrasoundReportHtml(d: UltrasoundReportData, lang: PrintLang = "en"): string {
  const L = PRINT_LABELS[lang];
  return `${STYLES}${dirOpen(lang)}
    <div class="header">
      <div class="clinic-name">${L.clinicName}</div>
      <div class="doc-type">${L.ultrasoundDoc}</div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;color:#666">
      <span>${L.reportDate}: ${fmtDate(d.createdAt)}</span>
      <span>${L.requestedBy}: ${escapeHtml(d.requestedBy?.fullName) || "-"}</span>
    </div>
    <div class="section-title">${L.patientInfo}</div>
    <div class="grid2" style="margin-bottom:12px">
      <div><div class="lbl">${L.name}</div><div class="val">${escapeHtml(d.patient?.fullName) || "-"}</div></div>
      <div><div class="lbl">${L.mrn}</div><div class="val" style="font-family:monospace">${escapeHtml(d.patient?.mrn) || "-"}</div></div>
    </div>
    <div class="section-title">${L.examination}</div>
    <div class="grid2" style="margin-bottom:12px">
      <div><div class="lbl">${L.examType}</div><div class="val">${escapeHtml(d.examType) || "-"}</div></div>
      <div>
        <div class="lbl">${L.bodyPart}</div>
        <div class="val">${escapeHtml(d.bodyPart) || "-"}</div>
        ${d.bodyPartAr ? `<div class="ar-block">${escapeHtml(d.bodyPartAr)}</div>` : ""}
      </div>
    </div>
    ${imagesSectionHtml(d.imageUrl, d.images, lang)}
    <div class="section-title">${L.findings}</div>
    <p style="font-size:13px;white-space:pre-wrap;margin-bottom:4px">${escapeHtml(d.findings) || "—"}</p>
    ${d.findingsAr ? `<p class="ar-block" style="white-space:pre-wrap;margin-bottom:12px">${escapeHtml(d.findingsAr)}</p>` : "<p style='margin-bottom:12px'></p>"}
    <div class="section-title">${L.impression}</div>
    <p style="font-size:13px;white-space:pre-wrap;border-left:3px solid #111;padding-left:10px;margin-bottom:4px">${escapeHtml(d.impression) || "—"}</p>
    ${d.impressionAr ? `<p class="ar-block" style="white-space:pre-wrap;border-right:3px solid #111;padding-right:10px;margin-bottom:16px">${escapeHtml(d.impressionAr)}</p>` : "<p style='margin-bottom:16px'></p>"}
    <div class="footer">
      <div class="sig"><div class="sig-line">${L.sonographerSig}</div></div>
    </div></div>`;
}

interface InvoiceData {
  invoiceNumber?: string | null;
  createdAt: string | Date;
  status: string;
  total: number | string;
  subtotal?: number | string;
  discount?: number | string;
  patient?: { fullName?: string | null; mrn?: string | null } | null;
  items?: Array<{ description: string; quantity: number; unitPrice: number | string; total: number | string }>;
}

export function invoiceHtml(inv: InvoiceData, lang: PrintLang = "en"): string {
  const L = PRINT_LABELS[lang];
  const statusClass = inv.status === "paid" ? "status-paid" : inv.status === "cancelled" ? "status-cancelled" : "status-pending";
  const statusLabel = inv.status === "paid" ? L.statusPaid : inv.status === "cancelled" ? L.statusCancelled : L.statusPending;
  const items = (inv.items ?? []) as Array<{ description: string; quantity: number; unitPrice: number | string; total: number | string }>;

  const itemsHtml = items.length
    ? `<table>
        <thead><tr>
          <th>${L.description}</th>
          <th class="text-right">${L.qty}</th>
          <th class="text-right">${L.unitPrice}</th>
          <th class="text-right">${L.total}</th>
        </tr></thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>${escapeHtml(it.description)}</td>
              <td class="text-right">${it.quantity}</td>
              <td class="text-right">$${fmtCur(it.unitPrice)}</td>
              <td class="text-right">$${fmtCur(it.total)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`
    : `<div style="color:#888;font-size:12px;padding:8px">${L.noLineItems}</div>`;

  const subtotal = inv.subtotal ?? inv.total;
  const discount = inv.discount ?? 0;

  return `${STYLES}${dirOpen(lang)}
    <div class="header">
      <div class="clinic-name">${L.clinicName}</div>
      <div class="doc-type">${L.invoiceDoc}</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div>
        <div style="font-size:18px;font-weight:bold;font-family:monospace">${escapeHtml(inv.invoiceNumber) || "-"}</div>
        <div style="font-size:12px;color:#666;margin-top:2px">${L.date}: ${fmtDate(inv.createdAt)}</div>
      </div>
      <div><span class="status-badge ${statusClass}">${statusLabel}</span></div>
    </div>

    <div class="section-title">${L.billedTo}</div>
    <div class="grid2" style="margin-bottom:16px">
      <div><div class="lbl">${L.patient}</div><div class="val">${escapeHtml(inv.patient?.fullName) || "-"}</div></div>
      <div><div class="lbl">${L.mrn}</div><div class="val" style="font-family:monospace">${escapeHtml(inv.patient?.mrn) || "-"}</div></div>
    </div>

    <div class="section-title">${L.items}</div>
    ${itemsHtml}

    <div class="totals">
      <div class="total-row"><span class="total-label">${L.subtotal}</span><span class="total-value">$${fmtCur(subtotal)}</span></div>
      <div class="total-row"><span class="total-label">${L.discount}</span><span class="total-value">-$${fmtCur(discount)}</span></div>
      <div class="total-row grand-total"><span class="total-label">${L.totalCaps}</span><span class="total-value">$${fmtCur(inv.total)}</span></div>
    </div></div>`;
}
