// Tests for the table serializer's one guarantee: a table never leaves the
// editor as the "[table]" placeholder (issue #56), whatever its cells hold.
// Parsing goes through markdown-it and a DOM, hence the jsdom environment.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EditorImage } from "@/lib/editor/extensions/image";

type JSONNode = { type?: string; attrs?: Record<string, unknown>; content?: JSONNode[]; text?: string };

// The serializer indents nested list items with non-breaking spaces.
const NESTING_INDENT = String.fromCharCode(0xa0).repeat(2);

function createEditor(content: string | JSONContent) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), EditorImage],
    content
  });
}

function serialize(content: string | JSONContent): string {
  const editor = createEditor(content);
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  const markdown = storage.markdown?.getMarkdown?.() ?? "";
  editor.destroy();

  return markdown;
}

function parse(markdown: string): { doc: JSONNode; text: string } {
  const editor = createEditor(markdown);
  const result = { doc: editor.getJSON() as JSONNode, text: editor.state.doc.textContent };
  editor.destroy();

  return result;
}

function findAll(node: JSONNode, type: string, found: JSONNode[] = []): JSONNode[] {
  if (node.type === type) {
    found.push(node);
  }

  for (const child of node.content ?? []) {
    findAll(child, type, found);
  }

  return found;
}

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
}

function cell(type: "tableCell" | "tableHeader", content: JSONContent[], attrs: Record<string, unknown> = {}): JSONContent {
  return { type, attrs: { colspan: 1, rowspan: 1, ...attrs }, content };
}

function table(rows: JSONContent[][]): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: rows.map((cells) => ({ type: "tableRow", content: cells }))
      }
    ]
  };
}

function bulletList(...items: string[]): JSONContent {
  return {
    type: "bulletList",
    content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] }))
  };
}

describe("table markdown serializer", () => {
  it("round-trips a plain table unchanged", () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";

    expect(serialize(source)).toBe(source);
  });

  it("keeps the text of a cell that holds a list (issue #56)", () => {
    const markdown = serialize(
      table([
        [cell("tableHeader", [paragraph("Topic")]), cell("tableHeader", [paragraph("Notes")])],
        [cell("tableCell", [paragraph("Frame")]), cell("tableCell", [paragraph("Intro"), bulletList("first", "second")])]
      ])
    );

    expect(markdown).not.toContain("[table]");
    expect(markdown).toContain("| Frame | Intro<br>• first<br>• second |");

    const { text } = parse(markdown);
    expect(text).toContain("first");
    expect(text).toContain("second");
  });

  it("indents nested lists and numbers ordered items", () => {
    const markdown = serialize(
      table([
        [cell("tableHeader", [paragraph("H")])],
        [
          cell("tableCell", [
            {
              type: "orderedList",
              attrs: { start: 3 },
              content: [
                { type: "listItem", content: [paragraph("outer"), bulletList("inner")] },
                { type: "listItem", content: [paragraph("next")] }
              ]
            }
          ])
        ]
      ])
    );

    expect(markdown).toContain(`| 3) outer<br>${NESTING_INDENT}• inner<br>4) next |`);
  });

  it("writes a hard break inside a cell as <br> and reads it back", () => {
    const markdown = serialize(
      table([
        [cell("tableHeader", [paragraph("H")])],
        [cell("tableCell", [{ type: "paragraph", content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }] }])]
      ])
    );

    expect(markdown).not.toContain("[hardBreak]");
    expect(markdown).toContain("| one<br>two |");

    const { doc } = parse(markdown);
    expect(findAll(doc, "hardBreak")).toHaveLength(1);
    expect(serialize(markdown)).toBe(markdown);
  });

  it("keeps a hard break outside a table as a backslash line break", () => {
    expect(serialize("one\\\ntwo\n")).toBe("one\\\ntwo");
  });

  it("promotes the first row to the header when the table has none", () => {
    const markdown = serialize(
      table([
        [cell("tableCell", [paragraph("a")]), cell("tableCell", [paragraph("b")])],
        [cell("tableCell", [paragraph("c")]), cell("tableCell", [paragraph("d")])]
      ])
    );

    expect(markdown).toBe("| a | b |\n| --- | --- |\n| c | d |\n");
  });

  it("pads merged cells so every row keeps its column count", () => {
    const markdown = serialize(
      table([
        [cell("tableHeader", [paragraph("A")]), cell("tableHeader", [paragraph("B")]), cell("tableHeader", [paragraph("C")])],
        [cell("tableCell", [paragraph("wide")], { colspan: 2 }), cell("tableCell", [paragraph("x")])]
      ])
    );

    expect(markdown).toBe("| A | B | C |\n| --- | --- | --- |\n| wide |  | x |\n");
  });

  it("escapes pipes so they cannot end a cell", () => {
    const markdown = serialize(
      table([[cell("tableHeader", [paragraph("H")])], [cell("tableCell", [paragraph("a | b")])]])
    );

    expect(markdown).toContain("| a \\| b |");
    expect(parse(markdown).text).toBe("Ha | b");
  });

  it("keeps a literal <br> typed into a cell as text", () => {
    const markdown = serialize(table([[cell("tableHeader", [paragraph("H")])], [cell("tableCell", [paragraph("a<br>b")])]]));

    expect(markdown).toContain("| a&lt;br&gt;b |");
    expect(findAll(parse(markdown).doc, "hardBreak")).toHaveLength(0);
    expect(parse(markdown).text).toBe("Ha<br>b");
  });

  it("keeps inline marks and a code block inside a cell", () => {
    const markdown = serialize(
      table([
        [cell("tableHeader", [paragraph("H")])],
        [
          cell("tableCell", [
            { type: "paragraph", content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }] },
            { type: "codeBlock", content: [{ type: "text", text: "x = 1\ny = 2" }] }
          ])
        ]
      ])
    );

    expect(markdown).toContain("| **bold**<br>x = 1<br>y = 2 |");
  });

  it("serializes a table inside a blockquote with the quote prefix on every row", () => {
    const markdown = serialize({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            paragraph("intro"),
            table([[cell("tableHeader", [paragraph("H")])], [cell("tableCell", [paragraph("a"), paragraph("b")])]]).content![0]
          ]
        }
      ]
    });

    expect(markdown).toBe("> intro\n>\n> | H |\n> | --- |\n> | a<br>b |\n");
  });
});

