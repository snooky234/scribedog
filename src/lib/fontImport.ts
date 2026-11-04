// The pure half of importing fonts: which of the chosen files belong together,
// which file plays which of the four styles, and the manifest that is stored
// next to them. No filesystem and no DOM here, so all of it is unit-tested;
// lib/customFonts.ts does the reading and writing.

import type { FontStyleName, CustomFontId } from "@/lib/fonts";
import type { FontCodepointRange, FontInspection } from "@/lib/fontFile";

export type InspectedFontFile = {
  fileName: string;
  bytes: Uint8Array;
  font: FontInspection;
};

export type FontFamilyImport = {
  id: CustomFontId;
  /** Display name, also the CSS family and the name DOCX and ODT reference. */
  name: string;
  category: "sans" | "serif" | "mono";
  pdfLineHeight: number;
  hasIcons: boolean;
  /** The Private Use codepoints of the regular file; see FontManifest.iconRanges. */
  iconRanges: FontCodepointRange[];
  files: Partial<Record<FontStyleName, InspectedFontFile>>;
};

export type FontManifest = {
  version: 1;
  name: string;
  category: "sans" | "serif" | "mono";
  pdfLineHeight: number;
  hasIcons: boolean;
  /**
   * Which Private Use codepoints the font maps. Kept in the manifest so a
   * document that uses an icon from a font other than its own can be matched
   * to that font without opening a multi-megabyte file to find out.
   */
  iconRanges: FontCodepointRange[];
  /** Changes with every import; see CustomFontDefinition.revision. */
  revision: string;
  /** Style -> file name inside the font's own folder. `normal` is always present. */
  files: Partial<Record<FontStyleName, string>>;
};

const MAX_NAME_LENGTH = 80;
const FILE_NAME_PATTERN = /^(normal|bold|italics|bolditalics)\.(ttf|woff)$/;

/**
 * A family name as it may travel into CSS, XML and file names. The name comes
 * from a file the user picked, but a font from the internet is not trusted for
 * quotes, angle brackets or semicolons that would end up in a stylesheet.
 */
export function sanitizeFontName(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} ._+\-()]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/** "0xProto Nerd Font" -> "0xproto-nerd-font": the folder name and the id suffix. */
export function slugifyFontName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return slug === "" ? "font" : slug;
}

export function fontIdForName(name: string): CustomFontId {
  return `custom:${slugifyFontName(name)}`;
}

export function slugOfFontId(id: CustomFontId): string {
  return id.slice("custom:".length);
}

function closestTo(files: InspectedFontFile[], target: number): InspectedFontFile | undefined {
  return [...files].sort(
    (a, b) => Math.abs(a.font.weight - target) - Math.abs(b.font.weight - target)
  )[0];
}

/**
 * Sorts the files of one family into the four styles the document uses. A
 * family often ships more weights than that (Light, Medium, Black); the ones
 * closest to regular and bold are taken and the rest ignored. A family
 * without a regular file promotes whatever it has, so a font that only comes
 * in bold still works.
 */
function assignStyles(files: InspectedFontFile[]): Partial<Record<FontStyleName, InspectedFontFile>> {
  const upright = files.filter((file) => !file.font.italic);
  const slanted = files.filter((file) => file.font.italic);
  const styles: Partial<Record<FontStyleName, InspectedFontFile>> = {
    normal: closestTo(upright.filter((file) => file.font.weight < 600), 400),
    bold: closestTo(upright.filter((file) => file.font.weight >= 600), 700),
    italics: closestTo(slanted.filter((file) => file.font.weight < 600), 400),
    bolditalics: closestTo(slanted.filter((file) => file.font.weight >= 600), 700)
  };

  if (!styles.normal) {
    const promoted = (["bold", "italics", "bolditalics"] as const).find((style) => styles[style]);

    if (promoted) {
      styles.normal = styles[promoted];
      delete styles[promoted];
    }
  }

  for (const style of Object.keys(styles) as FontStyleName[]) {
    if (!styles[style]) {
      delete styles[style];
    }
  }

  return styles;
}

