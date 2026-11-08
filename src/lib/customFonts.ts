// Fonts the user imports live in the vault, in `.scribedog/fonts/<name>/`: one
// folder per family with a `font.json` manifest and up to four font files.
// Keeping them in the vault (rather than in the app's config folder) is what
// makes them work in the server edition too — the browser reads them through
// the same storage primitives as a note — and what lets them travel with the
// notes that use them. The selection itself stays app-wide; a vault without
// the font falls back to the system font and picks the choice up again when
// the font is back (lib/fonts.ts, resolveFontId).

import { join } from "@/platform/paths";
import { exists, mkdir, readDir, readFile, readTextFile, remove, writeFile, writeTextFile } from "@/platform/vaultFs";

import { VAULT_META_DIR_NAME } from "@/lib/fileSystem";
import { inspectFont, readIconGlyphs, type FontRejection, type IconGlyph } from "@/lib/fontFile";
import {
  clampIconScale,
  createManifest,
  groupIntoFamilies,
  normalizeManifest,
  slugOfFontId,
  storedFileName,
  type FontManifest,
  type InspectedFontFile
} from "@/lib/fontImport";
import {
  FONT_STYLE_NAMES,
  isCustomFontId,
  type CustomFontDefinition,
  type CustomFontId,
  type FontStyleName
} from "@/lib/fonts";

export const FONTS_DIR_NAME = "fonts";
const MANIFEST_FILE_NAME = "font.json";

const FALLBACK_STACKS = {
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: "ui-monospace, SFMono-Regular, Consolas, monospace"
} as const;

export type FontImportFile = { name: string; bytes: Uint8Array };

export type FontImportReport = {
  /** Display names of the fonts that were stored (new or replaced). */
  imported: string[];
  rejected: { fileName: string; reason: FontRejection }[];
};

async function fontsDirPath(folderPath: string): Promise<string> {
  return join(folderPath, VAULT_META_DIR_NAME, FONTS_DIR_NAME);
}

async function fontDirPath(folderPath: string, id: CustomFontId): Promise<string> {
  return join(await fontsDirPath(folderPath), slugOfFontId(id));
}

// The faces handed to the webview, per font, so that replacing or removing a
// font takes the old ones out of document.fonts again.
const loadedFaces = new Map<CustomFontId, FontFace[]>();

function forgetFaces(id: CustomFontId): void {
  for (const face of loadedFaces.get(id) ?? []) {
    document.fonts.delete(face);
  }

  loadedFaces.delete(id);
}

/**
 * The icon size as a face descriptor, `size-adjust`: the browser scales the
 * glyphs of the face and their advance widths, which is how the setting
 * reaches the editor, the file tree and the print at once, since they only
 * name the family. Not in the lib.dom typings of every TypeScript version,
 * hence the widened type.
 */
function sizeAdjustDescriptor(scale: number): Record<string, string> {
  return { sizeAdjust: `${Math.round(scale * 100)}%` };
}

function unicodeRangeDescriptor(ranges: [number, number][]): string {
  return ranges
    .map(([start, end]) => (start === end ? `U+${start.toString(16)}` : `U+${start.toString(16)}-${end.toString(16)}`))
    .join(", ");
}

async function addFontFaces(definition: CustomFontDefinition): Promise<void> {
  forgetFaces(definition.id);

  const faces: FontFace[] = [];
  const scaled = definition.iconScale !== 1 && definition.iconRanges.length > 0;

  for (const style of FONT_STYLE_NAMES) {
    if (!definition.styles[style]) {
      continue;
    }

    const bytes = await definition.readStyle(style);
    const descriptors = {
      weight: style === "bold" || style === "bolditalics" ? "700" : "400",
      style: style === "italics" || style === "bolditalics" ? "italic" : "normal"
    };
    const face = new FontFace(definition.familyName, bytes, descriptors);

    await face.load();
    document.fonts.add(face);
    faces.push(face);

    // The size applies to the icons only. A second face over the same bytes
    // covers just the Private Use codepoints the font maps and is added after
    // the plain one, which wins where they overlap: a font that is also the
    // document's own font keeps its letters at their size, and the PDF, which
    // scales icon runs and nothing else, comes out the same.
    if (scaled) {
      const iconFace = new FontFace(definition.familyName, bytes, {
        ...descriptors,
        ...sizeAdjustDescriptor(definition.iconScale),
        unicodeRange: unicodeRangeDescriptor(definition.iconRanges)
      });

      await iconFace.load();
      document.fonts.add(iconFace);
      faces.push(iconFace);
    }
  }

  loadedFaces.set(definition.id, faces);
}

