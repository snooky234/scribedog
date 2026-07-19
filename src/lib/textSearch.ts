import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
};

// A match found in plain markdown text (used for non-open files).
export type TextMatch = {
  start: number;
  end: number;
  text: string;
  before: string;
  after: string;
};

// A match found in the live ProseMirror document (positions are doc positions,
// not string offsets — see findMatchesInDoc).
export type DocMatch = {
  from: number;
  to: number;
  text: string;
  before: string;
  after: string;
};

const CONTEXT_LENGTH = 32;
const WORD_CHAR = "[\\p{L}\\p{N}_]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Returns null for an empty query so callers can treat "no search" and
// "search with zero matches" differently.
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  if (!query) {
    return null;
  }

  const escaped = escapeRegExp(query);
  const source = options.wholeWord
    ? `(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`
    : escaped;
  const flags = options.caseSensitive ? "gu" : "giu";

  return new RegExp(source, flags);
}

function extractContext(text: string, start: number, end: number): { before: string; after: string } {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = (() => {
    const index = text.indexOf("\n", end);
    return index === -1 ? text.length : index;
  })();

  const beforeStart = Math.max(lineStart, start - CONTEXT_LENGTH);
  const afterEnd = Math.min(lineEnd, end + CONTEXT_LENGTH);

  return {
    before: (beforeStart > lineStart ? "…" : "") + text.slice(beforeStart, start),
    after: text.slice(end, afterEnd) + (afterEnd < lineEnd ? "…" : "")
  };
}

export function findMatchesInText(text: string, regex: RegExp): TextMatch[] {
  const matches: TextMatch[] = [];

  regex.lastIndex = 0;

  for (const match of text.matchAll(regex)) {
    if (match[0].length === 0) {
      break;
    }

    const start = match.index;
    const end = start + match[0].length;

    matches.push({ start, end, text: match[0], ...extractContext(text, start, end) });
  }

  return matches;
}

// Searches every textblock of the document. Within a block the text is built
// from the block's inline content, where each non-text leaf (hard break,
// inline node) contributes exactly one "\n" — its nodeSize is also 1, so
// string offsets map 1:1 onto doc positions relative to the block start.
// Matches therefore never span block boundaries (same behavior as most
// editors' find widgets).
export function findMatchesInDoc(doc: ProseMirrorNode, regex: RegExp): DocMatch[] {
  const matches: DocMatch[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }

    const blockText = node.textBetween(0, node.content.size, undefined, "\n");

    regex.lastIndex = 0;

    for (const match of blockText.matchAll(regex)) {
      if (match[0].length === 0) {
        break;
      }

      const start = match.index;
      const end = start + match[0].length;

      matches.push({
        from: pos + 1 + start,
        to: pos + 1 + end,
        text: match[0],
        ...extractContext(blockText, start, end)
      });
    }

    return false;
  });

  return matches;
}

// Applies the selected replacements to plain markdown text, back to front so
// earlier offsets stay valid.
export function applyTextReplacements(
  text: string,
  matches: TextMatch[],
  replacement: string
): string {
  let result = text;

  for (const match of [...matches].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, match.start) + replacement + result.slice(match.end);
  }

  return result;
}
