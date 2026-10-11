import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";

// Where a block node dragged to `pos` (a position under the finger, from
// posAtCoords) would land: the nearest place the schema allows it, the same
// rule ProseMirror applies to a native drop. Null when the node would stay
// where it is (dropped onto itself or right next to itself) or fits nowhere.
export function blockDropPosition(doc: ProseMirrorNode, from: number, pos: number): number | null {
  const node = doc.nodeAt(from);

  if (!node) {
    return null;
  }

  const target = dropPoint(doc, Math.max(0, Math.min(pos, doc.content.size)), new Slice(Fragment.from(node), 0, 0));

  if (target === null || (target >= from && target <= from + node.nodeSize)) {
    return null;
  }

  return target;
}

// Moves the node at `from` to `to` (a position in the unchanged document)
// in one transaction, so it is one undo step, and leaves it selected.
export function moveBlockNode(state: EditorState, from: number, to: number): Transaction | null {
  const node = state.doc.nodeAt(from);

  if (!node || (to >= from && to <= from + node.nodeSize)) {
    return null;
  }

  const tr = state.tr.delete(from, from + node.nodeSize);
  const insertAt = tr.mapping.map(to);
  tr.insert(insertAt, node);

  const moved = tr.doc.nodeAt(insertAt);

  if (moved?.type === node.type) {
    tr.setSelection(NodeSelection.create(tr.doc, insertAt));
  }

  return tr;
}
