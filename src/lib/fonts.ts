// The curated font catalog shared by the editor and every export format.
//
// The built-in list is deliberately closed rather than enumerating installed
// system fonts: a PDF can only render a face whose bytes are embedded (pdfmake
// ships Roboto and Courier and nothing else), so an arbitrary system font would
// look right in the editor and silently fall back in the PDF. Every built-in
// entry is bundled, so the same font reaches the editor, PDF, DOCX, ODT and
// HTML. Fonts the user imports (lib/customFonts.ts) obey the same rule by
// other means: the app holds their bytes, and the import refuses what the
// constraints below would break.
//
// All faces are OFL-1.1 (MIT-compatible) and come from @fontsource. Two
// constraints drove the selection, both verified against fontkit — pdfmake's
// font engine — in exportFonts.test.ts:
//   * only *static* families work; fontkit's subsetter cannot handle the
//     variable-font glyf table (the app's own Geist UI font is variable-only,
//     which is why it is not offered here),
//   * only the WOFF1 files are embeddable; WOFF2 stores glyf transformed and
//     subsetting throws. WOFF2 is still used for on-screen rendering, where no
//     subsetting happens — see loadStyles below.

import type { HeadingNumberingSettings } from "@/lib/editor/headingNumbers";
import type { FontCodepointRange } from "@/lib/fontFile";
import type { PageMarginId, PageSizeId } from "@/lib/pageSetup";

export const APP_FONT_IDS = [
  "system",
  "lato",
  "inter",
  "eb-garamond",
  "libre-baskerville",
  "merriweather",
  "courier-prime",
  "jetbrains-mono"
] as const;

export type BuiltinFontId = (typeof APP_FONT_IDS)[number];

/**
 * A font the user imported into the open vault (lib/customFonts.ts). The id is
 * derived from the family name, so importing the same family again replaces it.
 */
export type CustomFontId = `custom:${string}`;

export type AppFontId = BuiltinFontId | CustomFontId;

export const DEFAULT_FONT_ID: AppFontId = "system";

export type AppFontDefinition = {
  id: AppFontId;
  /** Proper font name. `null` for the system default, which the UI translates. */
  label: string | null;
  category: "sans" | "serif" | "mono";
  /** Family name on its own — DOCX and ODT store a plain font name. */
  familyName: string;
  /** Full CSS stack for the editor, HTML and EPUB output. */
  cssStack: string;
  /**
   * The face's own line height, (ascent - descent) / unitsPerEm, of the file
   * the PDF embeds (Roboto for the system default). pdfmake multiplies its
   * lineHeight with it, so the print needs it to reproduce the PDF's spacing.
   * exportFonts.test.ts checks every value against the font files.
   */
  pdfLineHeight: number;
  /**
   * Injects the @font-face rules for on-screen rendering. Loaded on demand so
   * six unused families cost nothing at startup; `null` for the system font,
   * whose face is already part of the app shell.
   */
  loadStyles: (() => Promise<unknown>) | null;
};

const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Consolas, monospace';