describe("lists in table cells", () => {
  function cellListEditor(markdown = "| H |\n| --- |\n| text |\n") {
    const editor = createEditor(markdown);
    let cellStart = -1;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" && cellStart === -1) {
        // Just inside the cell's paragraph.
        cellStart = pos + 2;
      }
    });

    expect(cellStart).toBeGreaterThan(-1);
    editor.commands.setTextSelection(cellStart);

    return editor;
  }

  it.each([
    ["toggleBulletList", "bulletList"],
    ["toggleOrderedList", "orderedList"],
    ["toggleTaskList", "taskList"]
  ] as const)("%s turns a cell's text into a %s", (command, type) => {
    const editor = cellListEditor();

    expect(editor.commands[command]()).toBe(true);
    expect(findAll(findAll(editor.getJSON() as JSONNode, "tableCell")[0], type)).toHaveLength(1);

    editor.destroy();
  });

  it("reads bullet, numbered and checklists in a cell back as lists", () => {
    const markdown = serialize(
      table([
        [cell("tableHeader", [paragraph("H")])],
        [
          cell("tableCell", [
            paragraph("Intro"),
            bulletList("first", "second"),
            {
              type: "orderedList",
              attrs: { start: 3 },
              content: [
                { type: "listItem", content: [paragraph("outer"), bulletList("inner")] },
                { type: "listItem", content: [paragraph("next")] }
              ]
            },
            {
              type: "taskList",
              content: [
                { type: "taskItem", attrs: { checked: true }, content: [paragraph("done")] },
                { type: "taskItem", attrs: { checked: false }, content: [paragraph("open")] }
              ]
            },
            paragraph("Outro")
          ])
        ]
      ])
    );

    const { doc } = parse(markdown);
    const [tableCell] = findAll(doc, "tableCell");

    expect(tableCell.content?.map((block) => block.type)).toEqual([
      "paragraph",
      "bulletList",
      "orderedList",
      "taskList",
      "paragraph"
    ]);
    expect(findAll(tableCell, "orderedList")[0].attrs?.start).toBe(3);
    expect(findAll(findAll(tableCell, "orderedList")[0], "bulletList")).toHaveLength(1);
    expect(findAll(tableCell, "taskItem").map((item) => item.attrs?.checked)).toEqual([true, false]);
    expect(findAll(tableCell, "text").map((text) => text.text)).toEqual([
      "Intro",
      "first",
      "second",
      "outer",
      "inner",
      "next",
      "done",
      "open",
      "Outro"
    ]);

    // Opening and saving again leaves the file as it was.
    expect(serialize(markdown)).toBe(markdown);
  });

  it("keeps a line break inside a list item in its item", () => {
    const markdown = serialize(
      table([
        [cell("tableHeader", [paragraph("H")])],
        [
          cell("tableCell", [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }] }
                  ]
                },
                { type: "listItem", content: [paragraph("three")] }
              ]
            }
          ])
        ]
      ])
    );

    expect(markdown).toContain(`| • one<br>${NESTING_INDENT}two<br>• three |`);

    const [tableCell] = findAll(parse(markdown).doc, "tableCell");
    const items = findAll(tableCell, "listItem");

    expect(tableCell.content).toHaveLength(1);
    expect(items).toHaveLength(2);
    expect(findAll(items[0], "hardBreak")).toHaveLength(1);
    expect(serialize(markdown)).toBe(markdown);
  });

  it("leaves a cell without a list glyph untouched", () => {
    const { doc } = parse("| H |\n| --- |\n| a<br>- b<br>c • d |\n");
    const [tableCell] = findAll(doc, "tableCell");

    expect(tableCell.content?.map((block) => block.type)).toEqual(["paragraph"]);
    expect(findAll(tableCell, "hardBreak")).toHaveLength(2);
  });

  it("still turns a paragraph outside a table into a list", () => {
    const editor = createEditor("text\n");

    editor.commands.setTextSelection(1);

    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(findAll(editor.getJSON() as JSONNode, "bulletList")).toHaveLength(1);

    editor.destroy();
  });
});

