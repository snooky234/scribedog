import { describe, expect, it } from "vitest";

import { findIconGlyphs } from "./iconGlyphs";

describe("findIconGlyphs", () => {
  it("finds Private Use characters, also beyond the BMP", () => {
    const text = `a${String.fromCodePoint(0xf308)}b${String.fromCodePoint(0xf0868)}`;

    expect(findIconGlyphs(text)).toEqual([
      { from: 1, to: 2, spaceAfter: false },
      { from: 3, to: 5, spaceAfter: false }
    ]);
  });

  it("notes when a space follows, which already makes room", () => {
    const icon = String.fromCodePoint(0xf308);

    expect(findIconGlyphs(`${icon} x${icon}y${icon}`).map((range) => range.spaceAfter)).toEqual([true, false, false]);
  });

  it("leaves ordinary text and emoji alone", () => {
    expect(findIconGlyphs("Welcome 🐶 → ok")).toEqual([]);
  });
});
