// Backspace inside a list item must delete the line the caret is on, not
// dissolve the item: an empty paragraph under an image in a checklist used to
// take the checkbox with it. The lift at the real start of an item stays.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EditorImage } from "@/lib/editor/extensions/image";

type JSONNode = { type?: string; attrs?: Record<string, unknown>; content?: JSONNode[]; text?: string };

const image: JSONContent = { type: "image", attrs: { src: "images/a.png", alt: "shot" } };
const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const emptyParagraph: JSONContent = { type: "paragraph" };

const taskList = (content: JSONContent[]): JSONContent => ({
  type: "taskList",
  content: [{ type: "taskItem", attrs: { checked: false }, content }]
});

const bulletList = (content: JSONContent[]): JSONContent => ({
  type: "bulletList",
  content: [{ type: "listItem", content }]
});

function backspaceAt(doc: JSONContent, caret: (editor: Editor) => number): JSONNode {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), EditorImage],
    content: doc
  });

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret(editor))));
  editor.commands.keyboardShortcut("Backspace");

  const result = editor.getJSON() as JSONNode;
  editor.destroy();

  return result;
}

// Inside the only empty paragraph of the document.
const inEmptyParagraph = (editor: Editor): number => {
  let pos = -1;

  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "paragraph" && node.childCount === 0) {
      pos = position + 1;
    }
  });

  return pos;
};

// At the very start of the second list item's text.
const atStartOfSecondItem = (editor: Editor): number => {
  const items: number[] = [];

  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "taskItem") {
      items.push(position);
    }
  });

  return items[1] + 2;
};

describe("backspace inside a list item", () => {
  it("removes an empty line under an image without dropping the checkbox", () => {
    const result = backspaceAt(
      { type: "doc", content: [taskList([paragraph("Inline Code:"), image, emptyParagraph]), paragraph("danach")] },
      inEmptyParagraph
    );

    expect(result.content?.[0]?.type).toBe("taskList");
    const item = result.content?.[0]?.content?.[0];
    expect(item?.type).toBe("taskItem");
    expect(item?.content?.map((child) => child.type)).toEqual(["paragraph", "image"]);
  });

  it("removes an empty line under an image without dissolving a bullet item", () => {
    const result = backspaceAt(
      { type: "doc", content: [bulletList([paragraph("A"), image, emptyParagraph]), paragraph("danach")] },
      inEmptyParagraph
    );

    expect(result.content?.[0]?.type).toBe("bulletList");
    const item = result.content?.[0]?.content?.[0];
    expect(item?.content?.map((child) => child.type)).toEqual(["paragraph", "image"]);
  });

  it("removes a trailing empty paragraph in a task item", () => {
    const result = backspaceAt(
      { type: "doc", content: [taskList([paragraph("A"), emptyParagraph]), paragraph("danach")] },
      inEmptyParagraph
    );

    const item = result.content?.[0]?.content?.[0];
    expect(item?.type).toBe("taskItem");
    expect(item?.content?.map((child) => child.type)).toEqual(["paragraph"]);
  });

  it("still lifts the item when the caret is at its start", () => {
    const result = backspaceAt(
      {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              { type: "taskItem", attrs: { checked: false }, content: [paragraph("A")] },
              { type: "taskItem", attrs: { checked: false }, content: [paragraph("B")] }
            ]
          }
        ]
      },
      atStartOfSecondItem
    );

    expect(result.content?.[0]?.content?.length).toBe(1);
    expect(result.content?.[1]?.type).toBe("paragraph");
  });
});

