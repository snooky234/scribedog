import { describe, expect, it } from "vitest";

import { MAX_RECENT_ICONS, parseRecentIcons, pushRecentIcon } from "./recentIcons";

describe("pushRecentIcon", () => {
  it("puts the newest first and drops the duplicate", () => {
    expect(pushRecentIcon([1, 2, 3], 3)).toEqual([3, 1, 2]);
    expect(pushRecentIcon([], 5)).toEqual([5]);
  });

  it("keeps a bounded list", () => {
    const full = Array.from({ length: MAX_RECENT_ICONS }, (_, index) => index);

    expect(pushRecentIcon(full, 999)).toHaveLength(MAX_RECENT_ICONS);
    expect(pushRecentIcon(full, 999)[0]).toBe(999);
  });
});

describe("parseRecentIcons", () => {
  it("reads what it wrote", () => {
    expect(parseRecentIcons(JSON.stringify({ "custom:a": [1, 2] }))).toEqual({ "custom:a": [1, 2] });
  });

  it("survives anything else in storage", () => {
    expect(parseRecentIcons(null)).toEqual({});
    expect(parseRecentIcons("nope")).toEqual({});
    expect(parseRecentIcons("[1,2]")).toEqual({});
    expect(parseRecentIcons(JSON.stringify({ a: "x", b: [1, "2", -3, 1.5, 0x110000, 7] }))).toEqual({ b: [1, 7] });
  });
});
