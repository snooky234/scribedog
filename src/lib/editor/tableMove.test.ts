// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { moveTableLine, moveTopLevelTable, tableLineStep } from "@/lib/editor/tableMove";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
}

function cell(text: string, header = false, attrs: Record<string, unknown> = {}): JSONContent {
  return {
    type: header ? "tableHeader" : "tableCell",
    attrs: { colspan: 1, rowspan: 1, ...attrs },
    content: [paragraph(text)]
  };
}

// First row is the header row; every cell holds its own label, "r1c0" etc.
function table(rows: number, columns: number): JSONContent {
  return {
    type: "table",
    content: Array.from({ length: rows }, (_, row) => ({
      type: "tableRow",
      content: Array.from({ length: columns }, (_, column) => cell(`r${row}c${column}`, row === 0))
    }))
  };
}

function createEditor(...content: JSONContent[]): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content: { type: "doc", content }
  });

  return editor;
}

// Position inside the text `text`, `offset` characters in.
function positionOf(doc: ProseMirrorNode, text: string, offset = 0): number {
  let found = -1;

  doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) {
      found = pos + offset;
    }

    return found === -1;
  });

  expect(found).toBeGreaterThan(-1);
  return found;
}

function placeCaret(target: Editor, text: string, offset = 0): EditorState {
  const { state } = target;
  target.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, positionOf(state.doc, text, offset))));

  return target.state;
}

function grid(doc: ProseMirrorNode): string[][] {
  const rows: string[][] = [];

  doc.descendants((node) => {
    if (node.type.name === "tableRow") {
      const cells: string[] = [];
      node.forEach((child) => cells.push(`${child.textContent}${child.type.name === "tableHeader" ? "*" : ""}`));
      rows.push(cells);
      return false;
    }

    return true;
  });

  return rows;
}

function textAroundCaret(state: EditorState): string {
  const { $head } = state.selection;
  return `${$head.parent.textContent.slice(0, $head.parentOffset)}|${$head.parent.textContent.slice($head.parentOffset)}`;
}

describe("tableLineStep", () => {
  it("moves a body row down and keeps the caret in its cell", () => {
    const target = createEditor(table(4, 2));
    const state = placeCaret(target, "r1c1", 2);
    const step = tableLineStep(state, "row", 1);

    expect(step.handled).toBe(true);
    const next = state.apply(step.tr!);

    expect(grid(next.doc)).toEqual([
      ["r0c0*", "r0c1*"],
      ["r2c0", "r2c1"],
      ["r1c0", "r1c1"],
      ["r3c0", "r3c1"]
    ]);
    expect(textAroundCaret(next)).toBe("r1|c1");
  });

  it("leaves the header row to the whole-table move", () => {
    const state = placeCaret(createEditor(table(3, 2)), "r0c0");

    expect(tableLineStep(state, "row", 1)).toEqual({ handled: false, tr: null });
    expect(tableLineStep(state, "row", -1)).toEqual({ handled: false, tr: null });
  });

  it("does not move the first body row above the header row", () => {
    const state = placeCaret(createEditor(table(3, 2)), "r1c0");

    expect(tableLineStep(state, "row", -1)).toEqual({ handled: true, tr: null });
  });

  it("stops at the last row and the outer columns", () => {
    const target = createEditor(table(3, 3));

    expect(tableLineStep(placeCaret(target, "r2c1"), "row", 1)).toEqual({ handled: true, tr: null });
    expect(tableLineStep(placeCaret(target, "r1c0"), "column", -1)).toEqual({ handled: true, tr: null });
    expect(tableLineStep(placeCaret(target, "r1c2"), "column", 1)).toEqual({ handled: true, tr: null });
  });

  it("moves a column with its header cell, the header row keeps its cell type", () => {
    const state = placeCaret(createEditor(table(2, 3)), "r1c0", 1);
    const next = state.apply(tableLineStep(state, "column", 1).tr!);

    expect(grid(next.doc)).toEqual([
      ["r0c1*", "r0c0*", "r0c2*"],
      ["r1c1", "r1c0", "r1c2"]
    ]);
    expect(textAroundCaret(next)).toBe("r|1c0");
  });

  it("moves columns from the header row too", () => {
    const state = placeCaret(createEditor(table(2, 3)), "r0c2");
    const next = state.apply(tableLineStep(state, "column", -1).tr!);

    expect(grid(next.doc)[0]).toEqual(["r0c0*", "r0c2*", "r0c1*"]);
  });

  it("is not handled outside a table", () => {
    const state = placeCaret(createEditor(paragraph("text"), table(2, 2)), "text");

    expect(tableLineStep(state, "row", 1)).toEqual({ handled: false, tr: null });
    expect(tableLineStep(state, "column", 1)).toEqual({ handled: false, tr: null });
  });

  it("refuses tables with merged cells", () => {
    const merged: JSONContent = {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("h0", true), cell("h1", true)] },
        { type: "tableRow", content: [cell("wide", false, { colspan: 2 })] },
        { type: "tableRow", content: [cell("a"), cell("b")] }
      ]
    };
    const state = placeCaret(createEditor(merged), "a");

    expect(tableLineStep(state, "row", -1)).toEqual({ handled: true, tr: null });
    expect(tableLineStep(state, "column", 1)).toEqual({ handled: true, tr: null });
  });
});

