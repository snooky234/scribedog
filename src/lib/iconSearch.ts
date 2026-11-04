// What the icon picker does with the glyph list of a font: group it by the
// name prefix, search it, label it. Pure, so it is tested without a font.
//
// Icon fonts name their glyphs "<set>-<icon>" (Nerd Fonts: "fa-code",
// "md-cube_outline", "seti-typescript", "linux-docker"), which is where the
// groups come from; nothing is listed or maintained here.

import type { IconGlyph } from "@/lib/fontFile";

export type IconGroup = { prefix: string; count: number };

const MIN_GROUP_SIZE = 20;
const MAX_GROUPS = 12;

export function glyphPrefix(glyph: IconGlyph): string | null {
  const match = glyph.name ? /^([a-z0-9]+)[-_]/i.exec(glyph.name) : null;

  return match ? match[1].toLowerCase() : null;
}

/** The icon sets of a font, largest first; empty when there is nothing to choose between. */
export function glyphGroups(glyphs: IconGlyph[]): IconGroup[] {
  const counts = new Map<string, number>();

  for (const glyph of glyphs) {
    const prefix = glyphPrefix(glyph);

    if (prefix) {
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }

  const groups = [...counts]
    .filter(([, count]) => count >= MIN_GROUP_SIZE)
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix))
    .slice(0, MAX_GROUPS);

  return groups.length >= 2 ? groups : [];
}

export const codepointLabel = (codepoint: number) => `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;

/** "linux-docker", or the codepoint for a glyph the font did not name. */
export function glyphLabel(glyph: IconGlyph): string {
  return glyph.name ?? codepointLabel(glyph.codepoint);
}

/**
 * The glyphs matching a search and, optionally, one icon set. Every word of
 * the query has to be in the name ("docker linux"), and a hex number finds
 * the codepoint, with or without "U+".
 */
export function filterGlyphs(glyphs: IconGlyph[], query: string, prefix: string | null): IconGlyph[] {
  const words = query.toLowerCase().split(/[\s_-]+/).filter(Boolean);

  if (words.length === 0 && prefix === null) {
    return glyphs;
  }

  return glyphs.filter((glyph) => {
    if (prefix !== null && glyphPrefix(glyph) !== prefix) {
      return false;
    }

    const name = (glyph.name ?? "").toLowerCase().replace(/[_-]+/g, " ");
    const hex = glyph.codepoint.toString(16);

    return words.every((word) => name.includes(word) || hex === word.replace(/^u\+/, ""));
  });
}
