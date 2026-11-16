// An image inserted into an empty bullet or checkbox sits on the marker's
// line: no empty paragraph above it, and the Markdown keeps it in the list
// after reopening.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EditorImage } from "@/lib/editor/extensions/image";

type JSONNode = { type?: string; content?: JSONNode[] };

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(content: string | JSONContent): Editor {
  editor?.destroy();
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), EditorImage],
    content
  });

  return editor;
}

function markdownOf(current: Editor): string {
  const storage = current.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

// Child types of every item of the first list in the document.
function itemContent(current: Editor): string[][] {
  const list = (current.getJSON() as JSONNode).content?.[0];
  return (list?.content ?? []).map((item) => (item.content ?? []).map((child) => child.type ?? ""));
}

function insertImageIntoEmptyParagraph(current: Editor): void {
  let caret = -1;

  current.state.doc.descendants((node, pos) => {
    if (caret === -1 && node.type.name === "paragraph" && node.childCount === 0) {
      caret = pos + 1;
    }
  });

  current
    .chain()
    .insertContentAt(caret, { type: "image", attrs: { src: "images/a.png", alt: "a" } })
    .run();
}

const paragraph = (text?: string): JSONContent =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };

describe("image as the first block of a list item", () => {
  it("replaces the empty line of a new bullet", () => {
    const e = open({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph("one")] },
            { type: "listItem", content: [paragraph()] }
          ]
        }
      ]
    });

    insertImageIntoEmptyParagraph(e);

    expect(itemContent(e)).toEqual([["paragraph"], ["image"]]);
    expect(markdownOf(e)).toBe("- one\n- ![a](images/a.png)");
  });

  it("replaces the empty line of a new checkbox", () => {
    const e = open({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: false }, content: [paragraph("one")] },
            { type: "taskItem", attrs: { checked: false }, content: [paragraph()] }
          ]
        }
      ]
    });

    insertImageIntoEmptyParagraph(e);

    expect(itemContent(e)).toEqual([["paragraph"], ["image"]]);
    expect(markdownOf(e)).toContain("- [ ] ![a](images/a.png)");
  });

  it("reads an image-only bullet back into the list", () => {
    const e = open("- one\n- ![a](images/a.png)\n");

    expect(itemContent(e)).toEqual([["paragraph"], ["image"]]);
    expect(markdownOf(e)).toBe("- one\n- ![a](images/a.png)");
  });

  it("reads an image-only checkbox back without an empty line", () => {
    for (const source of ["- [ ] one\n- [ ] ![a](images/a.png)\n", "- [ ] one\n\n- [ ] ![a](images/a.png)\n"]) {
      const e = open(source);

      expect(itemContent(e)).toEqual([["paragraph"], ["image"]]);
    }
  });

  it("keeps text before an image in its own line", () => {
    const e = open("- [ ] one\n\n- [ ] Text ![a](images/a.png)\n");

    expect(itemContent(e)).toEqual([["paragraph"], ["paragraph", "image"]]);
  });

  it("still fills a new item with a paragraph", () => {
    const e = open("- one\n");

    expect(e.schema.nodes.listItem.createAndFill()?.firstChild?.type.name).toBe("paragraph");
    expect(e.schema.nodes.taskItem.createAndFill()?.firstChild?.type.name).toBe("paragraph");
  });
});
