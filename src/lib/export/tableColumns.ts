import { CELL_CHROME_PT, CHAR_WIDTH_EM, CHAR_WIDTH_EM_WIDE } from "./pdfTableFit";
import type { InlineRun, TableCell } from "./markdownModel";

// How a full-width table divides the page among its columns, in the PDF and
// in the direct print alike. Both used to decide on their own: pdfmake gave
// every column an equal share, the browser sized them by content. The same
// text then wrapped differently in each, and a notes column squeezed into a
// third of the page ran over several extra lines in the PDF.
//
// This is the browser's automatic table layout, estimated from character
// counts: every column gets at least its longest word, and the space beyond
// that goes to the columns in proportion to how much more their longest cell
// wants. The PDF sets the result as fixed column widths, the print as a
// <colgroup>, so the two wrap at the same places, and the editor (which sizes
// columns by content too) looks the same.

/** Width of an image in a cell, in characters, capped so it cannot claim the table. */
const IMAGE_CHARS = 12;

type ColumnMeasure = { minChars: number; maxChars: number };

function cellLines(runs: InlineRun[]): string[] {
  const lines = [""];

  for (const run of runs) {
    if (run.kind === "break") {
      lines.push("");
    } else if (run.kind === "text") {
      lines[lines.length - 1] += run.text;
    } else {
      lines[lines.length - 1] += "x".repeat(IMAGE_CHARS);
    }
  }

  return lines;
}

function measureCell(cell: TableCell): ColumnMeasure {
  const lines = cellLines(cell.runs);
  const longestLine = Math.max(...lines.map((line) => [...line.trim()].length));
  const longestWord = Math.max(0, ...lines.flatMap((line) => line.split(/\s+/)).map((word) => [...word].length));

  return { minChars: longestWord, maxChars: longestLine };
}

export function measureTableColumns(rows: TableCell[][]): ColumnMeasure[] {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));

  return Array.from({ length: columnCount }, (_, column) => {
    let minChars = 1;
    let maxChars = 1;

    for (const row of rows) {
      const cell = row[column];

      if (cell) {
        const measure = measureCell(cell);
        minChars = Math.max(minChars, measure.minChars);
        maxChars = Math.max(maxChars, measure.maxChars);
      }
    }

    return { minChars, maxChars };
  });
}

/**
 * Each column's share of the table width (summing to 1) for a table that
 * spans `tableWidthPt` in a `fontSizePt` body font.
 */
export function computeColumnShares(rows: TableCell[][], tableWidthPt: number, fontSizePt: number): number[] {
  const measures = measureTableColumns(rows);

  if (measures.length === 0) {
    return [];
  }

  const charPt = fontSizePt * CHAR_WIDTH_EM;
  // The longest word has to fit even in bold (a header cell) or a wide
  // face, or it breaks inside the word; the estimate for it errs wide.
  const wordCharPt = fontSizePt * CHAR_WIDTH_EM_WIDE;
  const min = measures.map((measure) => measure.minChars * wordCharPt + CELL_CHROME_PT);
  const max = measures.map((measure, index) => Math.max(min[index], measure.maxChars * charPt + CELL_CHROME_PT));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  let widths: number[];

  if (sum(max) <= tableWidthPt) {
    // Everything fits on one line: the spare room goes out in proportion.
    widths = max.map((value) => (value / sum(max)) * tableWidthPt);
  } else if (sum(min) <= tableWidthPt) {
    const spare = tableWidthPt - sum(min);
    const wants = max.map((value, index) => value - min[index]);
    const totalWant = sum(wants);
    widths = min.map((value, index) => value + (totalWant > 0 ? (spare * wants[index]) / totalWant : spare / min.length));
  } else {
    // Not even the longest words fit; they are broken inside (pdfTableFit.ts).
    widths = min.map((value) => (value / sum(min)) * tableWidthPt);
  }

  return widths.map((width) => width / tableWidthPt);
}

/**
 * Whether every row of the table is short enough to be kept whole on a page:
 * no row estimated taller than half the text area. Both the PDF and the
 * print then move a row to the next page instead of splitting it (the two
 * engines otherwise decide that differently), and a rare giant cell still
 * splits rather than being cut off.
 */
export function rowsFitWhole(
  rows: TableCell[][],
  tableWidthPt: number,
  fontSizePt: number,
  lineHeightPt: number,
  contentHeightPt: number
): boolean {
  const shares = computeColumnShares(rows, tableWidthPt, fontSizePt);
  const charPt = fontSizePt * CHAR_WIDTH_EM;

  return rows.every((row) => {
    const lines = Math.max(
      1,
      ...row.map((cell, column) => {
        const textWidth = Math.max(charPt, (shares[column] ?? 0) * tableWidthPt - CELL_CHROME_PT);

        return cellLines(cell.runs).reduce(
          (total, line) => total + Math.max(1, Math.ceil(([...line].length * charPt) / textWidth)),
          0
        );
      })
    );

    return lines * lineHeightPt <= contentHeightPt / 2;
  });
}
