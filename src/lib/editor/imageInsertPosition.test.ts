// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EditorImage } from "@/lib/editor/extensions/image";
import { imageInsertPosition } from "@/lib/editor/imageInsertPosition";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(markdown: string): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), EditorImage],
    content: markdown
  });

  return editor;
}

function markdownOf(current: Editor): string {
  const storage = current.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

function imagePositions(current: Editor): number[] {
  const positions: number[] = [];

  current.state.doc.descendants((node, pos) => {
    if (node.type.name === "image") {
      positions.push(pos);
    }
  });

  return positions;
}

function insertImage(current: Editor, src: string): void {
  current
    .chain()
    .insertContentAt(imageInsertPosition(current.state.selection), { type: "image", attrs: { src, alt: "b" } })
    .run();
}

describe("imageInsertPosition", () => {
  it("puts a new image after a selected image in a list item", () => {
    const e = open("- one\n- ![a](images/a.png)\n");
    const [imagePos] = imagePositions(e);

    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, imagePos)));
    insertImage(e, "images/b.png");

    const sources: string[] = [];
    e.state.doc.descendants((node) => {
      if (node.type.name === "image") {
        sources.push(String(node.attrs.src));
      }
    });

    expect(sources).toEqual(["images/a.png", "images/b.png"]);
    expect(markdownOf(e)).toContain("![a](images/a.png)");
    expect(markdownOf(e).indexOf("images/a.png")).toBeLessThan(markdownOf(e).indexOf("images/b.png"));
  });

  it("uses the caret when nothing is selected as a node", () => {
    const e = open("one two\n");

    e.commands.setTextSelection(4);

    expect(imageInsertPosition(e.state.selection)).toBe(4);
  });
});
