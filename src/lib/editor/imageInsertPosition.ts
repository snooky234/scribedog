import { NodeSelection, type Selection } from "@tiptap/pm/state";

// Where a pasted, picked or drawn image goes.
//
// With a caret or a text range that is the start of the selection. With a
// selected node (an image clicked on, a table) it is the end: the user marked
// the image to add the next one after it. An image that is the only content
// of a list item leaves no caret position after it, so selecting it is the
// only way to point there; inserting at the start put the new image above.
export function imageInsertPosition(selection: Selection): number {
  return selection instanceof NodeSelection ? selection.to : selection.from;
}