export const APP_FONTS: Record<BuiltinFontId, AppFontDefinition> = {
  system: {
    id: "system",
    label: null,
    category: "sans",
    familyName: "Geist",
    cssStack: `"Geist Variable", ${SANS_FALLBACK}`,
    pdfLineHeight: 1.1719,
    loadStyles: null
  },
  lato: {
    id: "lato",
    label: "Lato",
    category: "sans",
    familyName: "Lato",
    cssStack: `"Lato", ${SANS_FALLBACK}`,
    pdfLineHeight: 1.2,
    loadStyles: () =>
      Promise.all([
        import("@fontsource/lato/latin-400.css"),
        import("@fontsource/lato/latin-400-italic.css"),
        import("@fontsource/lato/latin-700.css"),
        import("@fontsource/lato/latin-700-italic.css")
      ])
  },
  inter: {
    id: "inter",
    label: "Inter",
    category: "sans",
    familyName: "Inter",
    cssStack: `"Inter", ${SANS_FALLBACK}`,
    pdfLineHeight: 1.21,
    loadStyles: () =>
      Promise.all([
        import("@fontsource/inter/latin-400.css"),
        import("@fontsource/inter/latin-400-italic.css"),
        import("@fontsource/inter/latin-700.css"),
        import("@fontsource/inter/latin-700-italic.css")
      ])
  },
  "eb-garamond": {
    id: "eb-garamond",
    label: "EB Garamond",
    category: "serif",
    familyName: "EB Garamond",
    cssStack: `"EB Garamond", ${SERIF_FALLBACK}`,
    pdfLineHeight: 1.305,
    loadStyles: () =>
      Promise.all([
        import("@fontsource/eb-garamond/latin-400.css"),
        import("@fontsource/eb-garamond/latin-400-italic.css"),
        import("@fontsource/eb-garamond/latin-700.css"),
        import("@fontsource/eb-garamond/latin-700-italic.css")
      ])
  },
  "libre-baskerville": {
    id: "libre-baskerville",
    label: "Libre Baskerville",
    category: "serif",
    familyName: "Libre Baskerville",
    cssStack: `"Libre Baskerville", ${SERIF_FALLBACK}`,
    pdfLineHeight: 1.24,
    loadStyles: () =>
      Promise.all([
        import("@fontsource/libre-baskerville/latin-400.css"),
        import("@fontsource/libre-baskerville/latin-400-italic.css"),
        import("@fontsource/libre-baskerville/latin-700.css"),
        import("@fontsource/libre-baskerville/latin-700-italic.css")
      ])
  },
  merriweather: {
    id: "merriweather",
    label: "Merriweather",
    category: "serif",
    familyName: "Merriweather",
    cssStack: `"Merriweather", ${SERIF_FALLBACK}`,
    pdfLineHeight: 1.257,
    loadStyles: () =>
      Promise.all([
        import("@fontsource/merriweather/latin-400.css"),
        import("@fontsource/merriweather/latin-400-italic.css"),
        import("@fontsource/merriweather/latin-700.css"),
        import("@fontsource/merriweather/latin-700-italic.css")
      ])
  },
  "courier-prime": {
    id: "courier-prime",
    label: "Courier Prime",
    category: "mono",
    familyName: "Courier Prime",
    cssStack: `"Courier Prime", ${MONO_FALLBACK}`,
    pdfLineHeight: 1.123,
    loadStyles: () =>
      Promise.all([
        import("@fontsource/courier-prime/latin-400.css"),
        import("@fontsource/courier-prime/latin-400-italic.css"),
        import("@fontsource/courier-prime/latin-700.css"),
        import("@fontsource/courier-prime/latin-700-italic.css")
      ])
  },
  "jetbrains-mono": {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    category: "mono",
    familyName: "JetBrains Mono",
    cssStack: `"JetBrains Mono", ${MONO_FALLBACK}`,
    pdfLineHeight: 1.32,
    loadStyles: () =>
      Promise.all([
        import("@fontsource/jetbrains-mono/latin-400.css"),
        import("@fontsource/jetbrains-mono/latin-400-italic.css"),
        import("@fontsource/jetbrains-mono/latin-700.css"),
        import("@fontsource/jetbrains-mono/latin-700-italic.css")
      ])
  }
};

// ---------------------------------------------------------------------------
// Document text size
// ---------------------------------------------------------------------------

/**
 * Body text size in points, for the document only — the app's own chrome keeps
 * its UI size. Distinct from the toolbar zoom, which scales the *view*: this
 * one is a property of the document and travels into every export.
 */
export const DEFAULT_FONT_SIZE_PT = 11;
export const FONT_SIZE_PT_MIN = 8;
export const FONT_SIZE_PT_MAX = 18;
export const FONT_SIZE_PT_STEP = 0.5;

export function clampFontSizePt(sizePt: number): number {
  if (!Number.isFinite(sizePt)) {
    return DEFAULT_FONT_SIZE_PT;
  }

  const stepped = Math.round(sizePt / FONT_SIZE_PT_STEP) * FONT_SIZE_PT_STEP;

  return Math.min(FONT_SIZE_PT_MAX, Math.max(FONT_SIZE_PT_MIN, stepped));
}

/**
 * The chosen size as a factor against the default, which every format applies
 * to its *own* body and heading sizes.
 *
 * Scaling rather than writing the point size straight into each format is
 * deliberate. The formats do not start from the same base — 10.5pt in the PDF,
 * 11pt in DOCX/ODT, 16px in HTML — and each has a heading hierarchy tuned
 * around that base. A factor moves the whole scale and keeps those
 * relationships intact; at the default it is exactly 1, so nothing about
 * today's output changes.
 */
