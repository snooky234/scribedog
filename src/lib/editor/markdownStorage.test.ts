// Serializing a *part* of the document, which is what the three copy variants
// and the AI rewrite hand to the model. Parsing runs through markdown-it and a
// DOM, so this file needs a document.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { getSelectionMarkdown } from "@/lib/editor/markdownStorage";

function open(markdown: string) {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content: markdown
  });
}

describe("getSelectionMarkdown", () => {
  it("keeps an inline mark inside a single paragraph", () => {
    const editor = open("A line with **bold** in it.\n");
    const { doc } = editor.state;
    // The whole text of the first paragraph, boundaries excluded: the range a
    // selection made with Home/Shift+End produces.
    const paragraph = doc.child(0);
    const from = 1;
    const to = 1 + paragraph.content.size;

    const markdown = getSelectionMarkdown(editor, from, to);
    editor.destroy();

    expect(markdown).toBe("A line with **bold** in it.");
  });

  it("keeps the list markers when the selection spans whole blocks", () => {
    const editor = open("- first **item**\n- second item\n");
    const markdown = getSelectionMarkdown(editor, 0, editor.state.doc.content.size);
    editor.destroy();

    expect(markdown).toContain("- first **item**");
    expect(markdown).toContain("- second item");
  });

  it("keeps the numbers when the selection lies inside one ordered list", () => {
    const editor = open("1. one\n2. two\n3. three\n4. four\n");
    const list = editor.state.doc.child(0);
    // From inside "two" to inside "four": cut at the list, not above it.
    const itemStart = (index: number) => {
      let pos = 1;
      for (let i = 0; i < index; i++) pos += list.child(i).nodeSize;
      return pos;
    };
    const from = itemStart(1) + 2;
    const to = itemStart(3) + 2 + "four".length;

    const markdown = getSelectionMarkdown(editor, from, to);
    editor.destroy();

    expect(markdown).toBe("2. two\n3. three\n4. four");
  });

  it("keeps the markers when the selection lies inside one bullet list", () => {
    const editor = open("- one\n- two\n");
    const list = editor.state.doc.child(0);
    const from = 3;
    const to = 1 + list.child(0).nodeSize + 2 + "two".length;

    const markdown = getSelectionMarkdown(editor, from, to);
    editor.destroy();

    expect(markdown).toBe("- one\n- two");
  });
});
