import { describe, expect, it } from "vitest";

import { activeImageScale, canApplyImageScale, widthForImageScale } from "./imageScale";

describe("widthForImageScale", () => {
  it("takes a share of the page width, rounded to whole pixels", () => {
    expect(widthForImageScale(50, 720, 48)).toBe(360);
    expect(widthForImageScale(75, 333, 48)).toBe(250);
  });

  it("stores the full page width for 100 percent", () => {
    expect(widthForImageScale(100, 720, 48)).toBe(720);
  });

  it("stores no width for the original size", () => {
    expect(widthForImageScale("original", 720, 48)).toBeNull();
  });

  it("never goes below the minimum width", () => {
    expect(widthForImageScale(25, 100, 48)).toBe(48);
  });
});

describe("canApplyImageScale", () => {
  it("needs a page width for the steps but not for the original size", () => {
    expect(canApplyImageScale(50, 720)).toBe(true);
    expect(canApplyImageScale(50, null)).toBe(false);
    expect(canApplyImageScale(50, 0)).toBe(false);
    expect(canApplyImageScale("original", null)).toBe(true);
  });
});

describe("activeImageScale", () => {
  it("treats an image without a width as the original size", () => {
    expect(activeImageScale(null, 720)).toBe("original");
    expect(activeImageScale(null, null)).toBe("original");
  });

  it("recognises a step within a small tolerance", () => {
    expect(activeImageScale(360, 720)).toBe(50);
    expect(activeImageScale(541, 720)).toBe(75);
    expect(activeImageScale(180, 721)).toBe(25);
    expect(activeImageScale(720, 720)).toBe(100);
  });

  it("finds no step for a width dragged freely", () => {
    expect(activeImageScale(400, 720)).toBeNull();
    expect(activeImageScale(400, null)).toBeNull();
  });
});
