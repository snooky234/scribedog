import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

import type { ClassifiedHunk, CompareBlock } from "@/lib/editor/compareNotes";

// Paints the differences of "Open as reference" into the read-only note beside the
// editor (compareNotes.ts has the comparison itself). Three kinds, as
// classifyCompareHunk sorts them: a block the open note has in another form
// (yellow), one it does not have (red), and, between the blocks, a green
// marker where the open note has blocks this one lacks, saying how many.
// Each hunk's first decoration carries its index, which the pane's
// previous/next buttons scroll to.
//
// The decorations are computed by the pane and handed in whole: the document
// is read-only, so the only change it ever sees is a new content, after
// which the pane computes them again.
export const COMPARE_HUNK_ATTRIBUTE = "data-compare-hunk";

const compareHighlightKey = new PluginKey<DecorationSet>("compareHighlight");

export type CompareHighlightInput = {
  blocks: CompareBlock[];
  hunks: ClassifiedHunk[];
  labels: {
    /** Tooltip of a block the open note has in another form. */
    changed: string;
    /** Tooltip of a block the open note does not have. */
    missing: string;
    /** Text of the marker for blocks only the open note has. */
    extra: (count: number) => string;
  };
};

export function buildCompareDecorations(doc: ProseMirrorNode, input: CompareHighlightInput): DecorationSet {
  const decorations: Decoration[] = [];

  input.hunks.forEach((hunk, index) => {
    for (let blockIndex = hunk.refStart; blockIndex < hunk.refEnd; blockIndex += 1) {
      const block = input.blocks[blockIndex];

      if (!block) {
        continue;
      }

      const isChanged = hunk.kinds[blockIndex - hunk.refStart] === "changed";

      decorations.push(
        Decoration.node(block.from, block.to, {
          class: `compare-diff compare-diff--${isChanged ? "changed" : "missing"}`,
          title: isChanged ? input.labels.changed : input.labels.missing,
          ...(blockIndex === hunk.refStart ? { [COMPARE_HUNK_ATTRIBUTE]: String(index) } : {})
        })
      );
    }

    if (hunk.extra > 0) {
      // In front of the block that follows the gap, or at the very end.
      const nextBlock = input.blocks[hunk.refEnd];
      const pos = nextBlock ? nextBlock.from : doc.content.size;
      const label = input.labels.extra(hunk.extra);
      const isFirstOfHunk = hunk.refEnd === hunk.refStart;

      decorations.push(
        Decoration.widget(
          pos,
          () => {
            const marker = document.createElement("div");
            marker.className = "compare-diff-insert";
            marker.setAttribute("contenteditable", "false");
            marker.textContent = label;

            if (isFirstOfHunk) {
              marker.setAttribute(COMPARE_HUNK_ATTRIBUTE, String(index));
            }

            return marker;
          },
          { side: -1, key: `compare-insert-${index}-${hunk.extra}`, ignoreSelection: true }
        )
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const CompareHighlight = Extension.create({
  name: "compareHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: compareHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, value) {
            const meta = tr.getMeta(compareHighlightKey) as DecorationSet | undefined;

            if (meta) {
              return meta;
            }

            // New content: the old positions say nothing about it.
            return tr.docChanged ? DecorationSet.empty : value;
          }
        },
        props: {
          decorations(state) {
            return compareHighlightKey.getState(state) ?? null;
          }
        }
      })
    ];
  }
});

/** Null clears the marks. */
export function setCompareDecorations(editor: Editor, decorations: DecorationSet | null): void {
  if (editor.isDestroyed) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(compareHighlightKey, decorations ?? DecorationSet.empty));
}
