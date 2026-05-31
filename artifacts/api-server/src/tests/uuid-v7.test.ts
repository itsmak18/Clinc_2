import { describe, it, expect } from "vitest";
import { uuidV7 } from "@workspace/db/uuid-v7";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("uuidV7", () => {
  it("returns a string matching UUID format", () => {
    expect(uuidV7()).toMatch(UUID_RE);
  });

  it("version nibble is 7", () => {
    const id = uuidV7();
    // 3rd group, first char is the version
    expect(id[14]).toBe("7");
  });

  it("variant bits are 10xx (chars 8, 9, a, b in position 19)", () => {
    const id = uuidV7();
    // 4th group, first char encodes the variant (must be 8, 9, a, or b)
    expect("89ab").toContain(id[19]);
  });

  it("embeds a monotonically non-decreasing timestamp", () => {
    const a = uuidV7();
    const b = uuidV7();
    // First 12 hex chars = 48-bit timestamp; lexicographic ≥ is correct for big-endian
    expect(b.replace(/-/g, "").slice(0, 12) >= a.replace(/-/g, "").slice(0, 12)).toBe(true);
  });

  it("produces unique values across 1000 calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidV7()));
    expect(ids.size).toBe(1000);
  });
});
