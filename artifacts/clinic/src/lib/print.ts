export function openPrintWindow(html: string, title: string) {
  const win = window.open("", "_blank", "width=860,height=720");
  if (!win) { alert("Pop-up blocked — please allow pop-ups for this site."); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

const STYLES = `
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;padding:30px 40px;color:#111;font-size:13px;line-height:1.5}
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
function fmtCur(v: number | string | null | undefined) {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

interface PrescriptionData {
  createdAt: string | Date;
  patient?: { fullName?: string | null; mrn?: string | null; dateOfBirth?: string | null; gender?: string | null; bloodType?: string | null; allergies?: string | null } | null;
  doctor?: { fullName?: string | null } | null;
  medications?: Array<{ name: string; dosage: string; frequency: string; duration: string; instructions?: string }>;
}

export function prescriptionHtml(rx: PrescriptionData): string {
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
          <div class="med-name">${i + 1}. ${m.name}</div>
          <div class="med-detail">
            Dose: <strong>${m.dosage}</strong> &nbsp;|&nbsp;
            Frequency: <strong>${m.frequency}</strong> &nbsp;|&nbsp;
            Duration: <strong>${m.duration}</strong>
            ${m.instructions ? `<br>Instructions: ${m.instructions}` : ""}
          </div>
        </div>`).join("")
    : `<div style="color:#888;font-size:12px;padding:8px">No medications listed</div>`;

  return `${STYLES}
    <div class="header">
      <div class="clinic-name">MediCore Clinic System</div>
      <div class="doc-type">Medical Prescription</div>
    </div>
    <div style="display:flex;justify-content:flex-end;font-size:12px;color:#666;margin-bottom:8px">Date: ${fmtDate(rx.createdAt)}</div>

    <div class="section-title">Patient Information</div>
    <div class="grid2">
      <div><div class="lbl">Name</div><div class="val">${p?.fullName ?? "-"}</div></div>
      <div><div class="lbl">MRN</div><div class="val" style="font-family:monospace">${p?.mrn ?? "-"}</div></div>
      <div><div class="lbl">Date of Birth</div><div class="val">${fmtDate(p?.dateOfBirth)}${ageStr}</div></div>
      <div><div class="lbl">Gender</div><div class="val" style="text-transform:capitalize">${p?.gender ?? "-"}</div></div>
      <div><div class="lbl">Blood Type</div><div class="val">${p?.bloodType ?? "-"}</div></div>
    </div>
    ${p?.allergies ? `<div class="allergy-box">⚠ Allergies: ${p.allergies}</div>` : ""}

    <div class="section-title">Medications</div>
    ${medsHtml}

    <div class="footer">
      <div class="sig">
        <div class="sig-line">${rx.doctor?.fullName ?? "Physician"}<br>Prescribing Physician</div>
      </div>
    </div>`;
}

export interface LabParam { name: string; value: string; unit: string; refRange: string; flag: "H" | "L" | "N" | "" }

interface LabReportData {
  createdAt: string | Date;
  testName?: string | null;
  patient?: { fullName?: string | null; mrn?: string | null; dateOfBirth?: string | null; gender?: string | null } | null;
  requestedBy?: { fullName?: string | null } | null;
  params: LabParam[];
  notes?: string | null;
}

