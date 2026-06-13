/**
 * discharge-sheet-xss.test.tsx — F-P7-3 regression guard.
 *
 * DischargeSheet's print path copies the React-rendered subtree into a new window
 * via `win.document.write(...${el.innerHTML}...)`. That is only safe because React
 * HTML-escapes all text content and the subtree uses no dangerouslySetInnerHTML.
 * This test pins that assumption: feed PHI fields containing HTML/script
 * metacharacters and assert the rendered DOM escapes them (no live <script> node,
 * escaped entities in the serialized HTML). If someone later introduces a raw-HTML
 * sink in this component, this fails.
 */
import { render, screen, waitFor } from "@testing-library/react";
import DischargeSheet from "@/components/DischargeSheet";

const XSS = "<script>alert('xss-fp7-3')</script>";

const dischargeData = {
  appointment: {
    id: 1, reason: XSS, status: "completed",
    scheduledAt: "2026-06-01T10:00:00.000Z", notes: null,
    doctor: { id: 2, fullName: "Dr Test" },
  },
  patient: {
    id: 1, fullName: XSS, fullNameAr: null, mrn: "MRN-1",
    dateOfBirth: "1990-01-01", gender: "male", phone: "123",
    allergies: XSS,
  },
  medicalRecord: {
    id: 1, chiefComplaint: "cc", diagnosis: XSS, treatment: "tx",
    notes: null, vitals: null,
  },
  prescriptions: [],
  labTests: [],
  xrays: [],
  invoice: null,
};

describe("DischargeSheet — PHI is HTML-escaped (F-P7-3)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => dischargeData } as unknown as Response)),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders script-laden PHI fields as escaped text, not live DOM", async () => {
    render(<DischargeSheet appointmentId={1} open={true} onClose={() => {}} />);

    // Data loaded + the malicious string is present as TEXT (React-escaped).
    await waitFor(() => {
      expect(screen.getAllByText(XSS).length).toBeGreaterThan(0);
    });

    // No live <script> element was created from the payload.
    expect(document.querySelector("script")).toBeNull();
    // The serialized HTML (what the print path copies via el.innerHTML) contains
    // the ESCAPED form, never the raw executable tag.
    expect(document.body.innerHTML).toContain("&lt;script&gt;");
    expect(document.body.innerHTML).not.toContain("<script>alert('xss-fp7-3')");
  });
});
