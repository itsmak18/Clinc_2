import { translations } from "@/hooks/i18n";

describe("i18n key parity", () => {
  const enKeys = new Set(Object.keys(translations.en));
  const arKeys = new Set(Object.keys(translations.ar));

  it("every EN key has an AR translation (no silent English fallback in AR UI)", () => {
    const missingInAr = [...enKeys].filter(k => !arKeys.has(k));
    expect(
      missingInAr,
      `Keys present in EN but missing in AR:\n  ${missingInAr.join("\n  ")}`,
    ).toHaveLength(0);
  });

  it("every AR key has a corresponding EN key (no orphaned Arabic strings)", () => {
    const missingInEn = [...arKeys].filter(k => !enKeys.has(k));
    expect(
      missingInEn,
      `Keys present in AR but missing in EN:\n  ${missingInEn.join("\n  ")}`,
    ).toHaveLength(0);
  });
});