// Two Backspaces on an empty checkbox: the first lifts it out of the list, the
// second has to remove the resulting empty line. It used to land as a second,
// invisible block in the item above: a gap in the checklist.
describe("backspace in an empty line after a list", () => {
  const task = (text: string): JSONContent => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [text ? paragraph(text) : emptyParagraph]
  });
  const bullet = (text: string): JSONContent => ({ type: "listItem", content: [text ? paragraph(text) : emptyParagraph] });

  // Runs the keys from the first empty paragraph (or the given position),
  // then types "x" so the result shows where the caret ended up. The keys go
  // through handleKeyDown like a real key press: the keyboardShortcut command
  // replays the steps of a nested dispatch and loses the join of two lists.
  function press(doc: JSONContent, keys: string[], caret: (editor: Editor) => number = inEmptyParagraph): JSONNode {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [...buildPreviewExtensions(), EditorImage],
      content: doc
    });

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret(editor))));
    keys.forEach((key) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      editor.view.someProp("handleKeyDown", (handleKeyDown) => handleKeyDown(editor.view, event));
    });
    editor.commands.insertContent("x");

    const result = editor.getJSON() as JSONNode;
    editor.destroy();

    return result;
  }

  const texts = (list: JSONNode | undefined): string[] =>
    (list?.content ?? []).map((item) => (item.content ?? []).map((block) => block.content?.[0]?.text ?? "").join("|"));

  it("leaves one checklist without a gap when an empty item in the middle is removed", () => {
    const result = press({ type: "doc", content: [{ type: "taskList", content: [task("A"), task(""), task("C")] }] }, [
      "Backspace",
      "Backspace"
    ]);

    expect(result.content?.[0]?.type).toBe("taskList");
    expect(texts(result.content?.[0])).toEqual(["Ax", "C"]);
    expect(result.content?.slice(1).map((node) => node.type)).toEqual(["paragraph"]);
  });

  it("removes an empty last item without a gap", () => {
    const result = press({ type: "doc", content: [{ type: "taskList", content: [task("A"), task("")] }] }, [
      "Backspace",
      "Backspace"
    ]);

    expect(texts(result.content?.[0])).toEqual(["Ax"]);
  });

  it("goes back to the end of the list after Enter twice left it", () => {
    const result = press(
      { type: "doc", content: [{ type: "taskList", content: [task("A")] }] },
      ["Enter", "Enter", "Backspace"],
      () => 4
    );

    expect(texts(result.content?.[0])).toEqual(["Ax"]);
  });

  it("does the same for a bullet list", () => {
    const result = press({ type: "doc", content: [{ type: "bulletList", content: [bullet("A"), bullet(""), bullet("C")] }] }, [
      "Backspace",
      "Backspace"
    ]);

    expect(result.content?.[0]?.type).toBe("bulletList");
    expect(texts(result.content?.[0])).toEqual(["Ax", "C"]);
  });

  it("puts the caret on the last line of a nested list", () => {
    const result = press(
      {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [paragraph("A"), { type: "taskList", content: [task("B")] }]
              }
            ]
          },
          emptyParagraph,
          paragraph("danach")
        ]
      },
      ["Backspace"]
    );

    const nested = result.content?.[0]?.content?.[0]?.content?.[1];
    expect(texts(nested)).toEqual(["Bx"]);
    expect(result.content?.slice(1).map((node) => node.content?.[0]?.text)).toEqual(["danach"]);
  });

  it("keeps lists of different kinds apart", () => {
    const result = press(
      { type: "doc", content: [{ type: "taskList", content: [task("A")] }, emptyParagraph, { type: "bulletList", content: [bullet("C")] }] },
      ["Backspace"]
    );

    expect(result.content?.map((node) => node.type)).toEqual(["taskList", "bulletList", "paragraph"]);
    expect(texts(result.content?.[0])).toEqual(["Ax"]);
  });

  it("keeps the start number when two numbered lists join", () => {
    const result = press(
      {
        type: "doc",
        content: [
          { type: "orderedList", attrs: { start: 3 }, content: [bullet("A")] },
          emptyParagraph,
          { type: "orderedList", attrs: { start: 1 }, content: [bullet("C")] }
        ]
      },
      ["Backspace"]
    );

    expect(result.content?.[0]?.attrs?.start).toBe(3);
    expect(texts(result.content?.[0])).toEqual(["Ax", "C"]);
  });

  it("removes the empty line inside a table cell", () => {
    const result = press(
      {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [{ type: "tableCell", content: [{ type: "taskList", content: [task("A")] }, emptyParagraph] }]
              }
            ]
          }
        ]
      },
      ["Backspace"]
    );

    const cell = result.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.content?.map((node) => node.type)).toEqual(["taskList"]);
    expect(texts(cell?.content?.[0])).toEqual(["Ax"]);
  });
});
