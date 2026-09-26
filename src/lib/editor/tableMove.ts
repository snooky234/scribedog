import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { CellSelection, TableMap, moveTableColumn, moveTableRow } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";

// Reordering the rows and columns of a table, shared by Alt+Shift+Arrow
// (Editor.tsx), the table menu and the drag grips (tableGrips.ts). Every move
// is one transaction, so one undo step.
//
// Two rules the file format sets:
// - The first row stays where it is. GFM has exactly one header row in first
//   position, and the serializer promotes whatever row sits there, so a data
//   row moved above it would silently become the header. Row moves happen
//   within the body; in the header row Alt+Shift+Up/Down moves the whole
//   table instead (the caller falls through to moveLine).
// - Tables with merged cells are not reordered. prosemirror-tables moves a
//   whole block of rows when a span crosses them, which is rarely what a
//   single step means, and GFM cannot keep the span anyway.

export type TableAxis = "row" | "column";

export type TableCellContext = {
  table: ProseMirrorNode;
  /** Position right before the table node. */
  tablePos: number;
  /** Position of the table's first row (tablePos + 1). */
  tableStart: number;
  /** Depth of the table node; 1 means a direct child of the document. */
  tableDepth: number;
  map: TableMap;
  row: number;
  column: number;
  /** Position right before the cell node. */
  cellPos: number;
};

const CELL_TYPES = new Set(["tableCell", "tableHeader"]);

/**
 * The cell the selection's head sits in, with its table. A cell selection
 * (a whole row picked with the grip) counts as its head cell.
 */
export function currentTableCell(state: EditorState): TableCellContext | null {
  const { selection } = state;
  const $cell = selection instanceof CellSelection ? selection.$headCell : null;
  let cellPos: number;

  if ($cell) {
    cellPos = $cell.pos;
  } else {
    const { $head } = selection;
    let depth = $head.depth;

    while (depth > 0 && !CELL_TYPES.has($head.node(depth).type.name)) {
      depth--;
    }

    if (depth < 3) {
      return null;
    }

    cellPos = $head.before(depth);
  }

  const $pos = state.doc.resolve(cellPos);
  // $pos points into the row; one level up is the table.
  const tableDepth = $pos.depth - 1;
  const table = $pos.node(tableDepth);

  if (table.type.name !== "table") {
    return null;
  }

  const tableStart = $pos.start(tableDepth);
  const map = TableMap.get(table);
  const rect = map.findCell(cellPos - tableStart);

  return {
    table,
    tablePos: tableStart - 1,
    tableStart,
    tableDepth,
    map,
    row: rect.top,
    column: rect.left,
    cellPos
  };
}

export function hasMergedCells(table: ProseMirrorNode): boolean {
  let merged = false;

  table.descendants((node) => {
    if (merged) {
      return false;
    }

    if (CELL_TYPES.has(node.type.name)) {
      merged = (Number(node.attrs.colspan) || 1) > 1 || (Number(node.attrs.rowspan) || 1) > 1;
      return false;
    }

    return true;
  });

  return merged;
}

// Where index `index` ends up when the line at `from` is moved to `to`.
function shiftedIndex(index: number, from: number, to: number): number {
  if (index === from) {
    return to;
  }

  if (from < to && index > from && index <= to) {
    return index - 1;
  }

  if (to < from && index >= to && index < from) {
    return index + 1;
  }

  return index;
}

/**
 * Moves row or column `from` of the table the selection is in to index
 * `to` (its index after the move). Null when the move is not allowed or
 * changes nothing. The selection follows the cell it was in: a caret keeps
 * its offset inside the cell, a row or column selection stays on the moved
 * line.
 */
