import type { PageStart } from "@/lib/export/pageMap";

// Turns the PDF page map (block indices of the exported markdown) into
// places in the editor. The editor's top-level nodes and the export's
// top-level blocks usually pair up one to one, but not always (an empty
// paragraph exports as nothing), so the two are matched by markdown lines:
// every block knows the line it starts on (parseMarkdownToBlocksWithLines),
// and every node the lines it serializes to.
//
// Pages end where the page plan cut the document (export/pagePlan.ts), so a
// page that begins inside a block comes with the exact place: the word of a
// paragraph, the row of a table, the item of a list, the line of a code
// block. Those are shown exactly; only a break pdfmake made on its own
// (inside a block taller than a page) is shown roughly.

/** Lines [startLine, endLine) of a node in the document's markdown. */
export type LineRange = { startLine: number; endLine: number };

/**
 * Finds each node's lines in the whole document's markdown, in order. A node
 * whose serialization cannot be found (the serializer writes some nodes
 * differently in context, e.g. a list's numbering) gets null; so does an
 * empty one.
 */
export function locateNodeLines(wholeMarkdown: string, nodeMarkdowns: string[]): Array<LineRange | null> {
  const wholeLines = wholeMarkdown.split("\n");
  let cursor = 0;

  return nodeMarkdowns.map((markdown) => {
    const lines = markdown.trim().split("\n");

    if (lines.length === 1 && lines[0] === "") {
      return null;
    }

    for (let line = cursor; line < wholeLines.length; line++) {
      if (wholeLines[line] === lines[0]) {
        cursor = line + lines.length;
        return { startLine: line, endLine: line + lines.length };
      }
    }

    return null;
  });
}

export type EditorNodeLines = LineRange & {
  /** Document position right before the node. */
  pos: number;
  /** Document position right after the node. */
  end: number;
};

/** An exact place inside a node, as the editor draws it. */
export type InnerMark =
  /** Inside text (a paragraph's word, a code block's line): the line breaks the text there. */
  | { kind: "inline"; pos: number }
  /** Before a nested node (a table row, a list item). */
  | { kind: "before"; pos: number; end: number; labelPos: number; labelEnd: number };

export type PageLineMark =
  /** The page begins with this node: a line goes in front of it. */
  | { kind: "between"; page: number; pos: number }
  /** The page begins at an exact place inside the node. */
  | ({ page: number } & InnerMark)
  /** The page begins inside this node, roughly `fraction` of the way down. */
  | { kind: "within"; page: number; pos: number; end: number; fraction: number };

/** Finds the exact place of a planned page start inside a node, or null. */
export type InnerResolver = (node: EditorNodeLines, at: NonNullable<PageStart["at"]>) => InnerMark | null;

export function pageLineMarks(
  pageStarts: PageStart[],
  blockLines: number[],
  nodes: EditorNodeLines[],
  resolveInner: InnerResolver = () => null
): PageLineMark[] {
  const marks: PageLineMark[] = [];

  for (const start of pageStarts) {
    const line = blockLines[start.blockIndex];

    if (line === undefined || line < 0) {
      continue;
    }

    const node = nodes.find((candidate) => candidate.startLine <= line && line < candidate.endLine);

    if (!node) {
      continue;
    }

    if (!start.withinBlock && line === node.startLine) {
      marks.push({ kind: "between", page: start.page, pos: node.pos });
      continue;
    }

    // The exact place, when the node is exactly the block the plan cut.
    const inner = start.at && line === node.startLine ? resolveInner(node, start.at) : null;

    if (inner) {
      marks.push({ ...inner, page: start.page });
      continue;
    }

    // Where in the node the page begins: the block's own offset in the
    // node's lines, plus the share of the block already on earlier pages.
    const nodeLines = node.endLine - node.startLine;
    const nextBlockLine = blockLines.find((candidate) => candidate > line) ?? node.endLine;
    const blockLinesInNode = Math.min(nextBlockLine, node.endLine) - line;
    const offset = line - node.startLine + start.fraction * blockLinesInNode;
    const fraction = Math.min(0.98, Math.max(0.02, offset / nodeLines));

    marks.push({ kind: "within", page: start.page, pos: node.pos, end: node.end, fraction });
  }

  return marks;
}
