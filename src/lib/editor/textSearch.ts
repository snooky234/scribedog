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

// Typographic variants of characters that mean the same thing. A model
// quoting a passage back regularly "tidies" it on the way — straight quotes
// become curly ones, a hyphen becomes an en dash, three dots become an
// ellipsis — and none of that changes which passage was meant, so the
// tolerant passes below compare with one spelling of each.
const PUNCTUATION_FOLD: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
  "«": '"',
  "»": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "…": "..."
};

// A needle shorter than this is never matched approximately: at that length a
// handful of edits can turn one word into a different one, and replacing the
// wrong three words is worse than reporting the passage as not found.
const FUZZY_MIN_LENGTH = 24;

// How much of the passage may differ. Enough for a swapped word, a dropped
// comma or a normalized spelling; not enough for a different sentence.
const FUZZY_MAX_ERROR_RATIO = 0.15;

// Ceiling on the approximate search's O(needle × document) work, so a long
// passage in a long document falls back to "not found" quickly instead of
// blocking the UI thread. Both are already unusual: this pass only ever runs
// after three exact ones have failed.
const FUZZY_MAX_WORK = 20_000_000;

// Folds typography and case, keeping every character's origin. Characters can
// expand ("…" → "..."), so the map is rebuilt rather than reused — and it is
// composed straight through the input's own map, so its entries keep pointing
// at the original text.
function foldForCompare(input: NormalizedText): NormalizedText {
  let value = "";
  const map: number[] = [];

  for (let index = 0; index < input.value.length; index += 1) {
    const char = input.value[index];
    const folded = (PUNCTUATION_FOLD[char] ?? char).toLowerCase();

    for (let offset = 0; offset < folded.length; offset += 1) {
      value += folded[offset];
      map.push(input.map[index]);
    }
  }

  return { value, map };
}

/**
 * Approximate substring search: the window of `haystack` that `needle` matches
 * most closely, or null if even the best one needs more than `maxEdits`
 * changes.
 *
 * A Levenshtein DP with a free start (row 0 is all zeros, so a match may begin
 * anywhere) and a free end (the answer is the cheapest cell of the last row).
 * Every cell carries the position its match began at, which is what turns the
 * distance into a range. Two rows at a time, so the memory cost is the
 * document's length rather than its square.
 */
function findApproximateRange(
  haystack: string,
  needle: string,
  maxEdits: number
): { start: number; end: number } | null {
  const width = haystack.length + 1;
  let previousCost = new Int32Array(width);
  let previousStart = new Int32Array(width);
  let cost = new Int32Array(width);
  let start = new Int32Array(width);

  for (let column = 0; column < width; column += 1) {
    previousStart[column] = column;
  }

  for (let row = 1; row <= needle.length; row += 1) {
    cost[0] = row;
    start[0] = 0;

    let rowMinimum = row;

    for (let column = 1; column < width; column += 1) {
      const substitution = previousCost[column - 1] + (needle[row - 1] === haystack[column - 1] ? 0 : 1);
      const dropped = previousCost[column] + 1;
      const inserted = cost[column - 1] + 1;

      if (substitution <= dropped && substitution <= inserted) {
        cost[column] = substitution;
        start[column] = previousStart[column - 1];
      } else if (dropped <= inserted) {
        cost[column] = dropped;
        start[column] = previousStart[column];
      } else {
        cost[column] = inserted;
        start[column] = start[column - 1];
      }

      rowMinimum = Math.min(rowMinimum, cost[column]);
    }

    // The row minimum never decreases as rows are added, so once it is past
    // the budget no later row can come back under it.
    if (rowMinimum > maxEdits) {
      return null;
    }

    [previousCost, cost] = [cost, previousCost];
    [previousStart, start] = [start, previousStart];
  }

  let bestEnd = -1;
  let bestCost = maxEdits + 1;

  for (let column = 1; column < width; column += 1) {
    if (previousCost[column] < bestCost) {
      bestCost = previousCost[column];
      bestEnd = column;
    }
  }

  if (bestEnd === -1) {
    return null;
  }

  const matchStart = previousStart[bestEnd];

  return matchStart < bestEnd ? { start: matchStart, end: bestEnd - 1 } : null;
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
// A verbatim match wins. Failing that, three progressively more tolerant
// passes run, because the passage comes from a language model rather than from
// a stored offset and is rarely character-identical to the document:
//
//  1. whitespace collapsed and Markdown markup stripped — callers hand the
//     chat agent the *Markdown* of the document (see agentTools.ts), so its
//     passages come back with list bullets, ** emphasis and table pipes the
//     document text does not contain;
//  2. typography and case folded, for the quotes, dashes and capitalization a
//     model silently normalizes while quoting;
//  3. an approximate match, for the swapped word or dropped comma that is left
//     — the alternative there is "passage not found", which sends the model
//     into a retry loop over a passage it did identify correctly.
//
// `fuzzy: false` stops before that last pass, for callers that keep searching
// after a hit and would otherwise land on a merely similar passage further
// down the document. Returns null if the passage cannot be located.
export function findTextRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  searchText: string,
  { fuzzy = true }: { fuzzy?: boolean } = {}
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

  const normalizedNeedle = normalizeForSearch(stripMarkdownConstructs(searchText));

  if (!normalizedNeedle.value) {
    return null;
  }

  const haystack = normalizeForSearch(text);
  const matchIndex = haystack.value.indexOf(normalizedNeedle.value);

  if (matchIndex !== -1) {
    return toDocRange(
      positions,
      haystack.map[matchIndex],
      haystack.map[matchIndex + normalizedNeedle.value.length - 1]
    );
  }

  const foldedHaystack = foldForCompare(haystack);
  const foldedNeedle = foldForCompare(normalizedNeedle).value;
  const foldedIndex = foldedHaystack.value.indexOf(foldedNeedle);

  if (foldedIndex !== -1) {
    return toDocRange(
      positions,
      foldedHaystack.map[foldedIndex],
      foldedHaystack.map[foldedIndex + foldedNeedle.length - 1]
    );
  }

  if (
    !fuzzy ||
    foldedNeedle.length < FUZZY_MIN_LENGTH ||
    foldedNeedle.length * foldedHaystack.value.length > FUZZY_MAX_WORK
  ) {
    return null;
  }

  const approximate = findApproximateRange(
    foldedHaystack.value,
    foldedNeedle,
    Math.floor(foldedNeedle.length * FUZZY_MAX_ERROR_RATIO)
  );

  if (!approximate) {
    return null;
  }

  return toDocRange(positions, foldedHaystack.map[approximate.start], foldedHaystack.map[approximate.end]);
}