export function moveTableLine(state: EditorState, axis: TableAxis, from: number, to: number): Transaction | null {
  const context = currentTableCell(state);

  if (!context || from === to || hasMergedCells(context.table)) {
    return null;
  }

  const { map, tableStart, cellPos } = context;
  const size = axis === "row" ? map.height : map.width;
  const first = axis === "row" ? 1 : 0;

  if (from < first || to < first || from >= size || to >= size) {
    return null;
  }

  let tr: Transaction | null = null;
  const command = axis === "row" ? moveTableRow : moveTableColumn;
  command({ from, to, select: false, pos: cellPos })(state, (transaction) => {
    tr = transaction;
  });

  if (!tr) {
    return null;
  }

  const moved = tr as Transaction;
  const table = moved.doc.nodeAt(context.tablePos);

  if (!table) {
    return null;
  }

  const newMap = TableMap.get(table);
  const row = axis === "row" ? shiftedIndex(context.row, from, to) : context.row;
  const column = axis === "column" ? shiftedIndex(context.column, from, to) : context.column;
  const newCellPos = tableStart + newMap.map[row * newMap.width + column];
  const { selection } = state;

  if (selection instanceof CellSelection && (selection.isRowSelection() || selection.isColSelection())) {
    const index = axis === "row" ? row : column;
    const headCell = moved.doc.resolve(
      tableStart + (axis === "row" ? newMap.positionAt(index, 0, table) : newMap.positionAt(0, index, table))
    );
    const anchorCell = moved.doc.resolve(
      tableStart +
        (axis === "row"
          ? newMap.positionAt(index, newMap.width - 1, table)
          : newMap.positionAt(newMap.height - 1, index, table))
    );

    // A cross selection (a row selected, a column moved) has no single
    // line to follow; the caret goes to the moved cell instead.
    const selectsMovedLine = axis === "row" ? selection.isRowSelection() : selection.isColSelection();

    if (selectsMovedLine) {
      moved.setSelection(
        axis === "row"
          ? CellSelection.rowSelection(anchorCell, headCell)
          : CellSelection.colSelection(anchorCell, headCell)
      );
      return moved.scrollIntoView();
    }
  }

  const cellEnd = cellPos + (state.doc.nodeAt(cellPos)?.nodeSize ?? 0);

  if (selection instanceof TextSelection && selection.from > cellPos && selection.to < cellEnd) {
    moved.setSelection(
      TextSelection.create(moved.doc, newCellPos + (selection.anchor - cellPos), newCellPos + (selection.head - cellPos))
    );
  } else {
    moved.setSelection(TextSelection.near(moved.doc.resolve(newCellPos + 1)));
  }

  return moved.scrollIntoView();
}

export type TableStep = {
  /** False when the key has no table meaning here and belongs to the next handler. */
  handled: boolean;
  /** The move, or null when the line is already at the edge (or spans block it). */
  tr: Transaction | null;
};

const NOT_HANDLED: TableStep = { handled: false, tr: null };

/**
 * One keyboard step of the row or column the selection is in. A row step in
 * the header row is not handled, so Alt+Shift+Up/Down there moves the whole
 * table as before. At the edge of the table the step is handled without a
 * move: the table must not jump away because a key was pressed once too
 * often.
 */
export function tableLineStep(state: EditorState, axis: TableAxis, delta: -1 | 1): TableStep {
  const context = currentTableCell(state);

  if (!context || (axis === "row" && context.row === 0)) {
    return NOT_HANDLED;
  }

  const from = axis === "row" ? context.row : context.column;

  return { handled: true, tr: moveTableLine(state, axis, from, from + delta) };
}

/**
 * Dispatches a handled step's move, if there is one. Always true: a step at
 * the edge of the table still consumes the key.
 */
export function dispatchTableStep(view: EditorView, tr: Transaction | null): true {
  if (tr) {
    view.dispatch(tr);
  }

  return true;
}

/**
 * Moves a top-level table so that it lands in front of the document's child
 * `targetIndex` (or at the end for doc.childCount), counted in the document
 * as it is now. A caret inside the table keeps its place in it; otherwise the
 * moved table ends up selected. Null when nothing would change or the table
 * is not a direct child of the document.
 */
export function moveTopLevelTable(state: EditorState, tablePos: number, targetIndex: number): Transaction | null {
  const { doc } = state;
  const $table = doc.resolve(tablePos);
  const table = doc.nodeAt(tablePos);

  if ($table.depth !== 0 || !table || table.type.name !== "table") {
    return null;
  }

  const fromIndex = $table.index(0);

  if (targetIndex < 0 || targetIndex > doc.childCount || targetIndex === fromIndex || targetIndex === fromIndex + 1) {
    return null;
  }

  let targetPos = 0;

  for (let index = 0; index < targetIndex; index++) {
    targetPos += doc.child(index).nodeSize;
  }

  const tr = state.tr.delete(tablePos, tablePos + table.nodeSize);
  const insertPos = tr.mapping.map(targetPos);
  tr.insert(insertPos, table);

  const { selection } = state;
  const inside = selection.from > tablePos && selection.to < tablePos + table.nodeSize;

  if (inside && selection instanceof TextSelection) {
    const shift = insertPos - tablePos;
    tr.setSelection(TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift));
  } else {
    tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  }

  return tr.scrollIntoView();
}
