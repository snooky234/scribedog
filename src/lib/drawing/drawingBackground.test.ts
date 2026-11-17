import { describe, expect, it } from "vitest";

import { canDrawOnMimeType, embeddedRasterSize, MAX_BACKGROUND_EDGE } from "./drawingBackground";

describe("canDrawOnMimeType", () => {
  it("offers raster formats only", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]) {
      expect(canDrawOnMimeType(type)).toBe(true);
    }

    expect(canDrawOnMimeType("image/svg+xml")).toBe(false);
    expect(canDrawOnMimeType("application/octet-stream")).toBe(false);
    expect(canDrawOnMimeType("toString")).toBe(false);
  });
});

describe("embeddedRasterSize", () => {
  it("keeps images up to the limit as they are", () => {
    expect(embeddedRasterSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(embeddedRasterSize(MAX_BACKGROUND_EDGE, 10)).toEqual({ width: MAX_BACKGROUND_EDGE, height: 10 });
  });

  it("scales the longest edge down to the limit, keeping the aspect ratio", () => {
    expect(embeddedRasterSize(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(embeddedRasterSize(1000, 5000, 2000)).toEqual({ width: 400, height: 2000 });
  });

  it("never rounds an edge down to nothing", () => {
    expect(embeddedRasterSize(10000, 1, 100)).toEqual({ width: 100, height: 1 });
  });
});
