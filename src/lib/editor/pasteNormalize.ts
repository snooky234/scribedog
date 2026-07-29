import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * Repairs pasted slices that carry hard breaks as siblings of block nodes.
 *
 * A hardBreak only ever lives *inside* a textblock, so a slice holding one next
 * to a paragraph is a shape the schema itself can't produce. Selecting across
 * the end of a paragraph that has trailing hard breaks yields exactly that
 * though — the breaks come along as top-level children — and pasting it inserts
 * them as standalone nodes. Each one adds a blank line, and since the pasted
 * content ends up surrounded by breaks again, copying it a second time grows the
 * gap further. They carry no content, so they are dropped.
 *
 * Slices without that defect are returned untouched: hard breaks in a purely
 * inline slice are real content (copying across a <br> inside a paragraph), and
 * an ordinary multi-block copy must keep splitting the target paragraph the way
 * ProseMirror intends.
 */
export function normalizePastedSlice(slice: Slice): Slice {
  const children: ProseMirrorNode[] = [];
  let hasBlock = false;
  let hasStrayBreak = false;

  for (let index = 0; index < slice.content.childCount; index += 1) {
    const child = slice.content.child(index);

    hasBlock = hasBlock || child.isBlock;
    hasStrayBreak = hasStrayBreak || child.type.name === "hardBreak";

    children.push(child);
  }

  // Only the mixed shape is broken — inline-only slices keep their breaks.
  if (!hasBlock || !hasStrayBreak) {
    return slice;
  }

  const kept = children.filter((child) => child.type.name !== "hardBreak");
  const content = Fragment.fromArray(kept);

  // With the stray breaks gone, a single textblock is just inline content. It is
  // reopened so it merges into the paragraph being pasted into instead of
  // splitting it — which is what "paste the emoji next to this one" expects.
  if (kept.length === 1 && kept[0].isTextblock) {
    return new Slice(content, 1, 1);
  }

  return new Slice(content, slice.openStart, slice.openEnd);
}
