import {
  FLOW_COLUMNS,
  FLOW_LABEL_KEY,
  FLOW_TERMINAL,
  columnForStatus,
  flowLabel,
  type AppointmentStatus,
} from "@/lib/appointment-flow";
import { translations } from "@/hooks/i18n";

const ALL_STATUSES: AppointmentStatus[] = [
  "scheduled", "checked_in", "in_triage", "ready_for_doctor", "in_consultation",
  "awaiting_diagnostics", "pending_payment", "completed", "cancelled", "no_show",
];
const NON_TERMINAL = ALL_STATUSES.filter(s => !FLOW_TERMINAL.includes(s));

describe("appointment-flow projection", () => {
  it("maps every non-terminal status to exactly one column", () => {
    for (const s of NON_TERMINAL) {
      const matches = FLOW_COLUMNS.filter(c => c.statuses.includes(s));
      expect(matches, `status ${s} should fall in one column`).toHaveLength(1);
      expect(columnForStatus(s)).toBe(matches[0].key);
    }
  });

  it("gives terminal + unknown statuses no column", () => {
    for (const s of FLOW_TERMINAL) expect(columnForStatus(s)).toBeNull();
    expect(columnForStatus("bogus_status")).toBeNull();
  });

  it("covers all non-terminal statuses exactly once across the 6 columns", () => {
    const covered = FLOW_COLUMNS.flatMap(c => c.statuses);
    expect(new Set(covered).size, "no status appears in two columns").toBe(covered.length);
    expect([...covered].sort()).toEqual([...NON_TERMINAL].sort());
    expect(FLOW_COLUMNS).toHaveLength(6);
  });

  it("has a flow label key for every status", () => {
    for (const s of ALL_STATUSES) expect(FLOW_LABEL_KEY[s]).toBeTruthy();
  });

  it("resolves every label + column-header key in both EN and AR (no silent fallback)", () => {
    const keys = new Set([
      ...Object.values(FLOW_LABEL_KEY),
      ...FLOW_COLUMNS.map(c => c.labelKey),
    ]);
    for (const k of keys) {
      expect(translations.en, `EN missing ${k}`).toHaveProperty(k);
      expect(translations.ar, `AR missing ${k}`).toHaveProperty(k);
    }
  });

  it("flowLabel resolves through the projection map", () => {
    const t = (key: string) => (translations.en as Record<string, string>)[key] ?? key;
    expect(flowLabel(t, "scheduled")).toBe("Booked");
    expect(flowLabel(t, "checked_in")).toBe("Waiting");
    expect(flowLabel(t, "awaiting_diagnostics")).toBe("Awaiting Results");
    expect(flowLabel(t, "completed")).toBe("Done");
    // terminal states reuse the shared key — label is unchanged
    expect(flowLabel(t, "cancelled")).toBe("Cancelled");
  });
});