// The load of each font, by revision. Several parts of the app ask for the
// same font at once (the cards, the editor, the icon fallback), and two loads
// running side by side would each add a face of their own while only the last
// one is remembered: the other would stay in the document for good and, at an
// icon size that has since changed, answer for the family with the old size.
// One load per revision, and a newer revision waits for the one before it.
const loading = new Map<CustomFontId, { revision: string; promise: Promise<void> }>();

function loadFontFaces(definition: CustomFontDefinition): Promise<void> {
  const current = loading.get(definition.id);

  if (current && current.revision === definition.revision) {
    return current.promise;
  }

  const previous = current ? current.promise.catch(() => undefined) : Promise.resolve();
  const promise = previous.then(() => addFontFaces(definition));

  loading.set(definition.id, { revision: definition.revision, promise });
  // A failed load is not kept, so the next request tries again.
  promise.catch(() => {
    if (loading.get(definition.id)?.promise === promise) {
      loading.delete(definition.id);
    }
  });

  return promise;
}

function createDefinition(dirPath: string, manifest: FontManifest, id: CustomFontId): CustomFontDefinition {
  const styles: Partial<Record<FontStyleName, true>> = {};

  for (const style of FONT_STYLE_NAMES) {
    if (manifest.files[style]) {
      styles[style] = true;
    }
  }

  const definition: CustomFontDefinition = {
    id,
    label: manifest.name,
    category: manifest.category,
    familyName: manifest.name,
    cssStack: `"${manifest.name}", ${FALLBACK_STACKS[manifest.category]}`,
    pdfLineHeight: manifest.pdfLineHeight,
    revision: manifest.revision,
    hasIcons: manifest.hasIcons,
    iconRanges: manifest.iconRanges,
    iconScale: manifest.iconScale,
    styles,
    readStyle: async (style) => {
      const fileName = manifest.files[style];

      if (!fileName) {
        throw new Error(`Font ${manifest.name} has no ${style} file`);
      }

      return readFile(await join(dirPath, fileName));
    },
    loadStyles: () => loadFontFaces(definition)
  };

  return definition;
}

async function readManifest(dirPath: string): Promise<FontManifest | null> {
  try {
    return normalizeManifest(JSON.parse(await readTextFile(await join(dirPath, MANIFEST_FILE_NAME))));
  } catch {
    return null;
  }
}

/**
 * Stores the icon size of a font. Only the manifest is rewritten, with a new
 * revision: the faces in the webview and the bytes the PDF registered are
 * keyed by it, so the new size is picked up without a second import.
 */
export async function setCustomFontIconScale(folderPath: string, id: CustomFontId, scale: number): Promise<void> {
  const dirPath = await fontDirPath(folderPath, id);
  const manifest = await readManifest(dirPath);

  if (!manifest) {
    throw new Error(`Font ${id} has no readable manifest`);
  }

  const next: FontManifest = {
    ...manifest,
    iconScale: clampIconScale(scale),
    revision: Date.now().toString(36)
  };

  await writeTextFile(await join(dirPath, MANIFEST_FILE_NAME), JSON.stringify(next, null, 2));
}

const PREVIEW_FAMILY = "ScribeDog Icon Size Preview";
let previewFace: FontFace | null = null;

/**
 * Loads the regular file of an icon font under a family name of its own, at
 * the given size, for the preview next to the slider. The real faces stay as
 * they are until the user saves; dragging the slider only swaps this one.
 */