describe("moveTableLine", () => {
  it("moves a row several places, as a drop does", () => {
    const state = placeCaret(createEditor(table(5, 1)), "r4c0");
    const next = state.apply(moveTableLine(state, "row", 4, 1)!);

    expect(grid(next.doc).map(([first]) => first)).toEqual(["r0c0*", "r4c0", "r1c0", "r2c0", "r3c0"]);
    expect(textAroundCaret(next)).toBe("|r4c0");
  });

  it("keeps a row selection on the moved row", () => {
    const target = createEditor(table(4, 2));
    const { doc } = target.state;
    const first = doc.resolve(positionOf(doc, "r1c0") - 2);
    const last = doc.resolve(positionOf(doc, "r1c1") - 2);
    target.view.dispatch(target.state.tr.setSelection(CellSelection.rowSelection(last, first)));

    const next = target.state.apply(moveTableLine(target.state, "row", 1, 3)!);
    const selection = next.selection as CellSelection;

    expect(selection).toBeInstanceOf(CellSelection);
    expect(selection.isRowSelection()).toBe(true);
    expect(next.doc.nodeAt(selection.$headCell.pos)?.textContent).toBe("r1c0");
    expect(grid(next.doc).map(([cellText]) => cellText)).toEqual(["r0c0*", "r2c0", "r3c0", "r1c0"]);
  });

  it("returns null for a move that changes nothing or leaves the table", () => {
    const state = placeCaret(createEditor(table(3, 2)), "r1c0");

    expect(moveTableLine(state, "row", 1, 1)).toBeNull();
    expect(moveTableLine(state, "row", 1, 0)).toBeNull();
    expect(moveTableLine(state, "row", 1, 3)).toBeNull();
    expect(moveTableLine(state, "column", 0, 2)).toBeNull();
  });
});

describe("moveTopLevelTable", () => {
  function blocks(doc: ProseMirrorNode): string[] {
    const names: string[] = [];
    doc.forEach((node) => names.push(node.type.name === "table" ? "table" : node.textContent));
    return names;
  }

  it("moves the table in front of an earlier block and keeps the caret in it", () => {
    const target = createEditor(paragraph("a"), paragraph("b"), table(2, 2), paragraph("c"));
    const state = placeCaret(target, "r1c1", 3);
    const tablePos = state.doc.child(0).nodeSize + state.doc.child(1).nodeSize;
    const next = state.apply(moveTopLevelTable(state, tablePos, 0)!);

    expect(blocks(next.doc)).toEqual(["table", "a", "b", "c"]);
    expect(textAroundCaret(next)).toBe("r1c|1");
  });

  it("moves the table to the end and selects it when the caret was elsewhere", () => {
    const target = createEditor(table(2, 2), paragraph("a"), paragraph("b"));
    const state = placeCaret(target, "a");
    const next = state.apply(moveTopLevelTable(state, 0, 3)!);

    // StarterKit's TrailingNode keeps an empty paragraph at the very end.
    expect(blocks(next.doc)).toEqual(["a", "b", "table", ""]);
    expect(next.selection).toBeInstanceOf(NodeSelection);
    expect((next.selection as NodeSelection).node.type.name).toBe("table");
  });

  it("returns null when the table would stay where it is", () => {
    const target = createEditor(paragraph("a"), table(2, 2), paragraph("b"));
    const { state } = target;
    const tablePos = state.doc.child(0).nodeSize;

    expect(moveTopLevelTable(state, tablePos, 1)).toBeNull();
    expect(moveTopLevelTable(state, tablePos, 2)).toBeNull();
    expect(moveTopLevelTable(state, 0, 0)).toBeNull();
  });
});
