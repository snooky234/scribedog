import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// Markup characters that only ever exist in the Markdown serialization — the
// editor's plain text carries none of them, so they are dropped on both sides
// of the comparison in the tolerant pass below.
const MARKUP_CHARS = "*_`~|";

// Leading block markers of a line (blockquote, heading, bullet/ordered list,
// task checkbox). Sticky so it can be probed at a given offset without
// slicing the whole remaining text on every line.
const BLOCK_PREFIX = /[ \t]*(?:>[ \t]*)*(?:#{1,6}[ \t]+|(?:[-*+]|\d{1,9}[.)])[ \t]+)?(?:\[[ xX]\][ \t]+)?/y;

const WHITESPACE = /\s/;

type NormalizedText = { value: string; map: number[] };

// Collapses whitespace, strips leading block markers and inline markup
// characters, and records for every surviving character its index in the
// input so a match can be mapped back. Applied to both sides so a character
// that is markup in one and literal text in the other still lines up.
function normalizeForSearch(text: string): NormalizedText {
  let value = "";
  const map: number[] = [];
  let pendingSpace = false;
  let atLineStart = true;
  let index = 0;

  while (index < text.length) {
    if (atLineStart) {
      atLineStart = false;
      BLOCK_PREFIX.lastIndex = index;

      const prefix = BLOCK_PREFIX.exec(text);

      if (prefix && prefix[0].length > 0) {
        index += prefix[0].length;
        continue;
      }
    }

    const char = text[index];

    if (WHITESPACE.test(char)) {
      if (char === "\n") {
        atLineStart = true;
      }

      // Leading whitespace never becomes a separator — otherwise a passage
      // starting mid-block would not line up with one starting at a block.
      if (value.length > 0) {
        pendingSpace = true;
      }

      index += 1;
      continue;
    }

    if (MARKUP_CHARS.includes(char)) {
      index += 1;
      continue;
    }

    if (pendingSpace) {
      value += " ";
      map.push(index);
      pendingSpace = false;
    }

    value += char;
    map.push(index);
    index += 1;
  }

  return { value, map };
}

// Markdown constructs whose serialization contains characters that have no
// counterpart in the document text at all — removing them cannot be done by
// the per-character pass above. Only ever applied to the needle: none of
// these shapes occur in the editor's plain text.
function stripMarkdownConstructs(input: string): string {
  return input
    .replace(/^[ \t]*```.*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1");
}

// Maps a [startIndex, endIndex] range of the flattened text back to doc
// positions. Block separators carry no real doc position (-1), so both ends
// are pulled onto the nearest actual character of the passage.
function toDocRange(
  positions: number[],
  startIndex: number,
  endIndex: number
): { from: number; to: number } | null {
  let start = startIndex;
  let end = endIndex;

  while (start <= end && positions[start] === -1) {
    start += 1;
  }

  while (end > start && positions[end] === -1) {
    end -= 1;
  }

  if (start > end || positions[start] === -1 || positions[end] === -1) {
    return null;
  }

  return { from: positions[start], to: positions[end] + 1 };
}

// Locates a plain-text passage inside a doc range and maps it back to real
// doc positions. Used wherever a passage has to be found by content instead
// of a stored offset (the AI response carries no reliable character offsets,
// and plain string offsets from textBetween() cannot be added to doc
// positions directly — each block boundary is 2 doc positions but only 1
// "\n" character).
//
// A verbatim match wins. Failing that, a tolerant pass compares both sides
// with whitespace collapsed and Markdown markup stripped: callers hand the
// chat agent the *Markdown* of the document (see agentTools.ts), so its
// passages come back with list bullets, ** emphasis and table pipes that the
// document text does not contain — without this pass, editing a list or
// table row could never match. Returns null if the passage cannot be located.
export function findTextRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  searchText: string
): { from: number; to: number } | null {
  if (!searchText) {
    return null;
  }

  let text = "";
  const positions: number[] = [];

  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) {
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);

      for (let i = start; i < end; i += 1) {
        text += node.text[i - pos];
        positions.push(i);
      }
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
      positions.push(-1);
    }

    return true;
  });

  const exactIndex = text.indexOf(searchText);

  if (exactIndex !== -1) {
    return toDocRange(positions, exactIndex, exactIndex + searchText.length - 1);
  }

  const needle = normalizeForSearch(stripMarkdownConstructs(searchText)).value;

  if (!needle) {
    return null;
  }

  const haystack = normalizeForSearch(text);
  const matchIndex = haystack.value.indexOf(needle);

  if (matchIndex === -1) {
    return null;
  }

  return toDocRange(positions, haystack.map[matchIndex], haystack.map[matchIndex + needle.length - 1]);
}
