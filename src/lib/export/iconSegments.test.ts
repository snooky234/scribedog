import { describe, expect, it } from "vitest";

import { iconFontSize, splitIconSegments, type PdfIconFont } from "./iconSegments";

const nerd: PdfIconFont = { name: "nerd", ranges: [[0xf300, 0xf3ff], [0xf0000, 0xf00ff]] };
const other: PdfIconFont = { name: "other", ranges: [[0xe000, 0xe0ff]] };

// Spelled as codepoints: a Private Use character typed into source is
// invisible in most editors and easy to lose.
const docker = String.fromCodePoint(0xf308);
const dockerNext = String.fromCodePoint(0xf309);
const otherIcon = String.fromCodePoint(0xe001);
const supplementary = String.fromCodePoint(0xf0001);
const unclaimed = String.fromCodePoint(0xe900);

describe("splitIconSegments", () => {
  it("leaves text alone when there are no icon fonts", () => {
    expect(splitIconSegments(`Docker ${docker}`, [])).toEqual([{ text: `Docker ${docker}`, font: null }]);
    expect(splitIconSegments("", [nerd])).toEqual([]);
  });

  it("tags the icon and keeps the text around it in the body font", () => {
    expect(splitIconSegments(`a ${docker} b`, [nerd])).toEqual([
      { text: "a ", font: null },
      { text: docker, font: "nerd" },
      { text: " b", font: null }
    ]);
  });

  it("keeps neighbouring icons of one font in one run", () => {
    expect(splitIconSegments(docker + dockerNext, [nerd])).toEqual([{ text: docker + dockerNext, font: "nerd" }]);
  });

  it("picks the font that covers the codepoint, also beyond the BMP", () => {
    expect(splitIconSegments(otherIcon + docker + supplementary, [nerd, other])).toEqual([
      { text: otherIcon, font: "other" },
      { text: docker + supplementary, font: "nerd" }
    ]);
  });

  it("leaves a Private Use codepoint that no font covers in the body font", () => {
    expect(splitIconSegments(unclaimed, [nerd])).toEqual([{ text: unclaimed, font: null }]);
  });
});

describe("iconFontSize", () => {
  const scaled: PdfIconFont = { name: "scaled", ranges: [], scale: 1.5 };

  it("scales from the size of the surrounding text", () => {
    expect(iconFontSize(11, [scaled], "scaled")).toBe(16.5);
    expect(iconFontSize(20, [scaled], "scaled")).toBe(30);
  });

  it("leaves the run alone at scale 1, without a scale, for body text and for an unknown font", () => {
    expect(iconFontSize(11, [{ ...scaled, scale: 1 }], "scaled")).toBeNull();
    expect(iconFontSize(11, [nerd], "nerd")).toBeNull();
    expect(iconFontSize(11, [scaled], null)).toBeNull();
    expect(iconFontSize(11, [scaled], "missing")).toBeNull();
  });
});
