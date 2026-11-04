// Reads what ScribeDog needs to know about a font file the user imports: its
// names, weight, metrics and which codepoints it covers. Written against the
// sfnt tables directly rather than pulling in a font library, because the
// import dialog is the only consumer on the page and a full parser would be
// the largest dependency of the settings screen.
//
// The checks mirror what the PDF export can embed (see the note at the top of
// lib/fonts.ts): pdfmake subsets with fontkit, which handles static TrueType
// outlines and fails on WOFF2 and variable fonts. A font that is accepted here
// but cannot be subset would look right in the editor and silently fall back
// in the PDF, so everything that cannot be embedded is refused up front, with
// a reason the dialog can phrase.

import { unzlibSync } from "fflate";

export type FontRejection =
  /** Not a font file, or damaged beyond reading. */
  | "unreadable"
  /** WOFF2 stores the outlines transformed; fontkit cannot subset them. */
  | "woff2"
  /** A .ttc bundles several faces in one file. */
  | "collection"
  /** One file with a weight axis instead of one file per style. */
  | "variable"
  /** OpenType with PostScript (CFF) outlines instead of TrueType ones. */
  | "cff";

export type FontCodepointRange = [start: number, end: number];

export type FontInspection = {
  /** Typographic family ("Lato"), not the per-weight one ("Lato Light"). */
  familyName: string;
  subfamilyName: string;
  weight: number;
  italic: boolean;
  /** (ascent - descent) / unitsPerEm, the factor pdfmake multiplies its line height with. */
  pdfLineHeight: number;
  monospace: boolean;
  serif: boolean;
  /** Merged, ascending ranges of the Unicode codepoints the font maps. */
  codepointRanges: FontCodepointRange[];
  /** Maps codepoints of the Private Use Areas, where icon fonts keep their glyphs. */
  hasIcons: boolean;
  /** The part of `codepointRanges` inside the Private Use Areas: what the font offers as icons. */
  privateUseRanges: FontCodepointRange[];
  container: "sfnt" | "woff";
};

export type FontInspectionResult =
  | { ok: true; font: FontInspection }
  | { ok: false; reason: FontRejection };

class FontReadError extends Error {
  constructor(readonly reason: FontRejection) {
    super(reason);
  }
}

// Ordinary fonts keep a handful of glyphs in the Private Use Areas (Roboto has
// three); an icon font has hundreds to thousands, so a count tells them apart.
const ICON_FONT_MIN_GLYPHS = 64;

const PRIVATE_USE_RANGES: FontCodepointRange[] = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd]
];

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";

  for (let index = 0; index < length; index++) {
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  }

  return text;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readSfntTables(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = viewOf(bytes);
  const tableCount = view.getUint16(4);
  const tables = new Map<string, Uint8Array>();

  for (let index = 0; index < tableCount; index++) {
    const entry = 12 + index * 16;
    const offset = view.getUint32(entry + 8);
    const length = view.getUint32(entry + 12);

    if (offset + length > bytes.length) {
      throw new FontReadError("unreadable");
    }

    tables.set(ascii(bytes, entry, 4), bytes.subarray(offset, offset + length));
  }

  return tables;
}

function readWoffTables(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = viewOf(bytes);
  const tableCount = view.getUint16(12);
  const tables = new Map<string, Uint8Array>();

  for (let index = 0; index < tableCount; index++) {
    const entry = 44 + index * 20;
    const offset = view.getUint32(entry + 4);
    const compressedLength = view.getUint32(entry + 8);
    const originalLength = view.getUint32(entry + 12);

    if (offset + compressedLength > bytes.length) {
      throw new FontReadError("unreadable");
    }

    const stored = bytes.subarray(offset, offset + compressedLength);
    tables.set(ascii(bytes, entry, 4), compressedLength < originalLength ? unzlibSync(stored) : stored);
  }

  return tables;
}

