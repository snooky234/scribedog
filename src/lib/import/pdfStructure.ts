// Pure PDF structure analysis: geometry, operator scanning, checkbox and
// table detection, and text-flow assembly. Deliberately free of Tauri/DOM
// imports so it stays testable outside the app shell.

// ---------------------------------------------------------------------------
// Geometry model. All coordinates are PDF user space (origin bottom-left,
// y grows upward) — the same space text item transforms live in.
// ---------------------------------------------------------------------------

export type Rect = { x1: number; y1: number; x2: number; y2: number };

export type VectorPath = {
  rect: Rect;
  paint: "stroke" | "fill" | "other";
};

export type PlacedImage = {
  objId: string;
  x: number;
  yTop: number;
  widthPt: number;
  heightPt: number;
};

export type TextLine = {
  y: number;
  fontSize: number;
  parts: Array<{ x: number; text: string }>;
};

export type Block = {
  y: number;
  markdown: string;
  kind: "text" | "checkbox" | "table" | "image";
};

const LINE_Y_TOLERANCE = 2.5;

type Matrix = [number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

function multiplyMatrix(m2: Matrix, m1: Matrix): Matrix {
  // Applies m1 first, then m2 (PDF cm semantics: new = args × current).
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
}

function applyMatrix(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5]
  };
}

function transformBounds(matrix: Matrix, x1: number, y1: number, x2: number, y2: number): Rect {
  const corners = [
    applyMatrix(matrix, x1, y1),
    applyMatrix(matrix, x2, y1),
    applyMatrix(matrix, x1, y2),
    applyMatrix(matrix, x2, y2)
  ];

  return {
    x1: Math.min(...corners.map((corner) => corner.x)),
    y1: Math.min(...corners.map((corner) => corner.y)),
    x2: Math.max(...corners.map((corner) => corner.x)),
    y2: Math.max(...corners.map((corner) => corner.y))
  };
}

function rectWidth(rect: Rect): number {
  return rect.x2 - rect.x1;
}

function rectHeight(rect: Rect): number {
  return rect.y2 - rect.y1;
}

function rectsOverlap(left: Rect, right: Rect, margin: number): boolean {
  return (
    left.x1 - margin <= right.x2 &&
    right.x1 - margin <= left.x2 &&
    left.y1 - margin <= right.y2 &&
    right.y1 - margin <= left.y2
  );
}

// ---------------------------------------------------------------------------
// Operator scan: walks the page's operator list with a proper transform
// stack and collects vector paths (with their painted bounding boxes) plus
// image placements including the displayed size.
// ---------------------------------------------------------------------------

export type OpsConstants = {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  paintImageXObject: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
};

function classifyPaint(paintOp: number, ops: OpsConstants): VectorPath["paint"] {
  if (paintOp === ops.stroke || paintOp === ops.closeStroke) {
    return "stroke";
  }

  if (
    paintOp === ops.fill ||
    paintOp === ops.eoFill ||
    paintOp === ops.fillStroke ||
    paintOp === ops.eoFillStroke
  ) {
    return "fill";
  }

  return "other";
}

