import { describe, it, expect } from "vitest";
import { parseMoneyToCents, sumCents, formatCents, centsToNumber } from "../lib/money";

describe("parseMoneyToCents", () => {
  it("parses numeric strings exactly", () => {
    expect(parseMoneyToCents("150.00")).toBe(15000);
    expect(parseMoneyToCents("0.30")).toBe(30);
    expect(parseMoneyToCents("0")).toBe(0);
    expect(parseMoneyToCents("48210.67")).toBe(4821067);
    expect(parseMoneyToCents("7")).toBe(700);
    expect(parseMoneyToCents("12.5")).toBe(1250);
  });

  it("parses negatives (refunds / adjustments)", () => {
    expect(parseMoneyToCents("-12.50")).toBe(-1250);
    expect(parseMoneyToCents("-0.01")).toBe(-1);
  });

  it("parses JS numbers without float drift", () => {
    expect(parseMoneyToCents(150)).toBe(15000);
    expect(parseMoneyToCents(0.1)).toBe(10);
    expect(parseMoneyToCents(0.2)).toBe(20);
    expect(parseMoneyToCents(29.99)).toBe(2999);
  });

  it("rounds an unexpected >2-dp fraction half-up", () => {
    expect(parseMoneyToCents("1.005")).toBe(101);
    expect(parseMoneyToCents("1.004")).toBe(100);
  });

  it("throws on malformed input", () => {
    expect(() => parseMoneyToCents("abc")).toThrow();
    expect(() => parseMoneyToCents("1.2.3")).toThrow();
    expect(() => parseMoneyToCents("")).toThrow();
    expect(() => parseMoneyToCents(Number.NaN)).toThrow();
    expect(() => parseMoneyToCents(Infinity)).toThrow();
  });
});

describe("sumCents — the float-drift regression", () => {
  it("0.1 + 0.2 sums exactly to 0.30 (float would give 0.30000000000000004)", () => {
    const cents = sumCents([parseMoneyToCents("0.10"), parseMoneyToCents("0.20")]);
    expect(cents).toBe(30);
    expect(formatCents(cents)).toBe("0.30");
  });

  it("aggregates many line items without accumulation error", () => {
    const items = Array.from({ length: 1000 }, () => "0.10");
    const cents = sumCents(items.map(parseMoneyToCents));
    expect(cents).toBe(10000);
    expect(formatCents(cents)).toBe("100.00");
  });

  it("sums a realistic mixed invoice list", () => {
    const totals = ["150.00", "75.50", "12.99", "0.01", "1000.00"];
    expect(formatCents(sumCents(totals.map(parseMoneyToCents)))).toBe("1238.50");
  });
});

describe("formatCents", () => {
  it("formats cents back to 2-dp strings", () => {
    expect(formatCents(15000)).toBe("150.00");
    expect(formatCents(30)).toBe("0.30");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(-1250)).toBe("-12.50");
    expect(formatCents(-5)).toBe("-0.05");
  });

  it("round-trips through parse", () => {
    for (const s of ["0.00", "0.01", "9.99", "150.00", "48210.67"]) {
      expect(formatCents(parseMoneyToCents(s))).toBe(s);
    }
  });
});

describe("centsToNumber", () => {
  it("converts to major units", () => {
    expect(centsToNumber(15000)).toBe(150);
    expect(centsToNumber(4821067)).toBeCloseTo(48210.67, 2);
  });
});
