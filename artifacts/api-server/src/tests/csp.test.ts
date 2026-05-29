import { describe, it, expect } from "vitest";
import { cspDirectives, buildCspString, cspMetaString } from "../lib/csp";

describe("CSP directives — regression guard", () => {
  it("script-src does not allow 'unsafe-inline'", () => {
    expect(cspDirectives.scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("script-src does not allow 'unsafe-eval'", () => {
    expect(cspDirectives.scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("default-src is self-only", () => {
    expect(cspDirectives.defaultSrc).toEqual(["'self'"]);
  });

  it("frame-ancestors is 'none'", () => {
    expect(cspDirectives.frameAncestors).toContain("'none'");
  });

  it("object-src is 'none'", () => {
    expect(cspDirectives.objectSrc).toContain("'none'");
  });

  it("font-src allows Google Fonts CDN", () => {
    expect(cspDirectives.fontSrc).toContain("https://fonts.gstatic.com");
  });

  it("style-src allows Google Fonts stylesheet", () => {
    expect(cspDirectives.styleSrc).toContain("https://fonts.googleapis.com");
  });

  it("style-src does not allow 'unsafe-inline'", () => {
    // React style={} props use the DOM API — not blocked by style-src.
    // chart.tsx ChartStyle was the only <style> injector; replaced 2026-05-29.
    expect(cspDirectives.styleSrc).not.toContain("'unsafe-inline'");
  });
});

describe("buildCspString", () => {
  it("full string includes frame-ancestors", () => {
    expect(buildCspString()).toContain("frame-ancestors 'none'");
  });

  it("meta string excludes frame-ancestors", () => {
    expect(cspMetaString).not.toContain("frame-ancestors");
  });

  it("meta string includes core directives", () => {
    expect(cspMetaString).toContain("default-src 'self'");
    expect(cspMetaString).toContain("script-src 'self'");
    expect(cspMetaString).toContain("object-src 'none'");
  });

  it("directive keys are serialised to kebab-case", () => {
    const str = buildCspString();
    expect(str).toContain("default-src");
    expect(str).toContain("script-src");
    expect(str).toContain("style-src");
    expect(str).toContain("font-src");
    expect(str).toContain("img-src");
    expect(str).toContain("connect-src");
    expect(str).toContain("object-src");
    expect(str).toContain("base-uri");
    expect(str).toContain("form-action");
  });
});
