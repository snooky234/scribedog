// The curated font catalog shared by the editor and every export format.
//
// The list is deliberately closed rather than enumerating installed system
// fonts: a PDF can only render a face whose bytes are embedded (pdfmake ships
// Roboto and Courier and nothing else), so an arbitrary system font would look
// right in the editor and silently fall back in the PDF. Every entry here is
// bundled, so the same font reaches the editor, PDF, DOCX, ODT and HTML.
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

export type AppFontId = (typeof APP_FONT_IDS)[number];

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
   * Injects the @font-face rules for on-screen rendering. Loaded on demand so
   * six unused families cost nothing at startup; `null` for the system font,
   * whose face is already part of the app shell.
   */
  loadStyles: (() => Promise<unknown>) | null;
};

const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Consolas, monospace';

export const APP_FONTS: Record<AppFontId, AppFontDefinition> = {
  system: {
    id: "system",
    label: null,
    category: "sans",
    familyName: "Geist",
    cssStack: `"Geist Variable", ${SANS_FALLBACK}`,
    loadStyles: null
  },
  lato: {
    id: "lato",
    label: "Lato",
    category: "sans",
    familyName: "Lato",
    cssStack: `"Lato", ${SANS_FALLBACK}`,
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

/** Font family plus body size — what the editor and every renderer need. */
export type DocumentStyle = {
  fontId: AppFontId;
  fontSizePt: number;
};

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
  return fontId === "system" ? "Arial" : APP_FONTS[fontId].familyName;
}

/** Generic CSS family a reader can substitute when the real face is missing. */
export function getGenericFamily(fontId: AppFontId): "sans-serif" | "serif" | "monospace" {
  const { category } = APP_FONTS[fontId];
  return category === "serif" ? "serif" : category === "mono" ? "monospace" : "sans-serif";
}

export function resolveFontId(value: string | null | undefined): AppFontId {
  return APP_FONT_IDS.includes(value as AppFontId) ? (value as AppFontId) : DEFAULT_FONT_ID;
}

export function getFontDefinition(fontId: AppFontId): AppFontDefinition {
  return APP_FONTS[fontId];
}

const loadedFontIds = new Set<AppFontId>();

/**
 * Makes the family's faces available to the webview. Idempotent — the styles
 * of a family already pulled in stay in the document, so switching back and
 * forth in the settings preview does not re-import.
 */
export async function ensureFontStylesLoaded(fontId: AppFontId): Promise<void> {
  if (loadedFontIds.has(fontId)) {
    return;
  }

  const definition = APP_FONTS[fontId];

  if (!definition.loadStyles) {
    loadedFontIds.add(fontId);
    return;
  }

  try {
    await definition.loadStyles();
    loadedFontIds.add(fontId);
  } catch {
    // A missing face falls back to the stack's generic family; a failed
    // stylesheet import must never take the editor down with it.
  }
}