function readTables(bytes: Uint8Array): { tables: Map<string, Uint8Array>; container: "sfnt" | "woff" } {
  if (bytes.length < 12) {
    throw new FontReadError("unreadable");
  }

  const signature = ascii(bytes, 0, 4);

  switch (signature) {
    case "wOF2":
      throw new FontReadError("woff2");
    case "ttcf":
      throw new FontReadError("collection");
    case "wOFF":
      return { tables: readWoffTables(bytes), container: "woff" };
    case "\u0000\u0001\u0000\u0000":
    case "true":
    case "OTTO":
      return { tables: readSfntTables(bytes), container: "sfnt" };
    default:
      throw new FontReadError("unreadable");
  }
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let text = "";

  for (let index = 0; index + 1 < bytes.length; index += 2) {
    text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  }

  return text;
}

/** One entry of the `name` table, English where the font offers several. */
function readName(table: Uint8Array | undefined, nameId: number): string | null {
  if (!table || table.length < 6) {
    return null;
  }

  const view = viewOf(table);
  const count = view.getUint16(2);
  const stringOffset = view.getUint16(4);
  let best: { rank: number; text: string } | null = null;

  for (let index = 0; index < count; index++) {
    const record = 6 + index * 12;

    if (record + 12 > table.length || view.getUint16(record + 6) !== nameId) {
      continue;
    }

    const platform = view.getUint16(record);
    const language = view.getUint16(record + 4);
    const length = view.getUint16(record + 8);
    const start = stringOffset + view.getUint16(record + 10);

    if (start + length > table.length) {
      continue;
    }

    const raw = table.subarray(start, start + length);
    const isWindows = platform === 3;
    const isUnicode = platform === 0;
    const isMac = platform === 1;

    if (!isWindows && !isUnicode && !isMac) {
      continue;
    }

    const rank = isWindows ? (language === 0x0409 ? 0 : 1) : isUnicode ? 2 : 3;
    const text = isMac ? ascii(raw, 0, raw.length) : decodeUtf16Be(raw);

    if (text.trim() !== "" && (best === null || rank < best.rank)) {
      best = { rank, text: text.trim() };
    }
  }

  return best?.text ?? null;
}

function mergeRanges(ranges: FontCodepointRange[]): FontCodepointRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: FontCodepointRange[] = [];

  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];

    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

function readCmapRanges(table: Uint8Array | undefined): FontCodepointRange[] {
  if (!table || table.length < 4) {
    return [];
  }

  const view = viewOf(table);
  const subtableCount = view.getUint16(2);
  const ranges: FontCodepointRange[] = [];
  const seenOffsets = new Set<number>();

  for (let index = 0; index < subtableCount; index++) {
    const record = 4 + index * 8;
    const platform = view.getUint16(record);
    const offset = view.getUint32(record + 4);

    // Only the Unicode subtables; the Macintosh and symbol ones map other
    // encodings, and several records often point at the same subtable.
    if ((platform !== 0 && platform !== 3) || seenOffsets.has(offset) || offset + 4 > table.length) {
      continue;
    }

    seenOffsets.add(offset);
    const format = view.getUint16(offset);

    if (format === 4) {
      const segmentCount = view.getUint16(offset + 6) / 2;
      const endCodes = offset + 14;
      const startCodes = endCodes + segmentCount * 2 + 2;

      for (let segment = 0; segment < segmentCount; segment++) {
        const end = view.getUint16(endCodes + segment * 2);
        const start = view.getUint16(startCodes + segment * 2);

        if (start <= end && start !== 0xffff) {
          ranges.push([start, end]);
        }
      }
    } else if (format === 12) {
      const groupCount = view.getUint32(offset + 12);

      for (let group = 0; group < groupCount; group++) {
        const entry = offset + 16 + group * 12;

        if (entry + 12 > table.length) {
          break;
        }

        const start = view.getUint32(entry);
        const end = view.getUint32(entry + 4);

        if (start <= end) {
          ranges.push([start, end]);
        }
      }
    }
  }

  return mergeRanges(ranges);
}

function clipToAreas(ranges: FontCodepointRange[], areas: FontCodepointRange[]): FontCodepointRange[] {
  const clipped: FontCodepointRange[] = [];

  for (const [start, end] of ranges) {
    for (const [areaStart, areaEnd] of areas) {
      const from = Math.max(start, areaStart);
      const to = Math.min(end, areaEnd);

      if (from <= to) {
        clipped.push([from, to]);
      }
    }
  }

  return mergeRanges(clipped);
}

