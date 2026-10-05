// The page lines against a real editor: every exported block has to find the
// node it came from, and the marks have to show up as decorations.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { PageLines, setPageLineMarks } from "@/lib/editor/pageLines";
import { createInnerResolver, serializeTopLevelNodes } from "@/lib/editor/pageLinesInput";
import { parseMarkdownToBlocksWithLines } from "@/lib/export/markdownModel";

const DOCUMENT = [
  "# Title",
  "",
  "A paragraph with **bold** and a [link](https://example.com).",
  "",
  "- one",
  "- two",
  "   - nested",
  "",
  "1. first",
  "2. second",
  "",
  "- [ ] open task",
  "- [x] done task",
  "",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "> [!INFO]",
  "> A callout",
  "",
  "> A quote",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  '<div style="page-break-after: always;"></div>',
  "",
  "---",
  "",
  "Last paragraph."
].join("\n");

const editors: Editor[] = [];

function createEditor(markdown: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), PageLines],
    content: markdown
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("serializeTopLevelNodes", () => {
  it("finds the node of every exported block", () => {
    const editor = createEditor(DOCUMENT);
    const { markdown, nodes } = serializeTopLevelNodes(editor);
    const { blocks, lines } = parseMarkdownToBlocksWithLines(markdown);

    expect(nodes).toHaveLength(editor.state.doc.childCount);
    expect(lines).toHaveLength(blocks.length);

    for (const line of lines) {
      expect(nodes.some((node) => node.startLine <= line && line < node.endLine)).toBe(true);
    }
  });
});

describe("setPageLineMarks", () => {
  it("draws a line between blocks and a marker inside one", () => {
    const editor = createEditor("First\n\nSecond\n\nThird\n");
    const positions: number[] = [];
    editor.state.doc.forEach((_node, offset) => positions.push(offset));
    const third = editor.state.doc.child(2);

    setPageLineMarks(editor, [
      { kind: "between", page: 2, pos: positions[1] },
      { kind: "within", page: 3, pos: positions[2], end: positions[2] + third.nodeSize, fraction: 0.4 }
    ]);

    const dom = editor.view.dom;
    expect(dom.querySelectorAll(".page-line")).toHaveLength(1);
    expect(dom.querySelector(".page-line")?.nextElementSibling?.textContent).toBe("Second");

    const within = dom.querySelector(".page-line-within") as HTMLElement | null;
    expect(within?.textContent).toBe("Third");
    expect(within?.style.getPropertyValue("--page-line-at")).toBe("40%");
  });

  it("removes every line again", () => {
    const editor = createEditor("First\n\nSecond\n");
    setPageLineMarks(editor, [{ kind: "between", page: 2, pos: editor.state.doc.child(0).nodeSize }]);
    setPageLineMarks(editor, null);

    expect(editor.view.dom.querySelector(".page-line")).toBeNull();
  });

  it("never changes the document", () => {
    const editor = createEditor("First\n\nSecond\n");
    const before = editor.state.doc;
    setPageLineMarks(editor, [{ kind: "between", page: 2, pos: editor.state.doc.child(0).nodeSize }]);

    expect(editor.state.doc).toBe(before);
  });
});

describe("createInnerResolver", () => {
  it("finds the exact word, table row, list item and code line a page begins with", () => {
    const editor = createEditor(
      [
        "First **bold** words and more words here.",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | x |",
        "| 2 | y |",
        "",
        "- one",
        "- two",
        "- three",
        "",
        "```",
        "a = 1",
        "b = 2",
        "c = 3",
        "```"
      ].join("\n")
    );
    const { nodes } = serializeTopLevelNodes(editor);
    const doc = editor.state.doc;
    const resolve = createInnerResolver(doc);
    const [paragraph, table, list, code] = nodes;

    const word = resolve(paragraph, { kind: "paragraph", offset: "First bold words and ".length });
    expect(word?.kind).toBe("inline");
    expect(doc.textBetween(paragraph.pos + 1, word!.pos)).toBe("First bold words and ");

    const row = resolve(table, { kind: "tableRow", row: 2 });
    expect(row?.kind).toBe("before");
    expect(doc.nodeAt(row!.pos)?.type.name).toBe("tableRow");
    // Row indices count the header row, in the export as in the editor.
    expect(doc.nodeAt(row!.pos)?.textContent).toBe("2y");
    // The label sits on the row's first cell, where the line starts.
    expect(doc.nodeAt(row!.kind === "before" ? row!.labelPos : 0)?.textContent).toBe("2");

    const item = resolve(list, { kind: "listItem", item: 2 });
    expect(doc.nodeAt(item!.pos)?.textContent).toBe("three");

    const line = resolve(code, { kind: "codeLine", line: 2 });
    expect(doc.textBetween(code.pos + 1, line!.pos)).toBe("a = 1\nb = 2\n");
  });

  it("finds a sub-point inside a nested list", () => {
    const editor = createEditor("- one\n  - a\n  - b\n- two\n");
    const { nodes } = serializeTopLevelNodes(editor);
    const doc = editor.state.doc;
    const item = createInnerResolver(doc)(nodes[0], { kind: "listItem", item: 0, within: { child: 1, item: 1 } });

    expect(item?.kind).toBe("before");
    expect(doc.nodeAt(item!.pos)?.type.name).toBe("listItem");
    expect(doc.nodeAt(item!.pos)?.textContent).toBe("b");
  });

  it("draws a line inside the text and on a table row", () => {
    const editor = createEditor("One two three four.\n\n| A |\n| - |\n| 1 |\n| 2 |\n");
    const { nodes } = serializeTopLevelNodes(editor);
    const resolve = createInnerResolver(editor.state.doc);
    const inline = resolve(nodes[0], { kind: "paragraph", offset: 8 })!;
    const row = resolve(nodes[1], { kind: "tableRow", row: 2 })!;

    setPageLineMarks(editor, [
      { ...inline, page: 2 },
      { ...row, page: 3 }
    ]);

    const dom = editor.view.dom;
    expect(dom.querySelector("p .page-line--inline")?.textContent).toMatch(/2/);
    expect(dom.querySelectorAll("tr.page-line-before")).toHaveLength(1);
    expect(dom.querySelector(".page-line-label")?.getAttribute("data-page-line")).toBeTruthy();
  });
});
