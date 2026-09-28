import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";

const LIST_ITEM_TYPES = ["listItem", "taskItem"];
const LIST_TYPES = ["bulletList", "orderedList", "taskList"];

// Backspace in an empty paragraph directly after a list: the line goes away
// and the caret moves to the end of the list's last line, the way the Delete
// key from that line already behaves. If the same kind of list follows, the
// two become one again. This is the second Backspace on an empty checkbox
// (the first lifts it out, which splits the list around an empty paragraph),
// and the Backspace after Enter twice left a list.
//
// TipTap's ListKeymap handles this case by moving the paragraph to the end of
// the last list *item*, not of its last line. Since an item holds block
// content, the empty paragraph became a second block inside that item: a gap
// under it that only goes away by clicking into the invisible line.
function removeEmptyLineAfterList(tr: Transaction): boolean {
  const { selection } = tr;
  const { $from } = selection;

  if (!selection.empty || $from.parent.type.name !== "paragraph" || $from.parent.content.size > 0) {
    return false;
  }

  const depth = $from.depth;
  const index = $from.index(depth - 1);
  const container = $from.node(depth - 1);
  const listBefore = index > 0 ? container.child(index - 1) : null;

  if (!listBefore || !LIST_TYPES.includes(listBefore.type.name)) {
    return false;
  }

  const paragraphStart = $from.before(depth);

  // The last line inside the list, however deep: an item can end with a
  // nested list, an image or a code block.
  const caret = TextSelection.findFrom(tr.doc.resolve(paragraphStart - 1), -1, true);

  if (!caret) {
    return false;
  }

  const listAfter = index + 1 < container.childCount ? container.child(index + 1) : null;

  tr.delete(paragraphStart, $from.after(depth));

  // Two adjacent lists of one kind can't stay apart in Markdown anyway: they
  // would come back as one list after reopening. A different kind stays
  // separate (canJoin alone would merge a bullet into an ordered list).
  if (listAfter?.type === listBefore.type) {
    tr.join(paragraphStart);
  }

  // Everything that changed lies after the caret, so its position holds.
  tr.setSelection(TextSelection.create(tr.doc, caret.head)).scrollIntoView();

  return true;
}

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

      // The check runs on a throwaway transaction. Typing "- " and Backspace
      // right away still undoes the input rule.
      if (removeEmptyLineAfterList(state.tr)) {
        return this.editor.commands.first(({ commands }) => [
          () => commands.undoInputRule(),
          () => commands.command(({ tr }) => removeEmptyLineAfterList(tr))
        ]);
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
