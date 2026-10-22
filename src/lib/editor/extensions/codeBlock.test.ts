// A code block toggled on inside a list stays inside that list item instead of
// lifting the line out and splitting the list in two (issue #79), and it
// survives saving and reopening as an indented fenced block.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";

type JSONNode = { type?: string; attrs?: Record<string, unknown>; content?: JSONNode[]; text?: string };

const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });

const orderedList = (...items: JSONContent[][]): JSONContent => ({
  type: "orderedList",
  attrs: { start: 1 },
  content: items.map((content) => ({ type: "listItem", content }))
});

function createEditor(content: string | JSONContent) {
  return new Editor({ element: document.createElement("div"), extensions: buildPreviewExtensions(), content });
}

function markdownOf(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };

  return storage.markdown?.getMarkdown?.() ?? "";
}

// The caret goes into the first text that matches, at the given offset.
function placeCaret(editor: Editor, text: string, offset = 0): void {
  let pos = -1;

  editor.state.doc.descendants((node, position) => {
    if (pos === -1 && node.isText && node.text === text) {
      pos = position + offset;
    }
  });

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

// The caret goes into the only empty paragraph.
function placeCaretInEmptyParagraph(editor: Editor): void {
  let pos = -1;

  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "paragraph" && node.childCount === 0) {
      pos = position + 1;
    }
  });

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

function typeText(editor: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const insert = () => editor.state.tr.insertText(character, from, to);
    const handled = editor.view.someProp("handleTextInput", (handler) => handler(editor.view, from, to, character, insert));

    if (!handled) {
      editor.view.dispatch(insert());
    }
  }
}

// A line after the list, as the editor's trailing node would add one anyway.
const abcde = () => ({
  type: "doc",
  content: [orderedList([paragraph("a")], [paragraph("b")], [paragraph("c")], [paragraph("d")], [paragraph("e")]), paragraph("Ende")]
});

describe("toggling a code block inside a list", () => {
  it("keeps the line in its list item instead of splitting the list", () => {
    const editor = createEditor(abcde());
    placeCaret(editor, "d", 1);
    editor.commands.toggleCodeBlock();

    const doc = editor.getJSON() as JSONNode;
    editor.destroy();

    expect(doc.content?.map((child) => child.type)).toEqual(["orderedList", "paragraph"]);
    const items = doc.content?.[0]?.content ?? [];
    expect(items).toHaveLength(5);
    expect(items[3]?.content?.map((child) => child.type)).toEqual(["paragraph", "codeBlock"]);
    expect(items[3]?.content?.[0]?.content).toBeUndefined();
    expect(items[3]?.content?.[1]?.content?.[0]?.text).toBe("d");
  });

  it("leaves the caret where it was in the text", () => {
    const editor = createEditor({ type: "doc", content: [orderedList([paragraph("abcdef")])] });
    placeCaret(editor, "abcdef", 3);
    editor.commands.toggleCodeBlock();

    const { $from } = editor.state.selection;
    const result = { parent: $from.parent.type.name, offset: $from.parentOffset };
    editor.destroy();

    expect(result).toEqual({ parent: "codeBlock", offset: 3 });
  });

  it("puts an empty code block into an empty list item", () => {
    const editor = createEditor({ type: "doc", content: [orderedList([paragraph("a")], [paragraph("")])] });
    placeCaretInEmptyParagraph(editor);
    editor.commands.toggleCodeBlock();

    const items = (editor.getJSON() as JSONNode).content?.[0]?.content ?? [];
    const caretIn = editor.state.selection.$from.parent.type.name;
    editor.destroy();

    expect(items).toHaveLength(2);
    expect(items[1]?.content?.map((child) => child.type)).toEqual(["paragraph", "codeBlock"]);
    expect(caretIn).toBe("codeBlock");
  });

  it("works in a nested list and in a checklist", () => {
    const nested = createEditor({
      type: "doc",
      content: [orderedList([paragraph("a"), { type: "bulletList", content: [{ type: "listItem", content: [paragraph("x")] }] }])]
    });
    placeCaret(nested, "x", 1);
    nested.commands.toggleCodeBlock();
    const inner = (nested.getJSON() as JSONNode).content?.[0]?.content?.[0]?.content?.[1]?.content?.[0];
    nested.destroy();

    expect(inner?.content?.map((child) => child.type)).toEqual(["paragraph", "codeBlock"]);

    const tasks = createEditor({
      type: "doc",
      content: [{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [paragraph("t")] }] }]
    });
    placeCaret(tasks, "t", 1);
    tasks.commands.toggleCodeBlock();
    const task = (tasks.getJSON() as JSONNode).content?.[0]?.content?.[0];
    tasks.destroy();

    expect(task?.content?.map((child) => child.type)).toEqual(["paragraph", "codeBlock"]);
  });

  it("toggles back to the item's original line", () => {
    const editor = createEditor(abcde());
    const before = editor.getJSON();
    placeCaret(editor, "d", 1);
    editor.commands.toggleCodeBlock();
    editor.commands.toggleCodeBlock();

    const after = editor.getJSON();
    editor.destroy();

    expect(after).toEqual(before);
  });

  it("converts a later line of an item in place", () => {
    const editor = createEditor({ type: "doc", content: [orderedList([paragraph("Install:"), paragraph("npm i")])] });
    placeCaret(editor, "npm i", 1);
    editor.commands.toggleCodeBlock();

    const item = (editor.getJSON() as JSONNode).content?.[0]?.content?.[0];
    editor.destroy();

    expect(item?.content?.map((child) => child.type)).toEqual(["paragraph", "codeBlock"]);
    expect(item?.content?.[0]?.content?.[0]?.text).toBe("Install:");
  });

  it("is one undo step", () => {
    const editor = createEditor(abcde());
    const before = editor.getJSON();
    placeCaret(editor, "d", 1);
    editor.commands.toggleCodeBlock();
    editor.commands.undo();

    const after = editor.getJSON();
    editor.destroy();

    expect(after).toEqual(before);
  });
});

