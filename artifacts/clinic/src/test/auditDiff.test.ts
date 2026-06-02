import { describe, it, expect } from "vitest";
import { computeDiff, formatValue } from "@/lib/auditDiff";

describe("computeDiff", () => {
  it("returns empty when nothing changed", () => {
    expect(computeDiff({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
  });

  it("flags changed fields with before/after", () => {
    const rows = computeDiff({ a: 1, b: "x" }, { a: 2, b: "x" });
    expect(rows).toEqual([{ key: "a", before: 1, after: 2, status: "changed" }]);
  });

  it("marks added and removed keys", () => {
    const rows = computeDiff({ a: 1 }, { a: 1, b: 2 });
    expect(rows).toEqual([{ key: "b", before: undefined, after: 2, status: "added" }]);

    const removed = computeDiff({ a: 1, b: 2 }, { a: 1 });
    expect(removed).toEqual([{ key: "b", before: 2, after: undefined, status: "removed" }]);
  });

  it("treats null before as creation and null after as deletion", () => {
    expect(computeDiff(null, { a: 1 })).toEqual([{ key: "a", before: undefined, after: 1, status: "added" }]);
    expect(computeDiff({ a: 1 }, null)).toEqual([{ key: "a", before: 1, after: undefined, status: "removed" }]);
  });

  it("compares nested objects by value", () => {
    expect(computeDiff({ v: { x: 1 } }, { v: { x: 1 } })).toEqual([]);
    expect(computeDiff({ v: { x: 1 } }, { v: { x: 2 } })).toHaveLength(1);
  });
});

describe("formatValue", () => {
  it("renders dashes for null/undefined", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(undefined)).toBe("—");
  });
  it("stringifies objects and primitives", () => {
    expect(formatValue({ x: 1 })).toBe('{"x":1}');
    expect(formatValue(42)).toBe("42");
    expect(formatValue("hi")).toBe("hi");
  });
});