export function getFontScale(sizePt: number): number {
  return clampFontSizePt(sizePt) / DEFAULT_FONT_SIZE_PT;
}

/**
 * Font family plus body size — what the editor and every renderer need.
 * Heading numbering rides along because it is the same kind of setting: one
 * app-wide choice the editor shows and every export has to reproduce.
 */
export type DocumentStyle = {
  fontId: AppFontId;
  fontSizePt: number;
  headingNumbering?: HeadingNumberingSettings;
  /**
   * Table width, mirroring the editor setting of the same name
   * (useEditorSettingsStore.tableWidth) so an exported table looks like the
   * one on screen. Markdown itself cannot carry this, so it travels with
   * the style rather than with the document. Omitted means "full".
   */
  tableWidth?: TableWidth;
  /**
   * The first table row looks like every other row, mirroring
   * useEditorSettingsStore.plainTableHeader. Display only, for the same reason
   * as the width: the file still carries its separator line. Omitted means the
   * usual bold header row.
   */
  plainTableHeader?: boolean;
  /**
   * Paper size and margin preset of every paged output (PDF, print, DOCX,
   * ODT), from the app-wide page setup (lib/pageSetup.ts). Omitted means A4
   * with normal margins, the PDF export's page before it was configurable.
   */
  pageSize?: PageSizeId;
  pageMargins?: PageMarginId;
};

/** @see DocumentStyle.tableWidth */
export type TableWidth = "full" | "content";

export const DEFAULT_DOCUMENT_STYLE: DocumentStyle = {
  fontId: DEFAULT_FONT_ID,
  fontSizePt: DEFAULT_FONT_SIZE_PT
};

/**
 * Font name for the formats that only *reference* a family instead of
 * embedding it (DOCX, ODT, EPUB). The system default resolves to Arial rather
 * than to the app's own Geist, which readers will not have installed.
 */
export function getReferencedFontName(fontId: AppFontId): string {
  const definition = getFontDefinition(fontId);
  return definition.id === "system" ? "Arial" : definition.familyName;
}

/** Generic CSS family a reader can substitute when the real face is missing. */
export function getGenericFamily(fontId: AppFontId): "sans-serif" | "serif" | "monospace" {
  const { category } = getFontDefinition(fontId);
  return category === "serif" ? "serif" : category === "mono" ? "monospace" : "sans-serif";
}

const CUSTOM_FONT_ID_PATTERN = /^custom:[a-z0-9][a-z0-9-]{0,63}$/;

export function isCustomFontId(value: unknown): value is CustomFontId {
  return typeof value === "string" && CUSTOM_FONT_ID_PATTERN.test(value);
}

/**
 * The stored choice as an id. A custom id is kept even while its font is not
 * known (yet): the choice is app-wide, the font lives in a vault, and opening
 * another vault must not forget what the user picked in this one.
 */
export function resolveFontId(value: string | null | undefined): AppFontId {
  if (isCustomFontId(value)) {
    return value;
  }

  return APP_FONT_IDS.includes(value as BuiltinFontId) ? (value as BuiltinFontId) : DEFAULT_FONT_ID;
}

// ---------------------------------------------------------------------------
// Fonts imported by the user
// ---------------------------------------------------------------------------

export type FontStyleName = "normal" | "bold" | "italics" | "bolditalics";

export const FONT_STYLE_NAMES: readonly FontStyleName[] = ["normal", "bold", "italics", "bolditalics"];

export type CustomFontDefinition = AppFontDefinition & {
  id: CustomFontId;
  /** Changes with every import, so a cache of the bytes never outlives a replaced font. */
  revision: string;
  /** Maps Private Use codepoints, i.e. carries icons (Nerd Fonts and the like). */
  hasIcons: boolean;
  /** The Private Use codepoints the font maps (see FontManifest.iconRanges). */
  iconRanges: FontCodepointRange[];
  /** Which of the four styles the user provided; `normal` is always there. */
  styles: Partial<Record<FontStyleName, true>>;
  /** Reads the bytes of one provided style from the vault. */
  readStyle: (style: FontStyleName) => Promise<Uint8Array>;
};

