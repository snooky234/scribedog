import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// Block numbering for the gutter and the details panel's position line
// (issue #52). The unit is the block, never the screen line: a WYSIWYG
// surface has no fixed line height, and a number that changes when the
// window gets narrower is useless for pointing someone else to a spot.
//
// A block is every textblock (paragraph, heading, code block, the paragraph
// of a list item) and every block-level leaf (image, rule, page break). A
// table counts as one block as a whole: numbering every cell would put
// numbers inside the grid, and "block 12" is enough to find a table.
// Positions inside a block count characters, with every inline leaf (an
// inline image, a hard break) counting as one.

export type NumberedBlock = {
  /** Document position right before the block node. */
  pos: number;
  /** Document position right after it. */
  end: number;
};

const blockCache = new WeakMap<ProseMirrorNode, NumberedBlock[]>();

function isTableNode(node: ProseMirrorNode): boolean {
  return node.type.spec.tableRole === "table" || node.type.name === "table";
}

/**
 * The document's numbered blocks in document order. Cached per document
 * node: the gutter and the details panel both ask after every transaction,
 * and an unchanged document is the same node object.
 */
export function collectNumberedBlocks(doc: ProseMirrorNode): NumberedBlock[] {
  const cached = blockCache.get(doc);

  if (cached) {
    return cached;
  }

  const blocks: NumberedBlock[] = [];

  doc.descendants((node, pos) => {
    if (!node.isBlock) {
      return false;
    }

    if (isTableNode(node) || node.isTextblock || node.isLeaf || node.isAtom) {
      blocks.push({ pos, end: pos + node.nodeSize });
      return false;
    }

    return true;
  });

  blockCache.set(doc, blocks);
  return blocks;
}

/** Index of the block containing `pos`, or of the last block before it, -1 above the first. */
export function blockIndexAt(blocks: NumberedBlock[], pos: number): number {
  let low = 0;
  let high = blocks.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;

    if (blocks[mid].pos <= pos) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

/** Characters between the start of the block's content and `pos`, inline leaves as one each. */
function offsetInBlock(doc: ProseMirrorNode, block: NumberedBlock, pos: number): number {
  const contentStart = block.pos + 1;
  const clamped = Math.min(Math.max(pos, contentStart), block.end - 1);

  if (clamped <= contentStart) {
    return 0;
  }

  return doc.textBetween(contentStart, clamped, "", () => "￼").length;
}

function hasContent(doc: ProseMirrorNode, block: NumberedBlock): boolean {
  const node = doc.nodeAt(block.pos);
  return Boolean(node && !node.isLeaf && !node.isAtom);
}

export type BlockPoint = {
  /** 1-based block number. */
  block: number;
  /** 1-based character column, null for a block without text (image, rule). */
  column: number | null;
};

export type BlockPosition = {
  total: number;
  /** Where the selection starts; for a cursor, where the cursor is. */
  from: BlockPoint;
  /** Where it ends, null for a collapsed cursor. */
  to: BlockPoint | null;
};

function pointAt(doc: ProseMirrorNode, blocks: NumberedBlock[], pos: number, side: "start" | "end"): BlockPoint {
  // The end of a selection that stops right at a block boundary belongs to
  // the block before: selecting a whole paragraph must not read as "into the
  // next one".
  const index = Math.max(0, blockIndexAt(blocks, side === "end" ? pos - 1 : pos));
  const block = blocks[index];

  if (!hasContent(doc, block)) {
    return { block: index + 1, column: null };
  }

  const offset = offsetInBlock(doc, block, pos);

  // A selection dragged down to the very start of a block covers nothing of
  // it; it ends with the last character of the block before.
  if (side === "end" && offset === 0 && index > 0) {
    const previous = blocks[index - 1];
    return {
      block: index,
      column: hasContent(doc, previous) ? offsetInBlock(doc, previous, previous.end - 1) : null
    };
  }

  // A cursor sits before character offset + 1; a selection's end is the last
  // character it covers.
  return { block: index + 1, column: side === "end" ? offset : offset + 1 };
}

/**
 * Block number and character position of a selection. A collapsed selection
 * reports one point; a range reports where it starts (the first character it
 * covers) and ends (the last one), so "7:41 to 7:65" covers 25 characters.
 * Null for an empty document.
 */
export function blockPositionOf(doc: ProseMirrorNode, from: number, to: number): BlockPosition | null {
  const blocks = collectNumberedBlocks(doc);

  if (blocks.length === 0) {
    return null;
  }

  const start = pointAt(doc, blocks, from, "start");

  if (from === to) {
    return { total: blocks.length, from: start, to: null };
  }

  return { total: blocks.length, from: start, to: pointAt(doc, blocks, to, "end") };
}

/**
 * The part of the gutter badge after the block number: the cursor's
 * character ("27"), a range inside the block ("41–65"), or where a range
 * across blocks ends ("27 → 8:4"). Null when there is nothing to add, as on
 * an image.
 */
export function formatBadgePosition(position: BlockPosition): string | null {
  const { from, to } = position;

  if (!to) {
    return from.column === null ? null : String(from.column);
  }

  if (to.block === from.block) {
    if (from.column === null || to.column === null) {
      return null;
    }

    return from.column === to.column ? String(from.column) : `${from.column}–${to.column}`;
  }

  const end = to.column === null ? String(to.block) : `${to.block}:${to.column}`;
  return from.column === null ? `→ ${end}` : `${from.column} → ${end}`;
}
