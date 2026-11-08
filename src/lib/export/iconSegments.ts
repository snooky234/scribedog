// Splits text into runs by the icon font that has their glyphs. pdfmake picks
// one font per run and has no per-character fallback, so an icon from a font
// other than the document's has to be tagged with that font, the same way
// emoji are (emojiSegments.ts). The editor and the print do not need this:
// the browser falls back per character along the font stack.

import type { FontCodepointRange } from "@/lib/fontFile";

export type PdfIconFont = {
  /** The name the font is registered under in pdfmake. */
  name: string;
  ranges: FontCodepointRange[];
  /**
   * The icon size the user set for the font (1 = as drawn). The webview scales
   * the face itself (size-adjust); pdfmake cannot, so the runs set in this font
   * get a proportionally larger font size instead (see iconFontSize).
   */
  scale?: number;
};

/**
 * The size of an icon run: the size of the text it sits in, times the font's
 * icon scale. pdfmake only knows absolute sizes, so the surrounding size has
 * to be handed in; null means the run keeps whatever it inherits.
 */
export function iconFontSize(surroundingPt: number, icons: PdfIconFont[], fontName: string | null): number | null {
  const scale = fontName ? icons.find((icon) => icon.name === fontName)?.scale : undefined;

  if (!scale || scale === 1) {
    return null;
  }

  return Math.round(surroundingPt * scale * 100) / 100;
}

export type IconSegment = {
  text: string;
  /** The icon font to set the run in; null for text in the document's own font. */
  font: string | null;
};

const PRIVATE_USE: FontCodepointRange[] = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd]
];

const inRanges = (ranges: FontCodepointRange[], codepoint: number) =>
  ranges.some(([start, end]) => codepoint >= start && codepoint <= end);

export function splitIconSegments(text: string, fonts: PdfIconFont[]): IconSegment[] {
  if (!text || fonts.length === 0) {
    return text ? [{ text, font: null }] : [];
  }

  const segments: IconSegment[] = [];

  for (const char of text) {
    const codepoint = char.codePointAt(0) ?? 0;
    const font = inRanges(PRIVATE_USE, codepoint)
      ? (fonts.find((candidate) => inRanges(candidate.ranges, codepoint))?.name ?? null)
      : null;
    const last = segments[segments.length - 1];

    if (last && last.font === font) {
      last.text += char;
    } else {
      segments.push({ text: char, font });
    }
  }

  return segments;
}