/**
 * Groups the inspected files by family. Choosing the nine files of a Nerd Font
 * download at once therefore gives three fonts (regular, Mono, Propo), each
 * with its own styles.
 */
export function groupIntoFamilies(files: InspectedFontFile[]): FontFamilyImport[] {
  const byName = new Map<string, InspectedFontFile[]>();

  for (const file of files) {
    const name = sanitizeFontName(file.font.familyName);

    if (name === "") {
      continue;
    }

    byName.set(name, [...(byName.get(name) ?? []), file]);
  }

  const families: FontFamilyImport[] = [];

  for (const [name, members] of byName) {
    const styles = assignStyles(members);
    const regular = styles.normal;

    if (!regular) {
      continue;
    }

    families.push({
      id: fontIdForName(name),
      name,
      category: regular.font.monospace ? "mono" : regular.font.serif ? "serif" : "sans",
      pdfLineHeight: regular.font.pdfLineHeight,
      hasIcons: members.some((file) => file.font.hasIcons),
      iconRanges: regular.font.privateUseRanges,
      files: styles
    });
  }

  return families;
}

export function storedFileName(style: FontStyleName, file: InspectedFontFile): string {
  return `${style}.${file.font.container === "woff" ? "woff" : "ttf"}`;
}

export function createManifest(family: FontFamilyImport, revision: string): FontManifest {
  const files: Partial<Record<FontStyleName, string>> = {};

  for (const style of Object.keys(family.files) as FontStyleName[]) {
    const file = family.files[style];

    if (file) {
      files[style] = storedFileName(style, file);
    }
  }

  return {
    version: 1,
    name: family.name,
    category: family.category,
    pdfLineHeight: family.pdfLineHeight,
    hasIcons: family.hasIcons,
    iconRanges: family.iconRanges,
    revision,
    files
  };
}

const MAX_ICON_RANGES = 4000;

function normalizeRanges(value: unknown): FontCodepointRange[] {
  if (!Array.isArray(value) || value.length > MAX_ICON_RANGES) {
    return [];
  }

  const ranges: FontCodepointRange[] = [];

  for (const entry of value) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !Number.isInteger(entry[0]) ||
      !Number.isInteger(entry[1]) ||
      entry[0] < 0 ||
      entry[1] < entry[0] ||
      entry[1] > 0x10ffff
    ) {
      return [];
    }

    ranges.push([entry[0], entry[1]]);
  }

  return ranges;
}

/**
 * A manifest read back from the vault, or null when it is not one. Strict,
 * because the vault can be edited by hand or synced from elsewhere, and the
 * file names in it are joined onto a path: only the names this module writes
 * are accepted, never anything with a separator in it.
 */
export function normalizeManifest(value: unknown): FontManifest | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? sanitizeFontName(record.name) : "";
  const category = record.category;
  const lineHeight = record.pdfLineHeight;
  const rawFiles = record.files;

  if (
    name === "" ||
    (category !== "sans" && category !== "serif" && category !== "mono") ||
    typeof lineHeight !== "number" ||
    !Number.isFinite(lineHeight) ||
    lineHeight < 0.5 ||
    lineHeight > 4 ||
    typeof rawFiles !== "object" ||
    rawFiles === null
  ) {
    return null;
  }

  const files: Partial<Record<FontStyleName, string>> = {};

  for (const style of ["normal", "bold", "italics", "bolditalics"] as const) {
    const fileName = (rawFiles as Record<string, unknown>)[style];

    if (fileName === undefined) {
      continue;
    }

    const match = typeof fileName === "string" ? FILE_NAME_PATTERN.exec(fileName) : null;

    if (!match || match[1] !== style) {
      return null;
    }

    files[style] = fileName as string;
  }

  if (!files.normal) {
    return null;
  }

  return {
    version: 1,
    name,
    category,
    pdfLineHeight: lineHeight,
    hasIcons: record.hasIcons === true,
    iconRanges: normalizeRanges(record.iconRanges),
    revision: typeof record.revision === "string" ? record.revision.slice(0, 40) : "0",
    files
  };
}
