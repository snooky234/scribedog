// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { blockDropPosition, moveBlockNode } from "@/lib/editor/blockMove";
import { buildPreviewExtensions } from "@/lib/editor/extensions";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function image(src: string): JSONContent {
  return { type: "image", attrs: { src } };
}

function createDoc(...content: JSONContent[]): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    // The plain image node: same schema as EditorImage, without its React view.
    extensions: [...buildPreviewExtensions(), Image],
    content: { type: "doc", content }
  });

  return editor;
}

// "p:text" for a paragraph, "img:src" for an image, top level only.
function blocks(doc: ProseMirrorNode): string[] {
  const result: string[] = [];
  doc.forEach((node) => result.push(node.type.name === "image" ? `img:${node.attrs.src}` : `p:${node.textContent}`));
  return result;
}

// Position right before the top-level block at `index`.
function blockStart(doc: ProseMirrorNode, index: number): number {
  let pos = 0;

  for (let i = 0; i < index; i += 1) {
    pos += doc.child(i).nodeSize;
  }

  return pos;
}

describe("blockDropPosition", () => {
  it("lands a block dropped into a paragraph's text before or after that paragraph", () => {
    const { state } = createDoc(paragraph("first"), image("a.png"), paragraph("second paragraph"));
    const from = blockStart(state.doc, 1);
    const secondStart = blockStart(state.doc, 2);

    // Early in the text: before the paragraph, which is where the image already is.
    expect(blockDropPosition(state.doc, from, secondStart + 2)).toBeNull();
    // Late in the text: after it.
    expect(blockDropPosition(state.doc, from, secondStart + 15)).toBe(state.doc.content.size);
    // Into the first paragraph's start: before it.
    expect(blockDropPosition(state.doc, from, 2)).toBe(0);
  });

  it("is null for a drop onto the dragged node itself", () => {
    const { state } = createDoc(paragraph("first"), image("a.png"), paragraph("second"));
    const from = blockStart(state.doc, 1);

    expect(blockDropPosition(state.doc, from, from)).toBeNull();
    expect(blockDropPosition(state.doc, from, from + 1)).toBeNull();
  });
});

describe("moveBlockNode", () => {
  it("moves an image down past a paragraph and keeps it selected", () => {
    const { state } = createDoc(image("a.png"), paragraph("text"), paragraph("end"));
    const tr = moveBlockNode(state, 0, blockStart(state.doc, 2));
    const next = state.apply(tr!);

    expect(blocks(next.doc)).toEqual(["p:text", "img:a.png", "p:end"]);
    expect(next.selection).toBeInstanceOf(NodeSelection);
    expect((next.selection as NodeSelection).node.attrs.src).toBe("a.png");
  });

  it("moves an image up to the top", () => {
    const { state } = createDoc(paragraph("text"), image("a.png"), image("b.png"), paragraph("end"));
    const next = state.apply(moveBlockNode(state, blockStart(state.doc, 2), 0)!);

    expect(blocks(next.doc)).toEqual(["img:b.png", "p:text", "img:a.png", "p:end"]);
  });

  it("does nothing when the target is the node's own place", () => {
    const { state } = createDoc(paragraph("text"), image("a.png"), paragraph("end"));
    const from = blockStart(state.doc, 1);

    expect(moveBlockNode(state, from, from)).toBeNull();
    expect(moveBlockNode(state, from, blockStart(state.doc, 2))).toBeNull();
  });
});
