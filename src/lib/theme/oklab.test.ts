import { describe, expect, it } from "vitest";

import { oklabToRgb, parseCssColor, rgbToOklab } from "./oklab";

describe("rgbToOklab / oklabToRgb", () => {
  it("round-trips sRGB colours", () => {
    for (const rgb of [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 15, g: 23, b: 42 },
      { r: 168, g: 85, b: 247 }
    ]) {
      const back = oklabToRgb(rgbToOklab(rgb));
      expect(Math.round(back.r)).toBe(rgb.r);
      expect(Math.round(back.g)).toBe(rgb.g);
      expect(Math.round(back.b)).toBe(rgb.b);
    }
  });

  it("puts white at lightness 1 with no chroma", () => {
    const white = rgbToOklab({ r: 255, g: 255, b: 255 });
    expect(white.l).toBeCloseTo(1, 4);
    expect(white.a).toBeCloseTo(0, 4);
    expect(white.b).toBeCloseTo(0, 4);
  });
});

describe("parseCssColor", () => {
  it("reads the spellings tokens.css uses", () => {
    expect(parseCssColor("#0f172a")).toEqual({ r: 15, g: 23, b: 42, alpha: 1 });
    expect(parseCssColor("15, 23, 42")).toEqual({ r: 15, g: 23, b: 42, alpha: 1 });
    expect(parseCssColor("rgba(253, 224, 71, 0.55)")).toEqual({ r: 253, g: 224, b: 71, alpha: 0.55 });
    expect(parseCssColor("rgb(10 20 30 / 15%)")).toEqual({ r: 10, g: 20, b: 30, alpha: 0.15 });
  });

  it("reads the alpha suffix of a highlight colour", () => {
    expect(parseCssColor("#0f172aff")).toEqual({ r: 15, g: 23, b: 42, alpha: 1 });
    expect(parseCssColor("#0f172a00")).toEqual({ r: 15, g: 23, b: 42, alpha: 0 });
    expect(parseCssColor("#0f172a33")?.alpha).toBeCloseTo(0.2, 3);
  });

  it("converts oklch, including an alpha", () => {
    const white = parseCssColor("oklch(1 0 0 / 10%)");
    expect(white?.alpha).toBeCloseTo(0.1, 5);
    expect(Math.round(white?.r ?? 0)).toBe(255);

    const gray = parseCssColor("oklch(0.145 0 0)");
    expect(Math.round(gray?.r ?? 0)).toBe(10);
  });

  it("rejects anything else", () => {
    expect(parseCssColor("red")).toBeNull();
    expect(parseCssColor("#fff")).toBeNull();
    expect(parseCssColor("url(x)")).toBeNull();
  });
});
