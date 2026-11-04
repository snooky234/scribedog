import { describe, expect, it } from "vitest";

import type { IconGlyph } from "./fontFile";
import { codepointLabel, filterGlyphs, glyphGroups, glyphLabel, glyphPrefix } from "./iconSearch";

const glyph = (codepoint: number, name: string | null): IconGlyph => ({ codepoint, name });

const sample = [
  glyph(0xf308, "linux-docker"),
  glyph(0xe7b0, "dev-docker"),
  glyph(0xf121, "fa-code"),
  glyph(0xf01a7, "md-cube_outline"),
  glyph(0xe900, null)
];

describe("glyphPrefix", () => {
  it("is the part before the first separator", () => {
    expect(glyphPrefix(glyph(1, "md-cube_outline"))).toBe("md");
    expect(glyphPrefix(glyph(1, "FA_code"))).toBe("fa");
    expect(glyphPrefix(glyph(1, "uniE0A0"))).toBeNull();
    expect(glyphPrefix(glyph(1, null))).toBeNull();
  });
});

describe("glyphGroups", () => {
  const many = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => glyph(0xe000 + index + prefix.length * 1000, `${prefix}-icon${index}`));

  it("lists the larger icon sets, biggest first", () => {
    expect(glyphGroups([...many("md", 30), ...many("fa", 50), ...many("x", 5)])).toEqual([
      { prefix: "fa", count: 50 },
      { prefix: "md", count: 30 }
    ]);
  });

  it("offers no choice when there is one set or none", () => {
    expect(glyphGroups(many("fa", 50))).toEqual([]);
    expect(glyphGroups(sample)).toEqual([]);
  });
});

describe("filterGlyphs", () => {
  it("returns everything for an empty query", () => {
    expect(filterGlyphs(sample, "  ", null)).toBe(sample);
  });

  it("matches words of the name in any order, ignoring - and _", () => {
    expect(filterGlyphs(sample, "docker", null).map((entry) => entry.name)).toEqual(["linux-docker", "dev-docker"]);
    expect(filterGlyphs(sample, "linux docker", null).map((entry) => entry.name)).toEqual(["linux-docker"]);
    expect(filterGlyphs(sample, "cube outline", null)).toHaveLength(1);
    expect(filterGlyphs(sample, "CUBE", null)).toHaveLength(1);
  });

  it("finds a codepoint by its hex number", () => {
    expect(filterGlyphs(sample, "f308", null)).toEqual([sample[0]]);
    expect(filterGlyphs(sample, "U+E900", null)).toEqual([sample[4]]);
  });

  it("narrows to one icon set", () => {
    expect(filterGlyphs(sample, "", "dev")).toEqual([sample[1]]);
    expect(filterGlyphs(sample, "docker", "linux")).toEqual([sample[0]]);
  });
});

describe("labels", () => {
  it("names a glyph by its name, or by its codepoint", () => {
    expect(glyphLabel(glyph(0xf308, "linux-docker"))).toBe("linux-docker");
    expect(glyphLabel(glyph(0xe900, null))).toBe("U+E900");
    expect(codepointLabel(0xf01a7)).toBe("U+F01A7");
    expect(codepointLabel(0xa)).toBe("U+000A");
  });
});
