/**
 * Paper size and margins, shared by every paged output: the PDF export, the
 * direct print, DOCX and ODT. One app-wide choice (useEditorSettingsStore),
 * never per document: ScribeDog reads no front matter, and a setting the
 * export dialog could override would let the printed pages drift away from
 * what the PDF shows.
 *
 * All measures are kept in PostScript points (1/72 inch), the PDF's own
 * unit; the converters below produce what the other formats want.
 */

export const PAGE_SIZE_IDS = ["a4", "letter", "a5", "legal"] as const;
export type PageSizeId = (typeof PAGE_SIZE_IDS)[number];

export const PAGE_MARGIN_IDS = ["normal", "narrow", "wide"] as const;
export type PageMarginId = (typeof PAGE_MARGIN_IDS)[number];

export const DEFAULT_PAGE_SIZE: PageSizeId = "a4";
export const DEFAULT_PAGE_MARGINS: PageMarginId = "normal";

type PageDimensions = { widthPt: number; heightPt: number };

// ISO sizes in mm converted to pt (the values pdfmake uses itself), the two
// North American ones are whole inches.
const PAGE_SIZES: Record<PageSizeId, PageDimensions> = {
  a4: { widthPt: 595.28, heightPt: 841.89 },
  letter: { widthPt: 612, heightPt: 792 },
  a5: { widthPt: 419.53, heightPt: 595.28 },
  legal: { widthPt: 612, heightPt: 1008 }
};

// The @page size keyword per format. A keyword rather than a length, so the
// print dialog preselects the matching paper instead of a custom size.
const CSS_PAGE_SIZES: Record<PageSizeId, string> = {
  a4: "A4",
  letter: "letter",
  a5: "A5",
  legal: "legal"
};

export type PageMargins = { top: number; right: number; bottom: number; left: number };

// Word's presets: Normal 2.54 cm all round (the 72pt the PDF export always
// had), Narrow 1.27 cm, Wide 3.18 cm left and right.
const PAGE_MARGINS: Record<PageMarginId, PageMargins> = {
  normal: { top: 72, right: 72, bottom: 72, left: 72 },
  narrow: { top: 36, right: 36, bottom: 36, left: 36 },
  wide: { top: 72, right: 90, bottom: 72, left: 90 }
};

/** Translation keys of the paper sizes, for the settings and the export dialog. */
export const PAGE_SIZE_LABEL_KEYS: Record<PageSizeId, string> = {
  a4: "settingsDialog.pageSizeA4",
  letter: "settingsDialog.pageSizeLetter",
  a5: "settingsDialog.pageSizeA5",
  legal: "settingsDialog.pageSizeLegal"
};

/** The paper's name alone, for the page lines toggle ("PDF, A4"). */
export const PAGE_SIZE_SHORT_LABELS: Record<PageSizeId, string> = {
  a4: "A4",
  letter: "US Letter",
  a5: "A5",
  legal: "US Legal"
};

export const PAGE_MARGIN_LABEL_KEYS: Record<PageMarginId, string> = {
  normal: "settingsDialog.pageMarginsNormal",
  narrow: "settingsDialog.pageMarginsNarrow",
  wide: "settingsDialog.pageMarginsWide"
};

export type PageLayout = {
  size: PageSizeId;
  widthPt: number;
  heightPt: number;
  margins: PageMargins;
  /** Width between the left and right margin. */
  contentWidthPt: number;
  /** Height between the top and bottom margin. */
  contentHeightPt: number;
};

export function resolvePageSize(value: string | null | undefined): PageSizeId | null {
  return PAGE_SIZE_IDS.includes(value as PageSizeId) ? (value as PageSizeId) : null;
}

export function resolvePageMargins(value: string | null | undefined): PageMarginId {
  return PAGE_MARGIN_IDS.includes(value as PageMarginId) ? (value as PageMarginId) : DEFAULT_PAGE_MARGINS;
}

export function getPageLayout(
  size: PageSizeId = DEFAULT_PAGE_SIZE,
  margins: PageMarginId = DEFAULT_PAGE_MARGINS
): PageLayout {
  const { widthPt, heightPt } = PAGE_SIZES[size];
  const pageMargins = PAGE_MARGINS[margins];

  return {
    size,
    widthPt,
    heightPt,
    margins: { ...pageMargins },
    contentWidthPt: widthPt - pageMargins.left - pageMargins.right,
    contentHeightPt: heightPt - pageMargins.top - pageMargins.bottom
  };
}

/**
 * The regions that print on US Letter (CLDR's paper size data). Everything
 * else uses A4.
 */
const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "PR", "CL", "CO", "VE", "CR", "GT", "PA", "SV", "NI", "BZ"]);

/**
 * The paper size to start with, from the region of a language tag
 * (navigator.language). The language alone says nothing: "en" is written on
 * Letter in the US and on A4 in the UK, "es" on Letter in Mexico and on A4
 * in Spain, so a tag without a region gets A4.
 */
export function defaultPageSizeForLocale(locale: string | null | undefined): PageSizeId {
  if (!locale) {
    return DEFAULT_PAGE_SIZE;
  }

  let region: string | undefined;

  try {
    region = new Intl.Locale(locale).region;
  } catch {
    // An invalid tag is no reason to fail; the pattern below still finds
    // the region of "en_US"-style spellings.
  }

  region ??= /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(locale)?.[1];

  return region && LETTER_REGIONS.has(region.toUpperCase()) ? "letter" : DEFAULT_PAGE_SIZE;
}

const PT_PER_CM = 72 / 2.54;

export function ptToCm(pt: number): number {
  return pt / PT_PER_CM;
}

/** Twentieths of a point, the unit of DOCX page and margin sizes. */
export function ptToTwips(pt: number): number {
  return Math.round(pt * 20);
}

/** CSS pixels at 96 dpi, the unit the exporters size images in. */
export function ptToPx(pt: number): number {
  return (pt * 96) / 72;
}

/** Length for ODF attributes ("2.540cm"). */
export function formatCm(pt: number): string {
  return `${ptToCm(pt).toFixed(3)}cm`;
}

/**
 * The @page rule for the direct print. Written into a <style> element rather
 * than print.css: @page does not reliably resolve custom properties.
 */
export function pageCssRule(layout: PageLayout): string {
  const { top, right, bottom, left } = layout.margins;

  return `@page { size: ${CSS_PAGE_SIZES[layout.size]} portrait; margin: ${top}pt ${right}pt ${bottom}pt ${left}pt; }`;
}
