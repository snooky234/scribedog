import { describe, expect, it } from "vitest";

import {
  PAGE_DOCK_DISTANCE_PX,
  PAGE_WIDTH_MIN_EM,
  PAGE_WIDTH_STEP_EM,
  draggedPageWidth,
  parseStoredPageWidth,
  steppedPageWidth
} from "./pageWidth";

describe("draggedPageWidth", () => {
  it("keeps a pulled page in em of the text", () => {
    expect(draggedPageWidth(800, 1600, 16)).toBe(50);
  });

  it("docks when pulled back to the card's edge", () => {
    expect(draggedPageWidth(1600 - PAGE_DOCK_DISTANCE_PX, 1600, 16)).toBeNull();
    expect(draggedPageWidth(1700, 1600, 16)).toBeNull();
    expect(draggedPageWidth(1600 - PAGE_DOCK_DISTANCE_PX - 1, 1600, 16)).not.toBeNull();
  });

  it("never gets narrower than the minimum", () => {
    expect(draggedPageWidth(10, 1600, 16)).toBe(PAGE_WIDTH_MIN_EM);
  });
});

describe("steppedPageWidth", () => {
  it("steps from the width the page has", () => {
    expect(steppedPageWidth(40, -1, 1600, 16)).toBe(40 - PAGE_WIDTH_STEP_EM);
    expect(steppedPageWidth(40, 1, 1600, 16)).toBe(40 + PAGE_WIDTH_STEP_EM);
  });

  it("starts a docked page from the card's width and docks again at its edge", () => {
    expect(steppedPageWidth(null, -1, 1600, 16)).toBe(100 - PAGE_WIDTH_STEP_EM);
    expect(steppedPageWidth(98, 1, 1600, 16)).toBeNull();
  });

  it("starts a stored width wider than the card from what is shown", () => {
    expect(steppedPageWidth(200, -1, 1600, 16)).toBe(100 - PAGE_WIDTH_STEP_EM);
  });
});

describe("parseStoredPageWidth", () => {
  it("reads a stored width and treats anything else as docked", () => {
    expect(parseStoredPageWidth("42.5")).toBe(42.5);
    expect(parseStoredPageWidth(null)).toBeNull();
    expect(parseStoredPageWidth("full")).toBeNull();
    expect(parseStoredPageWidth("3")).toBe(PAGE_WIDTH_MIN_EM);
  });
});