export async function loadIconScalePreview(bytes: Uint8Array, scale: number): Promise<string> {
  const face = new FontFace(PREVIEW_FAMILY, bytes, sizeAdjustDescriptor(clampIconScale(scale)));

  await face.load();

  if (previewFace) {
    document.fonts.delete(previewFace);
  }

  document.fonts.add(face);
  previewFace = face;

  return PREVIEW_FAMILY;
}

export function disposeIconScalePreview(): void {
  if (previewFace) {
    document.fonts.delete(previewFace);
    previewFace = null;
  }
}

/** The fonts stored in the vault, ordered by name. A damaged entry is skipped, never fatal. */
export async function loadCustomFonts(folderPath: string): Promise<CustomFontDefinition[]> {
  try {
    const fontsDir = await fontsDirPath(folderPath);

    if (!(await exists(fontsDir))) {
      return [];
    }

    const fonts: CustomFontDefinition[] = [];

    for (const entry of await readDir(fontsDir)) {
      if (!entry.isDirectory) {
        continue;
      }

      try {
        const dirPath = await join(fontsDir, entry.name);
        const manifest = normalizeManifest(JSON.parse(await readTextFile(await join(dirPath, MANIFEST_FILE_NAME))));

        const id = `custom:${entry.name}`;

        if (manifest && isCustomFontId(id)) {
          fonts.push(createDefinition(dirPath, manifest, id));
        }
      } catch {
        // No manifest or not JSON: not one of ours.
      }
    }

    return fonts.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
  } catch {
    return [];
  }
}

/**
 * Stores the chosen files. Files that cannot be embedded in a PDF are
 * reported, not stored; the rest is grouped into families and written, each
 * replacing an earlier import of the same family.
 */
export async function importFontFiles(folderPath: string, files: FontImportFile[]): Promise<FontImportReport> {
  const inspected: InspectedFontFile[] = [];
  const rejected: FontImportReport["rejected"] = [];

  for (const file of files) {
    const result = inspectFont(file.bytes);

    if (result.ok) {
      inspected.push({ fileName: file.name, bytes: file.bytes, font: result.font });
    } else {
      rejected.push({ fileName: file.name, reason: result.reason });
    }
  }

  const imported: string[] = [];
  const fontsDir = await fontsDirPath(folderPath);

  for (const family of groupIntoFamilies(inspected)) {
    const dirPath = await join(fontsDir, slugOfFontId(family.id));
    // Importing the same family again (a newer version of the font) keeps the
    // icon size the user chose for it.
    const previous = await readManifest(dirPath);
    const manifest = createManifest(family, Date.now().toString(36), previous?.iconScale);

    // An earlier import of this family may have had files this one lacks.
    if (await exists(dirPath)) {
      await remove(dirPath, { recursive: true });
    }

    await mkdir(dirPath, { recursive: true });

    for (const style of FONT_STYLE_NAMES) {
      const file = family.files[style];

      if (file) {
        await writeFile(await join(dirPath, storedFileName(style, file)), file.bytes);
      }
    }

    // The manifest goes last: a font whose files are not all there yet is not listed.
    await writeTextFile(await join(dirPath, MANIFEST_FILE_NAME), JSON.stringify(manifest, null, 2));
    imported.push(family.name);
  }

  return { imported, rejected };
}

const glyphCache = new Map<string, Promise<IconGlyph[]>>();

/**
 * The icons of an imported font, for the picker. Read from the regular file
 * once per revision: a Nerd Font has some ten thousand of them, which takes
 * a moment, not something to repeat on every opening of the picker.
 */
export function loadIconGlyphs(font: CustomFontDefinition): Promise<IconGlyph[]> {
  const key = `${font.id}@${font.revision}`;
  let glyphs = glyphCache.get(key);

  if (!glyphs) {
    glyphs = font.readStyle("normal").then(readIconGlyphs);
    glyphs.catch(() => glyphCache.delete(key));
    glyphCache.set(key, glyphs);
  }

  return glyphs;
}

export async function removeCustomFont(folderPath: string, id: CustomFontId): Promise<void> {
  loading.delete(id);
  forgetFaces(id);

  const dirPath = await fontDirPath(folderPath, id);

  if (await exists(dirPath)) {
    await remove(dirPath, { recursive: true });
  }
}
