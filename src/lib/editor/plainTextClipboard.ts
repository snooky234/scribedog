import { getTextBetween, getTextSerializersFromSchema } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

export type TextRange = { from: number; to: number };

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

type Segment = {
  text: string;
  /** Position of the outermost list around the block, if any. */
  list: number | null;
  /** Position of the table, row and cell around the block, if any. */
  table: number | null;
  row: number | null;
  cell: number | null;
};

function segmentFor(doc: ProseMirrorNode, pos: number, text: string): Segment {
  const $pos = doc.resolve(pos);
  let list: number | null = null;
  let table: number | null = null;
  let row: number | null = null;
  let cell: number | null = null;

  for (let depth = 1; depth <= $pos.depth; depth++) {
    const name = $pos.node(depth).type.name;

    if (list === null && LIST_TYPES.has(name)) {
      list = $pos.before(depth);
    } else if (name === "table") {
      table = $pos.before(depth);
    } else if (name === "tableRow") {
      row = $pos.before(depth);
    } else if (name === "tableCell" || name === "tableHeader") {
      cell = $pos.before(depth);
    }
  }

  return { text, list, table, row, cell };
}

function separator(previous: Segment, next: Segment): string {
  if (previous.cell !== null && previous.cell === next.cell) {
    return " ";
  }
  if (previous.row !== null && previous.row === next.row) {
    return "\t";
  }
  if (previous.table !== null && previous.table === next.table) {
    return "\n";
  }
  if (previous.list !== null && previous.list === next.list) {
    return "\n";
  }

  return "\n\n";
}

/**
 * The plain text Ctrl+C puts on the clipboard next to the HTML. TipTap's own
 * serializer writes a separator for every block it enters, so a task list
 * (list, item, paragraph) turned into several blank lines per item in any
 * plain-text editor. Here only text blocks count: blocks of one list follow
 * each other line by line, table cells are tab-separated per row, and
 * everything else keeps one blank line between paragraphs.
 */
export function plainTextBetween(doc: ProseMirrorNode, ranges: readonly TextRange[]): string {
  const textSerializers = getTextSerializersFromSchema(doc.type.schema);
  const segments: Segment[] = [];

  for (const { from, to } of [...ranges].sort((a, b) => a.from - b.from)) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        const start = Math.max(from, pos + 1);
        const end = Math.min(to, pos + node.nodeSize - 1);
        const text = start < end ? getTextBetween(doc, { from: start, to: end }, { textSerializers }) : "";
        segments.push(segmentFor(doc, pos + 1, text));
        return false;
      }

      // A block with its own text form (and no text block inside) still
      // counts as one line; other leaf blocks (images, rules) carry no text.
      if (node.isBlock && textSerializers[node.type.name]) {
        const parent = doc.resolve(pos).parent;
        const text = textSerializers[node.type.name]({
          node,
          pos,
          parent,
          index: doc.resolve(pos).index(),
          range: { from, to }
        });
        segments.push(segmentFor(doc, pos, text));
        return false;
      }

      return true;
    });
  }

  let text = "";
  segments.forEach((segment, index) => {
    if (index > 0) {
      text += separator(segments[index - 1], segment);
    }
    text += segment.text;
  });

  return text;
}

/** {@link plainTextBetween} for the current selection, one range per selected table cell. */
export function selectionPlainText(state: EditorState): string {
  return plainTextBetween(
    state.doc,
    state.selection.ranges.map(({ $from, $to }) => ({ from: $from.pos, to: $to.pos }))
  );
}
