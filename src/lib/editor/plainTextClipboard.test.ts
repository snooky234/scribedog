// The text/plain half of Ctrl+C. TipTap's default wrote a separator per
// entered block, so a task list pasted into Notepad showed several blank lines
// per item. Needs a DOM for the editor that parses the markdown.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { plainTextBetween } from "@/lib/editor/plainTextClipboard";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function plainText(markdown: string): string {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content: markdown
  });
  const { doc } = editor.state;

  return plainTextBetween(doc, [{ from: 0, to: doc.content.size }]);
}

describe("plainTextBetween", () => {
  it("keeps one blank line between paragraphs", () => {
    expect(plainText("One\n\nTwo")).toBe("One\n\nTwo");
  });

  it("puts task list items on consecutive lines", () => {
    expect(plainText("Intro\n\n- [ ] a\n- [x] b\n- [ ] c\n\nOutro")).toBe("Intro\n\na\nb\nc\n\nOutro");
  });

  it("puts nested bullet and ordered list items on consecutive lines", () => {
    expect(plainText("- a\n  - a1\n- b\n\n1. x\n2. y")).toBe("a\na1\nb\n\nx\ny");
  });

  it("separates table cells by tabs and rows by newlines", () => {
    expect(plainText("| A | B |\n| --- | --- |\n| 1 | 2 |")).toBe("A\tB\n1\t2");
  });

  it("keeps line breaks inside a code block", () => {
    expect(plainText("```\nfirst\nsecond\n```")).toBe("first\nsecond");
  });

  it("clips the first and last block to the range", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: buildPreviewExtensions(),
      content: "Hello\n\nWorld"
    });

    // "Hello" spans 1..6, "World" 8..13.
    expect(plainTextBetween(editor.state.doc, [{ from: 3, to: 10 }])).toBe("llo\n\nWo");
  });
});
