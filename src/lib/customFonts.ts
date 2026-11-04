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

async function loadFontFaces(definition: CustomFontDefinition): Promise<void> {
  forgetFaces(definition.id);

  const faces: FontFace[] = [];

  for (const style of FONT_STYLE_NAMES) {
    if (!definition.styles[style]) {
      continue;
    }

    const bytes = await definition.readStyle(style);
    const face = new FontFace(definition.familyName, bytes, {
      weight: style === "bold" || style === "bolditalics" ? "700" : "400",
      style: style === "italics" || style === "bolditalics" ? "italic" : "normal"
    });

    await face.load();
    document.fonts.add(face);
    faces.push(face);
  }

  loadedFaces.set(definition.id, faces);
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
    const manifest = createManifest(family, Date.now().toString(36));

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
  forgetFaces(id);

  const dirPath = await fontDirPath(folderPath, id);

  if (await exists(dirPath)) {
    await remove(dirPath, { recursive: true });
  }
}