export function labReportHtml(d: LabReportData): string {
  const rowStyle = (flag: string) =>
    flag === "H" ? "background:#fff1f2;color:#be123c" :
    flag === "L" ? "background:#eff6ff;color:#1d4ed8" : "";

  const rows = d.params.length
    ? d.params.map(p => `
      <tr style="${rowStyle(p.flag)}">
        <td>${p.name}</td>
        <td style="text-align:center"><strong>${p.value || "-"}</strong></td>
        <td style="text-align:center">${p.unit || "-"}</td>
        <td style="text-align:center">${p.refRange || "-"}</td>
        <td style="text-align:center;font-weight:700">${p.flag || "N"}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" style="color:#888;text-align:center">No parameters entered</td></tr>`;

  return `${STYLES}
    <style>
      .flag-H{background:#fff1f2;color:#be123c}
      .flag-L{background:#eff6ff;color:#1d4ed8}
    </style>
    <div class="header">
      <div class="clinic-name">MediCore Clinic System</div>
      <div class="doc-type">Laboratory Report</div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;color:#666">
      <span>Report Date: ${fmtDate(d.createdAt)}</span>
      <span>Requested by: ${d.requestedBy?.fullName ?? "-"}</span>
    </div>
    <div class="section-title">Patient Information</div>
    <div class="grid2" style="margin-bottom:12px">
      <div><div class="lbl">Name</div><div class="val">${d.patient?.fullName ?? "-"}</div></div>
      <div><div class="lbl">MRN</div><div class="val" style="font-family:monospace">${d.patient?.mrn ?? "-"}</div></div>
      <div><div class="lbl">Date of Birth</div><div class="val">${fmtDate(d.patient?.dateOfBirth)}</div></div>
      <div><div class="lbl">Gender</div><div class="val" style="text-transform:capitalize">${d.patient?.gender ?? "-"}</div></div>
    </div>
    <div class="section-title">Test: ${d.testName ?? "Unknown"}</div>
    <table>
      <thead><tr>
        <th>Parameter</th>
        <th style="text-align:center">Value</th>
        <th style="text-align:center">Unit</th>
        <th style="text-align:center">Reference Range</th>
        <th style="text-align:center">Flag</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${d.notes ? `<div class="section-title">Notes / Interpretation</div><p style="font-size:13px;white-space:pre-wrap">${d.notes}</p>` : ""}
    <div style="margin-top:32px;font-size:11px;color:#888">H = High &nbsp;|&nbsp; L = Low &nbsp;|&nbsp; N = Normal</div>
    <div class="footer">
      <div class="sig"><div class="sig-line">Laboratory Technician</div></div>
    </div>`;
}

interface XrayReportData {
  createdAt: string | Date;
  bodyPart?: string | null;
  patient?: { fullName?: string | null; mrn?: string | null } | null;
  requestedBy?: { fullName?: string | null } | null;
  findings: string;
  impression: string;
  imageUrl?: string | null;
}

export function xrayReportHtml(d: XrayReportData): string {
  return `${STYLES}
    <div class="header">
      <div class="clinic-name">MediCore Clinic System</div>
      <div class="doc-type">Radiology Report</div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;color:#666">
      <span>Report Date: ${fmtDate(d.createdAt)}</span>
      <span>Requested by: ${d.requestedBy?.fullName ?? "-"}</span>
    </div>
    <div class="section-title">Patient Information</div>
    <div class="grid2" style="margin-bottom:12px">
      <div><div class="lbl">Name</div><div class="val">${d.patient?.fullName ?? "-"}</div></div>
      <div><div class="lbl">MRN</div><div class="val" style="font-family:monospace">${d.patient?.mrn ?? "-"}</div></div>
    </div>
    <div class="section-title">Examination</div>
    <p style="font-size:14px;font-weight:600;margin-bottom:12px">${d.bodyPart ?? "Unknown area"}</p>
    ${d.imageUrl ? `<p style="font-size:11px;color:#888;margin-bottom:12px">Image: <a href="${d.imageUrl}">${d.imageUrl}</a></p>` : ""}
    <div class="section-title">Findings</div>
    <p style="font-size:13px;white-space:pre-wrap;margin-bottom:12px">${d.findings || "—"}</p>
    <div class="section-title">Impression / Conclusion</div>
    <p style="font-size:13px;white-space:pre-wrap;border-left:3px solid #111;padding-left:10px;margin-bottom:16px">${d.impression || "—"}</p>
    <div class="footer">
      <div class="sig"><div class="sig-line">Radiologist Signature</div></div>
    </div>`;
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

export function invoiceHtml(inv: InvoiceData): string {
  const statusClass = inv.status === "paid" ? "status-paid" : inv.status === "cancelled" ? "status-cancelled" : "status-pending";
  const items = (inv.items ?? []) as Array<{ description: string; quantity: number; unitPrice: number | string; total: number | string }>;

  const itemsHtml = items.length
    ? `<table>
        <thead><tr>
          <th>Description</th>
          <th class="text-right">Qty</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Total</th>
        </tr></thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>${it.description}</td>
              <td class="text-right">${it.quantity}</td>
              <td class="text-right">$${fmtCur(it.unitPrice)}</td>
              <td class="text-right">$${fmtCur(it.total)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`
    : `<div style="color:#888;font-size:12px;padding:8px">No line items</div>`;

  const subtotal = inv.subtotal ?? inv.total;
  const discount = inv.discount ?? 0;

  return `${STYLES}
    <div class="header">
      <div class="clinic-name">MediCore Clinic System</div>
      <div class="doc-type">Invoice</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div>
        <div style="font-size:18px;font-weight:bold;font-family:monospace">${inv.invoiceNumber ?? "-"}</div>
        <div style="font-size:12px;color:#666;margin-top:2px">Date: ${fmtDate(inv.createdAt)}</div>
      </div>
      <div><span class="status-badge ${statusClass}">${inv.status.toUpperCase()}</span></div>
    </div>

    <div class="section-title">Billed To</div>
    <div class="grid2" style="margin-bottom:16px">
      <div><div class="lbl">Patient</div><div class="val">${inv.patient?.fullName ?? "-"}</div></div>
      <div><div class="lbl">MRN</div><div class="val" style="font-family:monospace">${inv.patient?.mrn ?? "-"}</div></div>
    </div>

    <div class="section-title">Items</div>
    ${itemsHtml}

    <div class="totals">
      <div class="total-row"><span class="total-label">Subtotal</span><span class="total-value">$${fmtCur(subtotal)}</span></div>
      <div class="total-row"><span class="total-label">Discount</span><span class="total-value">-$${fmtCur(discount)}</span></div>
      <div class="total-row grand-total"><span class="total-label">TOTAL</span><span class="total-value">$${fmtCur(inv.total)}</span></div>
    </div>`;
}
