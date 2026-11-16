import { Extension } from "@tiptap/core";
import { createParagraphNear } from "@tiptap/pm/commands";
import { GapCursor } from "@tiptap/pm/gapcursor";
import type { ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, Selection, type EditorState } from "@tiptap/pm/state";

// A caret after an image that ends a list item (or a quote, a callout, a
// table cell), so text or a second image can go below it.
//
// ProseMirror's gap cursor already covers two images in a row and an image at
// the very end of the document. It refuses the end of a container that more
// text follows, though: prosemirror-gapcursor only accepts a position if the
// next thing in the document is not a text line either, and after the last
// item comes the next item's paragraph. An item holding just an image
// (listItem.ts) therefore had no position below the image at all: the arrow
// keys jumped from the image straight into the next item, and new text could
// only be placed by typing above the image and moving things around.
//
// The arrow keys stop at that position here, with the same GapCursor
// selection, so it is painted, typed into (ProseMirror wraps the text in a
// paragraph) and pasted at like the gaps the library finds itself. Enter
// opens an empty line there; left to the keymap, the list item's own Enter
// would claim the key first and put the caret into the next item.

export function isEndGap($pos: ResolvedPos): boolean {
  const { parent } = $pos;
  const before = $pos.nodeBefore;

  if ($pos.depth === 0 || parent.inlineContent || $pos.index() !== parent.childCount) {
    return false;
  }

  if (!before || !before.isBlock || !before.isAtom) {
    return false;
  }

  // Only where a text line may follow. Where the library accepts the position
  // itself, this sets the very selection it would.
  return Boolean(parent.contentMatchAt($pos.index()).defaultType?.isTextblock);
}

type Direction = "forward" | "backward";

export function moveAroundEndGap(state: EditorState, direction: Direction): Selection | null {
  const { selection } = state;

  if (direction === "forward" && selection instanceof NodeSelection && isEndGap(selection.$to)) {
    return new GapCursor(selection.$to);
  }

  if (selection instanceof GapCursor && isEndGap(selection.$head)) {
    const $pos = selection.$head;

    if (direction === "backward") {
      return NodeSelection.create(state.doc, $pos.pos - ($pos.nodeBefore?.nodeSize ?? 0));
    }

    return Selection.findFrom($pos, 1) ?? null;
  }

  return null;
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowRight: "forward",
  ArrowDown: "forward",
  ArrowLeft: "backward",
  ArrowUp: "backward"
};

export const EndGapCursor = Extension.create({
  name: "endGapCursor",

  // Ahead of the gap cursor plugin, which would hand the key on otherwise.
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("endGapCursor"),
        props: {
          handleKeyDown(view, event) {
            const { selection } = view.state;

            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              selection instanceof GapCursor &&
              isEndGap(selection.$head)
            ) {
              return createParagraphNear(view.state, view.dispatch);
            }

            const direction = KEY_DIRECTIONS[event.key];

            if (!direction || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
              return false;
            }

            const next = moveAroundEndGap(view.state, direction);

            if (!next) {
              return false;
            }

            view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
            return true;
          }
        }
      })
    ];
  }
});
