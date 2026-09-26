import { Extension } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

const LIST_ITEM_TYPES = ["listItem", "taskItem"];

// Depth of the list item the cursor sits in, or -1 outside any list.
function listItemDepth(state: EditorState): number {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    if (LIST_ITEM_TYPES.includes($from.node(depth).type.name)) {
      return depth;
    }
  }

  return -1;
}

// TipTap's ListKeymap lifts the whole list item out of the list when Backspace
// is pressed "at the start of the node", but its check is `parentOffset === 0`:
// the start of the current *block*, not of the item. A list item holds block
// content (`nested: true` on TaskItem, and a paragraph after an image or a
// nested list in any item), so the caret in an empty paragraph below an image
// always satisfies it — Backspace there dissolved the item and took its
// checkbox or bullet with it (issue: the empty line under an image can't be
// removed without destroying the formatting) instead of deleting that line.
//
// This keymap runs before ListKeymap and lets the lift happen only when the
// caret really is at the start of the item, i.e. in its first child block.
// Everywhere else inside the item it hands Backspace to ProseMirror's default
// (joinBackward/deleteBarrier), which removes the empty paragraph and leaves
// the item and its marker intact.
export const ListBackspace = Extension.create({
  name: "listBackspace",

  // Above ListKeymap's default 100, so this runs first and can stop it.
  priority: 110,

  addKeyboardShortcuts() {
    const guard = () => {
      const { state } = this.editor;
      const { selection } = state;

      if (!selection.empty) {
        return false;
      }

      const depth = listItemDepth(state);

      if (depth === -1) {
        return false;
      }

      const { $from } = selection;

      // Only the first block of the item may lift; the input rule undo that
      // ListKeymap does first stays reachable there.
      if ($from.index(depth) === 0) {
        return false;
      }

      // Claim the key and fall through to ProseMirror's default handling.
      return this.editor.commands.first(({ commands }) => [
        () => commands.undoInputRule(),
        () => commands.deleteSelection(),
        () => commands.joinBackward(),
        () => commands.selectNodeBackward()
      ]);
    };

    return {
      Backspace: guard,
      "Mod-Backspace": guard
    };
  }
});