describe("typing a fence inside a list", () => {
  it("turns the first line of an item into a code block with its language", () => {
    const editor = createEditor({ type: "doc", content: [orderedList([paragraph("a")], [paragraph("")])] });
    placeCaretInEmptyParagraph(editor);
    typeText(editor, "```ts ");

    typeText(editor, "x");

    const item = (editor.getJSON() as JSONNode).content?.[0]?.content?.[1];
    editor.destroy();

    expect(item?.content?.map((child) => child.type)).toEqual(["paragraph", "codeBlock"]);
    expect(item?.content?.[1]?.attrs?.language).toBe("ts");
    expect(item?.content?.[0]?.content).toBeUndefined();
    expect(item?.content?.[1]?.content?.[0]?.text).toBe("x");
  });
});

describe("a code block in a list item as Markdown", () => {
  it("is saved as an indented fence and read back into the same item", () => {
    const editor = createEditor(abcde());
    placeCaret(editor, "d", 1);
    editor.commands.toggleCodeBlock({ language: "js" });

    const doc = editor.getJSON();
    const markdown = markdownOf(editor);
    editor.destroy();

    expect(markdown).toBe("1. a\n2. b\n3. c\n4. ```js\n   d\n   ```\n5. e\n\nEnde");

    const reopened = createEditor(markdown);
    const reread = reopened.getJSON();
    const resaved = markdownOf(reopened);
    reopened.destroy();

    expect(reread).toEqual(doc);
    expect(resaved).toBe(markdown);
  });

  it("keeps a multi-line block with a line before it", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        orderedList(
          [paragraph("Install:"), { type: "codeBlock", attrs: { language: "sh" }, content: [{ type: "text", text: "npm i\nnpm test" }] }],
          [paragraph("Done")]
        )
      ]
    });
    const doc = editor.getJSON();
    const markdown = markdownOf(editor);
    editor.destroy();

    const reopened = createEditor(markdown);
    const reread = reopened.getJSON();
    reopened.destroy();

    expect(reread).toEqual(doc);
  });

  it("reads a fence under an empty marker line into the item", () => {
    const reopened = createEditor("1. c\n2.\n   ```js\n   d\n   ```\n3. e");
    const resaved = markdownOf(reopened);
    reopened.destroy();

    expect(resaved).toBe("1. c\n2. ```js\n   d\n   ```\n3. e");
  });

  it("keeps a nested list tight", () => {
    const markdown = "- a\n  - ```\n    x\n    ```\n- b";
    const reopened = createEditor(markdown);
    const resaved = markdownOf(reopened);
    reopened.destroy();

    expect(resaved).toBe(markdown);
  });

  it("keeps a checklist item's checkbox line", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [paragraph("t")] }] },
        paragraph("Ende")
      ]
    });
    placeCaret(editor, "t", 1);
    editor.commands.toggleCodeBlock();

    const doc = editor.getJSON();
    const markdown = markdownOf(editor);
    editor.destroy();

    expect(markdown.startsWith("- [ ]")).toBe(true);

    const reopened = createEditor(markdown);
    const reread = reopened.getJSON();
    reopened.destroy();

    expect(reread).toEqual(doc);
  });
});

describe("backspace in an empty code block inside a list", () => {
  it("removes the block and keeps the item", () => {
    const editor = createEditor({ type: "doc", content: [orderedList([paragraph("a")], [paragraph("")]), paragraph("Ende")] });
    placeCaretInEmptyParagraph(editor);
    editor.commands.toggleCodeBlock();
    editor.commands.keyboardShortcut("Backspace");

    const doc = editor.getJSON() as JSONNode;
    const caretIn = editor.state.selection.$from.parent.type.name;
    editor.destroy();

    expect(doc.content?.map((child) => child.type)).toEqual(["orderedList", "paragraph"]);
    expect(doc.content?.[0]?.content?.[1]?.content?.map((child) => child.type)).toEqual(["paragraph"]);
    expect(caretIn).toBe("paragraph");
  });
});

