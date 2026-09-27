import { describe, expect, it } from "vitest";

import {
  defaultPageSizeForLocale,
  formatCm,
  getPageLayout,
  pageCssRule,
  ptToPx,
  ptToTwips,
  resolvePageMargins,
  resolvePageSize
} from "@/lib/pageSetup";

describe("getPageLayout", () => {
  it("keeps the PDF export's former A4 page with 72pt margins as the default", () => {
    const layout = getPageLayout();

    expect(layout.size).toBe("a4");
    expect(layout.margins).toEqual({ top: 72, right: 72, bottom: 72, left: 72 });
    expect(Math.round(layout.contentWidthPt)).toBe(451);
  });

  it("derives the content area from size and margins", () => {
    const letter = getPageLayout("letter", "narrow");

    expect(letter.contentWidthPt).toBe(612 - 72);
    expect(letter.contentHeightPt).toBe(792 - 72);
  });

  it("widens only the side margins for the wide preset", () => {
    const layout = getPageLayout("a5", "wide");

    expect(layout.margins.top).toBe(72);
    expect(layout.margins.bottom).toBe(72);
    expect(formatCm(layout.margins.left)).toBe("3.175cm");
    expect(layout.contentWidthPt).toBeCloseTo(419.53 - 180, 5);
  });

  it("uses Word's centimetre values for the presets", () => {
    expect(formatCm(getPageLayout("a4", "normal").margins.left)).toBe("2.540cm");
    expect(formatCm(getPageLayout("a4", "narrow").margins.left)).toBe("1.270cm");
  });

  it("does not hand out its internal margin objects", () => {
    const first = getPageLayout();
    first.margins.left = 0;

    expect(getPageLayout().margins.left).toBe(72);
  });
});

describe("defaultPageSizeForLocale", () => {
  it.each(["en-US", "en-CA", "fr-CA", "es-MX", "fil-PH", "es-CO", "en_US"])("picks Letter for %s", (locale) => {
    expect(defaultPageSizeForLocale(locale)).toBe("letter");
  });

  it.each(["de-DE", "en-GB", "en-AU", "es-ES", "fr", "en", "ja-JP", "zh-Hans-CN"])("picks A4 for %s", (locale) => {
    expect(defaultPageSizeForLocale(locale)).toBe("a4");
  });

  it("falls back to A4 without a usable tag", () => {
    expect(defaultPageSizeForLocale(undefined)).toBe("a4");
    expect(defaultPageSizeForLocale("")).toBe("a4");
    expect(defaultPageSizeForLocale("not a locale")).toBe("a4");
  });
});

describe("stored values", () => {
  it("accepts only known sizes and leaves the rest to the regional default", () => {
    expect(resolvePageSize("legal")).toBe("legal");
    expect(resolvePageSize("b5")).toBeNull();
    expect(resolvePageSize(null)).toBeNull();
  });

  it("falls back to normal margins", () => {
    expect(resolvePageMargins("wide")).toBe("wide");
    expect(resolvePageMargins("huge")).toBe("normal");
  });
});

describe("unit conversion", () => {
  it("converts points into the other formats' units", () => {
    expect(ptToTwips(72)).toBe(1440);
    expect(ptToPx(72)).toBe(96);
  });

  it("writes an @page rule with a paper keyword and the margins", () => {
    expect(pageCssRule(getPageLayout("letter", "wide"))).toBe(
      "@page { size: letter portrait; margin: 72pt 90pt 72pt 90pt; }"
    );
  });
});