describe("Enter inside a table cell", () => {
  function pressEnter(editor: Editor): boolean {
    const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true });

    return editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event)) ?? false;
  }

  it("inserts a line break instead of a second paragraph", () => {
    const editor = createEditor("| H |\n| --- |\n| text |\n");
    let cellEnd = -1;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" && cellEnd === -1) {
        // End of the cell's paragraph text.
        cellEnd = pos + 2 + node.firstChild!.content.size;
      }
    });

    editor.commands.setTextSelection(cellEnd);

    expect(pressEnter(editor)).toBe(true);

    const cells = findAll(editor.getJSON() as JSONNode, "tableCell");
    expect(cells[0].content).toHaveLength(1);
    expect(findAll(cells[0], "hardBreak")).toHaveLength(1);

    editor.destroy();
  });

  it("starts the next list item inside a list in a cell", () => {
    const editor = createEditor("| H |\n| --- |\n| • one |\n");
    let itemEnd = -1;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "one") {
        itemEnd = pos + 1 + node.content.size;
      }
    });

    editor.commands.setTextSelection(itemEnd);

    expect(pressEnter(editor)).toBe(true);

    const [tableCell] = findAll(editor.getJSON() as JSONNode, "tableCell");
    expect(findAll(tableCell, "listItem")).toHaveLength(2);
    expect(findAll(tableCell, "hardBreak")).toHaveLength(0);

    editor.destroy();
  });

  it("still splits a paragraph outside a table", () => {
    const editor = createEditor("text\n");

    editor.commands.setTextSelection(5);

    expect(pressEnter(editor)).toBe(true);
    expect(findAll(editor.getJSON() as JSONNode, "paragraph")).toHaveLength(2);
    expect(findAll(editor.getJSON() as JSONNode, "hardBreak")).toHaveLength(0);

    editor.destroy();
  });
});

describe("Tab inside a list in a table cell", () => {
  function pressKey(editor: Editor, key: string, shiftKey = false): boolean {
    const event = new KeyboardEvent("keydown", { key, code: key, shiftKey, bubbles: true });

    return editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event)) ?? false;
  }

  function selectText(editor: Editor, text: string): void {
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === text) {
        editor.commands.setTextSelection(pos + 1);
      }
    });
  }

  it("indents the item and outdents it again with Shift+Tab", () => {
    const editor = createEditor("| A | B |\n| --- | --- |\n| • one<br>• two | x |\n");

    selectText(editor, "two");
    expect(pressKey(editor, "Tab")).toBe(true);
    expect(findAll(findAll(editor.getJSON() as JSONNode, "tableCell")[0], "bulletList")).toHaveLength(2);

    expect(pressKey(editor, "Tab", true)).toBe(true);
    expect(findAll(findAll(editor.getJSON() as JSONNode, "tableCell")[0], "bulletList")).toHaveLength(1);
    expect(findAll(findAll(editor.getJSON() as JSONNode, "tableCell")[0], "listItem")).toHaveLength(2);

    editor.destroy();
  });

  it("moves to the next cell from an item that can't be indented", () => {
    const editor = createEditor("| A | B |\n| --- | --- |\n| • one | x |\n");

    selectText(editor, "one");
    expect(pressKey(editor, "Tab")).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe("x");

    editor.destroy();
  });
});

describe("list input rules inside a table cell", () => {
  function typeText(editor: Editor, text: string): void {
    for (const character of text) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (handler) => handler(editor.view, from, to, character, () => editor.state.tr.insertText(character, from, to)));

      if (!handled) {
        editor.view.dispatch(editor.state.tr.insertText(character, from, to));
      }
    }
  }

  it.each([
    ["- ", "bulletList"],
    ["1. ", "orderedList"],
    ["[ ] ", "taskList"]
  ])("turns \"%s\" at the start of a cell into a %s", (trigger, type) => {
    const editor = createEditor("| H |\n| --- |\n|  |\n");
    let cellStart = -1;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" && cellStart === -1) {
        cellStart = pos + 2;
      }
    });

    editor.commands.setTextSelection(cellStart);
    typeText(editor, `${trigger}item`);

    const [tableCell] = findAll(editor.getJSON() as JSONNode, "tableCell");
    expect(findAll(tableCell, type)).toHaveLength(1);
    expect(editor.state.doc.textContent).toBe("Hitem");

    editor.destroy();
  });
});
