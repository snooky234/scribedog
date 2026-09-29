// Markdown round trip and insert command of the callout (hint banner) node.
// Parsing goes through markdown-it and a DOM, hence the jsdom environment.
// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";

const editors: Editor[] = [];

function createEditor(content: string | JSONContent): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

function json(editor: Editor): JSONContent {
  return editor.getJSON() as JSONContent;
}

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function callout(text: string): JSONContent {
  return { type: "callout", attrs: { variant: "warning" }, content: [paragraph(text)] };
}

function listWith(item: JSONContent[]): JSONContent {
  return { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: item }] }] };
}

// Drops what loading from markdown adds on its own: the trailing empty
// paragraph and the list's `tight` flag.
function normalize(node: JSONContent): JSONContent {
  const content = node.content?.map(normalize);
  const last = content?.[content.length - 1];

  if (node.type === "doc" && last?.type === "paragraph" && !last.content) {
    content?.pop();
  }

  const { tight: _tight, ...attrs } = node.attrs ?? {};

  return {
    ...node,
    ...(node.attrs ? { attrs } : {}),
    ...(content ? { content } : {})
  };
}

// Saves, reloads and saves again: the reloaded document has to equal the
// original, and the second save has to be stable.
function expectRoundTrip(doc: JSONContent) {
  const editor = createEditor(doc);
  const before = normalize(editor.getJSON());
  const saved = getMarkdown(editor);

  editor.commands.setContent(saved);

  expect(normalize(editor.getJSON())).toEqual(before);
  expect(getMarkdown(editor)).toBe(saved);

  return saved;
}

function placeCursorIn(editor: Editor, text: string) {
  let target = -1;

  editor.state.doc.descendants((node, pos) => {
    if (target === -1 && node.isText && node.text === text) {
      target = pos + 1;
    }
  });

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)));
}

describe("callout markdown", () => {
  it("round trips at the top level", () => {
    const saved = expectRoundTrip({ type: "doc", content: [callout("hint text")] });

    expect(saved).toBe("> [!WARNING]\n> hint text");
  });

  it("keeps a callout inside its list item", () => {
    const saved = expectRoundTrip(
      listWith([paragraph("item"), callout("hint text"), paragraph("after")])
    );

    expect(saved).toContain("  > [!WARNING]\n  > hint text");
  });

  it("keeps a callout inside a nested sub-item", () => {
    const markdown = "- item\n\n  - sub\n\n    > [!WARNING]\n    > hint text";
    const saved = expectRoundTrip(createEditor(markdown).getJSON());

    expect(saved).toBe(markdown);
  });

  it("keeps a multi-paragraph callout inside an ordered list", () => {
    expectRoundTrip({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                paragraph("item"),
                { type: "callout", attrs: { variant: "info" }, content: [paragraph("one"), paragraph("two")] }
              ]
            }
          ]
        }
      ]
    });
  });
});

describe("setCallout", () => {
  it("wraps a top-level paragraph", () => {
    const editor = createEditor("text\n");
    placeCursorIn(editor, "text");

    expect(editor.commands.setCallout({ variant: "success" })).toBe(true);
    expect(json(editor).content?.[0]).toMatchObject({
      type: "callout",
      attrs: { variant: "success" },
      content: [paragraph("text")]
    });
  });

  it("inserts an empty banner below the first paragraph of a list item", () => {
    const editor = createEditor("- one\n- two\n");
    placeCursorIn(editor, "one");

    expect(editor.commands.setCallout({ variant: "danger" })).toBe(true);

    const list = json(editor).content?.[0];

    expect(list?.content?.[0].content).toEqual([
      paragraph("one"),
      { type: "callout", attrs: { variant: "danger" }, content: [{ type: "paragraph" }] }
    ]);
    expect(list?.content?.[1].content).toEqual([paragraph("two")]);

    // The cursor lands inside the new banner, so typing fills it.
    editor.commands.insertContent("hint");

    expect(json(editor).content?.[0].content?.[0].content?.[1]).toEqual({
      type: "callout",
      attrs: { variant: "danger" },
      content: [paragraph("hint")]
    });
  });

  it("works in a nested sub-item", () => {
    const editor = createEditor("- one\n  - sub\n");
    placeCursorIn(editor, "sub");

    expect(editor.commands.setCallout({ variant: "info" })).toBe(true);
    expect(getMarkdown(editor)).toContain("  - sub\n\n    > [!INFO]");
  });

  it("wraps a later paragraph of a list item", () => {
    const editor = createEditor(listWith([paragraph("item"), paragraph("second")]));
    placeCursorIn(editor, "second");

    expect(editor.commands.setCallout({ variant: "info" })).toBe(true);
    expect(json(editor).content?.[0].content?.[0].content?.[1]).toMatchObject({
      type: "callout",
      content: [paragraph("second")]
    });
  });
});
