// Round-trip tests for the checkbox/list corner of the markdown pipeline.
// Parsing runs through markdown-it and a DOM, so unlike the other suites this
// one needs a document — hence the jsdom environment for this file only.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";

type JSONNode = { type?: string; text?: string; content?: JSONNode[] };

function open(markdown: string) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content: markdown
  });
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  const result = {
    markdown: storage.markdown?.getMarkdown?.() ?? "",
    doc: editor.getJSON() as JSONNode
  };
  editor.destroy();

  return result;
}

function countNodes(node: JSONNode, type: string): number {
  const self = node.type === type ? 1 : 0;
  return (node.content ?? []).reduce((total, child) => total + countNodes(child, type), self);
}

describe("task list markdown round-trip", () => {
  it("keeps an empty checkbox a checkbox", () => {
    const { markdown, doc } = open("- [ ] \n");

    expect(countNodes(doc, "taskItem")).toBe(1);
    expect(markdown.trimEnd()).toBe("- [ ]");
  });

  it("keeps an empty checked checkbox checked", () => {
    const { markdown } = open("- [x] \n");

    expect(markdown.trimEnd()).toBe("- [x]");
  });

  it("leaves escaped brackets as plain text", () => {
    const { markdown, doc } = open("- \\[ \\]\n- \\[ \\]\n");

    expect(countNodes(doc, "taskItem")).toBe(0);
    expect(markdown.trimEnd()).toBe("- \\[ \\]\n- \\[ \\]");
  });

  it("does not invent a checkbox in a list that mixes checkboxes and plain items", () => {
    const { doc } = open("- [x] a\n- normal\n- [ ] b\n");

    expect(countNodes(doc, "taskItem")).toBe(2);
    expect(countNodes(doc, "listItem")).toBe(1);
  });

  it("splits a mixed nested list without losing items", () => {
    const { doc } = open("- [ ] a\n  - [ ] b\n  - normal\n");

    expect(countNodes(doc, "taskItem")).toBe(2);
    expect(countNodes(doc, "listItem")).toBe(1);
  });

  // Regression: an empty checkbox followed by a blank line and further list
  // items used to parse into an extra, phantom checkbox and rewrite the
  // remaining items as escaped brackets — a file that changed just by being
  // opened.
  it("round-trips a document that mixes empty checkboxes, text items and checkboxes", () => {
    const source = [
      "- [ ] ",
      "",
      "- \\[ \\]",
      "- Hier ist ein Beispieltext:",
      "  - Wichtige Punkte",
      "",
      "- [x] erledigt",
      "",
      "- [ ] offen",
      ""
    ].join("\n");

    const first = open(source);
    const second = open(first.markdown);

    expect(countNodes(first.doc, "taskItem")).toBe(3);
    expect(countNodes(first.doc, "listItem")).toBe(3);
    expect(second.markdown).toBe(first.markdown);
  });
});
