import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Moves the list item (bullet, numbered, or task) the cursor is currently in
// one position up or down. ProseMirror has no built-in command for this, so
// the affected range is manually replaced with the two sibling nodes swapped.
// The cursor position is shifted by exactly the size of the node it passed,
// so the selection stays inside the moved item.
export function moveListItem(view: EditorView, direction: "up" | "down"): boolean {
  const { state } = view;
  const { $from, from, to } = state.selection;

  let listItemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    const nodeTypeName = $from.node(depth).type.name;
    if (nodeTypeName === "listItem" || nodeTypeName === "taskItem") {
      listItemDepth = depth;
      break;
    }
  }

  if (listItemDepth === -1) {
    return false;
  }

  const parentDepth = listItemDepth - 1;
  const parent = $from.node(parentDepth);
  const index = $from.index(parentDepth);
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (targetIndex < 0 || targetIndex >= parent.childCount) {
    return false;
  }

  const currentItem = parent.child(index);
  const siblingItem = parent.child(targetIndex);
  const itemStart = $from.before(listItemDepth);

  const rangeStart = direction === "up" ? itemStart - siblingItem.nodeSize : itemStart;
  const rangeEnd =
    direction === "up"
      ? itemStart + currentItem.nodeSize
      : itemStart + currentItem.nodeSize + siblingItem.nodeSize;
  const replacement =
    direction === "up" ? Fragment.from([currentItem, siblingItem]) : Fragment.from([siblingItem, currentItem]);
  const offset = direction === "up" ? -siblingItem.nodeSize : siblingItem.nodeSize;

  const tr = state.tr.replaceWith(rangeStart, rangeEnd, replacement);
  tr.setSelection(TextSelection.create(tr.doc, from + offset, to + offset));
  tr.scrollIntoView();

  view.dispatch(tr);
  return true;
}

// Toggles the checked state of the task item the cursor is currently in.
// TipTap's task-item extension only flips this attribute via a click on the
// rendered checkbox, so this walks up to the enclosing taskItem node and
// flips its "checked" attribute directly for keyboard-driven use.
export function toggleTaskItemChecked(view: EditorView): boolean {
  const { state } = view;
  const { $from } = state.selection;

  let taskItemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "taskItem") {
      taskItemDepth = depth;
      break;
    }
  }

  if (taskItemDepth === -1) {
    return false;
  }

  const pos = $from.before(taskItemDepth);
  const node = $from.node(taskItemDepth);

  const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked });
  view.dispatch(tr);
  return true;
}
