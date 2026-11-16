// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { EndGapCursor, isEndGap, moveAroundEndGap } from "@/lib/editor/extensions/endGapCursor";
import { EditorImage } from "@/lib/editor/extensions/image";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(markdown: string): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [...buildPreviewExtensions(), EditorImage, EndGapCursor],
    content: markdown
  });

  return editor;
}

function markdownOf(current: Editor): string {
  const storage = current.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

function selectImage(current: Editor, index = 0): void {
  const positions: number[] = [];

  current.state.doc.descendants((node, pos) => {
    if (node.type.name === "image") {
      positions.push(pos);
    }
  });

  current.view.dispatch(current.state.tr.setSelection(NodeSelection.create(current.state.doc, positions[index])));
}

function move(current: Editor, direction: "forward" | "backward"): void {
  const next = moveAroundEndGap(current.state, direction);

  if (next) {
    current.view.dispatch(current.state.tr.setSelection(next));
  }
}

const LIST_WITH_IMAGE = "- one\n- ![a](images/a.png)\n- three\n";

describe("end gap cursor", () => {
  it("stops below an image that ends a list item", () => {
    const e = open(LIST_WITH_IMAGE);

    selectImage(e);
    move(e, "forward");

    expect(e.state.selection).toBeInstanceOf(GapCursor);
    expect(e.state.selection.$head.parent.type.name).toBe("listItem");
  });

  it("goes back to the image and on to the next item", () => {
    const e = open(LIST_WITH_IMAGE);

    selectImage(e);
    move(e, "forward");
    move(e, "backward");
    expect(e.state.selection).toBeInstanceOf(NodeSelection);

    move(e, "forward");
    move(e, "forward");
    expect(e.state.selection).toBeInstanceOf(TextSelection);
    expect(e.state.selection.$head.parent.textContent).toBe("three");
  });

  it("puts typed text below the image in the same item", () => {
    const e = open(LIST_WITH_IMAGE);

    selectImage(e);
    move(e, "forward");
    e.view.dispatch(e.state.tr.insertText("caption"));

    expect(markdownOf(e)).toContain("- ![a](images/a.png)\n\n  caption");

    const reopened = open(markdownOf(e));
    const item = reopened.state.doc.firstChild?.child(1);

    expect(item?.childCount).toBe(2);
    expect(item?.child(0).type.name).toBe("image");
    expect(item?.child(1).textContent).toBe("caption");
  });

  it("opens a new line below the image on Enter", () => {
    const e = open(LIST_WITH_IMAGE);

    selectImage(e);
    move(e, "forward");
    e.view.someProp("handleKeyDown", (handler) =>
      handler(e.view, new KeyboardEvent("keydown", { key: "Enter" }))
    );

    const item = e.state.doc.firstChild?.child(1);

    expect(item?.childCount).toBe(2);
    expect(item?.child(1).type.name).toBe("paragraph");
    expect(e.state.selection.$head.parent).toBe(item?.child(1));
  });

  it("leaves the end of the document to the library", () => {
    const e = open("text\n\n![a](images/a.png)\n");

    selectImage(e);

    expect(isEndGap(e.state.selection.$to)).toBe(false);
  });

  it("does not stop after an image that text follows in the item", () => {
    const e = open("- ![a](images/a.png)\n  caption\n");

    selectImage(e);

    expect(isEndGap(e.state.selection.$to)).toBe(false);
  });
});
