import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { comparableText } from "@/lib/editor/textSearch";
import { diffLines } from "@/lib/textDiff";

/**
 * "Open as reference": another note read-only to the left of the open one,
 * and optionally the passages that differ marked in that second note.
 *
 * The comparison runs on rendered blocks, not on markdown lines. Two notes
 * written by different people differ in how they spell the same thing (a
 * "*" bullet against a "-", a line break inside a paragraph, a table padded
 * differently), and a line diff would mark all of that. A block's key is its
 * visible text folded the way the passage search compares text, plus the
 * kind of block, so a heading that became a paragraph still counts.
 */
export type CompareBlock = {
  /** Position before the block node, as ProseMirror counts. */
  from: number;
  to: number;
  key: string;
};

/**
 * A run of differences. `refStart`/`refEnd` (exclusive) are the blocks of
 * the reference that the open note does not have as they are; the open
 * note's blocks of the same run start at `mainStart`, `mainCount` of them.
 */
export type CompareHunk = {
  refStart: number;
  refEnd: number;
  mainStart: number;
  mainCount: number;
};

/**
 * The key of a block the comparison looks at, null for one it skips (an
 * empty paragraph), undefined for a container whose children count instead.
 */
function blockKey(node: ProseMirrorNode): string | null | undefined {
  if (node.isTextblock) {
    const text = comparableText(node.textContent);

    if (!text) {
      return null;
    }

    const level = node.type.name === "heading" ? String(node.attrs.level ?? "") : "";

    return `${node.type.name}${level}:${text}`;
  }

  if (node.type.name === "image") {
    return `image:${String(node.attrs.src ?? "")}`;
  }

  if (node.isBlock && node.isAtom) {
    return `[${node.type.name}]`;
  }

  return undefined;
}

/**
 * The blocks a comparison looks at, in document order: every textblock with
 * text, every image and every other leaf block (a rule, a page break). Empty
 * paragraphs are left out, since a blank line more or less is not a
 * difference anybody wants pointed at.
 */
export function collectCompareBlocks(doc: ProseMirrorNode): CompareBlock[] {
  const blocks: CompareBlock[] = [];

  doc.descendants((node, pos) => {
    const key = blockKey(node);

    if (key === undefined) {
      // A container (list, quote, table, callout): its children count.
      return true;
    }

    if (key !== null) {
      // Line breaks would split one key into two lines of the diff below.
      blocks.push({ from: pos, to: pos + node.nodeSize, key: key.replace(/\s+/g, " ") });
    }

    return false;
  });

  return blocks;
}

/**
 * Diffs the block keys of the compared note (`refKeys`) against those of the
 * open note (`mainKeys`) and groups adjacent differences into hunks.
 */
export function diffBlockKeys(refKeys: readonly string[], mainKeys: readonly string[]): CompareHunk[] {
  const ops = diffLines(refKeys.join("\n"), mainKeys.join("\n"));
  const hunks: CompareHunk[] = [];
  let refIndex = 0;
  let mainIndex = 0;
  let current: CompareHunk | null = null;

  for (const op of ops) {
    if (op.type === "equal") {
      current = null;
      refIndex += 1;
      mainIndex += 1;
      continue;
    }

    if (!current) {
      current = { refStart: refIndex, refEnd: refIndex, mainStart: mainIndex, mainCount: 0 };
      hunks.push(current);
    }

    if (op.type === "remove") {
      refIndex += 1;
      current.refEnd = refIndex;
    } else {
      mainIndex += 1;
      current.mainCount += 1;
    }
  }

  return hunks;
}

/**
 * What a hunk means to someone reading the reference. A diff only knows
 * "removed" and "added", so a paragraph that was merely reworded comes out
 * as one of each, and showing them as "missing" plus "one paragraph more"
 * describes a change nobody made. Pairing them up first gives three kinds:
 * blocks of the reference that are there in another form (`changed`), blocks
 * the open note does not have at all (`missing`), and blocks only the open
 * note has (`extra`).
 *
 * The pairing goes by position inside the hunk, which is what the diff's
 * order suggests, and only pairs blocks of one kind: text with text, an
 * image with an image. An image facing a paragraph is not "the same thing,
 * reworded", it is one missing and one extra.
 */
export type CompareBlockKind = "changed" | "missing";

export type ClassifiedHunk = CompareHunk & {
  /** One entry per reference block of the hunk, in order. */
  kinds: CompareBlockKind[];
  extra: number;
};

function blockFamily(key: string): string {
  if (key.startsWith("image:")) {
    return "image";
  }

  return key.startsWith("[") ? key : "text";
}

export function classifyCompareHunk(
  hunk: CompareHunk,
  refKeys: readonly string[],
  mainKeys: readonly string[]
): ClassifiedHunk {
  const kinds: CompareBlockKind[] = [];
  let paired = 0;

  for (let offset = 0; offset < hunk.refEnd - hunk.refStart; offset += 1) {
    const refKey = refKeys[hunk.refStart + offset];
    const mainKey = offset < hunk.mainCount ? mainKeys[hunk.mainStart + offset] : undefined;

    if (refKey !== undefined && mainKey !== undefined && blockFamily(refKey) === blockFamily(mainKey)) {
      kinds.push("changed");
      paired += 1;
    } else {
      kinds.push("missing");
    }
  }

  return { ...hunk, kinds, extra: hunk.mainCount - paired };
}

export function compareDocuments(refDoc: ProseMirrorNode, mainDoc: ProseMirrorNode) {
  const refBlocks = collectCompareBlocks(refDoc);
  const refKeys = refBlocks.map((block) => block.key);
  const mainKeys = collectCompareBlocks(mainDoc).map((block) => block.key);
  const hunks = diffBlockKeys(refKeys, mainKeys).map((hunk) => classifyCompareHunk(hunk, refKeys, mainKeys));

  return { refBlocks, hunks };
}
