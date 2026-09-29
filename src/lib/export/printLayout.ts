import { APP_FONTS, getFontScale, type AppFontId } from "@/lib/fonts";

import {
  COURIER_PDF_LINE_HEIGHT,
  PDF_BLOCK_MARGIN,
  PDF_BODY_SIZE_PT,
  PDF_CODE_INSET,
  PDF_CODE_SIZE_PT,
  PDF_HEADINGS,
  PDF_HR_MARGIN,
  PDF_IMAGE_MARGIN,
  PDF_LINE_HEIGHT,
  PDF_LIST_MARGIN,
  PDF_PARAGRAPH_MARGIN,
  PDF_QUOTE_BAR,
  PDF_QUOTE_GAP,
  PDF_TABLE_CELL_PADDING
} from "./pdfTypography";

// The metrics of the direct print, generated from the PDF export's own
// (pdfTypography.ts) so a printed page holds what a PDF page holds. Chromium
// and pdfmake stay two typesetters, so a long block may still break a line
// apart; the PDF is the reference for exact pages. Colours and borders stay
// in print.css.
//
// Three differences between the engines are bridged here:
//   * pdfmake's lineHeight multiplies the face's own line height, CSS's the
//     font size, so the factor is multiplied in (AppFontDefinition.pdfLineHeight);
//   * pdfmake adds the margins of neighbouring blocks, CSS collapses them, so
//     the spacing is set as padding;
//   * the PDF's system font is Roboto (pdfmake's own), so the print uses
//     Roboto there too, and pdfmake's bold Roboto is the Medium cut.

export type PrintFont = {
  cssStack: string;
  boldWeight: number;
  lineHeight: number;
  loadStyles: (() => Promise<unknown>) | null;
};

const ROBOTO_STACK = '"Roboto", "Helvetica Neue", Arial, sans-serif';
const COURIER_STACK = '"Courier New", Courier, monospace';