export function scanOperators(
  operatorList: { fnArray: number[]; argsArray: unknown[][] },
  ops: OpsConstants
): { paths: VectorPath[]; images: PlacedImage[] } {
  const paths: VectorPath[] = [];
  const images: PlacedImage[] = [];
  const matrixStack: Matrix[] = [];
  let matrix: Matrix = IDENTITY_MATRIX;

  for (const [index, fn] of operatorList.fnArray.entries()) {
    const args = operatorList.argsArray[index];

    if (fn === ops.save) {
      matrixStack.push(matrix);
    } else if (fn === ops.restore) {
      matrix = matrixStack.pop() ?? IDENTITY_MATRIX;
    } else if (fn === ops.transform) {
      const [a, b, c, d, e, f] = args as number[];
      matrix = multiplyMatrix(matrix, [a, b, c, d, e, f]);
    } else if (fn === ops.constructPath) {
      // args = [paintOp, pathData, minMax]; minMax is the untransformed
      // bounding box [x1, y1, x2, y2] (may be missing for glyph paths).
      const paintOp = args?.[0];
      const minMax = args?.[2];

      const box = minMax as ArrayLike<number> | null | undefined;

      if (typeof paintOp === "number" && box && box.length === 4) {
        paths.push({
          rect: transformBounds(matrix, box[0], box[1], box[2], box[3]),
          paint: classifyPaint(paintOp, ops)
        });
      }
    } else if (fn === ops.paintImageXObject) {
      const objId = args?.[0];

      if (typeof objId === "string") {
        // Images are drawn into the unit square, so the current matrix
        // spans exactly the displayed area.
        const bounds = transformBounds(matrix, 0, 0, 1, 1);
        images.push({
          objId,
          x: bounds.x1,
          yTop: bounds.y2,
          widthPt: rectWidth(bounds),
          heightPt: rectHeight(bounds)
        });
      }
    }
  }

  return { paths, images };
}

// ---------------------------------------------------------------------------
// Checkbox detection: exporters draw checkboxes as a small (~8–20pt) square
// outline; a checked box gets one extra stroked path (the check mark) inside
// the same footprint. Grouping overlapping small paths therefore yields one
// group per checkbox glyph, checked when it holds two or more strokes.
// ---------------------------------------------------------------------------

export type CheckboxMark = {
  rect: Rect;
  checked: boolean;
};

export function detectCheckboxes(paths: VectorPath[]): CheckboxMark[] {
  const smallPaths = paths.filter((path) => {
    const width = rectWidth(path.rect);
    const height = rectHeight(path.rect);
    return width >= 4 && width <= 20 && height >= 4 && height <= 20;
  });

  const groups: Array<{ rect: Rect; strokeCount: number; hasSquare: boolean }> = [];

  for (const path of smallPaths) {
    const width = rectWidth(path.rect);
    const height = rectHeight(path.rect);
    const isSquare = width >= 6 && height >= 6 && Math.abs(width - height) <= 5;
    const group = groups.find((candidate) => rectsOverlap(candidate.rect, path.rect, 2));

    if (group) {
      group.rect = {
        x1: Math.min(group.rect.x1, path.rect.x1),
        y1: Math.min(group.rect.y1, path.rect.y1),
        x2: Math.max(group.rect.x2, path.rect.x2),
        y2: Math.max(group.rect.y2, path.rect.y2)
      };
      group.strokeCount += path.paint === "stroke" ? 1 : 0;
      group.hasSquare = group.hasSquare || isSquare;
    } else {
      groups.push({
        rect: path.rect,
        strokeCount: path.paint === "stroke" ? 1 : 0,
        hasSquare: isSquare
      });
    }
  }

  return groups
    .filter((group) => group.hasSquare)
    .map((group) => ({ rect: group.rect, checked: group.strokeCount >= 2 }));
}

