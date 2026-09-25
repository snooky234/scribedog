import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Shared implementation behind moveListItem and moveLine: swaps the node(s)
// at `depth` that the selection spans with the adjacent sibling in that
// direction. Both callers just pick a different depth — a list item's own
// depth for moveListItem, or 1 (direct children of the doc) for moveLine —
// everything else about "find the sibling, swap the ranges, shift the
// selection by the sibling's size" is identical.
function moveSiblingsAtDepth(view: EditorView, direction: "up" | "down", depth: number): boolean {
  const { state } = view;
  const { selection } = state;
  const { $from, $to, from, to } = selection;
  const parentDepth = depth - 1;

  // A selected block node (an image clicked on, a horizontal rule) is a
  // NodeSelection whose ends sit *around* the node, one level above the
  // position a text cursor inside it would have — the node itself is the
  // range to move.
  const selectsWholeNode = selection instanceof NodeSelection && $from.depth === parentDepth;

  if (!selectsWholeNode && ($from.depth < depth || $to.depth < depth)) {
    return false;
  }

  const parent = $from.node(parentDepth);

  if ($to.node(parentDepth) !== parent) {
    return false;
  }

  const startIndex = $from.index(parentDepth);
  const endIndex = selectsWholeNode ? startIndex : $to.index(parentDepth);
  const targetIndex = direction === "up" ? startIndex - 1 : endIndex + 1;

  if (targetIndex < 0 || targetIndex >= parent.childCount) {
    return false;
  }

  const rangeStart = selectsWholeNode ? from : $from.before(depth);
  const rangeEnd = selectsWholeNode ? to : $to.after(depth);
  const sibling = parent.child(targetIndex);

  const selectedNodes: ProseMirrorNode[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    selectedNodes.push(parent.child(i));
  }

  const replacement =
    direction === "up" ? Fragment.from([...selectedNodes, sibling]) : Fragment.from([sibling, ...selectedNodes]);
  const newRangeStart = direction === "up" ? rangeStart - sibling.nodeSize : rangeStart;
  const newRangeEnd = direction === "up" ? rangeEnd : rangeEnd + sibling.nodeSize;
  const offset = direction === "up" ? -sibling.nodeSize : sibling.nodeSize;

  const tr = state.tr.replaceWith(newRangeStart, newRangeEnd, replacement);
  tr.setSelection(
    selection instanceof NodeSelection
      ? NodeSelection.create(tr.doc, from + offset)
      : TextSelection.create(tr.doc, from + offset, to + offset)
  );
  tr.scrollIntoView();

  view.dispatch(tr);
  return true;
}