// A paragraph whose lines are joined by hard breaks (Shift+Enter).
const lines = (...texts: string[]): JSONContent => ({
  type: "paragraph",
  content: texts.flatMap((text, i) => (i === 0 ? [] : [{ type: "hardBreak" }]).concat([{ type: "text", text }] as never[]))
});

const shape = (node: JSONNode | undefined): unknown =>
  node?.content?.map((child) =>
    child.type === "codeBlock"
      ? { code: child.content?.[0]?.text ?? "" }
      : (child.content ?? []).map((part) => (part.type === "hardBreak" ? "|" : part.text)).join("")
  );

function toggleIn(doc: JSONContent, text: string, offset = 1, extend = 0): { doc: JSONNode; caret: string; markdown: string } {
  const editor = createEditor(doc);
  placeCaret(editor, text, offset);

  if (extend) {
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + extend)));
  }

  editor.commands.toggleCodeBlock();
  const result = { doc: editor.getJSON() as JSONNode, caret: editor.state.selection.$from.parent.type.name, markdown: markdownOf(editor) };
  editor.destroy();

  return result;
}

describe("toggling a code block in a paragraph with line breaks", () => {
  it("takes only the caret's line in a list item and keeps the line above as the item's text", () => {
    const { doc, caret, markdown } = toggleIn(
      { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [lines("oben", "code")] }] }, paragraph("Ende")] },
      "code"
    );

    expect(shape(doc.content?.[0]?.content?.[0])).toEqual(["oben", { code: "code" }]);
    expect(caret).toBe("codeBlock");
    expect(markdown).toBe("- oben\n  ```\n  code\n  ```\n\nEnde");
  });

  it("keeps the lines before and after outside the block", () => {
    const { doc } = toggleIn({ type: "doc", content: [lines("eins", "zwei", "drei")] }, "zwei");

    expect(shape(doc)).toEqual(["eins", { code: "zwei" }, "drei"]);
  });

  it("takes a first line in a list item without the lines below", () => {
    const { doc } = toggleIn({ type: "doc", content: [orderedList([lines("code", "danach")]), paragraph("Ende")] }, "code");

    expect(shape(doc.content?.[0]?.content?.[0])).toEqual(["", { code: "code" }, "danach"]);
  });

  it("takes every line a selection touches", () => {
    const { doc } = toggleIn({ type: "doc", content: [lines("eins", "zwei", "drei", "vier")] }, "zwei", 1, 5);

    expect(shape(doc)).toEqual(["eins", { code: "zwei\ndrei" }, "vier"]);
  });

  it("is one undo step", () => {
    const editor = createEditor({ type: "doc", content: [lines("eins", "zwei", "drei"), paragraph("Ende")] });
    const before = editor.getJSON();
    placeCaret(editor, "zwei", 1);
    editor.commands.toggleCodeBlock();
    editor.commands.undo();

    const after = editor.getJSON();
    editor.destroy();

    expect(after).toEqual(before);
  });
});

describe("ArrowDown at the end of a code block", () => {
  const codeBlock = (text: string): JSONContent => ({ type: "codeBlock", content: [{ type: "text", text }] });

  function arrowDownAtEndOf(doc: JSONContent, code: string): { doc: JSONNode; caretIn: string } {
    const editor = createEditor(doc);
    placeCaret(editor, code, code.length);
    // Straight to ProseMirror: the keyboardShortcut command keeps only the
    // document steps of what a key does, not a caret that merely moves.
    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event));

    const result = { doc: editor.getJSON() as JSONNode, caretIn: editor.state.selection.$from.parent.textContent };
    editor.destroy();

    return result;
  }

  it("moves to the next list item instead of adding a line to this one", () => {
    const doc: JSONContent = { type: "doc", content: [orderedList([paragraph("eins"), codeBlock("code")], [paragraph("zwei")]), paragraph("Ende")] };
    const { doc: after, caretIn } = arrowDownAtEndOf(doc, "code");

    expect(shape(after.content?.[0]?.content?.[0])).toEqual(["eins", { code: "code" }]);
    expect(caretIn).toBe("zwei");
  });

  it("leaves a nested list for the next item of the outer one", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [orderedList([paragraph("eins"), orderedList([paragraph("innen"), codeBlock("code")])], [paragraph("zwei")]), paragraph("Ende")]
    };
    const { doc: after, caretIn } = arrowDownAtEndOf(doc, "code");

    expect(shape(after.content?.[0]?.content?.[0]?.content?.[1]?.content?.[0])).toEqual(["innen", { code: "code" }]);
    expect(caretIn).toBe("zwei");
  });

  it("still adds a line after a block that ends the document", () => {
    const { doc: after } = arrowDownAtEndOf({ type: "doc", content: [paragraph("eins"), codeBlock("code")] }, "code");

    expect(after.content?.map((child) => child.type)).toEqual(["paragraph", "codeBlock", "paragraph"]);
  });
});
