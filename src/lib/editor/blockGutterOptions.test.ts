import { describe, expect, it } from "vitest";

import { DEFAULT_BLOCK_GUTTER_OPTIONS, normalizeBlockGutterOptions } from "./blockGutterOptions";

describe("normalizeBlockGutterOptions", () => {
  it("falls back to the defaults for anything that is not an object", () => {
    expect(normalizeBlockGutterOptions(null)).toEqual(DEFAULT_BLOCK_GUTTER_OPTIONS);
    expect(normalizeBlockGutterOptions("x")).toEqual(DEFAULT_BLOCK_GUTTER_OPTIONS);
  });

  it("keeps valid values and replaces invalid ones one by one", () => {
    expect(
      normalizeBlockGutterOptions({ numbersOnAll: true, highlightActive: "yes", cursorPosition: "always" })
    ).toEqual({ numbersOnAll: true, highlightActive: false, cursorPosition: "always" });
    expect(normalizeBlockGutterOptions({ cursorPosition: "forever" }).cursorPosition).toBe("brief");
  });
});
