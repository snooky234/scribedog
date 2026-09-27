import { describe, expect, it } from "vitest";

import { isCoarsePointer, singleClickOpens } from "./openGesture";

describe("singleClickOpens", () => {
  it("opens on a click unless the user asked for double-click", () => {
    expect(singleClickOpens(false, false)).toBe(true);
    expect(singleClickOpens(true, false)).toBe(false);
  });

  it("keeps a tap opening on a touch screen, whatever the setting says", () => {
    expect(singleClickOpens(true, true)).toBe(true);
    expect(singleClickOpens(false, true)).toBe(true);
  });
});

describe("isCoarsePointer", () => {
  it("answers false where there is no window to ask", () => {
    expect(isCoarsePointer()).toBe(false);
  });
});