function countWithin(ranges: FontCodepointRange[], areas: FontCodepointRange[]): number {
  let count = 0;

  for (const [start, end] of ranges) {
    for (const [areaStart, areaEnd] of areas) {
      count += Math.max(0, Math.min(end, areaEnd) - Math.max(start, areaStart) + 1);
    }
  }

  return count;
}

function requireTable(table: Uint8Array | undefined, minimumLength: number): Uint8Array {
  if (!table || table.length < minimumLength) {
    throw new FontReadError("unreadable");
  }

  return table;
}

/**
 * Everything the import needs from one file, or the reason it cannot be used.
 * Never throws: a truncated or hostile file ends up as `unreadable`.
 */
export function inspectFont(bytes: Uint8Array): FontInspectionResult {
  try {
    const { tables, container } = readTables(bytes);

    if (tables.has("fvar")) {
      return { ok: false, reason: "variable" };
    }

    if (!tables.has("glyf")) {
      return { ok: false, reason: tables.has("CFF ") || tables.has("CFF2") ? "cff" : "unreadable" };
    }

    const head = viewOf(requireTable(tables.get("head"), 46));
    const hhea = viewOf(requireTable(tables.get("hhea"), 8));
    const unitsPerEm = head.getUint16(18);

    if (unitsPerEm === 0) {
      return { ok: false, reason: "unreadable" };
    }

    const os2 = tables.get("OS/2");
    const os2View = os2 && os2.length >= 64 ? viewOf(os2) : null;
    const post = tables.get("post");
    const name = tables.get("name");
    const macStyle = head.getUint16(44);
    const familyName = readName(name, 16) ?? readName(name, 1);

    if (!familyName) {
      return { ok: false, reason: "unreadable" };
    }

    const panoseKind = os2View?.getUint8(32) ?? 0;
    const panoseSerif = os2View?.getUint8(33) ?? 0;
    const panoseProportion = os2View?.getUint8(35) ?? 0;
    const codepointRanges = readCmapRanges(tables.get("cmap"));
    const privateUseRanges = clipToAreas(codepointRanges, PRIVATE_USE_RANGES);

    return {
      ok: true,
      font: {
        familyName,
        subfamilyName: readName(name, 17) ?? readName(name, 2) ?? "Regular",
        weight: os2View ? os2View.getUint16(4) : (macStyle & 1) !== 0 ? 700 : 400,
        italic: os2View ? (os2View.getUint16(62) & 1) !== 0 || (macStyle & 2) !== 0 : (macStyle & 2) !== 0,
        pdfLineHeight:
          Math.round(((hhea.getInt16(4) - hhea.getInt16(6)) / unitsPerEm) * 10000) / 10000,
        monospace: Boolean(post && post.length >= 16 && viewOf(post).getUint32(12) !== 0) || panoseProportion === 9,
        // Serif styles 2-10 of the PANOSE classification; 11 and up are the sans ones.
        serif: panoseKind === 2 && panoseSerif >= 2 && panoseSerif <= 10,
        codepointRanges,
        hasIcons: countWithin(privateUseRanges, PRIVATE_USE_RANGES) >= ICON_FONT_MIN_GLYPHS,
        privateUseRanges,
        container
      }
    };
  } catch (error) {
    return { ok: false, reason: error instanceof FontReadError ? error.reason : "unreadable" };
  }
}

export type IconGlyph = {
  codepoint: number;
  /** The glyph's own name ("linux-docker"), when the font carries them. */
  name: string | null;
};

