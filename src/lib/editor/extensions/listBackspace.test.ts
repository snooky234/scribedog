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