// Matches a checkbox glyph to the text line it belongs to: the glyph sits
// left of the line's first text and vertically overlaps it.
function findCheckboxForLine(line: TextLine, checkboxes: CheckboxMark[]): CheckboxMark | null {
  const lineStartX = Math.min(...line.parts.map((part) => part.x));
  const lineTop = line.y + line.fontSize;

  return (
    checkboxes.find(
      (checkbox) =>
        checkbox.rect.x2 <= lineStartX + 4 &&
        checkbox.rect.x2 >= lineStartX - 40 &&
        checkbox.rect.y1 <= lineTop &&
        checkbox.rect.y2 >= line.y
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Table detection: bordered tables paint their grid as stroked line
// segments. Vertical segment x-positions become column boundaries,
// horizontal segment y-positions row boundaries; text items falling into a
// grid cell are collected into a pipe table. Borderless tables cannot be
// detected this way and fall back to plain text — deliberate best effort.
// ---------------------------------------------------------------------------

export type TableGrid = {
  rect: Rect;
  columnBounds: number[];
  rowBounds: number[];
};

function clusterValues(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const clusters: number[][] = [];

  for (const value of sorted) {
    const current = clusters[clusters.length - 1];

    if (current && value - current[current.length - 1] <= tolerance) {
      current.push(value);
    } else {
      clusters.push([value]);
    }
  }

  return clusters.map((cluster) => cluster.reduce((sum, entry) => sum + entry, 0) / cluster.length);
}

export function detectTables(paths: VectorPath[]): TableGrid[] {
  const segments = paths.filter((path) => {
    if (path.paint !== "stroke") {
      return false;
    }

    const width = rectWidth(path.rect);
    const height = rectHeight(path.rect);
    return (height <= 2 && width >= 8) || (width <= 2 && height >= 8);
  });

  // Region-grow overlapping segments into connected components — one grid
  // (candidate table) per component.
  const components: Array<{ rect: Rect; segments: VectorPath[] }> = [];

  for (const segment of segments) {
    const matches = components.filter((component) => rectsOverlap(component.rect, segment.rect, 3));

    if (matches.length === 0) {
      components.push({ rect: { ...segment.rect }, segments: [segment] });
      continue;
    }

    const [target, ...rest] = matches;
    target.segments.push(segment);
    target.rect = {
      x1: Math.min(target.rect.x1, segment.rect.x1),
      y1: Math.min(target.rect.y1, segment.rect.y1),
      x2: Math.max(target.rect.x2, segment.rect.x2),
      y2: Math.max(target.rect.y2, segment.rect.y2)
    };

    for (const other of rest) {
      target.segments.push(...other.segments);
      target.rect = {
        x1: Math.min(target.rect.x1, other.rect.x1),
        y1: Math.min(target.rect.y1, other.rect.y1),
        x2: Math.max(target.rect.x2, other.rect.x2),
        y2: Math.max(target.rect.y2, other.rect.y2)
      };
      components.splice(components.indexOf(other), 1);
    }
  }

  const tables: TableGrid[] = [];

  for (const component of components) {
    const verticalXs = component.segments
      .filter((segment) => rectWidth(segment.rect) <= 2)
      .map((segment) => (segment.rect.x1 + segment.rect.x2) / 2);
    const horizontalYs = component.segments
      .filter((segment) => rectHeight(segment.rect) <= 2)
      .map((segment) => (segment.rect.y1 + segment.rect.y2) / 2);

    const columnBounds = clusterValues(verticalXs, 3);
    const rowBounds = clusterValues(horizontalYs, 3).reverse();

    // A real grid needs at least 2×2 cells; anything smaller is likely an
    // underline, separator rule, or blockquote bar.
    if (columnBounds.length >= 3 && rowBounds.length >= 3) {
      tables.push({ rect: component.rect, columnBounds, rowBounds });
    }
  }

  return tables;
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").trim();
}

export function buildTableMarkdown(
  table: TableGrid,
  items: Array<{ x: number; y: number; text: string }>
): string {
  const rowCount = table.rowBounds.length - 1;
  const columnCount = table.columnBounds.length - 1;
  const cells: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => "")
  );

  const sortedItems = [...items].sort((left, right) => right.y - left.y || left.x - right.x);

  for (const item of sortedItems) {
    // rowBounds is sorted top-down (descending y).
    const rowIndex = table.rowBounds.findIndex(
      (bound, index) =>
        index < rowCount && item.y <= bound && item.y >= table.rowBounds[index + 1]
    );
    const columnIndex = table.columnBounds.findIndex(
      (bound, index) =>
        index < columnCount && item.x >= bound - 2 && item.x < table.columnBounds[index + 1]
    );

    if (rowIndex === -1 || columnIndex === -1) {
      continue;
    }

    const existing = cells[rowIndex][columnIndex];
    cells[rowIndex][columnIndex] = existing ? `${existing} ${item.text}` : item.text;
  }

  const lines: string[] = [];
  const [headerRow, ...bodyRows] = cells;

  lines.push(`| ${headerRow.map(escapeTableCell).join(" | ")} |`);
  lines.push(`| ${headerRow.map(() => "---").join(" | ")} |`);

  for (const row of bodyRows) {
    lines.push(`| ${row.map(escapeTableCell).join(" | ")} |`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Text flow
// ---------------------------------------------------------------------------

// Heading detection is a best-effort heuristic over font sizes: lines set
// notably larger than the document's dominant size become headings.
function headingPrefix(fontSize: number, bodySize: number): string {
  const ratio = fontSize / bodySize;

  if (ratio >= 1.7) {
    return "# ";
  }

  if (ratio >= 1.4) {
    return "## ";
  }

  if (ratio >= 1.15) {
    return "### ";
  }

  return "";
}

function lineText(line: TextLine): string {
  return line.parts
    .sort((left, right) => left.x - right.x)
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function linesToBlocks(lines: TextLine[], checkboxes: CheckboxMark[]): Block[] {
  if (lines.length === 0) {
    return [];
  }

  const sortedSizes = lines.map((line) => line.fontSize).sort((left, right) => left - right);
  const bodySize = sortedSizes[Math.floor(sortedSizes.length / 2)] || 12;

  const blocks: Block[] = [];
  let paragraph = "";
  let paragraphY = 0;
  let previousLine: TextLine | null = null;

  const flushParagraph = () => {
    if (paragraph.trim()) {
      blocks.push({ y: paragraphY, markdown: paragraph.trim(), kind: "text" });
    }

    paragraph = "";
  };

  for (const line of lines) {
    const text = lineText(line);

    if (!text) {
      continue;
    }

    const checkbox = findCheckboxForLine(line, checkboxes);

    if (checkbox) {
      flushParagraph();
      blocks.push({
        y: line.y,
        markdown: `- [${checkbox.checked ? "x" : " "}] ${text}`,
        kind: "checkbox"
      });
      previousLine = line;
      continue;
    }

    const prefix = headingPrefix(line.fontSize, bodySize);

    if (prefix) {
      flushParagraph();
      blocks.push({ y: line.y, markdown: `${prefix}${text}`, kind: "text" });
      previousLine = line;
      continue;
    }

    // A vertical gap clearly larger than the line height starts a new paragraph.
    const gap = previousLine ? previousLine.y - line.y : 0;
    const startsNewParagraph =
      previousLine !== null &&
      (gap > Math.max(previousLine.fontSize, line.fontSize) * 1.6 ||
        headingPrefix(previousLine.fontSize, bodySize) !== "");

    if (startsNewParagraph || paragraph === "") {
      flushParagraph();
      paragraphY = line.y;
    }

    paragraph = paragraph ? `${paragraph} ${text}` : text;
    previousLine = line;
  }

  flushParagraph();

  return blocks;
}

// Joins page blocks top-to-bottom; consecutive checkbox blocks form one task
// list instead of separate paragraphs.
export function blocksToMarkdown(blocks: Block[]): string {
  const sorted = [...blocks].sort((left, right) => right.y - left.y);
  const parts: string[] = [];

  for (const [index, block] of sorted.entries()) {
    const previous = sorted[index - 1];

    if (index === 0) {
      parts.push(block.markdown);
    } else if (previous?.kind === "checkbox" && block.kind === "checkbox") {
      parts.push(`\n${block.markdown}`);
    } else {
      parts.push(`\n\n${block.markdown}`);
    }
  }

  return parts.join("");
}

export function collectPageLines(items: Array<{ x: number; y: number; fontSize: number; text: string }>): TextLine[] {
  const lines: TextLine[] = [];

  for (const item of items) {
    const existingLine = lines.find((line) => Math.abs(line.y - item.y) <= LINE_Y_TOLERANCE);

    if (existingLine) {
      existingLine.parts.push({ x: item.x, text: item.text });
      existingLine.fontSize = Math.max(existingLine.fontSize, item.fontSize);
    } else {
      lines.push({ y: item.y, fontSize: item.fontSize, parts: [{ x: item.x, text: item.text }] });
    }
  }

  return lines.sort((left, right) => right.y - left.y);
}