function readPrivateUseGlyphIds(table: Uint8Array | undefined): Map<number, number> {
  const glyphs = new Map<number, number>();

  if (!table || table.length < 4) {
    return glyphs;
  }

  const view = viewOf(table);
  const subtableCount = view.getUint16(2);
  const seenOffsets = new Set<number>();
  const add = (codepoint: number, glyphId: number) => {
    if (glyphId !== 0 && !glyphs.has(codepoint)) {
      glyphs.set(codepoint, glyphId);
    }
  };

  for (let index = 0; index < subtableCount; index++) {
    const record = 4 + index * 8;
    const platform = view.getUint16(record);
    const offset = view.getUint32(record + 4);

    if ((platform !== 0 && platform !== 3) || seenOffsets.has(offset) || offset + 4 > table.length) {
      continue;
    }

    seenOffsets.add(offset);
    const format = view.getUint16(offset);

    if (format === 12) {
      const groupCount = view.getUint32(offset + 12);

      for (let group = 0; group < groupCount; group++) {
        const entry = offset + 16 + group * 12;

        if (entry + 12 > table.length) {
          break;
        }

        const start = view.getUint32(entry);
        const end = view.getUint32(entry + 4);
        const startGlyph = view.getUint32(entry + 8);

        for (const [areaStart, areaEnd] of PRIVATE_USE_RANGES) {
          for (let codepoint = Math.max(start, areaStart); codepoint <= Math.min(end, areaEnd); codepoint++) {
            add(codepoint, startGlyph + (codepoint - start));
          }
        }
      }
    } else if (format === 4) {
      const segmentCount = view.getUint16(offset + 6) / 2;
      const endCodes = offset + 14;
      const startCodes = endCodes + segmentCount * 2 + 2;
      const deltas = startCodes + segmentCount * 2;
      const rangeOffsets = deltas + segmentCount * 2;

      for (let segment = 0; segment < segmentCount; segment++) {
        const end = view.getUint16(endCodes + segment * 2);
        const start = view.getUint16(startCodes + segment * 2);
        const delta = view.getUint16(deltas + segment * 2);
        const rangeOffsetPosition = rangeOffsets + segment * 2;
        const rangeOffset = view.getUint16(rangeOffsetPosition);

        for (let codepoint = Math.max(start, 0xe000); codepoint <= Math.min(end, 0xf8ff); codepoint++) {
          if (rangeOffset === 0) {
            add(codepoint, (codepoint + delta) & 0xffff);
            continue;
          }

          const address = rangeOffsetPosition + rangeOffset + 2 * (codepoint - start);

          if (address + 2 <= table.length) {
            const glyph = view.getUint16(address);
            add(codepoint, glyph === 0 ? 0 : (glyph + delta) & 0xffff);
          }
        }
      }
    }
  }

  return glyphs;
}

/** Glyph id -> name from a version 2.0 `post` table; other versions carry no names. */
function readGlyphNames(table: Uint8Array | undefined): Map<number, string> {
  const names = new Map<number, string>();

  if (!table || table.length < 34 || viewOf(table).getUint32(0) !== 0x00020000) {
    return names;
  }

  const view = viewOf(table);
  const glyphCount = view.getUint16(32);
  const strings: string[] = [];

  // Indices below 258 are the standard Macintosh names; the font's own come after.
  for (let position = 34 + glyphCount * 2; position < table.length; ) {
    const length = table[position];
    strings.push(ascii(table, position + 1, length));
    position += 1 + length;
  }

  for (let glyph = 0; glyph < glyphCount; glyph++) {
    const nameIndex = view.getUint16(34 + glyph * 2);

    if (nameIndex >= 258 && strings[nameIndex - 258] !== undefined) {
      names.set(glyph, strings[nameIndex - 258]);
    }
  }

  return names;
}

/**
 * The icons of a font: every Private Use codepoint it maps, in codepoint
 * order, with the glyph name where there is one. This is the catalogue of the
 * icon picker, taken from the font itself so nothing has to be shipped or
 * kept up to date for it. Empty for anything it cannot read.
 */
export function readIconGlyphs(bytes: Uint8Array): IconGlyph[] {
  try {
    const { tables } = readTables(bytes);
    const names = readGlyphNames(tables.get("post"));

    return [...readPrivateUseGlyphIds(tables.get("cmap"))]
      .sort((a, b) => a[0] - b[0])
      .map(([codepoint, glyphId]) => ({ codepoint, name: names.get(glyphId) ?? null }));
  } catch {
    return [];
  }
}
