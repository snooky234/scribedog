// The PDF export's type and spacing, in pt at the default text size. The PDF
// (pdfExport.ts) sets its styles from these values and the direct print
// generates its CSS from them (printLayout.ts), so a printed page holds what
// a PDF page holds. A change here moves both.
//
// Font sizes scale with the document text size (getFontScale); the spacing
// does not, just as in the PDF.

export const PDF_BODY_SIZE_PT = 10.5;
export const PDF_CODE_SIZE_PT = 9;

/**
 * pdfmake's lineHeight. It multiplies the face's own line height (see
 * AppFontDefinition.pdfLineHeight), not the font size, so the resulting
 * spacing differs from face to face.
 */
export const PDF_LINE_HEIGHT = 1.35;

/** Size and vertical margins of h1..h6. */
export const PDF_HEADINGS: ReadonlyArray<{ sizePt: number; marginTop: number; marginBottom: number }> = [
  { sizePt: 22, marginTop: 14, marginBottom: 8 },
  { sizePt: 17, marginTop: 12, marginBottom: 6 },
  { sizePt: 14, marginTop: 10, marginBottom: 5 },
  { sizePt: 12, marginTop: 8, marginBottom: 4 },
  { sizePt: 10.5, marginTop: 8, marginBottom: 4 },
  { sizePt: 10.5, marginTop: 8, marginBottom: 4 }
];

/** Paragraphs, and the text of every list item. */
export const PDF_PARAGRAPH_MARGIN = { top: 2, bottom: 6 };
export const PDF_LIST_MARGIN = { top: 2, bottom: 6 };
/** Code blocks, quotes and tables. */
export const PDF_BLOCK_MARGIN = { top: 4, bottom: 8 };
/** An image on a line of its own. */
export const PDF_IMAGE_MARGIN = 2;
export const PDF_HR_MARGIN = 10;

/**
 * Inset of a code block's text: the cell margin set in pdfExport plus the
 * default table layout's cell padding (4pt left and right, 2pt top and bottom).
 */
export const PDF_CODE_CELL_MARGIN = { horizontal: 8, vertical: 6 };
export const PDF_TABLE_CELL_PADDING = { horizontal: 4, vertical: 2 };
/** The default table layout's rule between rows and around the table. */
export const PDF_TABLE_LINE_WIDTH = 1;
export const PDF_CODE_INSET = {
  horizontal: PDF_CODE_CELL_MARGIN.horizontal + PDF_TABLE_CELL_PADDING.horizontal,
  vertical: PDF_CODE_CELL_MARGIN.vertical + PDF_TABLE_CELL_PADDING.vertical
};

/** Width of the bar in front of a quote, and the gap after it. */
export const PDF_QUOTE_BAR = 2;
export const PDF_QUOTE_GAP = PDF_TABLE_CELL_PADDING.horizontal;

/**
 * pdfkit's line height of the built-in Courier used for code:
 * (ascender 629 - descender -157) / 1000.
 */
export const COURIER_PDF_LINE_HEIGHT = 0.786;
