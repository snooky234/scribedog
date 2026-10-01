// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";

import { replaceDocumentKeepingSelection } from "./replaceDocument";

function markdownOf(editor: Editor): string {
  return ((editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? "").trim();
}

let editor: Editor | null = null;

function createEditor(markdown: string): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content: markdown
  });

  return editor;
}

// Places the caret right after `text` in the document.
function caretAfter(target: Editor, text: string) {
  let position = -1;

  target.state.doc.descendants((node, pos) => {
    if (position === -1 && node.isText && node.text?.includes(text)) {
      position = pos + node.text.indexOf(text) + text.length;
    }
  });

  target.commands.setTextSelection(position);
}

function textBeforeCaret(target: Editor, length: number): string {
  const { from } = target.state.selection;

  return target.state.doc.textBetween(Math.max(0, from - length), from);
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("replaceDocumentKeepingSelection", () => {
  it("replaces the content", () => {
    const target = createEditor("# Title\n\nFirst.\n\nSecond.");

    expect(replaceDocumentKeepingSelection(target, "# Title\n\nFirst, changed.\n\nSecond.")).toBe(true);
    expect(markdownOf(target)).toBe("# Title\n\nFirst, changed.\n\nSecond.");
  });

  it("keeps the caret in its sentence when text is inserted above it", () => {
    const target = createEditor("# Title\n\nFirst.\n\nI am typing here");
    caretAfter(target, "typing");

    replaceDocumentKeepingSelection(target, "# Title\n\nFirst.\n\nA whole new paragraph from someone else.\n\nI am typing here");

    expect(textBeforeCaret(target, "I am typing".length)).toBe("I am typing");
  });

  it("keeps the caret when text is changed below it", () => {
    const target = createEditor("I am typing here\n\nLast paragraph.");
    caretAfter(target, "typing");

    replaceDocumentKeepingSelection(target, "I am typing here\n\nLast paragraph, extended by someone else.");

    expect(textBeforeCaret(target, "I am typing".length)).toBe("I am typing");
  });

  it("does nothing for identical content", () => {
    const target = createEditor("Same.");
    const before = target.state.doc;

    expect(replaceDocumentKeepingSelection(target, "Same.")).toBe(true);
    expect(target.state.doc).toBe(before);
  });

  it("handles a change that repeats the text next to it", () => {
    const target = createEditor("aa");

    replaceDocumentKeepingSelection(target, "aaa");

    expect(markdownOf(target)).toBe("aaa");
  });
});
