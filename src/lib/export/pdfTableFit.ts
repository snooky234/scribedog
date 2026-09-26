// pdfmake wraps only at spaces, so the narrowest a table column can get is
// its longest word. With enough columns the sum of those words is wider than
// the A4 page, and the table runs off the right edge whatever the column
// widths are set to. A table in the editor scrolls sideways; a page cannot.
//
// The way out is pdfmake's `wordBreak: "break-all"`, but applied to a whole
// cell it breaks every word at the line end, even the ones that would have
// wrapped cleanly. So it goes only on the words that cannot fit their column
// in the first place: measured against an equal share of the page, which is
// the narrowest a column gets once the table is full.

// Horizontal space a pdfmake table cell spends besides its text: the default
// layout's 4pt padding on either side plus one 1pt border.
const CELL_CHROME_PT = 9;

// Average advance of a character as a share of the font size. On the high
// side of a typical sans serif on purpose: guessing a word too short lets
// the table overflow again, guessing it too long only breaks a word that was
// close to the limit anyway. Courier (inline code) is exactly 0.6.
const CHAR_WIDTH_EM = 0.56;
const CHAR_WIDTH_EM_WIDE = 0.62;

/** Longest word, in characters, that still fits one column of the table. */
export function maxWordLength(
  columnCount: number,
  fontSizePt: number,
  contentWidthPt: number,
  wide = false
): number {
  const columnPt = contentWidthPt / Math.max(1, columnCount) - CELL_CHROME_PT;
  const charPt = fontSizePt * (wide ? CHAR_WIDTH_EM_WIDE : CHAR_WIDTH_EM);

  return Math.max(1, Math.floor(columnPt / charPt));
}

export type FitSegment = { text: string; breakAll: boolean };

/**
 * Splits a cell's text so that only words longer than `maxLength` are marked
 * for breaking inside the word. Whitespace stays with the ordinary segments,
 * so the text joined back together is unchanged.
 */
export function splitOverlongWords(text: string, maxLength: number): FitSegment[] {
  const segments: FitSegment[] = [];
  let plain = "";

  for (const token of text.split(/(\s+)/)) {
    if (token === "") {
      continue;
    }

    if (!/\s/.test(token) && [...token].length > maxLength) {
      if (plain) {
        segments.push({ text: plain, breakAll: false });
        plain = "";
      }

      segments.push({ text: token, breakAll: true });
    } else {
      plain += token;
    }
  }

  if (plain) {
    segments.push({ text: plain, breakAll: false });
  }

  return segments;
}
