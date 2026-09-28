// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { isScrollOutside } from "./useDismissablePopover";

describe("isScrollOutside", () => {
  const popover = document.createElement("div");
  const list = document.createElement("ul");
  popover.append(list);
  const elsewhere = document.createElement("div");

  it("keeps the popover open while its own content scrolls", () => {
    expect(isScrollOutside(popover, popover)).toBe(false);
    expect(isScrollOutside(list, popover)).toBe(false);
  });

  it("closes it when something outside scrolls", () => {
    expect(isScrollOutside(elsewhere, popover)).toBe(true);
    expect(isScrollOutside(document, popover)).toBe(true);
  });

  it("closes it on any scroll when the popover element is unknown", () => {
    expect(isScrollOutside(list, null)).toBe(true);
  });
});
