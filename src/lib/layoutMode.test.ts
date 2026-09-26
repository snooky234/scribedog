import { describe, expect, it } from "vitest";

import { layoutModeForWidth } from "./layoutMode";

describe("layoutModeForWidth", () => {
  it("decides by width alone for a mouse", () => {
    expect(layoutModeForWidth(390)).toBe("phone");
    expect(layoutModeForWidth(800)).toBe("tablet");
    expect(layoutModeForWidth(1024)).toBe("desktop");
  });

  it("keeps every iPad width in the tablet layout on a touch screen", () => {
    // iPad mini portrait, iPad Pro 13" portrait and landscape
    expect(layoutModeForWidth(744, true)).toBe("tablet");
    expect(layoutModeForWidth(1024, true)).toBe("tablet");
    expect(layoutModeForWidth(1376, true)).toBe("tablet");
    expect(layoutModeForWidth(1920, true)).toBe("desktop");
  });
});
