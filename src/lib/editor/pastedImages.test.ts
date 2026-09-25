// Building the slices needs the editor's schema, and creating an editor needs a DOM.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { beforeEach, describe, expect, it } from "vitest";

import { holdClipboardImages } from "@/lib/clipboardImages";
import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EditorImage } from "@/lib/editor/extensions/image";
import { adoptPastedImages } from "@/lib/editor/pastedImages";

function withEditor<T>(run: (editor: Editor) => T): T {
  const editor = new Editor({
    element: document.createElement("div"),
    // The NodeView renders through React, which a plain editor has no renderer for.
    extensions: [...buildPreviewExtensions(), EditorImage.extend({ addNodeView: null })],
    content: ""
  });
  const result = run(editor);
  editor.destroy();

  return result;
}

function sourcesOf(slice: Slice): string[] {
  const sources: string[] = [];

  slice.content.descendants((node) => {
    if (node.type.name === "image") {
      sources.push(node.attrs.src as string);
    }
  });

  return sources;
}

beforeEach(() => {
  holdClipboardImages(null, []);
});

describe("adoptPastedImages", () => {
  it("rewrites the clipboard's images, also nested ones, and leaves the rest", () => {
    holdClipboardImages("/vault/a.md", ["images/a.png"]);

    const sources = withEditor((editor) => {
      const { blockquote, doc, image } = editor.schema.nodes;
      const content = doc.create(null, [
        image.create({ src: "images/a.png" }),
        blockquote.create(null, [image.create({ src: "images/a.png" })]),
        image.create({ src: "images/b.png" })
      ]).content;

      return sourcesOf(adoptPastedImages(new Slice(content, 0, 0), "/vault/sub/c.md", "/vault"));
    });

    expect(sources).toEqual(["../images/a.png", "../images/a.png", "images/b.png"]);
  });

  it("returns the slice itself when nothing changes", () => {
    withEditor((editor) => {
      const { doc, image } = editor.schema.nodes;
      const slice = new Slice(doc.create(null, [image.create({ src: "images/a.png" })]).content, 0, 0);

      expect(adoptPastedImages(slice, "/vault/sub/c.md", "/vault")).toBe(slice);
    });
  });
});
