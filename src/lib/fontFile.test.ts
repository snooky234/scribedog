import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { inspectFont, readIconGlyphs } from "./fontFile";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit") as { create: (bytes: Buffer) => FontkitFont };

type FontkitFont = {
  glyphForCodePoint: (codepoint: number) => { name: string };
  familyName: string;
  ascent: number;
  descent: number;
  unitsPerEm: number;
  characterSet: number[];
};

const roboto = (style: string) => readFileSync(`node_modules/pdfmake/fonts/Roboto/Roboto-${style}.ttf`);

function u16(value: number): number[] {
  return [(value >> 8) & 255, value & 255];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function tag(name: string): number[] {
  return [...name].map((char) => char.charCodeAt(0));
}

/** An sfnt container around the given tables, enough for inspectFont to read. */
function sfnt(tables: Record<string, number[]>, flavor = [0, 1, 0, 0]): Uint8Array {
  const names = Object.keys(tables);
  const header = [...flavor, ...u16(names.length), 0, 0, 0, 0, 0, 0];
  let offset = 12 + names.length * 16;
  const directory: number[] = [];
  const body: number[] = [];

  for (const name of names) {
    directory.push(...tag(name), ...u32(0), ...u32(offset), ...u32(tables[name].length));
    body.push(...tables[name]);
    offset += tables[name].length;
  }

  return Uint8Array.from([...header, ...directory, ...body]);
}

function nameTable(family: string, subfamily = "Regular"): number[] {
  const encode = (text: string) => [...text].flatMap((char) => u16(char.charCodeAt(0)));
  const strings = [encode(family), encode(subfamily)];
  const records: number[] = [];
  let offset = 0;

  [1, 2].forEach((nameId, index) => {
    records.push(...u16(3), ...u16(1), ...u16(0x409), ...u16(nameId), ...u16(strings[index].length), ...u16(offset));
    offset += strings[index].length;
  });

  return [...u16(0), ...u16(2), ...u16(6 + 2 * 12), ...records, ...strings.flat()];
}

/** A format 12 cmap covering the given inclusive ranges. */
function cmapTable(ranges: [number, number][]): number[] {
  let nextGlyph = 1;
  const groups = ranges.flatMap(([start, end]) => {
    const group = [...u32(start), ...u32(end), ...u32(nextGlyph)];
    nextGlyph += end - start + 1;
    return group;
  });
  const subtable = [...u16(12), ...u16(0), ...u32(16 + groups.length), ...u32(0), ...u32(ranges.length), ...groups];

  return [...u16(0), ...u16(1), ...u16(3), ...u16(10), ...u32(12), ...subtable];
}

function syntheticFont(options: { family?: string; ranges?: [number, number][]; weight?: number; extra?: Record<string, number[]> } = {}) {
  const head = new Array<number>(54).fill(0);
  head[18] = 0x03;
  head[19] = 0xe8; // unitsPerEm 1000
  const hhea = [0, 1, 0, 0, ...u16(800), ...u16(0xffff - 199)]; // ascender 800, descender -200
  const os2 = new Array<number>(64).fill(0);
  os2.splice(4, 2, ...u16(options.weight ?? 400));

  return sfnt({
    glyf: [0, 0, 0, 0],
    head,
    hhea,
    "OS/2": os2,
    name: nameTable(options.family ?? "Synthetic Sans"),
    cmap: cmapTable(options.ranges ?? [[0x41, 0x5a]]),
    ...options.extra
  });
}

describe("inspectFont", () => {
  it("reads a TrueType font the way fontkit does", () => {
    const bytes = roboto("Regular");
    const result = inspectFont(bytes);
    const reference = fontkit.create(bytes);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.font.familyName).toBe("Roboto");
    expect(result.font.container).toBe("sfnt");
    expect(result.font.weight).toBe(400);
    expect(result.font.italic).toBe(false);
    expect(result.font.hasIcons).toBe(false);
    expect(result.font.pdfLineHeight).toBeCloseTo((reference.ascent - reference.descent) / reference.unitsPerEm, 3);
  });

  it("finds the weight and the italic flag", () => {
    const medium = inspectFont(roboto("Medium"));
    const italic = inspectFont(roboto("Italic"));

    expect(medium.ok && medium.font.weight).toBe(500);
    expect(italic.ok && italic.font.italic).toBe(true);
  });

  it("covers the codepoints fontkit reports", () => {
    const bytes = roboto("Regular");
    const result = inspectFont(bytes);
    const covered = (codepoint: number) =>
      result.ok && result.font.codepointRanges.some(([start, end]) => codepoint >= start && codepoint <= end);

    for (const codepoint of [0x41, 0x7a, 0xe4, 0x20ac]) {
      expect(fontkit.create(bytes).characterSet).toContain(codepoint);
      expect(covered(codepoint)).toBe(true);
    }

    expect(covered(0x4e2d)).toBe(false);
  });

  it("reads a WOFF file, which compresses its tables", () => {
    const bytes = readFileSync("node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff");
    const result = inspectFont(bytes);
    const reference = fontkit.create(bytes);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.font.container).toBe("woff");
      expect(result.font.familyName).toBe("JetBrains Mono");
      expect(result.font.monospace).toBe(true);
      expect(result.font.pdfLineHeight).toBeCloseTo((reference.ascent - reference.descent) / reference.unitsPerEm, 3);
    }
  });

  it("flags a font with many Private Use codepoints as an icon font", () => {
    const plain = inspectFont(syntheticFont({ ranges: [[0x41, 0x5a]] }));
    const fewPrivate = inspectFont(syntheticFont({ ranges: [[0x41, 0x5a], [0xf308, 0xf30a]] }));
    const icons = inspectFont(syntheticFont({ ranges: [[0x41, 0x5a], [0xf300, 0xf37f]] }));
    const supplementary = inspectFont(syntheticFont({ ranges: [[0xf0000, 0xf007f]] }));

    expect(plain.ok && plain.font.hasIcons).toBe(false);
    expect(fewPrivate.ok && fewPrivate.font.hasIcons).toBe(false);
    expect(icons.ok && icons.font.hasIcons).toBe(true);
    expect(supplementary.ok && supplementary.font.hasIcons).toBe(true);
  });

  it("reads names, weight and metrics from a built font", () => {
    const result = inspectFont(syntheticFont({ family: "Test Mono Nerd Font", weight: 700 }));

    expect(result).toMatchObject({
      ok: true,
      font: { familyName: "Test Mono Nerd Font", subfamilyName: "Regular", weight: 700, pdfLineHeight: 1 }
    });
  });

  it("refuses what pdfmake cannot embed, with the reason", () => {
    const woff2 = readFileSync("node_modules/@fontsource/lato/files/lato-latin-400-normal.woff2");

    expect(inspectFont(woff2)).toEqual({ ok: false, reason: "woff2" });
    expect(inspectFont(syntheticFont({ extra: { fvar: [0, 0, 0, 0] } }))).toEqual({ ok: false, reason: "variable" });
    expect(inspectFont(Uint8Array.from([...tag("ttcf"), 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({
      ok: false,
      reason: "collection"
    });
    expect(inspectFont(sfnt({ "CFF ": [0, 0, 0, 0], head: new Array(54).fill(0) }, tag("OTTO")))).toEqual({
      ok: false,
      reason: "cff"
    });
  });

  it("treats anything else as unreadable instead of throwing", () => {
    expect(inspectFont(new Uint8Array())).toEqual({ ok: false, reason: "unreadable" });
    expect(inspectFont(new TextEncoder().encode("not a font at all, just text"))).toEqual({
      ok: false,
      reason: "unreadable"
    });
    expect(inspectFont(roboto("Regular").subarray(0, 300))).toEqual({ ok: false, reason: "unreadable" });
  });
});

/** A post table of version 2.0 that names the glyphs 1..n. */
function postTable(names: string[]): number[] {
  const strings = names.flatMap((name) => [name.length, ...tag(name)]);
  const header = new Array<number>(32).fill(0);
  header.splice(0, 4, ...u32(0x00020000));

  return [...header, ...u16(names.length + 1), ...u16(0), ...names.flatMap((_, index) => u16(258 + index)), ...strings];
}

describe("readIconGlyphs", () => {
  it("reads the Private Use glyphs of a font with their names, like fontkit does", () => {
    const bytes = roboto("Regular");
    const reference = fontkit.create(bytes);
    const glyphs = readIconGlyphs(bytes);

    expect(glyphs.map((glyph) => glyph.codepoint)).toEqual([0xee01, 0xee02, 0xf6c3]);

    for (const glyph of glyphs) {
      expect(glyph.name).toBe(reference.glyphForCodePoint(glyph.codepoint).name ?? null);
    }
  });

  it("maps codepoints through a format 12 cmap and names them from the post table", () => {
    const bytes = syntheticFont({
      ranges: [[0x41, 0x41], [0xf308, 0xf309]],
      extra: { post: postTable(["A", "linux-docker", "fa-code"]) }
    });
    const glyphs = readIconGlyphs(bytes);

    expect(glyphs.map((glyph) => glyph.codepoint)).toEqual([0xf308, 0xf309]);
    expect(glyphs[0].name).toBe("linux-docker");
  });

  it("has no names for a font without a version 2 post table", () => {
    expect(readIconGlyphs(syntheticFont({ ranges: [[0xf308, 0xf308]] }))).toEqual([{ codepoint: 0xf308, name: null }]);
  });

  it("returns nothing for what it cannot read", () => {
    expect(readIconGlyphs(new Uint8Array())).toEqual([]);
    expect(readIconGlyphs(roboto("Regular").subarray(0, 300))).toEqual([]);
  });

  it("reports the Private Use part of the coverage on the inspection", () => {
    const result = inspectFont(syntheticFont({ ranges: [[0x41, 0x5a], [0xf300, 0xf37f]] }));

    expect(result.ok && result.font.privateUseRanges).toEqual([[0xf300, 0xf37f]]);
  });
});
