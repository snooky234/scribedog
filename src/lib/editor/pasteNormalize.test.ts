// Paste repair for slices that carry hard breaks next to block nodes. Building
// the slices needs a schema, and parsing the editor's content needs a DOM.
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { buildPreviewExtensions } from "@/lib/editor/extensions";
import { normalizePastedSlice } from "@/lib/editor/pasteNormalize";

function withEditor<T>(content: string, run: (editor: Editor) => T): T {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPreviewExtensions(),
    content
  });
  const result = run(editor);
  editor.destroy();

  return result;
}

/** Describes a slice compactly so expectations read as the shape they assert. */
function shapeOf(slice: Slice): string {
  const children = Array.from({ length: slice.content.childCount }, (_, index) => {
    const child = slice.content.child(index);

    return child.textContent ? `${child.type.name}(${child.textContent})` : child.type.name;
  });

  return `${slice.openStart}${slice.openEnd}[${children.join(" ")}]`;
}

describe("normalizePastedSlice", () => {
  it("drops hard breaks that sit next to a block and merges the rest inline", () => {
    // The shape a real copy produced: selecting an emoji whose paragraph had
    // trailing hard breaks dragged those breaks in as top-level siblings.
    const normalized = withEditor("start", (editor) => {
      const { hardBreak, paragraph } = editor.schema.nodes;
      const slice = new Slice(
        Fragment.fromArray([
          hardBreak.create(),
          hardBreak.create(),
          paragraph.create(null, editor.schema.text("👍")),
          hardBreak.create(),
          hardBreak.create()
        ]),
        0,
        0
      );

      return normalizePastedSlice(slice);
    });

    // Reopened to 1/1 so it lands inside the target paragraph rather than
    // splitting it — pasting an emoji next to another must stay on one line.
    expect(shapeOf(normalized)).toBe("11[paragraph(👍)]");
  });

  it("actually pastes inline once repaired", () => {
    const markdown = withEditor("hello 👍", (editor) => {
      const { hardBreak, paragraph } = editor.schema.nodes;
      const slice = normalizePastedSlice(
        new Slice(
          Fragment.fromArray([
            hardBreak.create(),
            paragraph.create(null, editor.schema.text("👍")),
            hardBreak.create()
          ]),
          0,
          0
        )
      );

      editor.commands.focus("end");
      editor.view.dispatch(editor.state.tr.replaceSelection(slice));

      const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };

      return storage.markdown?.getMarkdown?.() ?? "";
    });

    expect(markdown).toBe("hello 👍👍");
  });

  it("keeps hard breaks that are real inline content", () => {
    // Copying across a <br> inside one paragraph: no block sibling, nothing to
    // repair — dropping these would lose the line break the user copied.
    const normalized = withEditor("start", (editor) => {
      const { hardBreak } = editor.schema.nodes;
      const slice = new Slice(
        Fragment.fromArray([editor.schema.text("a"), hardBreak.create(), editor.schema.text("b")]),
        1,
        1
      );

      return normalizePastedSlice(slice);
    });

    expect(shapeOf(normalized)).toBe("11[text(a) hardBreak text(b)]");
  });

  it("leaves an ordinary multi-paragraph copy alone", () => {
    const normalized = withEditor("start", (editor) => {
      const { paragraph } = editor.schema.nodes;
      const slice = new Slice(
        Fragment.fromArray([
          paragraph.create(null, editor.schema.text("first")),
          paragraph.create(null, editor.schema.text("second"))
        ]),
        0,
        0
      );

      return normalizePastedSlice(slice);
    });

    // Unchanged: these must still split the paragraph they are pasted into.
    expect(shapeOf(normalized)).toBe("00[paragraph(first) paragraph(second)]");
  });

  it("leaves a single pasted paragraph alone when no stray break is involved", () => {
    const normalized = withEditor("start", (editor) => {
      const { paragraph } = editor.schema.nodes;
      const slice = new Slice(
        Fragment.fromArray([paragraph.create(null, editor.schema.text("solo"))]),
        0,
        0
      );

      return normalizePastedSlice(slice);
    });

    expect(shapeOf(normalized)).toBe("00[paragraph(solo)]");
  });
});