let customFonts = new Map<CustomFontId, CustomFontDefinition>();

/** Replaces the set of imported fonts, which is the one of the open vault. */
export function setCustomFonts(fonts: CustomFontDefinition[]): void {
  customFonts = new Map(fonts.map((font) => [font.id, font]));
}

export function getCustomFonts(): CustomFontDefinition[] {
  return [...customFonts.values()];
}

/**
 * Which of the user's files stands in for each of the four styles. PDF export
 * needs all four, but fonts often come with fewer: bold falls back to the
 * regular file rather than to a synthesized one, which pdfmake cannot make.
 */
export function fillStyleFallbacks(
  provided: Partial<Record<FontStyleName, true>>
): Record<FontStyleName, FontStyleName> {
  const has = (style: FontStyleName) => provided[style] === true;

  return {
    normal: "normal",
    bold: has("bold") ? "bold" : "normal",
    italics: has("italics") ? "italics" : "normal",
    bolditalics: has("bolditalics") ? "bolditalics" : has("bold") ? "bold" : has("italics") ? "italics" : "normal"
  };
}

/**
 * The definition behind an id. A custom font that is not in the open vault
 * resolves to the system font, so a note never renders in nothing and an
 * export never dies over a font that is not here.
 */
export function getFontDefinition(fontId: AppFontId): AppFontDefinition {
  if (isCustomFontId(fontId)) {
    return customFonts.get(fontId) ?? APP_FONTS.system;
  }

  return APP_FONTS[fontId] ?? APP_FONTS.system;
}

/**
 * The imported fonts that carry icons, other than `exceptId`. Their glyphs
 * live in the Private Use Areas, which no ordinary font covers, so a document
 * set in any font can show them by naming these as fallbacks.
 */
export function getIconFonts(exceptId?: AppFontId): CustomFontDefinition[] {
  return getCustomFonts().filter((font) => font.hasIcons && font.id !== exceptId);
}

/**
 * The font stack of the editor and the print: the chosen font, then the icon
 * fonts, then the stack's own fallbacks. Right after the first family and not
 * at the end, because a system font further down may map a Private Use
 * codepoint to some other icon of its own.
 */
export function getDocumentFontStack(fontId: AppFontId): string {
  const definition = getFontDefinition(fontId);
  const icons = getIconFonts(definition.id).map((font) => `"${font.familyName}"`);

  if (icons.length === 0) {
    return definition.cssStack;
  }

  const firstComma = definition.cssStack.indexOf(",");

  return firstComma < 0
    ? [definition.cssStack, ...icons].join(", ")
    : `${definition.cssStack.slice(0, firstComma)}, ${icons.join(", ")}${definition.cssStack.slice(firstComma)}`;
}

/** Loads the faces of the font and of the icon fonts its stack falls back to. */
export async function ensureDocumentFontLoaded(fontId: AppFontId): Promise<void> {
  const { id } = getFontDefinition(fontId);

  await Promise.all([ensureFontStylesLoaded(fontId), ...getIconFonts(id).map((font) => ensureFontStylesLoaded(font.id))]);
}

export function getCustomFontDefinition(fontId: AppFontId): CustomFontDefinition | null {
  return isCustomFontId(fontId) ? (customFonts.get(fontId) ?? null) : null;
}

const loadedFontKeys = new Set<string>();

/**
 * Makes the family's faces available to the webview. Idempotent — the styles
 * of a family already pulled in stay in the document, so switching back and
 * forth in the settings preview does not re-import. A custom font is keyed by
 * its revision as well, because replacing it has to load the new bytes.
 */
export async function ensureFontStylesLoaded(fontId: AppFontId): Promise<void> {
  const definition = getFontDefinition(fontId);
  const custom = getCustomFontDefinition(fontId);
  const key = custom ? `${custom.id}@${custom.revision}` : definition.id;

  if (loadedFontKeys.has(key)) {
    return;
  }

  if (!definition.loadStyles) {
    loadedFontKeys.add(key);
    return;
  }

  try {
    await definition.loadStyles();
    loadedFontKeys.add(key);
  } catch {
    // A missing face falls back to the stack's generic family; a failed
    // stylesheet import must never take the editor down with it.
  }
}