/** The face the print sets the body in, matching the one the PDF embeds. */
export function getPrintFont(fontId: AppFontId): PrintFont {
  const definition = APP_FONTS[fontId];

  if (fontId === "system") {
    return {
      cssStack: ROBOTO_STACK,
      boldWeight: 500,
      lineHeight: definition.pdfLineHeight,
      loadStyles: () =>
        Promise.all([
          import("@fontsource/roboto/latin-400.css"),
          import("@fontsource/roboto/latin-400-italic.css"),
          import("@fontsource/roboto/latin-500.css"),
          import("@fontsource/roboto/latin-500-italic.css")
        ])
    };
  }

  return {
    cssStack: definition.cssStack,
    boldWeight: 700,
    lineHeight: definition.pdfLineHeight,
    loadStyles: definition.loadStyles
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const pt = (value: number) => `${round(value)}pt`;

export type PrintLayoutOptions = {
  font: PrintFont;
  fontSizePt: number;
  /** Width of "9. " in the body font, pdfmake's list indent; measured by the caller. */
  listIndentPt: number;
};

/** Height of a line of body text in pt, as the PDF sets it. */
export function printLineHeightPt(font: PrintFont, fontSizePt: number): number {
  return printBodySizePt(fontSizePt) * PDF_LINE_HEIGHT * font.lineHeight;
}

/** The size of the print body text in pt, as in the PDF. */
export function printBodySizePt(fontSizePt: number): number {
  return round(PDF_BODY_SIZE_PT * getFontScale(fontSizePt));
}

export function printLayoutCss({ font, fontSizePt, listIndentPt }: PrintLayoutOptions): string {
  const scale = getFontScale(fontSizePt);
  const lineHeight = round(PDF_LINE_HEIGHT * font.lineHeight);
  const paragraphPadding = `${pt(PDF_PARAGRAPH_MARGIN.top)} 0 ${pt(PDF_PARAGRAPH_MARGIN.bottom)}`;

  const headings = PDF_HEADINGS.map(
    (heading, index) =>
      `.print-root h${index + 1} { font-size: ${pt(heading.sizePt * scale)}; padding: ${pt(heading.marginTop)} 0 ${pt(heading.marginBottom)}; }`
  );

  return [
    "@media print {",
    `html.scribedog-printing .print-root { font-family: ${font.cssStack}; font-size: ${pt(PDF_BODY_SIZE_PT * scale)}; line-height: ${lineHeight}; }`,
    // Chromium's own default of two lines at either edge of a page comes
    // closest to the PDF's paragraph rules (pdfPageRules.ts).
    ".print-root * { orphans: 2; widows: 2; }",
    // pdfmake breaks a word longer than the line (a URL, a path, a hash) at
    // the line's end. Chromium lets it run off the paper instead, cut off, so
    // the page held fewer lines than planned and ended in a gap.
    ".print-root { overflow-wrap: break-word; }",
    // In a list the PDF splits an item wherever the page ends.
    ".print-root li { orphans: 1; widows: 1; }",
    // What the PDF keeps on one page: an image with its caption, a short
    // code block or table (keepTogether.ts).
    ".print-root .print-keep { break-inside: avoid; }",
    // Table rows move to the next page whole, as in the PDF (tableColumns.ts).
    ".print-root table.print-rows-whole tr { break-inside: avoid; }",    ".print-root h1, .print-root h2, .print-root h3, .print-root h4, .print-root h5, .print-root h6 {",
    `  margin: 0; line-height: ${lineHeight}; font-weight: ${font.boldWeight}; }`,
    ...headings,
    `.print-root strong, .print-root b, .print-root th { font-weight: ${font.boldWeight}; }`,
    `.print-root p { margin: 0; padding: ${paragraphPadding}; }`,
    `.print-root p.print-image { padding: ${pt(PDF_IMAGE_MARGIN)} 0; }`,
    `.print-root ul, .print-root ol { margin: 0; padding: ${pt(PDF_LIST_MARGIN.top)} 0 ${pt(PDF_LIST_MARGIN.bottom)} ${pt(listIndentPt)}; }`,
    `.print-root li { padding: ${paragraphPadding}; }`,
    // The PDF draws the box 12pt wide with a 4pt gap (pdfExport.ts).
    ".print-root ul.task-list { padding-left: 4pt; }",
    ".print-root ul.task-list input[type=\"checkbox\"] { width: 12pt; height: 12pt; margin: 0 4pt 0 0; }",
    // The rest of an item cut across pages (pagePlan.ts): no marker of its
    // own, and in a task list the room the checkbox took.
    ".print-root li.list-continued { list-style: none; }",
    ".print-root ul.task-list li.list-continued { padding-left: 16pt; }",
    `.print-root table { margin: ${pt(PDF_BLOCK_MARGIN.top)} 0 ${pt(PDF_BLOCK_MARGIN.bottom)}; }`,
    ".print-root table.print-table--full { width: 100%; table-layout: fixed; }",
    `.print-root th, .print-root td { padding: ${pt(PDF_TABLE_CELL_PADDING.vertical)} ${pt(PDF_TABLE_CELL_PADDING.horizontal)}; border-width: 1pt; vertical-align: top; }`,
    `.print-root pre { margin: ${pt(PDF_BLOCK_MARGIN.top)} 0 ${pt(PDF_BLOCK_MARGIN.bottom)}; padding: ${pt(PDF_CODE_INSET.vertical)} ${pt(PDF_CODE_INSET.horizontal)}; border: none; border-radius: 0;`,
    `  font-family: ${COURIER_STACK}; font-size: ${pt(PDF_CODE_SIZE_PT * scale)}; line-height: ${round(PDF_LINE_HEIGHT * COURIER_PDF_LINE_HEIGHT)}; }`,
    ".print-root pre code { font: inherit; }",
    // Inline code sits in the running text at its size, as in the PDF.
    `.print-root code { font-family: ${COURIER_STACK}; font-size: 1em; padding: 0; border-radius: 0; }`,
    `.print-root blockquote { margin: ${pt(PDF_BLOCK_MARGIN.top)} 0 ${pt(PDF_BLOCK_MARGIN.bottom)}; padding: 0 ${pt(PDF_TABLE_CELL_PADDING.horizontal)} 0 ${pt(PDF_QUOTE_GAP)}; border-left-width: ${pt(PDF_QUOTE_BAR)}; }`,
    `.print-root hr { margin: ${pt(PDF_HR_MARGIN)} 0; border-top-width: 0.5pt; }`,
    "}"
  ].join("\n");
}
