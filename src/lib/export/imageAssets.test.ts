import { describe, expect, it } from "vitest";

import { computeExportImageSize } from "./imageAssets";

const asset = { width: 800, height: 600 };

describe("computeExportImageSize", () => {
  it("uses the display width and keeps the native aspect ratio", () => {
    // Regression: PDF/DOCX/ODT used to ignore the display width and stretch the
    // image to the full page width.
    expect(computeExportImageSize(asset, 400, 600)).toEqual({ width: 400, height: 300 });
  });

  it("falls back to the native width when no display width is set", () => {
    expect(computeExportImageSize(asset, null, 1000)).toEqual({ width: 800, height: 600 });
  });

  it("caps the native width at the page width", () => {
    expect(computeExportImageSize(asset, null, 600)).toEqual({ width: 600, height: 450 });
  });

  it("caps an oversized display width at the page width", () => {
    expect(computeExportImageSize(asset, 5000, 600)).toEqual({ width: 600, height: 450 });
  });

  it("keeps a display width that is smaller than the page width, even when the native size is huge", () => {
    expect(computeExportImageSize({ width: 4000, height: 3000 }, 388, 600)).toEqual({
      width: 388,
      height: 291
    });
  });

  it("ignores a zero or negative display width", () => {
    expect(computeExportImageSize(asset, 0, 1000)).toEqual({ width: 800, height: 600 });
    expect(computeExportImageSize(asset, -50, 1000)).toEqual({ width: 800, height: 600 });
  });

  it("does not divide by zero on a degenerate asset", () => {
    const result = computeExportImageSize({ width: 0, height: 0 }, null, 600);
    expect(Number.isFinite(result.width)).toBe(true);
    expect(Number.isFinite(result.height)).toBe(true);
  });
});