// Moves a list item that sits at the edge of a top-level list past the block
// next to the list (an image, a blockquote, a paragraph, …): the item leaves
// its list and either joins an adjacent list of the same type as its first
// (down) or last (up) item, or becomes a new list of its own on the far side
// of the neighbour. The item's nested sub-list travels with it. Only a
// selection inside one item is handled — a range spanning several items has
// no natural single-item meaning here.
function moveListItemAcrossBlock(view: EditorView, direction: "up" | "down", itemDepth: number): boolean {
  const { state } = view;
  const { $from, $to, from, to } = state.selection;
  const listDepth = itemDepth - 1;

  if (listDepth !== 1 || $to.depth < itemDepth || $to.before(itemDepth) !== $from.before(itemDepth)) {
    return false;
  }

  const doc = state.doc;
  const list = $from.node(listDepth);
  const item = $from.node(itemDepth);
  const itemIndex = $from.index(listDepth);
  const listIndex = $from.index(0);
  const neighbourIndex = direction === "up" ? listIndex - 1 : listIndex + 1;

  if (neighbourIndex < 0 || neighbourIndex >= doc.childCount) {
    return false;
  }

  const neighbour = doc.child(neighbourIndex);

  // The empty paragraph StarterKit's TrailingNode keeps at the end of the
  // document is not a block to move past — crossing it would detach the last
  // item from its list for no visible reason.
  if (
    neighbourIndex === doc.childCount - 1 &&
    neighbour.type.name === "paragraph" &&
    neighbour.content.size === 0
  ) {
    return false;
  }

  const listStart = $from.before(listDepth);
  const listEnd = $from.after(listDepth);
  const itemStart = $from.before(itemDepth);
  const itemEnd = $from.after(itemDepth);

  const remainingItems: ProseMirrorNode[] = [];
  for (let i = 0; i < list.childCount; i++) {
    if (i !== itemIndex) {
      remainingItems.push(list.child(i));
    }
  }
  const remainder = remainingItems.length > 0 ? list.copy(Fragment.from(remainingItems)) : null;

  // The item lands in the first list of the same type it reaches: the
  // neighbour itself, or the block right behind it — that is what the
  // markdown line would join once it sits below the image or quote.
  const beyondIndex = direction === "up" ? neighbourIndex - 1 : neighbourIndex + 1;
  const beyond = beyondIndex >= 0 && beyondIndex < doc.childCount ? doc.child(beyondIndex) : null;
  const mergeInto = neighbour.type === list.type ? neighbour : beyond?.type === list.type ? beyond : null;
  const crossed: ProseMirrorNode[] = mergeInto === neighbour ? [] : [neighbour];
  const crossedSize = crossed.reduce((sum, node) => sum + node.nodeSize, 0);
  const target = mergeInto
    ? direction === "up"
      ? mergeInto.copy(mergeInto.content.append(Fragment.from(item)))
      : mergeInto.copy(Fragment.from(item).append(mergeInto.content))
    : list.copy(Fragment.from(item));
  const replacedSize = crossedSize + (mergeInto ? mergeInto.nodeSize : 0);

  const nodes: ProseMirrorNode[] = [];
  let newItemStart: number;
  const rangeStart = direction === "up" ? listStart - replacedSize : listStart;
  const rangeEnd = direction === "up" ? listEnd : listEnd + replacedSize;

  if (direction === "up") {
    nodes.push(target, ...crossed);
    newItemStart = rangeStart + 1 + (mergeInto ? mergeInto.content.size : 0);
    if (remainder) {
      nodes.push(remainder);
    }
  } else {
    if (remainder) {
      nodes.push(remainder);
    }
    nodes.push(...crossed, target);
    newItemStart = rangeStart + (remainder ? remainder.nodeSize : 0) + crossedSize + 1;
  }

  const tr = state.tr.replaceWith(rangeStart, rangeEnd, Fragment.from(nodes));
  const anchor = Math.min(Math.max(from, itemStart), itemEnd) - itemStart;
  const head = Math.min(Math.max(to, itemStart), itemEnd) - itemStart;
  tr.setSelection(
    state.selection instanceof NodeSelection
      ? NodeSelection.create(tr.doc, newItemStart + anchor)
      : TextSelection.create(tr.doc, newItemStart + anchor, newItemStart + head)
  );
  tr.scrollIntoView();

  view.dispatch(tr);
  return true;
}

// Moves the list item (bullet, numbered, or task) the selection is currently
// in — or the range of sibling items it spans — one position up or down.
// ProseMirror has no built-in command for this, so the affected range is
// manually replaced with the sibling nodes swapped. At the edge of a top-level
// list the item is moved past the neighbouring block instead (see
// moveListItemAcrossBlock). Returns true whenever the selection is inside a
// list item, even if nothing could move: falling through to moveLine there
// would shove the whole list past its neighbour, which is never what a
// "move this line" keystroke means.
export function moveListItem(view: EditorView, direction: "up" | "down"): boolean {
  const { $from } = view.state.selection;

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

  if (!moveSiblingsAtDepth(view, direction, listItemDepth)) {
    moveListItemAcrossBlock(view, direction, listItemDepth);
  }

  return true;
}

// Moves the top-level block(s) (paragraph, heading, blockquote, code block,
// a selected image, etc.) the selection spans one position up or down, the same way VS Code's
// Alt+Up/Down moves whole lines. This is the fallback for content that isn't
// inside a list — moveListItem takes priority there.
export function moveLine(view: EditorView, direction: "up" | "down"): boolean {
  return moveSiblingsAtDepth(view, direction, 1);
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
